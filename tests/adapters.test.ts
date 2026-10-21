import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterError } from '../src/main/adapters/types';
import { DeepSeekBalanceAdapter, KimiPlatformCnAdapter, OpenRouterKeyAdapter, parseRetryAfterMs, assertAllowedAdapterGetUrl, DEEPSEEK_MANIFEST, type HttpFetchFn } from '../src/main/adapters/http-adapters';
import { CodexLocalAdapter } from '../src/main/adapters/codex-adapter';
import { CopilotLocalAdapter } from '../src/main/adapters/copilot-adapter';

const now = '2026-10-21T03:00:00.000Z';
const input = { connectionId: 'test', generation: 1, reason: 'probe' as const, secret: 'test-not-a-real-key' };
const errorCode = (code: string) => (error: unknown) => error instanceof AdapterError && error.code === code;
const response = (status: number, body: unknown, retry?: string): HttpFetchFn => async () => ({ status, headers: { get: () => retry ?? null }, text: async () => JSON.stringify(body) });

test('HTTP 只读固定主机、拒绝重定向目标、未知字段不补零', async () => {
  let called = 0;
  const adapter = new DeepSeekBalanceAdapter(async (url, request) => {
    called++; assert.equal(url, 'https://api.deepseek.com/user/balance'); assert.equal(request.method, 'GET');
    assert.equal(request.headers.Authorization, `Bearer ${input.secret}`);
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '0', granted_balance: '0.000000123456' }] }) };
  });
  const out = await adapter.collect(input); assert.equal(called, 1);
  assert.equal(out.metrics.find(m => m.id === 'total_cny')?.remaining, '0');
  assert.equal(out.metrics.find(m => m.id === 'gift_cny')?.remaining, '0.000000123456');
  assert.equal(out.metrics.some(m => m.id === 'cash_cny'), false);
  assert.equal(out.partialFailures.length, 1);
  for (const url of ['http://api.deepseek.com/user/balance', 'https://api.deepseek.com.evil.test/user/balance', 'https://x:secret@api.deepseek.com/user/balance', 'https://api.deepseek.com:8443/user/balance']) assert.throws(() => assertAllowedAdapterGetUrl(DEEPSEEK_MANIFEST, url), errorCode('UNSUPPORTED'));
});

test('401/403/429/5xx与结构变化分类，错误不包含响应秘密', async () => {
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'PERMISSION_DENIED'], [429, 'RATE_LIMITED'], [503, 'UPSTREAM_UNAVAILABLE']] as const) {
    const adapter = new DeepSeekBalanceAdapter(response(status, { message: 'must-not-leak-secret' }, '172800'));
    await assert.rejects(adapter.collect(input), error => { assert.ok(errorCode(code)(error)); assert.doesNotMatch(String(error), /must-not-leak/); if (status === 429) assert.equal((error as AdapterError).options?.retryAfterMs, 172800000); return true; });
  }
  assert.equal(parseRetryAfterMs('172800'), 172800000, '不能把两天Retry-After截成一天');
  await assert.rejects(new DeepSeekBalanceAdapter(response(200, {})).collect(input), errorCode('SCHEMA_CHANGED'));
});

test('请求取消不发起查询，超时不伪装结构变化', async () => {
  let requests = 0;
  const cancelled = new DeepSeekBalanceAdapter(async () => { requests++; throw new Error('not reached'); });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(cancelled.collect({ ...input, signal: abort.signal }), errorCode('CANCELLED')); assert.equal(requests, 0);
  const timed = new DeepSeekBalanceAdapter(async (_url, request) => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
  await assert.rejects(timed.collect({ ...input, timeoutMs: 5 }), errorCode('TIMEOUT'));
});

test('DeepSeek 币种变化保留指标身份，失败不是零', () => {
  const adapter = new DeepSeekBalanceAdapter();
  const single = adapter.normalize({ balance_infos: [{ currency: 'CNY', total_balance: '10.12345678' }] }, now);
  const multi = adapter.normalize({ balance_infos: [{ currency: 'CNY', total_balance: '9' }, { currency: 'USD', total_balance: '2' }] }, now);
  assert.equal(single.metrics[0].id, multi.metrics[0].id); assert.equal(single.metrics[0].remaining, '10.12345678');
  assert.equal(multi.metrics[1].unit, 'USD');
});

test('Kimi 业务成功状态、负现金和部分成功，不能自行相加', () => {
  const adapter = new KimiPlatformCnAdapter();
  const out = adapter.normalize({ code: 0, status: true, data: { available_balance: 9, cash_balance: -3, voucher_balance: 9 } }, now);
  assert.equal(out.metrics.find(m => m.id === 'available')?.remaining, '9');
  assert.equal(out.metrics.find(m => m.id === 'cash')?.remaining, '-3');
  const partial = adapter.normalize({ code: 0, status: true, data: { cash_balance: 4 } }, now);
  assert.equal(partial.metrics.length, 1); assert.equal(partial.metrics[0].id, 'cash'); assert.equal(partial.partialFailures.length, 2);
  for (const envelope of [{ code: 1, status: true }, { code: 0, status: false }, {}]) assert.throws(() => adapter.normalize({ ...envelope, data: { available_balance: 99 } }, now), errorCode('UPSTREAM_UNAVAILABLE'));
});

test('OpenRouter Key与生效预算分列，null限额不等于账户无限资金', () => {
  const adapter = new OpenRouterKeyAdapter();
  const out = adapter.normalize({ data: { limit: null, limit_remaining: null, usage: 12.25, effective_budget: { scope: 'member', remaining_usd: 5.5, limit_usd: 50, spend_usd: 44.5, resets_at: '2026-11-01T00:00:00Z' } } }, now);
  assert.equal(out.metrics[0].id, 'effective-budget'); assert.equal(out.metrics[0].remaining, '5.5');
  assert.equal(out.metrics.find(m => m.id === 'budget')?.total, null);
  assert.equal(out.metrics.find(m => m.id === 'usage')?.remaining, '12.25');
  assert.equal(out.fields.some(f => f.field === 'renewalDate'), false);
  const missing = adapter.normalize({ data: { usage: 2, limit: null } }, now);
  assert.equal(missing.metrics.some(m => m.availability === 'unlimited'), false);
});

const codex = (buckets: unknown) => ({ accountRead: { account: { type: 'chatgpt', email: 'test@example.test', planType: 'plus' } }, rateLimitsRead: { rateLimitsByLimitId: buckets } });
test('Codex 全部桶、稳定身份、秒时间戳和异常百分比', () => {
  const adapter = new CodexLocalAdapter();
  const window = { usedPercent: 25.123456, windowDurationMins: 300, resetsAt: 1792551600 };
  const a = adapter.normalize(codex({ codex: { primary: window } }), now);
  const b = adapter.normalize(codex({ codex: { primary: window, secondary: { ...window, usedPercent: 110 } }, other: { primary: { ...window, windowDurationMins: 60 } } }), now);
  assert.equal(a.metrics[0].id, b.metrics[0].id); assert.equal(b.metrics.length, 3);
  assert.equal(b.metrics[0].remaining, '74.876544'); assert.equal(b.metrics[1].remaining, '-10');
  assert.equal(b.metrics[0].resetAt, new Date(1792551600 * 1000).toISOString());
  assert.equal(b.fields.some(f => f.field === 'renewalDate'), false);
});
test('Codex null不是0%已用，账号变更不得提交', async () => {
  const adapter = new CodexLocalAdapter(async () => codex({ codex: { primary: { usedPercent: 20 } } }));
  assert.throws(() => adapter.normalize(codex({ codex: { primary: { usedPercent: null } } }), now), errorCode('SCHEMA_CHANGED'));
  await assert.rejects(adapter.collect({ ...input, reason: 'scheduled', expectedSubject: 'other-account' }), errorCode('ACCOUNT_MISMATCH'));
});

test('Copilot动态键、文档无限量、缺resetDate不倒计时', () => {
  const adapter = new CopilotLocalAdapter();
  const out = adapter.normalize({ auth: { isAuthenticated: true, login: 'test-user' }, quota: { quotaSnapshots: { future_plan: { entitlementRequests: -1 }, chat: { remainingPercentage: 40, entitlementRequests: 100, usedRequests: 60 }, missing: {} } } }, now);
  assert.equal(out.metrics.find(m => m.id === 'future_plan')?.availability, 'unlimited');
  assert.equal(out.metrics.find(m => m.id === 'chat')?.remaining, '40');
  assert.equal(out.metrics.find(m => m.id === 'chat:requests')?.remaining, '40');
  assert.equal(out.metrics.every(m => m.resetAt === null), true);
  assert.equal(out.metrics.some(m => m.id === 'missing'), false); assert.equal(out.partialFailures.length, 1);
});
