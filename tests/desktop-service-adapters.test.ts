import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WorkBuddyAdapter, TraeAdapter, MiniMaxCodeAdapter, createDesktopServiceAdapters, desktopServiceAdapters, signMiniMaxRead, type DesktopFetchFn } from '../src/main/adapters/desktop-service-adapters';
import { AdapterError, type ProviderAdapter, type CollectInput } from '../src/main/adapters/types';

const at = '2026-10-21T00:00:00.000Z';
const reply = (value: unknown, status = 200): Awaited<ReturnType<DesktopFetchFn>> => ({ status, headers: { get: n => n === 'retry-after' ? '7' : null }, text: async () => JSON.stringify(value) });
const error = (code: string) => (e: unknown) => e instanceof AdapterError && e.code === code;
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
function input(a: ProviderAdapter, extra: Record<string, unknown> = {}): CollectInput {
  return { connectionId: 'test', generation: 1, reason: 'probe', secret: JSON.stringify({ provider: a.manifest.id, source: 'desktop-opencode', accessToken: 'synthetic-access', refresh: 'never-spend-refresh', uid: 'user-1', region: a.manifest.region, deviceId: '1234567890123456', machineId: 'original-machine', management: 'external', locator: '/never-read', ...extra }) };
}
function pack(cn = true) {
  return { entitlement_pack_id: 'pack-1', display_desc: 'Pro', entitlement_base_info: { quota: cn ? { credits_limit: '0.3' } : { basic_usage_limit: '10', bonus_usage_limit: '2' }, end_time: 1793491200 }, usage: cn ? { credits_amount: '0.2' } : { basic_usage_amount: '3', bonus_usage_amount: '0' } };
}
test('WorkBuddy both sites use exact read RPCs, original uid/domain/enterprise; no refresh or models', async () => {
  for (const region of ['cn', 'global'] as const) {
    const seen: string[] = [];
    const a = new WorkBuddyAdapter(region, async (url, init) => {
      const u = new URL(url); seen.push(u.pathname);
      assert.equal(u.hostname, region === 'cn' ? 'copilot.tencent.com' : 'www.workbuddy.ai');
      assert.equal(init.method, 'POST'); assert.equal(init.headers['User-Agent'], 'WorkBuddy/5.5.6');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-access'); assert.equal(init.headers['X-User-Id'], 'user-1');
      assert.equal(init.headers['X-Domain'], 'original-enterprise-domain'); assert.equal(init.headers['X-Enterprise-Id'], 'tenant-1'); assert.equal(init.headers['X-Tenant-Id'], 'tenant-1');
      assert.doesNotMatch(init.body ?? '', /never-spend|original-machine|locator/);
      if (u.pathname.endsWith('summary')) { assert.equal(init.body, '{}'); return reply({ code: 0, data: { Packages: [], IsPaidUser: true } }); }
      if (u.pathname.endsWith('get-enterprise-user-usage')) return reply({ code: 0, data: { limitNum: '0.3', credit: '0.2', cycleStartTime: '2026-10-01 00:00:00', cycleResetTime: '2026-11-01 00:00:00' } });
      const b = JSON.parse(init.body!); assert.deepEqual(b.Status, [0, 3]); assert.equal(b.PageSize, 200); assert.equal(b.PageNumber, 1); assert.ok(b.PackageCodes.length > 5);
      if (u.pathname.endsWith('paid-packages')) assert.equal(b.NeedRenewInfo, true);
      else { assert.match(b.SlicePeriodStartTime, /^\d{4}-\d\d-\d\d 00:00:00$/); assert.equal(b.NeedRenewInfo, undefined); }
      return reply({ code: 0, data: { Accounts: [] } });
    });
    const out = await a.collect(input(a, { domain: 'original-enterprise-domain', enterpriseId: 'tenant-1', subject: 'verified-account', alias: 'My WorkBuddy' }));
    assert.equal(seen.length, 4); assert.equal(out.metrics[0].remaining, '0.1'); assert.equal(out.metrics[0].scope, 'organization'); assert.equal(out.metrics[0].resetAt, '2026-10-31T16:00:00.000Z');
    assert.equal(out.metrics[0].windowStart?.value?.value, '2026-09-30T16:00:00.000Z');
    assert.equal(out.account.organization, 'tenant-1'); assert.equal(out.account.subject, 'verified-account'); assert.equal(out.account.alias, 'My WorkBuddy');
    assert.equal(out.entitlements, undefined);
  }
});
test('WorkBuddy personal packages preserve exact decimals and zero; batch expiry is never renewal/reset', () => {
  const out = new WorkBuddyAdapter().normalize({ sum: { IsPaidUser: true, Packages: [{ PackageCode: 'paid', CycleTotalCapacity: '0.3', CycleUsedCapacity: '0.2' }, { PackageCode: 'gift', CycleTotalCapacity: 0, CycleUsedCapacity: 0 }] }, paid: [{ AccountId: 'p1', PackageCode: 'paid', CycleCapacityRemainPrecise: '0.1', DeductionEndTime: 1793491200000, autoRenew: true }], free: [{ AccountId: 'f1', PackageCode: 'gift', CycleCapacityRemain: 0, CapacityType: 4, ExpiredTime: '2026-11-01 00:00:00' }], failures: ['free-pagination'] }, at);
  assert.deepEqual(out.metrics.map(m => m.remaining), ['0.1', '0']); assert.ok(out.metrics.every(m => m.resetAt === null));
  assert.deepEqual(out.balances?.map(b => [b.amount.value, b.kind]), [['0.1', 'credit'], ['0', 'grant']]);
  assert.equal(out.balances?.[0].expiresAt?.value?.value, '2026-11-01T00:00:00.000Z'); assert.equal(out.balances?.[1].expiresAt?.value?.value, '2026-10-31T16:00:00.000Z');
  assert.equal(out.entitlements, undefined); assert.equal(out.partialFailures.length, 1);
  const missing = new WorkBuddyAdapter().normalize({ sum: { IsPaidUser: false, Packages: [{ CycleTotalCapacity: 5 }] } }, at);
  assert.equal(missing.metrics[0].remaining, null); assert.equal(missing.metrics[0].used, null);
});
test('WorkBuddy pagination and partial failures do not discard valid summary', async () => {
  let pages = 0;
  const a = new WorkBuddyAdapter('cn', async (url, init) => {
    if (url.endsWith('summary')) return reply({ data: { IsPaidUser: false, Packages: [{ CycleTotalCapacity: 5, CycleUsedCapacity: 1 }] } });
    if (url.endsWith('free-packages')) return reply({}, 503);
    const page = JSON.parse(init.body!).PageNumber; pages++;
    return reply({ data: { Accounts: page === 1 ? Array.from({ length: 200 }, (_, i) => ({ AccountId: `p-${i}`, CycleCapacityRemain: 1 })) : [{ AccountId: 'last', CycleCapacityRemain: 0 }], TotalCount: 201 } });
  });
  const out = await a.collect(input(a)); assert.equal(pages, 2); assert.equal(out.balances?.length, 201); assert.equal(out.metrics[0].remaining, '4'); assert.equal(out.partialFailures[0].field, 'free');
});
test('Trae CN/SG/US route only to bound billing host, keep device and tenant contexts', async () => {
  for (const region of ['cn', 'sg', 'us'] as const) {
    let calls = 0;
    const a = new TraeAdapter(region, async (url, init) => {
      calls++; assert.equal(new URL(url).hostname, region === 'cn' ? 'api.trae.cn' : region === 'us' ? 'api-us-east.trae.ai' : 'api-sg-central.trae.ai');
      assert.equal(new URL(url).pathname, region === 'cn' ? '/trae/api/v2/pay/ide_user_ent_usage' : '/trae/api/v1/pay/user_current_entitlement_list');
      assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(init.body!), region === 'cn' ? { require_usage: true, req_source: 0 } : {});
      assert.equal(init.headers.Authorization, 'Cloud-IDE-JWT synthetic-access'); assert.equal(init.headers['X-Cloudide-Token'], 'synthetic-access'); assert.equal(init.headers['x-ide-token'], 'synthetic-access');
      assert.equal(init.headers['x-uid'], 'user-1'); assert.equal(init.headers['x-device-id'], '1234567890123456'); assert.equal(init.headers['x-machine-id'], 'original-machine');
      assert.equal(init.headers['X-Tenant-Id'], undefined); // original plugin deliberately does not transmit account metadata
      return reply({ is_credits_billing: true, user_entitlement_pack_list: [pack(region === 'cn')] });
    });
    const out = await a.collect(input(a, { account: { TenantID: 'team-1', loginType: 'SaaS' }, region: region === 'cn' ? 'CN' : region.toUpperCase() }));
    assert.equal(calls, 1); assert.equal(out.account.organization, 'team-1'); assert.equal(out.metrics[0].unit, region === 'cn' ? 'credits' : 'USD');
    assert.equal(out.metrics[0].remaining, region === 'cn' ? '0.1' : '7'); assert.ok(out.metrics.every(m => m.resetAt === null)); assert.equal(out.entitlements, undefined);
    assert.equal(out.metrics[0].windowEnd?.value?.value, '2026-11-01T00:00:00.000Z');
  }
});
test('Trae packs and USD bonus stay separate; unlimited -1, missing usage, expiry semantics', () => {
  const a = new TraeAdapter('cn');
  const p = pack(); const unlimited = pack(); unlimited.entitlement_pack_id = 'unlimited'; unlimited.entitlement_base_info.quota.credits_limit = '-1';
  const out = a.normalize({ is_credits_billing: true, user_entitlement_pack_list: [p, unlimited, { pack_id: 'missing', entitlement_base_info: { quota: { credits_limit: 10 } } }] }, at);
  assert.deepEqual(out.metrics.map(m => m.remaining), ['0.1', null, null]); assert.equal(out.metrics[1].availability, 'unlimited'); assert.equal(out.metrics[2].used, null); assert.equal(out.metrics[2].availability, 'unfetched');
  assert.equal(out.balances?.length, 1); assert.equal(out.balances[0].expiresAt?.value?.precision, 'instant');
  const dollar = new TraeAdapter('sg').normalize({ user_entitlement_pack_list: [pack(false)] }, at);
  assert.deepEqual(dollar.metrics.map(m => [m.unit, m.remaining]), [['USD', '7'], ['USD', '2']]);
  assert.throws(() => a.normalize({}, at), error('SCHEMA_CHANGED'));
});
test('MiniMax signing matches fixed canonical query and original GET/POST MD5 protocol', () => {
  for (const body of [undefined, {}, { workspace_id: 17 }]) {
    const r = signMiniMaxRead('https://agent.minimaxi.com', '/matrix/api/v1/commerce/get_membership_info', 'fake-access', 'real-user', 'zh', body, 1792540800123, 28800, 'win32');
    const path = '/matrix/api/v1/commerce/get_membership_info?device_platform=mcode&biz_id=3&app_id=3001&version_code=22201&unix=1792540800123&timezone_offset=28800&sys_language=zh&lang=zh&device_id=0&os_name=win32&browser_name=mcode&user_id=real-user&client=mcode';
    assert.equal(r.url, 'https://agent.minimaxi.com' + path); assert.equal(r.headers['x-timestamp'], '1792540800');
    assert.equal(r.headers.yy, md5(encodeURIComponent(path) + '_' + (body === undefined ? '{}' : JSON.stringify(body)) + md5('1792540800123') + 'ooui'));
    assert.equal(r.headers['x-signature'], md5('1792540800I*7Cf%WZ#S&%1RlZJ&C2' + (body === undefined ? '' : JSON.stringify(body))));
    assert.equal(r.body, body === undefined ? undefined : JSON.stringify(body));
  }
});
test('MiniMax CN/Global identity, personal workspace, membership, grouped M Plan only', async () => {
  for (const region of ['cn', 'global'] as const) {
    const seen: string[] = [];
    const a = new MiniMaxCodeAdapter(region, async (url, init) => {
      const u = new URL(url); seen.push(u.pathname);
      assert.equal(init.headers.Authorization, 'Bearer synthetic-access');
      if (u.pathname.endsWith('coding_plan/remains')) {
        assert.equal(u.hostname, region === 'cn' ? 'www.minimaxi.com' : 'platform.minimax.io'); assert.equal(init.headers['X-Group-Id'], 'personal-group'); assert.equal(init.method, 'GET');
        return reply({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general', current_interval_remaining_percent: 0, current_weekly_remaining_percent: 100 }] });
      }
      assert.equal(u.hostname, region === 'cn' ? 'agent.minimaxi.com' : 'agent.minimax.io'); assert.equal(u.searchParams.get('lang'), region === 'cn' ? 'zh' : 'en'); assert.ok(init.headers.yy); assert.ok(init.headers['x-signature']);
      if (u.pathname.endsWith('user/info')) { assert.equal(init.method, 'GET'); assert.equal(u.searchParams.get('user_id'), '0'); return reply({ data: { userInfo: { realUserID: 'real-user' } } }); }
      assert.equal(u.searchParams.get('user_id'), 'real-user'); assert.equal(init.method, 'POST');
      if (u.pathname.endsWith('get_user_extra_info')) return reply({ data: { workspaces: [{ workspace_type: 1, workspace_id: 'enterprise' }, { workspace_type: 0, workspace_id: 0, has_token_plan: true, op_group_id: 'personal-group' }] } });
      assert.equal(u.pathname, '/matrix/api/v1/commerce/get_membership_info'); assert.deepEqual(JSON.parse(init.body!), { workspace_id: 0 });
      return reply({ data: { has_token_plan: true, token_plan_tier: 'Plus', token_plan_expires_at: 1793491200, op_credit_summary: { total_remaining_amount: '0.10' } } });
    });
    const out = await a.collect(input(a));
    assert.equal(seen.length, 4); assert.equal(out.fields[0].value, 'M Plan Plus'); assert.equal(out.balances?.[0].amount.value, '0.10');
    assert.equal(out.entitlements?.membershipExpiresAt?.value?.value, '2026-11-01T00:00:00.000Z'); assert.equal(out.entitlements?.billingPeriodEnd, undefined); assert.equal(out.entitlements?.autoRenew, undefined);
    assert.deepEqual(out.metrics.map(m => m.remaining), ['0', '100']);
  }
});
test('MiniMax known identity avoids unnecessary user-info; membership survives quota failure and wallet missing stays unknown', async () => {
  const a = new MiniMaxCodeAdapter('cn', async url => {
    assert.doesNotMatch(url, /user\/info|oauth|signin|claim|messages|models/);
    if (url.includes('coding_plan/remains')) return reply({}, 503);
    if (url.includes('get_user_extra_info')) return reply({ workspaces: [{ workspace_type: 0, workspace_id: 'w', has_token_plan: true, op_group_id: 'group', token_plan_tier: 'Max' }] });
    return reply({}, 503);
  });
  const out = await a.collect(input(a, { realUserID: 'real-user' })); assert.equal(out.fields[0].value, 'M Plan Max'); assert.equal(out.balances, undefined); assert.equal(out.partialFailures.length, 2);
  const missing = a.normalize({ membership: { balance: 0 } }, at); assert.equal(missing.balances?.[0].amount.value, '0'); assert.equal(missing.fields.length, 0);
});
test('all desktop adapters fail closed on wrong source, abort, invalid account and expired external auth', async () => {
  let calls = 0; const adapters = createDesktopServiceAdapters(async () => { calls++; return reply({}); });
  assert.equal(adapters.length, 7); assert.equal(new Set(desktopServiceAdapters.map(a => a.manifest.id)).size, 7);
  for (const a of adapters) {
    await assert.rejects(a.collect(input(a, { provider: 'wrong-site' })), error('AUTH_REQUIRED'));
    await assert.rejects(a.collect(input(a, { accessToken: { $wbEncrypted: 1 } })), error('AUTH_REQUIRED'));
    await assert.rejects(a.collect(input(a, { expires: 1 })), error('AUTH_REQUIRED'));
    await assert.rejects(a.collect(input(a, { uid: 'user\nheader' })), error('AUTH_REQUIRED'));
    const abort = new AbortController(); abort.abort(); await assert.rejects(a.collect({ ...input(a), signal: abort.signal }), error('CANCELLED'));
    await assert.rejects(a.collect({ ...input(a, { subject: 'new-account' }), reason: 'manual', expectedSubject: 'old-account' }), error('ACCOUNT_MISMATCH'));
  }
  assert.equal(calls, 0);
});
test('Trae cross-deployment context is rejected without network; original plugin auth supported', async () => {
  let calls = 0;
  const a = new TraeAdapter('sg', async () => { calls++; return reply({ is_credits_billing: false, user_entitlement_pack_list: [pack(false)] }); });
  await assert.rejects(a.collect(input(a, { region: 'US' })), error('AUTH_REQUIRED'));
  await assert.rejects(a.collect(input(a, { region: 'SG', api: 'https://coreva-normal.trae.ai' })), error('AUTH_REQUIRED'));
  await assert.rejects(a.collect(input(a, { deviceId: '' })), error('AUTH_REQUIRED'));
  await assert.rejects(a.collect(input(a, { region: undefined })), error('AUTH_REQUIRED'));
  await a.collect({ ...input(a), secret: JSON.stringify({ source: 'trae-global', type: 'oauth', access: 'original-plugin-access', uid: 'user', region: 'SG', deviceId: '123', account: { tenantId: 't' } }) });
  assert.equal(calls, 1);
});
test('MiniMax cannot silently switch from missing personal workspace to enterprise default', async () => {
  let calls = 0;
  const a = new MiniMaxCodeAdapter('global', async url => {
    calls++; assert.ok(url.includes('get_user_extra_info'));
    return reply({ workspaces: [{ workspace_type: 1, workspace_id: 'enterprise' }] });
  });
  await assert.rejects(a.collect(input(a, { realUserID: 'real-user' })), error('SCHEMA_CHANGED')); assert.equal(calls, 1);
});
test('network failures, cancellation and invalid/oversized JSON keep safe error classes', async () => {
  const network = new TraeAdapter('cn', async () => { throw new Error('token=do-not-leak'); });
  await assert.rejects(network.collect(input(network)), e => { assert.ok(e instanceof AdapterError); assert.equal(e.code, 'NETWORK_OFFLINE'); assert.doesNotMatch(e.message, /do-not-leak/); return true; });
  for (const raw of ['not json', '[]', 'null', 'x'.repeat(1024 * 1024 + 1)]) {
    const a = new TraeAdapter('cn', async () => ({ ...reply({}), text: async () => raw }));
    await assert.rejects(a.collect(input(a)), error('SCHEMA_CHANGED'));
  }
  const controller = new AbortController();
  const cancelled = new TraeAdapter('cn', async () => { controller.abort(); return reply({}); });
  await assert.rejects(cancelled.collect({ ...input(cancelled), signal: controller.signal }), error('CANCELLED'));
  const timeout = new TraeAdapter('cn', async (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('secret transport diagnostic')), { once: true }); }));
  await assert.rejects(timeout.collect({ ...input(timeout), timeoutMs: 5 }), error('TIMEOUT'));
});
test('HTTP and business failures sanitized, Retry-After kept; never retries refresh', async () => {
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'PERMISSION_DENIED'], [429, 'RATE_LIMITED'], [503, 'UPSTREAM_UNAVAILABLE']] as const) {
    let calls = 0; const a = new TraeAdapter('cn', async () => { calls++; return reply({ message: 'synthetic-access NEVER-LEAK' }, status); });
    await assert.rejects(a.collect(input(a)), e => { assert.ok(e instanceof AdapterError); assert.equal(e.code, code); assert.doesNotMatch(e.message, /synthetic-access|NEVER-LEAK/); if (status === 429) assert.equal(e.options?.retryAfterMs, 7000); return true; });
    assert.equal(calls, 1);
  }
  for (const value of [{ code: 1001 }, { error: { code: 20101 } }, { ResponseMetadata: { Error: { Code: 401 } } }]) {
    const a = new TraeAdapter('cn', async () => reply(value)); await assert.rejects(a.collect(input(a)), error('AUTH_REQUIRED'));
  }
  const mm = new MiniMaxCodeAdapter('cn', async () => reply({ statusInfo: { code: 1000048, message: 'secret' } })); await assert.rejects(mm.collect(input(mm)), error('AUTH_REQUIRED'));
});
test('token expiry is auth-only; malformed dates stay unknown; returned samples never expose credentials', async () => {
  const a = new TraeAdapter('cn', async () => reply({ is_credits_billing: true, user_entitlement_pack_list: [pack()] }));
  const out = await a.collect(input(a, { expires: Date.now() + 3600000 }));
  assert.equal(out.credentialExpiresAt?.value?.precision, 'instant'); assert.equal(out.entitlements, undefined); assert.doesNotMatch(JSON.stringify(out), /synthetic-access|never-spend|locator|original-machine/);
  const p = pack(); (p.entitlement_base_info as Record<string, unknown>).end_time = '2026-02-31';
  const invalid = a.normalize({ user_entitlement_pack_list: [p] }, at); assert.equal(invalid.metrics[0].windowEnd, undefined); assert.equal(invalid.balances, undefined);
});
