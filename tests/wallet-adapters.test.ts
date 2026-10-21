import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletAdapters, walletAdapters, type WalletTemplate } from '../src/main/adapters/wallet-adapters';
import type { HttpFetchFn } from '../src/main/adapters/http-adapters';
import type { CollectInput } from '../src/main/adapters/types';

const at = '2026-10-21T10:00:00.000Z';
const input = (secret: unknown = 'test-key'): CollectInput => ({ connectionId: 'wallet-test', generation: 1, reason: 'probe', secret: typeof secret === 'string' ? secret : JSON.stringify(secret) });
function fake(body: unknown, status = 200, headers: Record<string, string> = {}, seen: { url: string; init: Parameters<HttpFetchFn>[1] }[] = []): HttpFetchFn {
  return async (url, init) => { seen.push({ url, init }); return { status, headers: { get: name => headers[name.toLowerCase()] ?? null }, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }; };
}
const official = (id: string, fetchFn?: HttpFetchFn) => createWalletAdapters({ fetchFn }).find(a => a.manifest.id === id)!;
function relay(template: WalletTemplate, fetchFn?: HttpFetchFn) {
  return createWalletAdapters({ fetchFn, approvedOrigins: [{ origin: 'https://panel.example.com', template, source: 'reviewed-panel' }] }).at(-1)!;
}
const relaySecret = { accessToken: 'panel-key', source: 'reviewed-panel', locator: { origin: 'https://panel.example.com' }, management: 'external' };

test('default registration contains only five fixed official wallets, not existing providers or relays', () => {
  assert.deepEqual(walletAdapters.map(a => a.manifest.id), ['kimi-platform-global', 'siliconflow-cn', 'siliconflow-global', 'aihubmix-key', 'aihubmix-account']);
  assert.ok(walletAdapters.every(a => a.manifest.allowedHosts.length === 1));
});
test('Kimi international preserves USD components independently; missing is not zero', () => {
  const out = official('kimi-platform-global').normalize({ code: 0, status: true, data: { available_balance: '9007199254740993.123456789', cash_balance: '0' } }, at);
  assert.deepEqual(out.balances!.map(b => [b.scope, b.kind, b.currency, b.amount.value]), [['account', 'total', 'USD', '9007199254740993.123456789'], ['account', 'cash', 'USD', '0']]);
  assert.ok(out.partialFailures.some(f => f.field === 'voucher'));
  assert.equal(out.fields.length, 0); assert.equal(out.entitlements, undefined);
  assert.throws(() => official('kimi-platform-global').normalize({ code: 1, status: false, data: { available_balance: 99 } }, at));
  assert.throws(() => official('kimi-platform-global').normalize({ code: 0, status: true, data: {} }, at));
});
test('transport preserves decimal numeric lexemes and exponent precision before JSON.parse', async () => {
  const a = official('kimi-platform-global', fake('{"code":0,"status":true,"data":{"available_balance":9007199254740993.123456789,"cash_balance":1.23456789123456789e-8,"voucher_balance":0}}'));
  const out = await a.collect(input());
  assert.deepEqual(out.balances!.map(b => b.amount.value), ['9007199254740993.123456789', '0.0000000123456789123456789', '0']);
});
test('SiliconFlow both regions: HTTP 410 or code 20092 never returns successful observations', async () => {
  for (const id of ['siliconflow-cn', 'siliconflow-global']) {
    for (const [status, code] of [[410, 20092], [200, 20092], [410, 20000]]) {
      const a = official(id, fake({ code, data: { totalBalance: '123' } }, status));
      await assert.rejects(a.collect(input()), { code: 'UNSUPPORTED' });
    }
    const out = official(id).normalize({ code: 20000, data: { totalBalance: '0.0000000001', balance: '8', chargeBalance: '9' } }, at);
    assert.equal(out.balances!.length, 1); assert.equal(out.balances![0].currency, id.endsWith('-cn') ? 'CNY' : 'USD');
    assert.equal(out.balances![0].amount.value, '0.0000000001');
    await assert.rejects(official(id, fake({}, 401)).collect(input()), { code: 'AUTH_REQUIRED' });
  }
});
test('AiHubMix total_usage is remaining Key budget, negative means uncapped Key NOT account funds', () => {
  const a = official('aihubmix-key');
  const out = a.normalize({ object: 'list', total_usage: '12.34567890123456789' }, at);
  assert.deepEqual(out.balances!.map(b => [b.scope, b.kind, b.amount.value]), [['key', 'budget', '12.34567890123456789']]);
  const uncapped = a.normalize({ total_usage: '-0.000002' }, at);
  assert.equal(uncapped.balances!.length, 0); assert.equal(uncapped.metrics[0].availability, 'unlimited');
  assert.equal(uncapped.metrics[0].remaining, null); assert.equal(uncapped.metrics[0].scope, 'key');
  assert.equal(a.normalize({ total_usage: '-0' }, at).balances![0].amount.value, '-0');
});
test('AiHubMix account quota divides exactly and uses raw account token authorization', async () => {
  const seen: { url: string; init: Parameters<HttpFetchFn>[1] }[] = [];
  const a = official('aihubmix-account', fake({ success: true, data: { quota: '9007199254740993.123456789' } }, 200, {}, seen));
  const out = await a.collect(input({ accessToken: 'system-token', subject: 'account-a', alias: 'A', source: 'opencode', management: 'external', locator: {} }));
  assert.equal(seen[0].url, 'https://aihubmix.com/api/user/self'); assert.equal(seen[0].init.headers.Authorization, 'system-token');
  assert.equal(out.balances![0].amount.value, '18014398509.481986246913578');
  assert.equal(out.balances![0].scope, 'account'); assert.equal(out.account.subject, 'account-a');
});
test('approved templates have fixed endpoints, no expressions, no compatibility guessing', async () => {
  for (const template of ['new-api-key', 'one-api-key'] as const) {
    const seen: { url: string; init: Parameters<HttpFetchFn>[1] }[] = [];
    const a = relay(template, fake({ success: true, data: { total_available: '123456789.0123456789' } }, 200, {}, seen));
    const out = await a.collect(input(relaySecret));
    assert.equal(seen[0].url, 'https://panel.example.com/api/usage/token'); assert.equal(seen[0].init.headers.Authorization, 'Bearer panel-key');
    assert.equal(out.balances![0].amount.value, '246.9135780246913578'); assert.equal(out.balances![0].scope, 'key');
    assert.equal(out.balances![0].amount.evidence, 'derived');
  }
  const uncapped = relay('new-api-key').normalize({ success: true, data: { unlimited_quota: true, total_available: '0' } }, at);
  assert.equal(uncapped.balances!.length, 0); assert.equal(uncapped.metrics[0].availability, 'unlimited');
  for (const site of ['http://panel.example.com', 'https://panel.example.com/path', 'https://panel.example.com:8443', 'https://user:pass@panel.example.com', 'https://127.0.0.1', 'https://panel.example.com/?key={key}']) {
    assert.throws(() => createWalletAdapters({ approvedOrigins: [{ origin: site, template: 'new-api-key', source: 'reviewed-panel' }] }), { code: 'UNSUPPORTED' });
  }
  assert.throws(() => createWalletAdapters({ approvedOrigins: [{ origin: 'https://panel.example.com', template: 'data.quota / 3' as WalletTemplate, source: 'reviewed-panel' }] }));
});
test('relay requires source plus precise host binding before any request', async () => {
  let calls = 0; const a = relay('sub2api-key', async () => { calls++; throw new Error(); });
  for (const secret of ['raw-key', { ...relaySecret, source: 'unknown' }, { ...relaySecret, locator: { origin: 'https://other.example.com' } }, { ...relaySecret, locator: {} }]) {
    await assert.rejects(a.collect(input(secret)));
  }
  assert.equal(calls, 0);
});
test('New API account requires user ID, no account-to-Key downgrade; refusal is failure', async () => {
  const seen: { url: string; init: Parameters<HttpFetchFn>[1] }[] = [];
  const a = relay('new-api-account', fake({ success: true, data: { quota: '500000' } }, 200, {}, seen));
  await assert.rejects(a.collect(input(relaySecret)), { code: 'AUTH_REQUIRED' }); assert.equal(seen.length, 0);
  const out = await a.collect(input({ ...relaySecret, userId: '42' }));
  assert.equal(seen[0].init.headers['New-Api-User'], '42'); assert.equal(seen[0].init.headers.Authorization, 'panel-key');
  assert.equal(out.balances![0].amount.value, '1'); assert.equal(out.balances![0].scope, 'account');
  assert.throws(() => a.normalize({ success: false, message: 'refused', data: { quota: 500000 } }, at), { code: 'PERMISSION_DENIED' });
});
test('Sub2API retains independent Key windows, exact subtraction, explicit starts/resets only', () => {
  const out = relay('sub2api-key').normalize({ isValid: true, mode: 'quota_limited', rate_limits: [
    { window: '5h', limit: '1.0000000000000000001', used: '0.0000000000000000002', reset_at: '2026-10-22T00:00:00+08:00', window_start: '2026-10-21T19:00:00+08:00' },
    { window: '1d', limit: '300', used: '0', remaining: '300', window_start: null },
    { window: '7d', limit: '800' },
  ] }, at);
  assert.equal(out.balances!.length, 0); assert.equal(out.metrics.length, 3);
  assert.equal(out.metrics[0].remaining, '0.9999999999999999999'); assert.equal(out.metrics[0].evidence, 'derived');
  assert.equal(out.metrics[0].resetAt, '2026-10-21T16:00:00.000Z'); assert.ok(out.metrics[0].windowStart);
  assert.equal(out.metrics[1].resetAt, null); assert.equal(out.metrics[1].windowStart, undefined);
  assert.equal(out.metrics[2].remaining, null); assert.equal(out.metrics[2].used, null); assert.equal(out.metrics[2].availability, 'unfetched');
  assert.ok(out.metrics.every(m => m.scope === 'key' && m.unit === 'USD'));
  const account = relay('sub2api-account').normalize({ code: 0, data: { balance: '3.123456789' } }, at);
  assert.equal(account.balances![0].scope, 'account'); assert.equal(account.balances![0].amount.value, '3.123456789');
  assert.throws(() => relay('sub2api-key').normalize({ isValid: false, remaining: '9' }, at));
});
test('legacy credit-grants keeps available and usage apart, never invents current cash/grant', () => {
  const out = relay('credit-grants').normalize({ total_available: '2.01', total_used: '3.99', total_granted: '6' }, at);
  assert.deepEqual(out.balances!.map(b => [b.kind, b.amount.value]), [['total', '2.01'], ['usage', '3.99']]);
});
test('old response dates are not freshened and identities/pools remain isolated', async () => {
  const a = official('kimi-platform-global', fake({ code: 0, status: true, data: { available_balance: '2' } }, 200, { date: 'Tue, 20 Oct 2026 10:00:00 GMT' }));
  const old = await a.collect(input('key-A')), other = await a.collect(input('key-B'));
  assert.equal(old.observedAt, '2026-10-20T10:00:00.000Z'); assert.equal(old.balances![0].amount.observedAt, old.observedAt);
  assert.notEqual(old.account.subject, other.account.subject); assert.notEqual(old.balances![0].poolId, other.balances![0].poolId);
  await assert.rejects(a.collect({ ...input('key-B'), reason: 'scheduled', expectedSubject: old.account.subject }), { code: 'ACCOUNT_MISMATCH' });
  const out = a.normalize({ code: 0, status: true, providerAt: '2026-10-01T00:00:00Z', data: { available_balance: '1' } }, at);
  assert.equal(out.observedAt, '2026-10-01T00:00:00.000Z');
  const keyAdapter = official('aihubmix-key', fake({ total_usage: '1' }));
  const keyA = await keyAdapter.collect(input({ accessToken: 'key-a', subject: 'same-account' }));
  const keyB = await keyAdapter.collect(input({ accessToken: 'key-b', subject: 'same-account' }));
  assert.notEqual(keyA.balances![0].poolId, keyB.balances![0].poolId);
});
test('fixed host envelopes reject cross-region binding, cancellation and HTTP failures remain failures', async () => {
  const a = official('siliconflow-cn', fake({ code: 20000, data: { totalBalance: '1' } }));
  await assert.rejects(a.collect(input({ accessToken: 'key', baseUrl: 'https://api.siliconflow.com' })), { code: 'AUTH_REQUIRED' });
  for (const [status, code] of [[403, 'PERMISSION_DENIED'], [429, 'RATE_LIMITED'], [500, 'UPSTREAM_UNAVAILABLE']] as const) {
    await assert.rejects(official('aihubmix-key', fake({}, status, { 'retry-after': '20' })).collect(input()), { code });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(a.collect({ ...input(), signal: controller.signal }), { code: 'CANCELLED' });
  await assert.rejects(official('aihubmix-key', fake('<html>error</html>')).collect(input()), { code: 'SCHEMA_CHANGED' });
});
