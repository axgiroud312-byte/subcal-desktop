import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlAdapters, type ControlFetchFn } from '../src/main/adapters/control-adapters';
import { AdapterError, type CollectInput } from '../src/main/adapters/types';

const at = '2026-10-21T09:00:00.000Z';
const input: CollectInput = { connectionId: 'test', generation: 1, reason: 'manual', secret: 'test-key' };
function harness(response: unknown | ((url: string) => unknown), status = 200) {
  const requests: { url: string; init: Parameters<ControlFetchFn>[1] }[] = [];
  const fetchFn: ControlFetchFn = async (url, init) => {
    requests.push({ url, init });
    const body = typeof response === 'function' ? response(url) : response;
    return { status, headers: { get: name => name.toLowerCase() === 'retry-after' ? '17' : null }, text: async () => JSON.stringify(body) };
  };
  const adapters = createControlAdapters({ fetchFn, remoteOrigins: ['https://magpie.example'], relays: [{ origin: 'https://relay.example', protocol: 'new-api-key' }] });
  return { requests, get: (id: string) => { const adapter = adapters.find(a => a.manifest.id === id || (id === 'relay' && a.manifest.id.startsWith('relay-'))); assert.ok(adapter, id); return adapter; } };
}
function code(expected: string) { return (e: unknown) => e instanceof AdapterError && e.code === expected; }

test('Gemini quota uses fixed read RPC; no onboarding, model list or generation', async () => {
  const h = harness({ buckets: [
    { modelId: 'gemini-pro', tokenType: 'requests', remainingFraction: 0.5, resetTime: '2026-10-22T00:00:00Z' },
    { modelId: 'gemini-pro', tokenType: 'tokens', remainingFraction: 0, resetTime: '2026-10-23T00:00:00Z' },
    { modelId: 'unknown', remainingFraction: null },
  ] });
  const a = h.get('gemini-cli');
  const out = await a.collect({ ...input, secret: JSON.stringify({ accessToken: 'oauth-secret', project: 'project-1' }) });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota');
  assert.equal(h.requests[0].init.method, 'POST');
  assert.equal(h.requests[0].init.body, '{"project":"project-1"}');
  assert.equal(h.requests[0].init.headers.Authorization, 'Bearer oauth-secret');
  assert.deepEqual(out.metrics.map(m => m.remaining), ['50', '0']);
  assert.notEqual(out.metrics[0].id, out.metrics[1].id);
  assert.equal(out.partialFailures.length, 1);
  assert.equal(JSON.stringify(out).includes('oauth-secret'), false);
  const changedReset = a.normalize({ buckets: [{ modelId: 'gemini-pro', tokenType: 'requests', remainingFraction: 0.4, resetTime: '2026-10-24T00:00:00Z' }] }, at);
  assert.equal(out.metrics[0].id, changedReset.metrics[0].id, 'metric identity survives reset');
});

test('Google missing project/token refuses before network; token rotation cannot silently change account', async () => {
  const h = harness({ buckets: [{ modelId: 'gemini', remainingFraction: 1 }] });
  await assert.rejects(h.get('gemini-cli').collect(input), code('AUTH_REQUIRED'));
  await assert.rejects(h.get('gemini-cli').collect({ ...input, secret: '{"accessToken":"token"}' }), code('AUTH_REQUIRED'));
  assert.equal(h.requests.length, 0);
  await assert.rejects(h.get('gemini-cli').collect({ ...input, expectedSubject: 'other-account', secret: '{"accessToken":"token","project":"p"}' }), code('ACCOUNT_MISMATCH'));
});

test('Antigravity confirmed proto omission is exhausted, groups stay apart', async () => {
  const h = harness({ groups: [
    { displayName: 'Gemini', buckets: [{ bucketId: 'g5', window: '5h', remainingFraction: 1 }, { bucketId: 'gw', window: 'weekly' }] },
    { displayName: 'Claude', buckets: [{ bucketId: 'c5', window: '5h', remainingFraction: 0.2 }, { bucketId: 'disabled', remainingFraction: 1, disabled: true }] },
  ] });
  const out = await h.get('antigravity').probe({ ...input, secret: '{"accessToken":"token","project":"p"}' });
  assert.equal(h.requests[0].url, 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary');
  assert.deepEqual(out.metrics.map(m => m.remaining), ['100', '0', '20']);
  assert.notEqual(out.metrics[0].poolId, out.metrics[2].poolId);
  assert.equal(out.metrics[0].windowMinutes, 300);
  assert.equal(out.partialFailures.length, 0);
});

const stepQuota = {
  five_hour_usage_left_rate: 0.6, five_hour_usage_reset_time: '1792602000',
  weekly_usage_left_rate: 75, weekly_usage_reset_time: '1792602000000',
  plan_credit_rate_limit: { subscription_credit_left_rate: 0.2, subscription_credit_reset_time: 0, credit_buckets: [{}] },
};
const stepSecret = JSON.stringify({ access: 'access-jwt', refresh: 'refresh-jwt', webId: 'web-id' });

test('Step Plan session RPCs preserve region/app, fractions, seconds/milliseconds, expiry versus reset', async () => {
  const h = harness((url: string) => url.endsWith('GetStepPlanStatus')
    ? { subscription: { name: 'Step Pro', expired_at: '1792602000', auto_renew: false } } : stepQuota);
  const out = await h.get('stepfun-plan-ai').collect({ ...input, secret: stepSecret });
  assert.equal(h.requests.length, 2);
  for (const r of h.requests) {
    assert.ok(r.url.startsWith('https://platform.stepfun.ai/api/step.openapi.devcenter.Dashboard/'));
    assert.equal(r.init.method, 'POST'); assert.equal(r.init.body, '{}');
    assert.equal(r.init.headers.Cookie, 'Oasis-Token=access-jwt...refresh-jwt');
    assert.equal(r.init.headers['Oasis-Appid'], '20700');
    assert.equal(r.init.headers.Authorization, '');
    assert.doesNotMatch(r.url, /RefreshToken|checkin|claim/i);
  }
  assert.deepEqual(out.metrics.map(m => m.remaining), ['60', '75', '20']);
  assert.equal(out.metrics[0].resetAt, out.metrics[1].resetAt);
  assert.equal(out.metrics[2].resetAt, null);
  assert.equal(out.entitlements?.membershipExpiresAt?.value?.precision, 'instant');
  assert.equal(out.entitlements?.autoRenew?.value, false);
  assert.equal(out.entitlements?.billingPeriodEnd, undefined);
  assert.equal(out.fields.find(f => f.field === 'renewalDate'), undefined);
  assert.equal(JSON.stringify(out).includes('refresh-jwt'), false);
});

test('Step Plan partial quota/status failure is isolated; auth failure remains fatal', async () => {
  const requests: string[] = [];
  const fetchFn: ControlFetchFn = async url => {
    requests.push(url);
    return { status: url.endsWith('GetStepPlanStatus') ? 503 : 200, headers: { get: () => null }, text: async () => JSON.stringify(stepQuota) };
  };
  const a = createControlAdapters({ fetchFn }).find(a => String(a.manifest.id) === 'stepfun-plan-com')!;
  const out = await a.collect({ ...input, secret: stepSecret });
  assert.equal(out.metrics.length, 3); assert.equal(out.partialFailures.length, 1);
  assert.equal(out.entitlements?.membershipExpiresAt, undefined);
  const h = harness({}, 401);
  await assert.rejects(h.get('stepfun-plan-com').collect({ ...input, secret: stepSecret }), code('AUTH_REQUIRED'));
  assert.equal(requests.length, 2);
});

test('Step plan absent zero-reset window is not exhausted, invalid dates stay separate from valid plan', () => {
  const h = harness({});
  const out = h.get('stepfun-plan-com').normalize({ quota: { five_hour_usage_left_rate: 0, five_hour_usage_reset_time: 0 }, status: { subscription: { name: 'Step', expired_at: 'bad' } } }, at);
  assert.equal(out.metrics.length, 0);
  assert.equal(out.entitlements?.membershipExpiresAt, undefined);
  assert.equal(out.partialFailures.length, 1);
});

test('StepFun API balance uses root balance and region-specific currency, never a Plan session', async () => {
  for (const [site, currency] of [['com', 'CNY'], ['ai', 'USD']] as const) {
    const h = harness({ balance: '123.4500' });
    const out = await h.get(`stepfun-balance-${site}`).collect(input);
    assert.equal(h.requests[0].url, `https://api.stepfun.${site}/v1/accounts`);
    assert.equal(h.requests[0].init.method, 'GET');
    assert.equal(out.balances?.[0].currency, currency);
    assert.equal(out.balances?.[0].amount.value, '123.4500');
    assert.equal(out.metrics.length, 0);
  }
});

test('Ollama plan money, purchased money and legacy percentages are distinct', async () => {
  const h = harness({ included: { balance_usd: '72.5000', allowance_usd: 100, period: { from: '2026-10-01T00:00:00Z', until: '2026-11-01T00:00:00Z' }, session: { remaining_percent: 75, resets_at: 'bad' }, weekly: { remaining_percent: 40 } }, purchased: { balance_usd: '25.00' } });
  const out = await h.get('ollama-cloud').collect(input);
  assert.equal(h.requests[0].url, 'https://ollama.com/api/balance');
  assert.deepEqual(out.metrics.map(m => m.unit), ['USD', '%', '%']);
  assert.equal(out.metrics[0].remaining, '72.5000');
  assert.equal(out.metrics[1].windowMinutes, undefined);
  assert.equal(out.metrics[1].resetAt, null);
  assert.equal(out.balances?.[0].amount.value, '25.00');
  assert.equal(out.entitlements?.billingPeriodEnd?.value?.value, '2026-11-01T00:00:00.000Z');
  assert.equal(out.entitlements?.membershipExpiresAt, undefined);
  const absent = h.get('ollama-cloud').normalize({ included: { session: { remaining_percent: 0 } } }, at);
  assert.equal(absent.balances, undefined);
  assert.equal(absent.metrics[0].remaining, '0');
});

test('Remote reads cache only, preserves read time, isolates cards/users and scopes units', async () => {
  const h = harness({ data: [
    { provider: 'codex', user: 'alice', readAt: '2026-10-19T00:00:00Z', windows: [{ name: '5h', used: 30 }] },
    { provider: 'codex', user: 'bob', readAt: '2026-10-20T00:00:00Z', windows: [{ name: '5h', amount: 5, limit: 20, unit: 'credits' }] },
    { provider: 'bad', error: 'secret-upstream-body', windows: [] },
    { provider: 'recursive', from: 'other-magpie', windows: [{ used: 90 }] },
  ] });
  const out = await h.get('remote-magpie').collect({ ...input, secret: '{"origin":"https://magpie.example","apiKey":"remote-key"}' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://magpie.example/v1/magpie/quotas/cards');
  assert.equal(h.requests[0].init.method, 'GET');
  assert.equal(out.metrics.length, 2);
  assert.deepEqual(out.metrics.map(m => m.unit), ['%', 'credits']);
  assert.deepEqual(out.metrics.map(m => m.remaining), ['70', '15']);
  assert.equal(out.metrics[0].observedAt, '2026-10-19T00:00:00.000Z');
  assert.equal(out.metrics[0].evidence, 'cached');
  assert.notEqual(out.metrics[0].id, out.metrics[1].id);
  assert.notEqual(out.metrics[0].poolId, out.metrics[1].poolId);
  assert.equal(out.partialFailures.length, 1);
  assert.equal(JSON.stringify(out).includes('secret-upstream-body'), false);
});

test('Remote unknown cache time never pretends current; unapproved origin never receives key', async () => {
  const h = harness({ data: [{ provider: 'codex', windows: [{ name: 'week', used: 10 }] }] });
  const raw = h.get('remote-magpie').normalize({ data: [{ provider: 'codex', windows: [{ name: 'week', used: 10 }] }] }, at);
  assert.equal(raw.metrics[0].remaining, null); assert.equal(raw.metrics[0].availability, 'unfetched');
  await assert.rejects(h.get('remote-magpie').collect({ ...input, secret: '{"origin":"https://evil.example","apiKey":"key"}' }), code('UNSUPPORTED'));
  await assert.rejects(h.get('remote-magpie').collect({ ...input, secret: '{"origin":"http://magpie.example","apiKey":"key"}' }), code('UNSUPPORTED'));
  assert.equal(h.requests.length, 0);
  assert.throws(() => createControlAdapters({ remoteOrigins: ['https://user:password@magpie.example'] }));
  assert.throws(() => createControlAdapters({ remoteOrigins: ['https://magpie.example:9090'] }));
});

test('Relay uses approved protocol/path; exact monetary quota conversion does not lose precision', async () => {
  const h = harness({ success: true, data: { total_available: '9007199254740993' } });
  const out = await h.get('relay').collect(input);
  assert.equal(h.requests[0].url, 'https://relay.example/api/usage/token');
  assert.equal(out.balances?.[0].amount.value, '18014398509.481986');
  assert.equal(out.balances?.[0].scope, 'key');
  assert.equal(out.balances?.[0].currency, 'USD');
  assert.throws(() => h.get('relay').normalize({ success: false, data: { total_available: 0 } }, at), code('SCHEMA_CHANGED'));
});

test('OpenCode envelope identity/alias is preserved, raw keys use shared hashKeySubject', async () => {
  const h = harness({ balance: '12' });
  const a = h.get('stepfun-balance-com');
  const out = await a.collect({ ...input, secret: JSON.stringify({ type: 'api', key: 'actual-key', accessToken: 'actual-key', subject: 'external-account', alias: 'Work', source: 'stepfun', management: 'external', locator: 'auth.json:stepfun' }) });
  assert.equal(h.requests[0].init.headers.Authorization, 'Bearer actual-key');
  assert.equal(out.account.subject, 'external-account');
  assert.equal(out.account.alias, 'Work');
  assert.equal(out.balances?.[0].poolId, 'external-account');
  assert.equal(JSON.stringify(out).includes('auth.json'), false);
  const raw = await a.collect({ ...input, secret: 'test-key' });
  const { hashKeySubject } = await import('../src/main/adapters/http-adapters');
  assert.equal(raw.account.subject, hashKeySubject('stepfun-balance-com', 'test-key'));
});

test('Google and Step Plan accept external session envelopes, preserving external stable identity', async () => {
  const h = harness({ buckets: [{ modelId: 'gemini', remainingFraction: 1 }] });
  const out = await h.get('gemini-cli').collect({ ...input, expectedSubject: 'google:account', secret: JSON.stringify({ access: 'token', accessToken: 'token', project: 'p', subject: 'google:account', alias: 'Alice', management: 'external' }) });
  assert.equal(out.account.subject, 'google:account');
  assert.equal(out.account.alias, 'Alice');
  const step = harness(stepQuota);
  const stepOut = await step.get('stepfun-plan-ai').collect({ ...input, secret: JSON.stringify({ accessToken: stepSecret, subject: 'step:external', alias: 'Step account' }) });
  assert.equal(stepOut.account.subject, 'step:external');
  assert.equal(step.requests[0].init.headers.Cookie, 'Oasis-Token=access-jwt...refresh-jwt');
});

test('other Relay protocols use fixed USD fields and never evaluate arbitrary JSONPath', async () => {
  for (const protocol of ['sub2api-key', 'credit-grants'] as const) {
    const calls: string[] = [];
    const fetchFn: ControlFetchFn = async url => {
      calls.push(url);
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(protocol === 'sub2api-key' ? { remaining: '123.400' } : { total_available: '123.400' }) };
    };
    const a = createControlAdapters({ fetchFn, relays: [{ origin: 'https://relay.example', protocol }] }).at(-1)!;
    const out = await a.collect(input);
    assert.equal(out.balances?.[0].amount.value, '123.400');
    assert.equal(calls[0], `https://relay.example${protocol === 'sub2api-key' ? '/v1/usage' : '/dashboard/billing/credit_grants'}`);
  }
});

test('all transport failures are safely classified, rate limits retain backoff', async () => {
  for (const [status, expected] of [[401, 'AUTH_REQUIRED'], [403, 'PERMISSION_DENIED'], [429, 'RATE_LIMITED'], [503, 'UPSTREAM_UNAVAILABLE']] as const) {
    const h = harness({ error: 'PRIVATE-KEY-DO-NOT-LEAK' }, status);
    await assert.rejects(h.get('ollama-cloud').collect(input), (e: unknown) => {
      assert.ok(e instanceof AdapterError); assert.equal(e.code, expected);
      assert.equal(e.message.includes('PRIVATE-KEY'), false);
      if (status === 429) assert.equal(e.options?.retryAfterMs, 17000);
      return true;
    });
  }
  const aborted = new AbortController(); aborted.abort();
  const h = harness({});
  await assert.rejects(h.get('ollama-cloud').collect({ ...input, signal: aborted.signal }), code('CANCELLED'));
  assert.equal(h.requests.length, 0);
  for (const id of ['ollama-cloud', 'gemini-cli', 'antigravity', 'stepfun-balance-com', 'remote-magpie']) assert.throws(() => h.get(id).normalize({}, at), code('SCHEMA_CHANGED'));
});
