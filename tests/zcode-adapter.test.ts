import test from 'node:test';
import assert from 'node:assert/strict';
import { ZCodeTeamAdapter, ZCodeGiftAdapter, parseZCodeCredential, createZCodeAdapters } from '../src/main/adapters/zcode-adapter';
import { AdapterError, type CollectInput } from '../src/main/adapters/types';
import type { HttpFetchFn } from '../src/main/adapters/http-adapters';
const at = '2026-10-21T00:00:00.000Z', now = Date.parse(at) / 1000;
const ok = (data: unknown) => ({ code: 200, success: true, data });
const response = (data: unknown, status = 200): Awaited<ReturnType<HttpFetchFn>> => ({ status, headers: { get: name => name === 'retry-after' ? '9' : null }, text: async () => JSON.stringify(data) });
const is = (code: string) => (e: unknown) => e instanceof AdapterError && e.code === code;
// Exact OpenCode state and fields: upstream team.test.mjs:70-85.
const teamState = { site: 'bigmodel', base: 'https://open.bigmodel.cn/api/anthropic', key: 'tk.team-secret', token: 'bm-token', org: 't1', project: 'tp1', plan: 'GLM Coding Team Max' };
function auth(state: Record<string, unknown> = teamState): CollectInput {
  return { connectionId: 'zcode-test', generation: 1, reason: 'probe', secret: JSON.stringify({ type: 'oauth', access: state.key ?? state.jwt, refresh: JSON.stringify(state), expires: 0, accountId: 'ada@example.com (team)', source: 'zcode', management: 'external', locator: '/never-read', subject: 'verified-account', alias: 'Team A' }) };
}
// Field-for-field shape from usage.test.mjs:244-265 (fixed clock substituted).
const quota = { limits: [
  { type: 'CREDIT_LIMIT', unit: 3, percentage: 42, currentValue: 420, usage: 1000, nextResetTime: (now + 7200) * 1000 },
  { type: 'CREDIT_LIMIT', unit: 6, percentage: 10, currentValue: 1000, usage: 10000, nextResetTime: (now + 93600) * 1000 },
] };
const subscription = { hasSubscription: true, status: 'EFFECTIVE', memberGrantStatus: 'VALID', productId: 'prod-1', productName: 'GLM Coding Team Pro', subscribeEndTime: '2026-12-31 23:59:59' };
const resets = { fiveHourResets: [{ available: true, expireTime: '2026-11-30 23:59:59' }, { available: true, expireTime: 1790000000 }, { available: false, expireTime: 1 }], weekResets: [{ available: true, expireTime: '2026-12-31 23:59:59' }] };
// Exact gift.test.mjs:25-29 shape, with fixed clock and a synthetic model.
const gift = { server_time: now, plans: [{ plan_id: 'grant', user_plan_id: 'g1', name: 'Festival Grant', status: 'active', ends_at: now + 86400 }], balances: [{ plan_id: 'grant', user_plan_id: 'g1', show_name: 'Limited credit', capabilities: ['model:glm-limited-preview'], total_units: 100, used_units: 25, remaining_units: 75, expires_at: now + 3600 }] };
const giftState = { site: 'zai', base: 'https://api.z.ai/api/anthropic', key: 'synthetic-key', jwt: 'synthetic-session-jwt', device: '11111111-2222-4333-8444-555555555555' };

test('team executes only three GETs on business root, with original auth headers', async () => {
  const seen: string[] = [];
  const a = new ZCodeTeamAdapter('cn', async (url, init) => {
    const u = new URL(url); seen.push(url); assert.equal(u.origin, 'https://bigmodel.cn'); assert.equal(init.method, 'GET');
    assert.equal(init.headers['Bigmodel-Organization'], 't1'); assert.equal(init.headers['Bigmodel-Project'], 'tp1'); assert.equal(init.headers['Set-Language'], 'zh');
    if (u.pathname.endsWith('/limit')) { assert.equal(u.searchParams.get('type'), '2'); assert.equal(init.headers.Authorization, 'tk.team-secret'); return response(ok(quota)); }
    assert.equal(init.headers.Authorization, 'bm-token');
    if (u.pathname.endsWith('/querySubscribeDetail')) return response(ok(subscription));
    assert.equal(u.pathname, '/api/biz/customer-package-reset/list'); assert.equal(u.searchParams.get('targetType'), 'TEAM'); return response(ok(resets));
  });
  const out = await a.collect(auth());
  assert.equal(seen.length, 3); assert.deepEqual(out.metrics.slice(0, 2).map(m => [m.remaining, m.unit, m.scope]), [['580', 'credits', 'seat'], ['9000', 'credits', 'seat']]);
  assert.equal(out.entitlements?.membershipExpiresAt?.value?.value, '2026-12-31T15:59:59.000Z'); assert.equal(out.entitlements?.autoRenew, undefined);
  assert.equal(out.account.organization, 't1/tp1'); assert.equal(out.account.alias, 'Team A');
  assert.equal(out.balances?.length, 3); assert.equal(out.metrics.filter(m => m.id.startsWith('reset-coupons')).every(m => m.resetAt === null), true);
  assert.equal(out.balances?.[0].expiresAt?.value?.value, '2026-11-30T15:59:59.000Z');
});
test('team Global never hits CN; region/base/organization/project are isolated', async () => {
  let calls = 0;
  const a = new ZCodeTeamAdapter('global', async (url, init) => { calls++; assert.equal(new URL(url).hostname, 'api.z.ai'); assert.equal(init.headers['Set-Language'], 'en'); return response(ok(url.includes('/limit') ? quota : url.includes('/list?') ? resets : subscription)); });
  const state = { ...teamState, site: 'zai', base: 'https://api.z.ai/api/anthropic', token: 'Bearer existing-business-token' };
  const first = await a.collect(auth(state));
  await assert.rejects(a.collect(auth()), is('AUTH_REQUIRED')); assert.equal(calls, 3);
  await assert.rejects(a.collect(auth({ ...state, base: 'https://open.bigmodel.cn/api/anthropic' })), is('AUTH_REQUIRED'));
  await assert.rejects(a.collect({ ...auth({ ...state, project: 'tp2' }), reason: 'scheduled', expectedSubject: first.account.subject }), is('ACCOUNT_MISMATCH')); assert.equal(calls, 3);
  const second = await a.collect(auth({ ...state, project: 'tp2' })); assert.notEqual(second.poolId, first.poolId);
});
test('available reset-list fields preserve captured recordId/date shapes; missing is not zero', () => {
  const a = new ZCodeTeamAdapter('cn');
  // Captured shape documented in upstream usage.test.mjs:187-200 / magpie#1191.
  const out = a.normalize({ resets: { code: 200, msg: '操作成功', success: true, data: { customerId: 0, targetType: 'TEAM', organizationId: 't1', projectId: 'tp1', lastFiveHourResetTime: '2026-10-06 21:14:03', lastWeekResetTime: null, fiveHourResets: [{ recordId: 0, grantType: 'DIRECT', expireTime: '2026-11-02 23:59:59', available: true }], weekResets: [{ recordId: 0, grantType: 'DIRECT', expireTime: '2026-10-30 23:59:59', available: true }, { recordId: 0, grantType: 'DIRECT', expireTime: '2026-10-04 23:59:59', available: false }] } } }, at);
  assert.deepEqual(out.metrics.map(m => m.remaining), ['1', '1']); assert.equal(out.balances?.length, 2); assert.equal(out.balances?.[1].expiresAt?.value?.value, '2026-10-30T15:59:59.000Z');
  const incomplete = a.normalize({ resets: ok({ fiveHourResets: [{ available: true }, {}] }) }, at); assert.equal(incomplete.metrics.length, 0); assert.equal(incomplete.partialFailures.length, 1);
  const empty = a.normalize({ resets: ok({ fiveHourResets: [] }) }, at); assert.equal(empty.metrics[0].remaining, '0'); assert.equal(empty.metrics.length, 1);
});
test('team missing values are unknown, zero cap unlimited, invalid seat does not become Free', () => {
  const a = new ZCodeTeamAdapter();
  const out = a.normalize({ quota: ok({ limits: [{ type: 'CREDIT_LIMIT', usage: 0, percentage: 100 }, { type: 'TIME_LIMIT', usage: 10, remaining: 0 }, { unit: 3 }] }), subscription: ok({ ...subscription, memberGrantStatus: 'UNASSIGNED' }) }, at);
  assert.equal(out.metrics[0].availability, 'unlimited'); assert.equal(out.metrics[0].remaining, null); assert.equal(out.metrics[1].remaining, '0'); assert.equal(out.metrics[1].unit, '次');
  assert.equal(out.fields.length, 0); assert.equal(out.entitlements, undefined); assert.equal(out.partialFailures.length, 2);
  const dateOnly = a.normalize({ subscription: ok({ ...subscription, subscribeEndTime: '2026-12-31' }) }, at); assert.equal(dateOnly.entitlements?.membershipExpiresAt?.value?.precision, 'day');
});
test('partial query failure preserves readable team result; all denied stays AUTH_REQUIRED', async () => {
  const a = new ZCodeTeamAdapter('cn', async url => url.includes('/limit') ? response(ok(quota)) : response({ sensitive: 'do-not-leak' }, 403));
  const out = await a.collect(auth()); assert.equal(out.metrics.length, 2); assert.equal(out.partialFailures.length, 2); assert.equal(out.partialFailures[0].reason, 'PERMISSION_DENIED');
  const denied = new ZCodeTeamAdapter('cn', async () => response({ message: 'secret-must-not-leak' }, 401));
  await assert.rejects(denied.collect(auth()), e => { assert.ok(e instanceof AdapterError); assert.equal(e.code, 'AUTH_REQUIRED'); assert.doesNotMatch(e.message, /secret-must/); return true; });
  const tokenOnly = await a.collect(auth({ ...teamState, key: undefined, token: 'existing-token' })).catch(e => e);
  assert.ok(tokenOnly instanceof AdapterError); // Does not discover/mint a missing key to bypass failures.
});
test('gift real balance shape preserves model bucket and expiry, preview is NOT owned credits', async () => {
  const paths: string[] = [];
  const a = new ZCodeGiftAdapter(async (url, init) => {
    const u = new URL(url); paths.push(u.pathname); assert.equal(u.origin, 'https://zcode.z.ai'); assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, 'Bearer synthetic-session-jwt'); assert.equal(init.headers['X-Device-Mid'], giftState.device); assert.equal(u.searchParams.get('app_version'), '3.14.3');
    if (u.pathname.endsWith('/preview')) { assert.equal(u.searchParams.get('platform'), `${process.platform}-${process.arch}`); return response(ok({ plans: [{ plan_id: 'pending', name: 'Unclaimed Grant' }] })); }
    assert.equal(u.pathname, '/api/v1/zcode-plan/billing/balance'); return response(ok({ ...gift, server_time: Math.floor(Date.now() / 1000), plans: [{ ...gift.plans[0], ends_at: Math.floor(Date.now() / 1000) + 86400 }], balances: [{ ...gift.balances[0], expires_at: Math.floor(Date.now() / 1000) + 3600 }] }));
  });
  const out = await a.collect(auth(giftState)); assert.equal(paths.length, 2); assert.equal(out.metrics[0].remaining, '75'); assert.deepEqual(out.metrics[0].models, ['glm-limited-preview']); assert.equal(out.metrics[0].resetAt, null); assert.equal(out.balances?.[0].expiresAt?.value?.precision, 'instant'); assert.equal(out.samples.length, 1); assert.match(out.samples[0], /未计入权益/); assert.equal(out.balances?.length, 1);
});
test('multi-plan gift fixture filters expired plans/buckets, keeps spent siblings separately', () => {
  // upstream dual.test.mjs:353-361 and gift.test.mjs:149-153.
  const plans = [...gift.plans, { plan_id: 'bonus', user_plan_id: 'g2', name: 'Earlier Grant', status: 'active', ends_at: now + 7200 }, { plan_id: 'old', user_plan_id: 'g3', name: 'Old', status: 'active', ends_at: now - 1 }];
  const balances = [...gift.balances, { ...gift.balances[0], plan_id: 'bonus', user_plan_id: 'g2', show_name: 'Spent sibling', used_units: 100, remaining_units: 0 }, { ...gift.balances[0], plan_id: 'old', user_plan_id: 'g3' }, { ...gift.balances[0], show_name: 'Expired', expires_at: now - 1 }];
  const out = new ZCodeGiftAdapter().normalize({ balance: ok({ server_time: now, plans, balances }), preview: ok({ plans: [] }) }, at);
  assert.equal(out.fields[0].value, 'Earlier Grant'); assert.deepEqual(out.metrics.map(m => m.remaining), ['75', '0']); assert.equal(new Set(out.metrics.map(m => m.poolId)).size, 2); assert.equal(out.metrics.every(m => m.resetAt === null), true);
});
test('gift decimal amounts, unknown usage, window end and stable bucket identity', () => {
  const a = new ZCodeGiftAdapter();
  const b = { ...gift, balances: [{ ...gift.balances[0], total_units: '0.3', used_units: '0.2', remaining_units: undefined, period_start: now, period_end: now + 86400 }, { ...gift.balances[0], total_units: undefined, used_units: undefined, remaining_units: '0' }, { ...gift.balances[0], total_units: undefined, used_units: undefined, remaining_units: undefined }] };
  const out = a.normalize({ balance: ok(b) }, at); assert.equal(out.metrics[0].remaining, '0.1'); assert.equal(out.balances?.[0].amount.evidence, 'derived'); assert.equal(out.metrics[0].windowEnd?.value?.value, new Date((now + 86400) * 1000).toISOString()); assert.equal(out.metrics[0].resetAt, null); assert.equal(out.metrics[1].used, null); assert.equal(out.partialFailures.filter(f => !f.field.endsWith(':unit')).length, 1); assert.equal(out.metrics[0].unit, 'units');
  const zero = a.normalize({ balance: ok({ ...gift, balances: [{ ...gift.balances[0], remaining_units: 0, used_units: 100 }] }) }, at);
  assert.equal(zero.metrics[0].id, a.normalize({ balance: ok(gift) }, at).metrics[0].id);
});
test('captured preview entitlement unit is preserved only on owned matching bucket', () => {
  // Real preview shape copied from upstream usage.test.mjs:338-347; IDs are fixture IDs.
  const captured = { server_time: 1791216750, plans: [{ user_plan_id: 'upl_2107141892427358208', plan_id: 'zcode-v3-start-plan-trust-1006', name: 'ZCode Trust Build', description: 'ZCode Global Build', priority: 110, status: 'active', starts_at: 1791216750, ends_at: 1791302400, entitlements: [{ entitlement_id: 'zcode-v3-start-plan-trust-1006', show_name: 'GLM-5.3-Flash', meter: 'model_usage', unit_type: 'token', capabilities: ['model:glm-5.3-flash'], grant_units: 100000000, period: 'one_time', priority: 110, effective_at: 0 }] }] };
  const a = new ZCodeGiftAdapter(), preview = a.normalize({ preview: ok(captured) }, at);
  assert.equal(preview.metrics.length, 0); assert.equal(preview.entitlements, undefined); assert.equal(preview.balances, undefined); assert.match(preview.samples[0], /ZCode Trust Build/);
  const ownedPlan = { ...captured.plans[0], ends_at: now + 3600 };
  const owned = a.normalize({ balance: ok({ server_time: now, plans: [ownedPlan], balances: [{ user_plan_id: ownedPlan.user_plan_id, plan_id: ownedPlan.plan_id, entitlement_id: ownedPlan.entitlements[0].entitlement_id, total_units: 100000000, used_units: 0, remaining_units: 100000000, capabilities: ['model:glm-5.3-flash', 'tool:web-search'], expires_at: now + 3600 }] }) }, at);
  assert.equal(owned.metrics[0].unit, 'token'); assert.equal(owned.balances?.[0].currency, 'token'); assert.deepEqual(owned.metrics[0].models, ['glm-5.3-flash']); assert.equal(owned.metrics[0].poolId, owned.balances?.[0].poolId);
});
test('token-only team queries subscription and coupons, without discovering a seat key', async () => {
  const paths: string[] = [];
  const a = new ZCodeTeamAdapter('cn', async url => { paths.push(new URL(url).pathname); return response(ok(url.includes('/list?') ? resets : subscription)); });
  const out = await a.collect(auth({ ...teamState, key: undefined }));
  assert.equal(paths.length, 2); assert.equal(paths.some(p => /api_keys|limit/.test(p)), false); assert.equal(out.fields[0].value, subscription.productName); assert.ok(out.partialFailures.some(f => f.field === 'quota'));
});
test('foreign reset scope and expired JWT never produce owned entitlement', async () => {
  const a = new ZCodeTeamAdapter('cn', async url => response(ok(url.includes('/limit') ? quota : url.includes('/list?') ? { ...resets, targetType: 'PERSONAL', organizationId: 'other-org' } : subscription)));
  const out = await a.collect(auth()); assert.equal(out.balances, undefined); assert.ok(out.partialFailures.some(f => f.field === 'resets' && f.reason === 'ACCOUNT_MISMATCH'));
  const expired = Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url'); let calls = 0;
  const g = new ZCodeGiftAdapter(async () => { calls++; return response(ok(gift)); });
  await assert.rejects(g.collect(auth({ ...giftState, jwt: `header.${expired}.synthetic` })), is('AUTH_REQUIRED')); assert.equal(calls, 0);
});
test('gift balance failure can still return preview, never fabricates success or active entitlement', async () => {
  const a = new ZCodeGiftAdapter(async url => url.includes('/balance') ? response({}, 503) : response(ok({ plans: [{ plan_id: 'pending', name: 'Gift' }] })));
  const out = await a.collect(auth(giftState)); assert.equal(out.metrics.length, 0); assert.equal(out.balances, undefined); assert.equal(out.fields.length, 0); assert.equal(out.entitlements, undefined); assert.equal(out.partialFailures[0].field, 'balance'); assert.equal(out.partialFailures[0].reason, 'UPSTREAM_UNAVAILABLE'); assert.equal(out.samples.length, 1);
});
test('credentials fail closed: no raw key, no fabricated JWT/device, no side effects', async () => {
  let calls = 0; const fn: HttpFetchFn = async () => { calls++; return response(ok({})); };
  const giftAdapter = new ZCodeGiftAdapter(fn), team = new ZCodeTeamAdapter('cn', fn);
  for (const state of [{ ...giftState, jwt: undefined }, { ...giftState, device: undefined }]) await assert.rejects(giftAdapter.collect(auth(state)), is('AUTH_REQUIRED'));
  await assert.rejects(team.collect(auth({ ...teamState, org: undefined })), is('AUTH_REQUIRED'));
  await assert.rejects(team.collect({ ...auth(), secret: 'raw-key' }), is('AUTH_REQUIRED'));
  await assert.rejects(team.collect(auth({ ...teamState, base: 'https://evil.example' })), is('AUTH_REQUIRED'));
  await assert.rejects(team.collect(auth({ ...teamState, token: 'x\r\nInjected: yes' })), is('AUTH_REQUIRED'));
  const controller = new AbortController(); controller.abort(); await assert.rejects(team.collect({ ...auth(), signal: controller.signal }), is('CANCELLED'));
  assert.equal(calls, 0); assert.equal(createZCodeAdapters(fn).length, 3); assert.equal(parseZCodeCredential(auth().secret, team.manifest.id).key, 'tk.team-secret');
});
test('429 Retry-After and malformed business envelopes are not zero entitlement', async () => {
  const a = new ZCodeGiftAdapter(async () => response({}, 429));
  await assert.rejects(a.collect(auth(giftState)), e => { assert.ok(e instanceof AdapterError); assert.equal(e.code, 'RATE_LIMITED'); assert.equal(e.options?.retryAfterMs, 9000); return true; });
  const b = new ZCodeTeamAdapter('cn', async () => response({ code: 200, data: null })); await assert.rejects(b.collect(auth()), is('SCHEMA_CHANGED'));
  assert.throws(() => new ZCodeGiftAdapter().normalize({ balance: { code: 403, data: gift } }, at), is('SCHEMA_CHANGED'));
});
