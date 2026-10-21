import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopSourceLocators, readDesktopSource, resolveDesktopSource, DesktopSourceError, type DesktopSourceOptions, type DesktopSourceLocator } from '../src/main/desktop-account-sources';

// Every reader is injected. These tests never touch a real user's credential.
const opts: DesktopSourceOptions = { home: '/synthetic', env: {}, platform: 'linux', readText: async () => null, readKiroEntry: async () => null };
const loc = (format: DesktopSourceLocator['format'], entry?: string): DesktopSourceLocator => ({ kind: 'service', path: '/synthetic/auth', format, entry });
const fixture = (v: unknown): DesktopSourceOptions => ({ ...opts, readText: async () => JSON.stringify(v) });
const code = (expected: string) => (e: unknown) => e instanceof DesktopSourceError && e.code === expected;

test('fixed cross-platform locators; MiniMax and Global Trae never guess desktop paths', () => {
  const linux = desktopSourceLocators(opts);
  assert.equal(linux.find(l => l.format === 'kiro-cli')?.path, '/synthetic/.local/share/kiro-cli/data.sqlite3');
  assert.equal(linux.find(l => l.format === 'kiro-ide')?.path, '/synthetic/.aws/sso/cache/kiro-auth-token.json');
  assert.equal(linux.filter(l => l.entry?.includes('minimax')).every(l => l.format === 'desktop-opencode'), true);
  assert.equal(linux.some(l => l.path.includes('.minimax')), false);
  const win = desktopSourceLocators({ home: 'C:\\fake', env: { APPDATA: 'C:\\fake\\AppData\\Roaming' }, platform: 'win32' });
  assert.equal(win.filter(l => l.format === 'trae-desktop').length, 2);
  assert.equal(win.find(l => l.format === 'workbuddy-desktop')?.path, 'C:\\fake\\AppData\\Local\\CodeBuddyExtension\\Data\\Public\\auth\\workbuddy-desktop.info');
  const mac = desktopSourceLocators({ home: '/fake', env: {}, platform: 'darwin' });
  assert.equal(mac.filter(l => l.format === 'trae-desktop').length, 1);
  assert.ok(mac.find(l => l.format === 'kiro-cli')?.path.includes('Library/Application Support'));
});

test('Kiro CLI enumerates three fixed rows independently, preserving original metadata', async () => {
  const seen: string[] = [];
  const c = await readDesktopSource(loc('kiro-cli', 'kirocli:external-idp:token'), { ...opts, readKiroEntry: async (_p, key) => { seen.push(key); return JSON.stringify({ access_token: 'opaque', refresh_token: 'do-not-spend', region: 'eu-central-1', profile_arn: 'arn:profile', token_endpoint: 'https://idp.example/token', expires_at: '2026-11-01T00:00:00Z' }); } });
  assert.deepEqual(seen, ['kirocli:external-idp:token']);
  assert.equal(c?.providerId, 'kiro-eu-central-1');
  const secret = JSON.parse(c!.secret);
  assert.equal(secret.profileArn, 'arn:profile'); assert.equal(secret.refresh, 'do-not-spend'); assert.equal(secret.token_endpoint, 'https://idp.example/token'); assert.equal(secret.method, 'external-idp');
  assert.equal(secret.expires, 1793491200000);
  await assert.rejects(readDesktopSource(loc('kiro-cli', 'other'), opts), code('UNSUPPORTED'));
});

test('Kiro opaque token rotation is NOT guessed to be the same user/profile', async () => {
  const l = loc('kiro-ide');
  const a = { accessToken: 'first', refreshToken: 'refresh', profileArn: 'shared-service-profile', region: 'us-east-1' };
  const c = await readDesktopSource(l, fixture(a));
  assert.equal(JSON.parse(c!.secret).profileArn, 'shared-service-profile');
  await assert.rejects(resolveDesktopSource(l, c!, fixture({ ...a, accessToken: 'second' })), code('ACCOUNT_MISMATCH'));
  assert.equal(await readDesktopSource(l, fixture({ refreshToken: 'only-refresh' })), null);
});

test('WorkBuddy identity/enterprise/region binding survives token rotation only for same explicit uid', async () => {
  const l = loc('workbuddy-desktop', 'workbuddy');
  const a = { auth: { accessToken: 'one', refreshToken: 'held', domain: 'copilot.tencent.com', tokenType: 'Bearer', refreshExpiresAt: 123 }, account: { uid: 'u1', enterpriseId: 'team1' } };
  const c = await readDesktopSource(l, fixture(a));
  const next = await resolveDesktopSource(l, c!, fixture({ ...a, auth: { ...a.auth, accessToken: 'two' } }));
  assert.equal(next.subject, c!.subject);
  assert.equal(JSON.parse(next.secret).refreshExpiresAt, 123);
  await assert.rejects(resolveDesktopSource(l, c!, fixture({ ...a, account: { uid: 'u1', enterpriseId: 'team2' } })), code('ACCOUNT_MISMATCH'));
  await assert.rejects(resolveDesktopSource(loc('workbuddy-desktop', 'workbuddy-ai'), c!, fixture(a)), code('ACCOUNT_MISMATCH'));
});

test('encrypted WorkBuddy is unreadable, not a false absent account; injected codec remains read-only', async () => {
  const l = loc('workbuddy-desktop', 'workbuddy-ai'), a = { auth: { accessToken: { $wbEncrypted: 1, envelope: 'cipher' } }, account: { uid: 'uid' } };
  await assert.rejects(readDesktopSource(l, fixture(a)), code('SOURCE_UNREADABLE'));
  const seen: string[] = [];
  const c = await readDesktopSource(l, { ...fixture(a), decrypt: async (_v, context) => { seen.push(context.format); return 'decrypted'; } });
  assert.deepEqual(seen, ['workbuddy']); assert.equal(JSON.parse(c!.secret).access, 'decrypted');
  assert.equal(JSON.parse(c!.secret).management, 'external');
});

test('Trae CN original client envelope and unique device kept; ambiguous device never invented', async () => {
  const root = { 'iCubeAuthInfo://icube.cloudide': JSON.stringify({ token: 'jwt', refreshToken: 'r', userId: 'uid', machineId: 'machine', account: { tenant: 't' } }), 'iCubeAuthInfo://icube-dc:1234567890123456': {} };
  const c = await readDesktopSource(loc('trae-desktop', 'trae-cn'), fixture(root));
  const a = JSON.parse(c!.secret); assert.equal(a.uid, 'uid'); assert.equal(a.deviceId, '1234567890123456'); assert.equal(a.machineId, 'machine'); assert.equal(a.refresh, 'r');
  await assert.rejects(readDesktopSource(loc('trae-desktop'), fixture({ ...root, 'iCubeAuthInfo://icube-dc:9999999999999999': {} })), code('SCHEMA_CHANGED'));
  await assert.rejects(readDesktopSource(loc('trae-desktop'), fixture({ 'iCubeAuthInfo://icube.cloudide': 'encoded' })), code('SOURCE_UNREADABLE'));
  const decoded = await readDesktopSource(loc('trae-desktop'), { ...fixture({ ...root, 'iCubeAuthInfo://icube.cloudide': 'encoded' }), decrypt: async () => root['iCubeAuthInfo://icube.cloudide'] });
  assert.equal(JSON.parse(decoded!.secret).uid, 'uid');
});

test('saved OAuth keeps access/refresh/device/enterprise context; display accountId is not uid', async () => {
  const a = { type: 'oauth', access: 'one', refresh: 'r', expires: 1793491200000, accountId: 'Display Name', region: 'US', deviceId: 'device', machineId: 'machine', account: { tenant: 't' }, unknownMetadata: { retain: true } };
  const l = loc('desktop-opencode', 'trae-global'), c = await readDesktopSource(l, fixture({ 'trae-global': a }));
  assert.equal(c?.providerId, 'trae-global-us'); assert.deepEqual(JSON.parse(c!.secret).unknownMetadata, { retain: true });
  await assert.rejects(resolveDesktopSource(l, c!, fixture({ 'trae-global': { ...a, access: 'two' } })), code('ACCOUNT_MISMATCH'));
  const stable = { ...a, uid: 'uid' }, known = await readDesktopSource(l, fixture({ 'trae-global': stable }));
  assert.equal((await resolveDesktopSource(l, known!, fixture({ 'trae-global': { ...stable, access: 'two' } }))).subject, known!.subject);
  await assert.rejects(resolveDesktopSource(l, known!, fixture({ 'trae-global': { ...stable, region: 'SG' } })), code('ACCOUNT_MISMATCH'));
});

test('MiniMax only saved OAuth; no refresh or API fallback; organization is part of subject', async () => {
  const l = loc('desktop-opencode', 'minimax-code');
  const a = { type: 'oauth', access: 'one', refresh: 'keep', realUserID: 'uid', opGroupId: 'g', workspaceID: 'workspace' };
  const c = await readDesktopSource(l, fixture({ 'minimax-code': a }));
  assert.equal(JSON.parse(c!.secret).realUserID, 'uid'); assert.equal(JSON.parse(c!.secret).refresh, 'keep');
  await assert.rejects(resolveDesktopSource(l, c!, fixture({ 'minimax-code': { ...a, workspaceID: 'other' } })), code('ACCOUNT_MISMATCH'));
  assert.equal(await readDesktopSource(l, fixture({ 'minimax-code': { type: 'api', key: 'not-oauth' } })), null);
  assert.equal(await readDesktopSource(loc('desktop-opencode', 'workbuddy'), fixture({ workbuddy: { type: 'oauth', source: 'desktop', uid: 'u' } })), null);
});

test('absence, denied access, bad JSON and decoder failures are distinct and never leak secrets', async () => {
  assert.equal(await readDesktopSource(loc('kiro-ide'), opts), null);
  await assert.rejects(readDesktopSource(loc('kiro-ide'), { ...opts, readText: async () => { throw new Error('secret-token /private/path'); } }), e => code('SOURCE_UNREADABLE')(e) && !String(e).includes('secret-token'));
  await assert.rejects(readDesktopSource(loc('kiro-ide'), { ...opts, readText: async () => '{bad secret-token' }), e => code('SCHEMA_CHANGED')(e) && !String(e).includes('secret-token'));
  await assert.rejects(resolveDesktopSource(loc('kiro-ide'), { subject: 's', providerId: 'p' }, opts), code('AUTH_REQUIRED'));
});

test('global region is never guessed; original OAuth survives envelope metadata names', async () => {
  const l = loc('desktop-opencode', 'trae-global');
  await assert.rejects(readDesktopSource(l, fixture({ 'trae-global': { type: 'oauth', access: 'a', uid: 'u' } })), code('SCHEMA_CHANGED'));
  await assert.rejects(readDesktopSource(l, fixture({ 'trae-global': { type: 'oauth', access: 'a', uid: 'u', region: 'SG', api: 'https://coreva-normal.trae.ai' } })), code('SCHEMA_CHANGED'));
  const original = { type: 'oauth', access: 'a', uid: 'u', region: 'US', source: 'browser', refresh: 'keep', account: { tenant: 't' } };
  const c = await readDesktopSource(l, fixture({ 'trae-global': original }));
  assert.deepEqual(JSON.parse(c!.secret).rawAuth, original);
  await assert.rejects(readDesktopSource(loc('kiro-ide'), { ...opts, readText: async () => ' '.repeat(8 * 1024 * 1024 + 1) }), code('SOURCE_UNREADABLE'));
});
