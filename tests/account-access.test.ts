import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountAccess, type AccountCredential, type CredentialEnvelope } from '../src/main/account-access';
import { hashKeySubject } from '../src/main/adapters/http-adapters';

const token = (user = 'user-a', exp = 10000) => `e30.${Buffer.from(JSON.stringify({ sub: user, exp, email: 'fixture@example.test', 'https://api.openai.com/auth': { chatgpt_account_id: 'account-a', chatgpt_user_id: user } })).toString('base64url')}.fixture`;
const auth = (user = 'user-a', access = token(user)) => ({ auth_mode: 'chatgpt', tokens: { access_token: access, id_token: token(user), refresh_token: 'fixture-refresh', account_id: 'account-a' } });
const payload = (c: AccountCredential) => JSON.parse(c.secret) as CredentialEnvelope;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const home = await mkdtemp(join(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir(), 'account-access-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const put = async (path: string, value: unknown) => { const p = join(home, path); await mkdir(join(p, '..'), { recursive: true }); await writeFile(p, typeof value === 'string' ? value : JSON.stringify(value)); };
  return { home, put, create: (extra = {}) => new AccountAccess({ home, env: {}, platform: 'linux', ...extra }) };
}

test('discovery is secret-free; CODEX_HOME resolves afresh and rejects changed identity', async t => {
  const f = await fixture(t); await f.put('custom/auth.json', auth());
  const access = f.create({ env: { CODEX_HOME: join(f.home, 'custom') } });
  const found = await access.discover(); assert.equal(found.accounts.length, 1); assert.deepEqual(found.warnings, []);
  assert.ok(!JSON.stringify(found).includes('fixture-refresh')); assert.ok(!JSON.stringify(found).includes('access_token'));
  const c = await access.resolve(found.accounts[0].id); assert.equal(payload(c).management, 'external');
  await f.put('custom/auth.json', auth('user-a', token('user-a', 20000)));
  assert.notEqual((await access.refreshExternal(c)).secret, c.secret);
  await f.put('custom/auth.json', auth('user-b'));
  await assert.rejects(access.resolve(found.accounts[0].id), { code: 'ACCOUNT_MISMATCH' });
  await assert.rejects(access.refreshExternal(c), { code: 'ACCOUNT_MISMATCH' });
  assert.equal(JSON.parse(await readFile(join(f.home, 'custom/auth.json'), 'utf8')).tokens.id_token, token('user-b'));
});

test('Codex keyring selects canonical service/account and denied auto never falls back', async t => {
  const f = await fixture(t); await f.put('.codex/config.toml', 'cli_auth_credentials_store = "auto"\n'); await f.put('.codex/auth.json', auth('stale'));
  const access = f.create({ platform: 'darwin', readSystemSecret: async (service: string, account: string) => {
    if (service !== 'Codex Auth') return null;
    assert.match(account, /^cli\|[a-f0-9]{16}$/); return JSON.stringify(auth());
  } });
  assert.equal((await access.discover()).accounts.length, 1);
  const denied = f.create({ platform: 'darwin', readSystemSecret: async () => { throw Error('SECRET MUST NOT ESCAPE'); } });
  const result = await denied.discover(); assert.equal(result.accounts.length, 0); assert.ok(result.warnings.some(w => /不可读/.test(w))); assert.ok(!result.warnings.join().includes('SECRET'));
});

test('Windows encrypted keyring is explicitly unreadable; file mode still supported', async t => {
  const f = await fixture(t); await f.put('.codex/config.toml', 'cli_auth_credentials_store = "auto"\n'); await f.put('.codex/auth.json', auth());
  const access = f.create({ platform: 'win32' }); let found = await access.discover();
  assert.equal(found.accounts.length, 0); assert.ok(found.warnings.some(w => w.includes('加密系统存储')));
  await f.put('.codex/config.toml', 'cli_auth_credentials_store = "file"\n'); found = await access.discover(); assert.equal(found.accounts.length, 1);
});

test('Claude empty keychain means logout; both OAuth shapes follow rotation with verified stable identity', async t => {
  const f = await fixture(t); await f.put('.claude/.credentials.json', { claudeAiOauth: { accessToken: 'fixture-claude' } });
  const access = f.create({ platform: 'darwin', readSystemSecret: async () => '{}' }); assert.equal((await access.discover()).accounts.length, 0);
  let accountId = 'fixture-account';
  const file = f.create({ fetch: async () => response({ account: { uuid: accountId, email_address: 'fixture@example.test' }, organization: { uuid: 'fixture-org' } }) });
  await f.put('.claude.json', { oauthAccount: { accountUuid: accountId, organizationUuid: 'fixture-org' } });
  const found = await file.discover(); const c = await file.resolve(found.accounts[0].id); assert.equal(c.providerId, 'claude-local');
  await f.put('.claude/.credentials.json', { 'claude.ai_oauth': { accessToken: 'fixture-rotated' } });
  assert.equal((await file.refreshExternal(c)).subject, c.subject);
  accountId = 'other-account'; await f.put('.claude/.credentials.json', { claudeAiOauth: { accessToken: 'fixture-other' } });
  await assert.rejects(file.refreshExternal(c), { code: 'ACCOUNT_MISMATCH' });
});

test('Copilot editor and CLI remain separate and CLI system token is never listed', async t => {
  const f = await fixture(t);
  await f.put('.config/github-copilot/apps.json', { 'github.com:client': { user: 'fixture-user', oauth_token: 'fixture-editor' } });
  await f.put('.copilot/config.json', { lastLoggedInUser: { host: 'https://github.com', login: 'fixture-user' }, loggedInUsers: [] });
  const access = f.create({ readSystemSecret: async (s: string, a: string) => { assert.equal(s, 'copilot-cli'); assert.equal(a, 'https://github.com:fixture-user'); return 'fixture-cli'; } });
  const found = await access.discover(); assert.deepEqual(found.accounts.map(c => c.source).sort(), ['Copilot CLI 登录', 'Copilot 编辑器登录']);
  const credentials = await Promise.all(found.accounts.map(c => access.resolve(c.id)));
  assert.equal(credentials[0].subject, credentials[1].subject); assert.notEqual(payload(credentials[0]).accessToken, payload(credentials[1]).accessToken);
  assert.ok(!JSON.stringify(found).includes('fixture-cli'));
});

test('supported API imports use adapter subjects; changed key fails selection', async t => {
  const f = await fixture(t); const path = '.local/share/opencode/auth.json';
  await f.put(path, { deepseek: { type: 'api', key: 'fixture-key' }, unrelated: { type: 'api', key: 'ignored' }, openrouter: { type: 'oauth', access: 'ignored' } });
  const access = f.create(), found = await access.discover(); assert.equal(found.accounts.length, 1);
  const c = await access.resolve(found.accounts[0].id); assert.equal(c.secret, 'fixture-key'); assert.equal(c.subject, hashKeySubject('deepseek-balance', 'fixture-key'));
  await f.put(path, { deepseek: { type: 'api', key: 'fixture-new' } }); await assert.rejects(access.resolve(found.accounts[0].id), { code: 'ACCOUNT_MISMATCH' });
});

test('Codex device flow respects interval, pending/expiry and exchanges server PKCE', async t => {
  const f = await fixture(t); let now = 1000000, calls = 0, poll = 0;
  const access = f.create({ now: () => now, fetch: async (url: string, init: RequestInit) => {
    calls++;
    if (url.endsWith('/usercode')) return response({ device_auth_id: 'fixture-device', user_code: 'AAAA-BBBB', interval: '5' });
    if (url.endsWith('/deviceauth/token')) return ++poll === 1 ? response({}, 403) : response({ authorization_code: 'fixture-code', code_verifier: 'fixture-verifier' });
    assert.ok(String(init.body).includes('code_verifier=fixture-verifier')); return response(auth().tokens);
  } });
  const login = await access.startLogin('codex-local'); assert.ok(!JSON.stringify(login).includes('fixture-device'));
  assert.equal((await access.pollLogin(login.id)).status, 'pending'); assert.equal(calls, 1);
  now += 5000; assert.equal((await access.pollLogin(login.id)).status, 'pending');
  now += 5000; const result = await access.pollLogin(login.id); assert.equal(result.status, 'complete'); assert.equal(payload(result.credential!).management, 'managed');
  const again = await access.pollLogin(login.id); assert.equal(again.status, 'complete'); assert.equal(calls, 4);
  assert.equal((await access.pollLogin('unknown')).status, 'expired');
});

test('Copilot device flow slows down, validates identity and keeps GitHub token as device source', async t => {
  const f = await fixture(t); let now = 0, polls = 0;
  const access = f.create({ now: () => now, fetch: async (url: string) => {
    if (url.endsWith('/device/code')) return response({ device_code: 'fixture-device', user_code: 'AAAA', expires_in: 900, interval: 5 });
    if (url.endsWith('/access_token')) return ++polls === 1 ? response({ error: 'slow_down' }) : response({ access_token: 'fixture-github' });
    return response({ id: 42, login: 'fixture-user' });
  } });
  const login = await access.startLogin('copilot-local'); now = 5000; assert.equal((await access.pollLogin(login.id)).status, 'pending');
  now = 10000; await access.pollLogin(login.id); assert.equal(polls, 1);
  now = 15000; const result = await access.pollLogin(login.id); assert.equal(result.status, 'complete'); assert.equal(payload(result.credential!).source, 'copilot-device');
  await access.refresh(result.credential!); assert.equal(polls, 2);
});

test('managed near-expiry refresh is single-flight; stale callers receive newest generation', async t => {
  const f = await fixture(t); let now = 1000000, refreshes = 0;
  const access = f.create({ now: () => now, fetch: async (url: string, init: RequestInit) => {
    if (url.endsWith('/usercode')) return response({ device_auth_id: 'd', user_code: 'u', interval: 1 });
    if (url.endsWith('/deviceauth/token')) return response({ authorization_code: 'c', code_verifier: 'v' });
    if (String(init.body).includes('refresh_token')) { refreshes++; await new Promise(r => setTimeout(r, 10)); return response({ ...auth().tokens, access_token: token('user-a', 20000), refresh_token: 'fixture-next' }); }
    return response(auth().tokens);
  } });
  const login = await access.startLogin('codex-local'); now += 1000; const c = (await access.pollLogin(login.id)).credential!;
  await access.refresh(c); assert.equal(refreshes, 0);
  now = 9950000; const results = await Promise.all([access.refresh(c), access.refresh(c), access.refresh(c)]);
  assert.equal(refreshes, 1); assert.equal(payload(results[0]).generation, 2); assert.equal(results[0].secret, results[1].secret);
  assert.equal((await access.refresh(c)).secret, results[0].secret); assert.equal(refreshes, 1);
});

test('overlapping device authorizations invalidate old generations and expiry purges state', async t => {
  const f = await fixture(t); let now = 0;
  const access = f.create({ now: () => now, fetch: async () => response({ device_code: 'd', user_code: 'u', expires_in: 10 }) });
  const old = await access.startLogin('copilot-local'), fresh = await access.startLogin('copilot-local');
  assert.equal((await access.pollLogin(old.id)).status, 'expired'); now = 11000; assert.equal((await access.pollLogin(fresh.id)).status, 'expired');
});

test('malformed sources warn without leaking content; missing source is AUTH_REQUIRED', async t => {
  const f = await fixture(t); await f.put('.codex/auth.json', auth());
  const access = f.create(), found = await access.discover(), c = await access.resolve(found.accounts[0].id);
  await rm(join(f.home, '.codex/auth.json')); await assert.rejects(access.refreshExternal(c), { code: 'AUTH_REQUIRED' });
  await f.put('.codex/auth.json', '{"token":"DO-NOT-LEAK" broken');
  const broken = await access.discover(); assert.equal(broken.accounts.length, 0); assert.ok(broken.warnings.length); assert.ok(!broken.warnings.join().includes('DO-NOT-LEAK'));
});

test('managed refresh rejects a token for another identity without replacing old credential', async t => {
  const f = await fixture(t); let now = 1000, refreshing = false;
  const access = f.create({ now: () => now, fetch: async (url: string) => {
    if (url.endsWith('/usercode')) return response({ device_auth_id: 'd', user_code: 'u', interval: 1 });
    if (url.endsWith('/deviceauth/token')) return response({ authorization_code: 'c', code_verifier: 'v' });
    return response(auth(refreshing ? 'other-user' : 'user-a').tokens);
  } });
  const login = await access.startLogin('codex-local'); now += 1000; const c = (await access.pollLogin(login.id)).credential!;
  now = 9950000; refreshing = true; await assert.rejects(access.refresh(c), { code: 'ACCOUNT_MISMATCH' });
  assert.equal((await access.pollLogin(login.id)).status, 'expired');
  assert.equal(payload(c).generation, 1);
});

test('Windows CredRead bridge positively distinguishes absent known target from unsupported store', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  await f.put('.copilot/config.json', { lastLoggedInUser: { host: 'https://github.com', login: `subcal-fixture-nonexistent-${Date.now()}` } });
  const found = await f.create({ platform: 'win32' }).discover();
  assert.deepEqual(found.warnings, []); assert.equal(found.accounts.length, 0);
});
test('refresh-token reuse stops for re-login instead of retrying a rotated token',async t=>{
  const f=await fixture(t);let now=1000;
  const access=f.create({now:()=>now,fetch:async(url:string,init:RequestInit)=>{
    if(url.endsWith('/usercode'))return response({device_auth_id:'d',user_code:'u',interval:1});
    if(url.endsWith('/deviceauth/token'))return response({authorization_code:'c',code_verifier:'v'});
    if(String(init.body).includes('grant_type=refresh_token'))return response({error:{code:'refresh_token_reused'}},400);
    return response(auth().tokens);
  }});
  const login=await access.startLogin('codex-local');now+=1000;const credential=(await access.pollLogin(login.id)).credential!;
  now=9950000;await assert.rejects(access.refresh(credential),{code:'AUTH_REQUIRED'});
  assert.equal(payload(credential).generation,1);
});
