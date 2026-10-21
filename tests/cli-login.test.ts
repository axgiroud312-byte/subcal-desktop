import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createCliLogin, type CliLoginOptions } from '../src/main/login/cli-login';

const paste = 'https://claude.ai/oauth/authorize?redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode';
const browser = 'https://claude.ai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1234%2Fcallback';
type FakeChild = ChildProcessWithoutNullStreams & { stdout: PassThrough; stderr: PassThrough };
function fake(provider: 'claude-local' | 'grok-build', start: (child: FakeChild, dir: string) => void, extra: Partial<CliLoginOptions['cli']> = {}) {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => { queueMicrotask(() => child.emit('close', null)); return true; } });
  let dir = '', killed = 0;
  const kill = child.kill; child.kill = (...args) => { killed++; return kill(...args); };
  const options: CliLoginOptions = { fetch, now: Date.now, cli: { executable: 'fake-official-cli', platform: 'linux', pasteGraceMs: 0, linkTimeoutMs: 500, env: { ANTHROPIC_API_KEY: 'existing', GROK_AUTH_PATH: 'existing', CLAUDE_CONFIG_DIR: 'existing' }, ...extra,
    spawn: (_file, args, opts) => {
      assert.equal(opts.windowsHide, true); assert.equal(opts.shell, undefined);
      assert.deepEqual(args, provider === 'claude-local' ? ['auth', 'login', '--claudeai'] : ['login', '--device-auth']);
      assert.equal(opts.env?.ANTHROPIC_API_KEY, undefined); assert.equal(opts.env?.GROK_AUTH_PATH, undefined);
      dir = String(opts.cwd); assert.equal(opts.env?.[provider === 'claude-local' ? 'CLAUDE_CONFIG_DIR' : 'GROK_HOME'], dir);
      setImmediate(() => start(child, dir)); return child;
    },
  } };
  return { options, child, dir: () => dir, killed: () => killed };
}
test('Claude prioritizes captured loopback and requires successful CLI + isolated credentials', async () => {
  const f = fake('claude-local', (child, dir) => {
    child.stdout.write(paste + '\n');
    void writeFile(join(dir, '.opened-url'), browser);
  }, { pasteGraceMs: 100 });
  const flow = await createCliLogin('claude-local', f.options);
  assert.equal(flow.url, browser); assert.equal(flow.submit, undefined);
  assert.equal(await flow.poll(), null);
  await writeFile(join(f.dir(), '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'private-token', expiresAt: Date.now() + 60000 } }));
  assert.equal(await flow.poll(), null);
  f.child.emit('close', 0);
  const credential = await flow.poll();
  assert.equal(JSON.parse(credential!.secret).management, 'static');
  assert.equal(JSON.parse(credential!.secret).accessToken, 'private-token');
  await assert.rejects(access(f.dir()));
  assert.deepEqual(await flow.poll(), credential);
});
test('paste flow accepts code through application stdin, never declares URL success', async () => {
  const f = fake('claude-local', child => child.stdout.write(paste + '\n'));
  const flow = await createCliLogin('claude-local', f.options);
  assert.ok(flow.submit); assert.equal(await flow.poll(), null);
  let submitted = ''; f.child.stdin.on('data', c => submitted += c);
  await flow.submit('official-code#state'); assert.equal(submitted, 'official-code#state\n');
  await assert.rejects(flow.submit('bad\ncommand'), { code: 'INVALID_CODE' });
  flow.cancel(); await assert.rejects(flow.poll(), { code: 'CANCELLED' });
  await new Promise(r => setTimeout(r, 30)); assert.equal(f.killed(), 1); await assert.rejects(access(f.dir()));
});
test('Grok device login reads keyed auth.json; chunked URL stays intact', async () => {
  const f = fake('grok-build', child => { child.stdout.write('https://auth.x.ai/act'); child.stdout.write('ivate\nCode: ABCD-EFGH\n'); });
  const flow = await createCliLogin('grok-build', f.options);
  assert.equal(flow.url, 'https://auth.x.ai/activate'); assert.equal(flow.userCode, 'ABCD-EFGH');
  await writeFile(join(f.dir(), 'auth.json'), JSON.stringify({ xai: { key: 'grok-secret', user_id: 'account-1', email: null, expires_at: new Date(Date.now() + 60000).toISOString() } }));
  f.child.emit('close', 0); assert.equal((await flow.poll())?.subject, 'account-1');
});
test('failure and timeout sanitize CLI output and remove isolated directory', async () => {
  const f = fake('grok-build', child => child.stderr.write('Error: https://auth.x.ai/oauth2/device/code secret-token\n'), { linkTimeoutMs: 60 });
  await assert.rejects(createCliLogin('grok-build', f.options), (error: Error) => !error.message.includes('secret-token') && 'code' in error && error.code === 'NO_URL');
  assert.equal(f.killed(), 1); await assert.rejects(access(f.dir()));
});
test('expiry kills background CLI even without polling', async () => {
  const f = fake('claude-local', child => child.stdout.write(paste + '\n'), { lifetimeMs: 150 });
  const flow = await createCliLogin('claude-local', f.options);
  await new Promise(r => setTimeout(r, 200));
  await assert.rejects(flow.poll(), { code: 'EXPIRED' }); assert.equal(f.killed(), 1); await assert.rejects(access(f.dir()));
});
test('macOS reads and deletes only hashed isolated keychain item', async () => {
  const calls: [string, boolean][] = [];
  const f = fake('claude-local', child => child.stdout.write(paste + '\n'), { platform: 'darwin', systemSecret: async (service, remove) => { calls.push([service, remove]); return remove ? null : JSON.stringify({ claudeAiOauth: { accessToken: 'keychain-token' } }); } });
  const flow = await createCliLogin('claude-local', f.options); f.child.emit('close', 0);
  assert.equal(JSON.parse((await flow.poll())!.secret).accessToken, 'keychain-token');
  assert.match(calls[0][0], /^Claude Code-credentials-[a-f0-9]{8}$/); assert.deepEqual(calls.map(c => c[1]), [false, true]);
});
test('missing runtime is actionable without terminal-login instructions', async () => {
  await assert.rejects(createCliLogin('grok-build', { fetch, now: Date.now, cli: { env: {}, home: join(process.cwd(), 'nonexistent-test-home') } }), { code: 'RUNTIME_MISSING' });
});
test('Windows creates browser capture helper without launching a terminal', async () => {
  const f = fake('claude-local', child => child.stdout.write(paste + '\n'), { platform: 'win32' });
  const flow = await createCliLogin('claude-local', f.options);
  assert.match(await readFile(join(f.dir(), 'browser.cmd'), 'utf8'), /-NonInteractive/);
  flow.cancel(); await new Promise(r => setTimeout(r, 30));
});
