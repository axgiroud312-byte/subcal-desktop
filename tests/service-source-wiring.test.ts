import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readServiceSource, serviceSourceLocators } from '../src/main/service-account-sources';
import { AccountAccess } from '../src/main/account-access';
import { bindZCodeSource, getAdapter } from '../src/main/adapters';
import { ZCodeTeamAdapter } from '../src/main/adapters/zcode-adapter';
import { OFFICIAL_ADAPTER_CATALOG } from '../src/shared/types';
import { tencentTeamCredential } from '../src/main/tencent-account-teams';

test('ZCode source creates separate team/gift candidates and preserves scheduled/source identity', async () => {
  const home = await mkdtemp(join(tmpdir(), 'subcal-zcode-source-'));
  try {
    const path = join(home, '.local', 'share', 'opencode', 'auth.json');
    await mkdir(join(home, '.local', 'share', 'opencode'), { recursive: true });
    let state = { site: 'bigmodel', base: 'https://open.bigmodel.cn/api/anthropic', org: 'org1', project: 'project1', key: 'seat-key', token: 'business-token', jwt: 'session-jwt', device: 'device1' };
    const write = () => writeFile(path, JSON.stringify({ zcode: { type: 'oauth', access: state.key, accountId: 'source-user', refresh: JSON.stringify(state) } }));
    await write();
    const access = new AccountAccess({ home, env: {}, platform: 'linux', readSystemSecret: async () => null });
    const found = (await access.discover()).accounts.filter(a=>a.providerId.startsWith('zcode-'));
    assert.deepEqual(found.map(a=>a.providerId).sort(), ['zcode-gift', 'zcode-team-cn']);
    const c = await access.resolve(found.find(a=>a.providerId==='zcode-team-cn')!.id);
    for (const id of ['zcode-team-cn', 'zcode-team-global', 'zcode-gift']) {
      assert.equal(getAdapter(id).manifest.id, id);
      assert.ok(OFFICIAL_ADAPTER_CATALOG.some(a=>a.adapterId===id));
    }
    const adapter = bindZCodeSource(new ZCodeTeamAdapter('cn', async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ success: true, data: { limits: [{ type: 'CREDIT_LIMIT', usage: 100, currentValue: 10 }] } }) })));
    const out = await adapter.collect({ connectionId: 'source', generation: 1, reason: 'scheduled', secret: c.secret, expectedSubject: c.subject });
    assert.equal(out.account.subject, c.subject);
    await assert.rejects(adapter.collect({ connectionId: 'source', generation: 1, reason: 'scheduled', secret: c.secret, expectedSubject: 'another-account' }), /来源账号/);
    state = { ...state, key: 'rotated-seat-key' }; await write();
    assert.equal((await access.refreshExternal(c)).subject, c.subject);
    state = { ...state, project: 'project2' }; await write();
    await assert.rejects(access.refreshExternal(c), /账号已切换/);
    state = { ...state, site: 'zai', base: 'https://api.z.ai/api/anthropic' }; await write();
    const global = (await access.discover()).accounts.filter(a=>a.providerId.startsWith('zcode-'));
    assert.deepEqual(global.map(a=>a.providerId).sort(), ['zcode-gift', 'zcode-team-global']);
    await writeFile(path, JSON.stringify({ zcode: { type: 'api', key: 'not-a-session' } }));
    assert.equal((await access.discover()).accounts.filter(a=>a.providerId.startsWith('zcode-')).length, 0);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('AiHubMix reads only independent Magpie balanceToken, isolates entries and detects rotation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'subcal-aihubmix-source-'));
  try {
    const config = join(home, 'xdg'); await mkdir(join(config, 'magpie'), { recursive: true });
    const path = join(config, 'magpie', 'providers.json');
    const providers = [
      { id: 'account-a', chat: 'https://aihubmix.com/v1', key: 'model-key', balanceToken: 'account-token' },
      { id: 'key-only', chat: 'https://aihubmix.com/v1', key: 'model-key' },
      { id: 'wrong-host', chat: 'https://aihubmix.com.evil.test/v1', balanceToken: 'not-for-aihubmix' },
      { id: 'custom-balance', chat: 'https://aihubmix.com/v1', balanceToken: 'custom', balanceURL: 'https://other.example/balance' },
      { id: 'account-b', chat: 'https://aihubmix.com/v1', balanceToken: 'account-token-b' },
    ];
    await writeFile(path, JSON.stringify({ providers }));
    const env = { XDG_CONFIG_HOME: config };
    const access = new AccountAccess({ home, env, platform: 'linux', readSystemSecret: async () => null });
    const found = (await access.discover()).accounts.filter(a=>a.providerId==='aihubmix-account');
    assert.equal(found.length, 2);
    const c = await access.resolve(found[0].id);
    assert.equal(JSON.parse(c.secret).accessToken, 'account-token');
    assert.ok(!c.secret.includes('model-key'));
    assert.equal((await access.refreshExternal(c)).subject, c.subject);
    providers[0].balanceToken = 'new-account-token'; await writeFile(path, JSON.stringify({ providers }));
    await assert.rejects(access.refreshExternal(c), /账号已切换/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('Tencent source permits enumerating teams while retaining region and explicit team identity', async () => {
  const home = await mkdtemp(join(tmpdir(), 'subcal-tencent-source-'));
  try {
    const locator = serviceSourceLocators(home, {}, 'linux').find(l=>l.entry==='tencent-cloud')!;
    await mkdir(join(home, '.local', 'share', 'opencode'), { recursive: true });
    const write = (teamId?: string) => writeFile(locator.path, JSON.stringify({ 'tencent-cloud': { type: 'api', key: JSON.stringify({ region: 'ap-singapore', SecretId: 'id', SecretKey: 'secret', teamId }) } }));
    await write(); const all = await readServiceSource(locator);
    assert.equal(all?.providerId, 'tencent-token-plan-ap-singapore');
    assert.equal(JSON.parse(all!.secret).region, 'ap-singapore');
    const access = new AccountAccess({ home, env: {}, platform: 'linux', readSystemSecret: async()=>null });
    const bound = tencentTeamCredential(all!, { id:'selected-team', name:'选择的团队' });
    const fresh = await access.refreshExternal(bound);
    assert.equal(fresh.subject, bound.subject);
    assert.equal(JSON.parse(fresh.secret).teamId, 'selected-team');
    assert.equal(JSON.parse(fresh.secret).management, 'external');
    await write('team1'); const one = await readServiceSource(locator);
    await assert.rejects(access.refreshExternal(bound), /账号已切换/);
    assert.notEqual(one?.subject, all?.subject);
    assert.equal(JSON.parse(one!.secret).teamId, 'team1');
  } finally { await rm(home, { recursive: true, force: true }); }
});
