import test from 'node:test';
import assert from 'node:assert/strict';
import { CursorAdapter, DevinAdapter, OpenCodeGoAdapter, OpenCodeZenAdapter, OpenCodeZenFreeAdapter, type PriorityFetchFn } from '../src/main/adapters/priority-adapters';
import { AdapterError, type CollectInput } from '../src/main/adapters/types';

// Synthetic protocol fixtures only: no real account, credential scan or network.
const at = '2026-10-21T00:00:00.000Z';
const input: CollectInput = { connectionId: 'fixture', generation: 1, reason: 'probe', secret: 'synthetic-key' };
const reply = (body: unknown, status = 200) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const statusError = (code: string) => (e: unknown) => e instanceof AdapterError && e.code === code;
test('Cursor makes only three Dashboard RPCs and independent Bot, preserves envelope identity', async () => {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: 'auth0|fixture_user' })).toString('base64url')}.sig`;
  const seen: { url: string; init: Parameters<PriorityFetchFn>[1] }[] = [];
  const fetch: PriorityFetchFn = async (url, init) => { seen.push({ url, init });
    if (url.endsWith('GetPlanInfo')) return reply({ planInfo: { planName: 'Pro' } });
    if (url.endsWith('GetHardLimit')) return reply({ hardLimit: 25 });
    if (url.endsWith('get-sand-usage-status')) return reply({ includedLimitZero: false, usagePercent: 42, nextResetTimestampUtc: '2026-10-28T00:00:00Z' });
    return reply({ billingCycleEnd: '1793145600000', planUsage: { autoPercentUsed: 0, apiPercentUsed: 40, totalPercentUsed: 20 }, spendLimitUsage: { individualUsed: 1000 } });
  };
  const out = await new CursorAdapter(fetch).collect({ ...input, secret: JSON.stringify({ accessToken: token, source: 'cursor', subject: 'external:cursor:fixture', alias: 'Fixture', management: 'external', locator: 'do-not-read' }) });
  assert.equal(seen.length, 4); assert.ok(seen.every(x => x.init.method === 'POST' && x.init.body === '{}' && x.init.redirect === 'error'));
  const bot = seen.find(x => x.url.includes('sand-usage'))!;
  assert.equal(bot.init.headers.Cookie, `WorkosCursorSessionToken=${encodeURIComponent(`fixture_user::${token}`)}`);
  assert.equal(bot.init.headers.Authorization, undefined);
  assert.equal(out.account.subject, 'external:cursor:fixture'); assert.equal(out.account.alias, 'Fixture');
  assert.equal(out.metrics.find(m => m.id === 'cursor-on-demand')?.remaining, '15');
  assert.equal(out.metrics.find(m => m.id === 'grok-bot')?.remaining, '58');
  assert.equal(out.metrics.find(m => m.id === 'cursor-autoPercentUsed')?.remaining, '100');
  assert.ok(out.entitlements?.billingPeriodEnd); assert.equal(out.fields.some(f => f.field === 'renewalDate'), false);
});
test('Cursor Bot error is partial, missing percentages never become zero', async () => {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: 'auth0|u' })).toString('base64url')}.sig`;
  const a = new CursorAdapter(async url => url.includes('sand-usage') ? reply({}, 403) : url.endsWith('GetCurrentPeriodUsage') ? reply({ planUsage: { autoPercentUsed: 12 } }) : reply({}));
  const out = await a.collect({ ...input, secret: token });
  assert.equal(out.metrics.length, 1); assert.equal(out.metrics[0].remaining, '88');
  assert.ok(out.partialFailures.some(x => x.field === 'grok-bot')); assert.ok(out.partialFailures.some(x => x.field === 'cursor-apiPercentUsed'));
});
test('Cursor trial expiry is not a reset; Bot-only data remains usable', () => {
  const out = new CursorAdapter().normalize({ bot: { includedLimitZero: true, sandTrialExpiresAt: '2099-01-01T00:00:00Z', usagePercent: 100, nextResetTimestampUtc: '2030-01-01T00:00:00Z' } }, at);
  assert.equal(out.metrics[0].id, 'grok-bot'); assert.equal(out.metrics[0].remaining, '0'); assert.equal(out.metrics[0].resetAt, null);
});
test('Cursor pooled on-demand keeps team scope, and hard-limit failure never invents unlimited', () => {
  const a = new CursorAdapter();
  const out = a.normalize({ GetCurrentPeriodUsage: { spendLimitUsage: { limitType: 'team', pooledLimit: '45120000', pooledUsed: 12500, individualUsed: 500 } } }, at);
  assert.equal(out.metrics[0].scope, 'organization'); assert.equal(out.metrics[0].total, '451200'); assert.equal(out.metrics[0].used, '125');
  const unknown = a.normalize({ GetCurrentPeriodUsage: { planUsage: { autoPercentUsed: 1 }, spendLimitUsage: { limitType: 'team', individualUsed: 500 } } }, at);
  assert.equal(unknown.metrics.some(m => m.id === 'cursor-on-demand'), false);
});
test('Devin uses only read-only status RPC with credential in metadata, not Bearer', async () => {
  const a = new DevinAdapter(async (url, init) => {
    assert.equal(url, 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus');
    assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers['Connect-Protocol-Version'], '1');
    assert.equal(JSON.parse(init.body!).metadata.apiKey, 'synthetic-key');
    return reply({ userStatus: { planStatus: { planInfo: { planName: 'Teams', billingStrategy: 'BILLING_STRATEGY_QUOTA' }, planEnd: '2026-10-26T21:45:55Z', dailyQuotaRemainingPercent: 100, dailyQuotaResetAtUnix: '1793145600', weeklyQuotaResetAtUnix: '1793404800', acuLimit: 50, acuConsumed: 12.5, overageBalanceMicros: '46807746' } } });
  });
  const out = await a.collect({ ...input, secret: JSON.stringify({ accessToken: 'synthetic-key', source: 'devin', subject: 'devin-fixture' }) });
  assert.equal(out.account.subject, 'devin-fixture'); assert.equal(out.metrics.find(m => m.id === 'devin-weekly')?.remaining, '0');
  assert.equal(out.metrics.find(m => m.id === 'devin-acu')?.remaining, '37.5'); assert.equal(out.balances?.[0].amount.value, '46.807746');
  assert.equal(out.entitlements?.membershipExpiresAt?.value?.value, '2026-10-26T21:45:55.000Z');
});
test('Devin hidden quotas/credits billing do not infer exhausted quota; explicit zero balance stays known', () => {
  const out = new DevinAdapter().normalize({ userStatus: { planStatus: { planInfo: { planName: 'Free', billingStrategy: 'BILLING_STRATEGY_CREDITS', hideDailyQuota: true }, dailyQuotaRemainingPercent: 50, weeklyQuotaResetAtUnix: '1793404800', overageBalanceMicros: '0' } } }, at);
  assert.equal(out.metrics.length, 1); assert.equal(out.balances?.[0].amount.value, '0.000000');
});
test('Go sends GET with session attribution; zero usage ignores synthetic reset', async () => {
  const a = new OpenCodeGoAdapter(async (url, init) => {
    assert.equal(url, 'https://opencode.ai/zen/go/v1/usage'); assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, 'Bearer synthetic-key');
    assert.match(init.headers['x-opencode-session'], /^ses_[0-9a-f]{12}[a-zA-Z0-9]{14}$/); assert.ok(0xfff - parseInt(init.headers['x-opencode-session'].slice(13, 16), 16) < 16); assert.equal(init.headers['x-opencode-session-id'], init.headers['x-opencode-session']);
    assert.equal(init.redirect, 'error');
    return reply({ usage: { rolling: { percent: 0, resetsAt: '2030-01-01T00:00:00Z' }, weekly: { percent: 37, resetsAt: '2030-01-02T00:00:00Z' }, monthly: {} } });
  });
  const out = await a.collect(input); assert.equal(out.metrics.length, 2); assert.equal(out.metrics[0].resetAt, null); assert.equal(out.metrics[0].remaining, '100'); assert.equal(out.metrics[1].remaining, '63'); assert.equal(out.metrics[1].resetAt, '2030-01-02T00:00:00.000Z');
});
test('Go 401 is invalid key, 403 is missing member/workspace subscription', async () => {
  await assert.rejects(new OpenCodeGoAdapter(async () => reply({}, 401)).collect(input), statusError('AUTH_REQUIRED'));
  await assert.rejects(new OpenCodeGoAdapter(async () => reply({}, 403)).collect(input), (e: unknown) => e instanceof AdapterError && e.code === 'PERMISSION_DENIED' && /成员.*工作区/.test(e.message));
});
test('Go missing/invalid windows are schema errors, not fabricated quotas', () => {
  for (const raw of [{}, { usage: { rolling: { percent: null } } }, { usage: { weekly: { percent: 'NaN' } } }]) assert.throws(() => new OpenCodeGoAdapter().normalize(raw, at), statusError('SCHEMA_CHANGED'));
});
test('Zen and Free are no-network capabilities, never unlimited or credential-verified', async () => {
  const forbidden: PriorityFetchFn = async () => { throw new Error('must not fetch'); };
  for (const a of [new OpenCodeZenAdapter(forbidden), new OpenCodeZenFreeAdapter(forbidden)]) {
    const out = await a.collect(input); assert.equal(out.metrics[0].availability, 'unsupported'); assert.equal(out.metrics[0].remaining, null); assert.equal(out.metrics[0].total, null); assert.equal(out.fields.length, 0); assert.match(out.samples[0], /未联网验证/);
  }
});
test('source mismatch is rejected before any request; identity changes require re-probe', async () => {
  let calls = 0; const a = new OpenCodeGoAdapter(async () => { calls++; return reply({ usage: { rolling: { percent: 1 } } }); });
  await assert.rejects(a.collect({ ...input, secret: JSON.stringify({ accessToken: 'key', source: 'cursor' }) }), statusError('AUTH_REQUIRED')); assert.equal(calls, 0);
  await assert.rejects(a.collect({ ...input, reason: 'manual', expectedSubject: 'other' }), statusError('ACCOUNT_MISMATCH'));
});
test('cancellation, malformed JSON and redirect failures do not leak body or credential', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0; const a = new DevinAdapter(async () => { calls++; return reply({}); });
  await assert.rejects(a.collect({ ...input, signal: controller.signal }), statusError('CANCELLED')); assert.equal(calls, 0);
  const malformed = new DevinAdapter(async () => ({ status: 200, headers: { get: () => null }, text: async () => 'synthetic-secret-in-invalid-body' }));
  await assert.rejects(malformed.collect(input), (e: unknown) => e instanceof AdapterError && e.code === 'SCHEMA_CHANGED' && !e.message.includes('synthetic-secret'));
  await assert.rejects(new DevinAdapter(async () => reply({}, 307)).collect(input), statusError('UPSTREAM_UNAVAILABLE'));
});
