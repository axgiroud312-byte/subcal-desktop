import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegionalAdapters, regionalUnavailableAdapters, KiroAdapter, GlmCodingAdapter, QoderAdapter, MiniMaxPlanAdapter, MimoAppAdapter, MimoTokenPlanAdapter, RaccoonAdapter } from '../src/main/adapters/regional-adapters';
import { AdapterError, type CollectInput, type ProviderAdapter } from '../src/main/adapters/types';
import type { HttpFetchFn } from '../src/main/adapters/http-adapters';
import { hashKeySubject } from '../src/main/adapters/http-adapters';
const at = '2026-10-21T00:00:00.000Z';
const error = (code: string) => (e: unknown) => e instanceof AdapterError && e.code === code;
const reply = (value: unknown, status = 200): Awaited<ReturnType<HttpFetchFn>> => ({ status, headers: { get: n => n === 'retry-after' ? '7' : null }, text: async () => JSON.stringify(value) });
function input(a: ProviderAdapter, extra: Record<string, unknown> = {}): CollectInput {
  return { connectionId: 'test', generation: 1, reason: 'probe', secret: JSON.stringify({ provider: a.manifest.id, region: a.manifest.region, accessToken: 'synthetic-secret', ...extra }) };
}
test('Kiro precision zero survives; trial expiry is NOT a reset or membership date', () => {
  const out = new KiroAdapter().normalize({ subscriptionInfo: { subscriptionTitle: 'KIRO PRO' }, nextDateReset: 1793491200, usageBreakdownList: [{ currentUsageWithPrecision: '0.2', usageLimitWithPrecision: '0.3', freeTrialInfo: { freeTrialStatus: 'ACTIVE', currentUsageWithPrecision: 0, usageLimitWithPrecision: 5, freeTrialExpiry: 1793491200 } }] }, at);
  assert.equal(out.metrics[0].remaining, '0.1'); assert.equal(out.metrics[1].remaining, '5'); assert.equal(out.metrics[1].resetAt, null);
  assert.equal(out.balances?.[0].expiresAt?.value?.precision, 'instant'); assert.equal(out.entitlements, undefined);
  const missing = new KiroAdapter().normalize({ subscriptionInfo: { subscriptionTitle: 'Free' }, usageBreakdownList: [{ usageLimitWithPrecision: 5 }] }, at);
  assert.equal(missing.metrics.length, 0); assert.equal(missing.partialFailures.length, 1);
});
test('Kiro protocol binds region/profile/token type and never discovers profiles', async () => {
  const seen: string[] = [];
  const fn: HttpFetchFn = async (url, init) => { seen.push(url); assert.equal(init.method, 'GET'); assert.equal(init.headers.tokentype, 'API_KEY'); return reply({ subscriptionInfo: { subscriptionTitle: 'Pro' } }); };
  const a = new KiroAdapter('eu-central-1', fn), i = input(a, { profileArn: 'arn:aws:codewhisperer:eu-central-1:123:profile/test', tokenType: 'API_KEY' });
  await a.collect(i); const url = new URL(seen[0]);
  assert.equal(url.hostname, 'management.eu-central-1.kiro.dev'); assert.equal(url.pathname, '/Get-Usage-Limits'); assert.equal(url.searchParams.get('origin'), 'KIRO_CLI');
  await assert.rejects(a.collect(input(a)), error('AUTH_REQUIRED'));
  await assert.rejects(a.collect(input(a, { profileArn: 'arn:aws:codewhisperer:us-east-1:123:profile/test' })), error('AUTH_REQUIRED')); assert.equal(seen.length, 1);
});
test('Qoder distinct pools, explicit units, plan-only enterprise; no expiry-as-reset', () => {
  const a = new QoderAdapter();
  const out = a.normalize({ displayMode: 'qoder', qoderUsage: { user_type: 'Pro', expires_at: '2026-11-01', user_quota: { total: '0.3', used: '0.2' }, orgResourcePackage: { remaining: 0, unit: 'ACU' }, dedicatedResourcePackages: [{ name: 'Team A', remaining: 10 }, { remaining: null }] } }, at);
  assert.deepEqual(out.metrics.map(m => [m.remaining, m.unit]), [['0.1', 'credits'], ['0', 'ACU'], ['10', 'credits']]);
  assert.equal(out.metrics[1].scope, 'organization'); assert.equal(out.metrics.every(m => m.resetAt === null), true);
  assert.deepEqual(out.entitlements?.membershipExpiresAt?.value, { precision: 'day', value: '2026-11-01' }); assert.equal(out.partialFailures.length, 1);
  assert.equal(a.normalize({ displayMode: 'enterprise' }, at).fields[0].value, 'Enterprise');
  assert.throws(() => a.normalize({}, at), error('SCHEMA_CHANGED'));
});
test('Qoder regional protocol rejects raw PAT and changed account before network', async () => {
  let calls = 0;
  const a = new QoderAdapter('cn', async (url, init) => { calls++; assert.equal(url, 'https://openapi.qoder.com.cn/sash/api/v2/me/usage'); assert.equal(init.headers['Cosy-ClientType'], '10'); return reply({ displayMode: 'enterprise' }); });
  await assert.rejects(a.collect(input(a, { tokenKind: 'pat' })), error('AUTH_REQUIRED'));
  const i = input(a, { tokenKind: 'device', accountId: 'user-a' }); const first = await a.collect(i);
  const next = await a.collect({ ...input(a, { tokenKind: 'device', accountId: 'user-a', accessToken: 'rotated' }), reason: 'manual', expectedSubject: first.account.subject });
  assert.equal(first.account.subject, next.account.subject);
  await assert.rejects(a.collect({ ...input(a, { tokenKind: 'device', accountId: 'user-b' }), reason: 'scheduled', expectedSubject: first.account.subject }), error('ACCOUNT_MISMATCH')); assert.equal(calls, 2);
});
test('GLM known zero cap is unlimited, MCP stays calls; date-only remains civil', () => {
  const a = new GlmCodingAdapter('cn');
  const out = a.normalize({ quota: { code: 200, data: { level: 'max', limits: [{ usage: 0, percentage: 100 }, { type: 'TIME_LIMIT', usage: 100, remaining: 0, nextResetTime: 1793491200000 }, { percentage: null }] } }, subscriptions: { code: 200, data: [{ status: 'VALID', autoRenew: false, valid: '2026-10-01 - 2026-11-01' }] } }, at);
  assert.equal(out.metrics[0].availability, 'unlimited'); assert.equal(out.metrics[0].remaining, null); assert.equal(out.metrics[1].unit, '次'); assert.equal(out.metrics[1].remaining, '0');
  assert.equal(out.entitlements?.autoRenew?.value, false); assert.deepEqual(out.entitlements?.membershipExpiresAt?.value, { precision: 'day', value: '2026-11-01' });
  const renewing = a.normalize({ subscriptions: { data: [{ status: 'VALID', productName: 'GLM', autoRenew: 1, nextRenewTime: '2026-11-01 08:00:00' }] } }, at);
  assert.equal(renewing.entitlements?.billingPeriodEnd?.value?.value, '2026-11-01T00:00:00.000Z'); assert.equal(renewing.entitlements?.membershipExpiresAt, undefined);
});
test('GLM exact Authorization and partial query preserve readable quota', async () => {
  const urls: string[] = [];
  const a = new GlmCodingAdapter('global', async (url, init) => { urls.push(url); assert.equal(init.headers.Authorization, 'synthetic-secret'); return url.endsWith('/list') ? reply({}, 403) : reply({ code: 200, data: { limits: [{ percentage: 0 }] } }); });
  const out = await a.collect(input(a, { tokenKind: 'coding-key' }));
  assert.equal(urls.length, 2); assert.equal(out.metrics[0].remaining, '100'); assert.equal(out.partialFailures[0].field, 'subscriptions');
  assert.throws(() => a.normalize({ quota: { success: false, data: { limits: [{ percentage: 0 }] } } }, at), error('SCHEMA_CHANGED'));
});
test('MiniMax remaining percentages and model scopes; status 2 exhausted and 3 omitted', () => {
  const out = new MiniMaxPlanAdapter().normalize({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general', current_interval_remaining_percent: 100, current_weekly_status: 2, end_time: 1793491200 }, { model_name: 'video', current_interval_status: 3, current_weekly_remaining_percent: 0 }, { model_name: 'unknown' }] }, at);
  assert.deepEqual(out.metrics.map(m => m.remaining), ['100', '0', '0']); assert.deepEqual(out.metrics[2].models, ['video']); assert.equal(out.metrics[2].unit, '%'); assert.equal(out.entitlements, undefined);
  assert.throws(() => new MiniMaxPlanAdapter().normalize({ base_resp: { status_code: 1004 } }, at), error('UPSTREAM_UNAVAILABLE'));
});
test('MiMo App UTC+8 vs TokenPlan UTC; credits are not tokens; no fake renewal', () => {
  const app = new MimoAppAdapter().normalize({ self: { code: 0, data: { current: { title: 'Plus', endTime: '2026-11-01 08:00:00', renewalMode: 'ONE_TIME' } } }, usage: { code: 0, data: { percent: 0, resetDate: '2026-11-01' } } }, at);
  assert.equal(app.metrics[0].remaining, '0'); assert.equal(app.metrics[0].resetAt, '2026-11-01'); assert.equal(app.entitlements?.membershipExpiresAt?.value?.value, '2026-11-01T00:00:00.000Z'); assert.equal(app.entitlements?.autoRenew?.value, false);
  const platform = new MimoTokenPlanAdapter().normalize({ detail: { code: 0, data: { expired: false, planName: 'Pro', currentPeriodEnd: '2026-11-01 08:00:00' } }, usage: { code: 0, data: { monthUsage: { items: [{ name: 'month_total_token', used: 10, limit: 100 }] }, usage: { items: [{ name: 'plan_total_token', used: 0, limit: 999 }] } } } }, at);
  assert.equal(platform.metrics[0].remaining, '90'); assert.equal(platform.metrics[0].unit, 'credits'); assert.equal(platform.metrics[0].resetAt, null); assert.equal(platform.entitlements?.billingPeriodEnd?.value?.value, '2026-11-01T08:00:00.000Z'); assert.equal(platform.entitlements?.autoRenew, undefined);
});
test('MiMo cookie request stays on one host; membership survives usage denial', async () => {
  const seen: string[] = [];
  const a = new MimoAppAdapter('RU', async (url, init) => { seen.push(url); assert.equal(new URL(url).hostname, 'mimo-server-ru.xiaomimimo.com'); assert.equal(init.headers.Cookie, 'session=fake'); assert.equal(init.headers.Authorization, ''); return url.endsWith('/usage') ? reply({}, 403) : reply({ code: 0, data: { current: { title: 'RU Pro' } } }); });
  const out = await a.collect(input(a, { cookie: 'session=fake', accessToken: undefined }));
  assert.equal(out.fields[0].value, 'RU Pro'); assert.equal(out.partialFailures.length, 1); assert.equal(seen.length, 2);
  await assert.rejects(a.collect(input(a, { region: 'mimo-server-sgp.xiaomimimo.com', cookie: 'session=fake' })), error('AUTH_REQUIRED')); assert.equal(seen.length, 2);
});
test('Raccoon balance is not bill-derived quota; never calls onboarding or setting_info', async () => {
  const seen: string[] = [];
  const a = new RaccoonAdapter(async url => { seen.push(url); return reply({ code: 0, data: url.endsWith('/balance') ? { available_points: '0' } : { office: { pro_enable: true, active_plan: { type: 'Pro' }, pro_expired_time: '2026-11-01' } } }); });
  const out = await a.collect(input(a));
  assert.equal(out.balances?.[0].amount.value, '0'); assert.equal(out.metrics.length, 0); assert.equal(out.balances?.[0].expiresAt, undefined); assert.equal(out.entitlements?.membershipExpiresAt?.value?.precision, 'day');
  assert.deepEqual(seen.map(u => new URL(u).pathname).sort(), ['/api/web/auth/v1/entitlement_info', '/api/web/points/v1/balance']);
  assert.throws(() => a.normalize({ points: { code: 200001, data: { available_points: 0 } } }, at), error('SCHEMA_CHANGED'));
});
test('invalid calendar and timezone-less Raccoon dates stay unknown', () => {
  const a = new RaccoonAdapter();
  for (const end of ['2026-02-31', '2026-02-31T12:00:00Z', '2026-11-01 10:00:00', 1793491200]) {
    assert.equal(a.normalize({ points: { available_points: 1 }, entitlement: { office: { pro_enable: true, pro_expired_time: end } } }, at).entitlements, undefined);
  }
});
test('all regional GET adapters fail closed on cross-region imports; unsupported POST providers do no network', async () => {
  let calls = 0; const adapters = createRegionalAdapters(async () => { calls++; return reply({}); });
  assert.equal(new Set(adapters.map(a => a.manifest.id)).size, 13);
  for (const a of adapters) {
    await assert.rejects(a.collect(input(a, { region: 'wrong.example' })), error('AUTH_REQUIRED'));
    if (!/^(glm-coding-|minimax-plan-)/.test(a.manifest.id)) await assert.rejects(a.collect({ ...input(a), secret: 'raw-unbound-token' }), error('AUTH_REQUIRED'));
    const c = new AbortController(); c.abort(); await assert.rejects(a.collect({ ...input(a), signal: c.signal }), error('CANCELLED'));
  }
  assert.equal(calls, 0);
  for (const a of regionalUnavailableAdapters) { assert.equal(a.manifest.supportedFields.length, 0); await assert.rejects(a.collect(input(a)), error('UNSUPPORTED')); }
});
test('main-process OpenCode envelope and raw key compatibility without refresh', async () => {
  const a = new GlmCodingAdapter('cn', async () => reply({ code: 200, data: { level: 'Pro', limits: [{ percentage: 20 }] } }));
  const envelope = { type: 'api', key: 'fake-key', accessToken: 'fake-key', source: 'zhipu', subject: 'verified-user', alias: 'My GLM', management: 'external', locator: '/never-read' };
  const out = await a.collect({ ...input(a), secret: JSON.stringify(envelope) });
  assert.equal(out.account.subject, 'verified-user'); assert.equal(out.account.alias, 'My GLM');
  const raw = await a.collect({ ...input(a), secret: ' fake-key ' }); assert.equal(raw.account.subject, hashKeySubject(a.manifest.id, 'fake-key'));
  await assert.rejects(new GlmCodingAdapter('global').collect({ ...input(a), secret: JSON.stringify(envelope) }), error('AUTH_REQUIRED'));
  const q = new QoderAdapter('global', async (_url, init) => { assert.equal(init.headers.Authorization, 'Bearer device-real'); return reply({ displayMode: 'enterprise' }); });
  await q.collect({ ...input(q), secret: JSON.stringify({ source: 'qoder', type: 'oauth', access: 'job-fake', accessToken: 'job-fake', deviceToken: 'device-real', subject: 'qoder-user' }) });
  await assert.rejects(q.collect({ ...input(q), secret: JSON.stringify({ source: 'qoder', type: 'oauth', access: 'job-fake', deviceToken: 'device-real', vpc: 'tenant-a' }) }), error('UNSUPPORTED'));
  const m = new MimoAppAdapter('SGP', async (_url, init) => { assert.equal(init.headers.Cookie, 'session=fake'); return reply({ code: 0, data: { current: { title: 'App' } } }); });
  await m.collect({ ...input(m), secret: JSON.stringify({ source: 'mimo-app', type: 'oauth', access: JSON.stringify({ session: 'fake' }), accessToken: JSON.stringify({ session: 'fake' }), refresh: JSON.stringify({ base: 'https://mimo-server-sgp.xiaomimimo.com/api', userId: '123', passToken: 'never-used' }), subject: 'mimo-user' }) });
});
test('HTTP failures keep sanitized error classes and Retry-After', async () => {
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'PERMISSION_DENIED'], [429, 'RATE_LIMITED'], [503, 'UPSTREAM_UNAVAILABLE']] as const) {
    const a = new QoderAdapter('global', async () => reply({ message: 'synthetic-secret cookie=do-not-leak' }, status));
    await assert.rejects(a.collect(input(a, { tokenKind: 'job' })), e => {
      assert.ok(e instanceof AdapterError); assert.equal(e.code, code); assert.doesNotMatch(e.message, /synthetic-secret|do-not-leak/); if (status === 429) assert.equal(e.options?.retryAfterMs, 7000); return true;
    });
  }
});
