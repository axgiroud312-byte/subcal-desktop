import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ExtendedProviderAdapter, extendedAdapters, resolveExtendedCredential, type ExtendedAdapterId, type ExtendedAdapterOptions } from '../src/main/adapters/extended-adapters';
import type { HttpFetchFn } from '../src/main/adapters/http-adapters';
import type { CollectInput } from '../src/main/adapters/types';

const at = '2026-10-21T00:00:00.000Z';
const end = '2026-11-01T00:00:00Z';
const input: CollectInput = { connectionId: 'synthetic', generation: 1, reason: 'manual', secret: 'synthetic-key' };
const response = (value: unknown, status = 200, retry?: string) => ({ status, headers: { get: (name: string) => name === 'retry-after' ? retry || null : null }, text: async () => JSON.stringify(value) });
const adapter = (id: ExtendedAdapterId, options?: ExtendedAdapterOptions) => new ExtendedProviderAdapter(id, options);
const normalize = (id: ExtendedAdapterId, raw: unknown) => adapter(id).normalize(raw, at);
const keySubject = (id: string, key = 'synthetic-key') => `${id}:${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;

test('all 11 independent manifests are exported without retired IDs', () => {
  assert.equal(extendedAdapters.length, 11);
  assert.equal(new Set(extendedAdapters.map(a => a.manifest.id)).size, 11);
  assert(extendedAdapters.every(a => !['grok', 'commandcode-plan', 'factory-local'].includes(a.manifest.id)));
});

test('Grok billing is percentage, currentPeriod wins, and it is not membership expiry', () => {
  const out = normalize('grok-build', { config: { creditUsagePercent: 42.5, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end }, billingPeriodEnd: '2030-01-01T00:00:00Z', onDemandCap: { val: 2000 }, onDemandUsed: { val: 500 } } });
  assert.equal(out.metrics[0].used, '42.5');
  assert.equal(out.metrics[0].remaining, '57.5');
  assert.equal(out.metrics[0].resetAt, '2026-11-01T00:00:00.000Z');
  assert.equal(out.metrics[0].windowMinutes, 10080);
  assert.equal(out.metrics[1].used, '25');
  assert(out.metrics.every(m => m.unit === '%'));
  assert.deepEqual(out.entitlements, {});
});

test('unknown quantities never become zero and malformed dates are not parsed heuristically', () => {
  assert.throws(() => normalize('grok-build', { config: { currentPeriod: { end } } }), { code: 'SCHEMA_CHANGED' });
  const out = normalize('grok-build', { config: { creditUsagePercent: 0, currentPeriod: { end: '2026-11-01' } } });
  assert.equal(out.metrics[0].used, '0');
  assert.equal(out.metrics[0].resetAt, null);
});

test('Kimi Code strings and short windows only expose verified relative units', () => {
  const out = normalize('kimi-code-cn', { usage: { limit: '200', used: '50', resetTime: end }, limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', remaining: '88', resetTime: end } }, { detail: {} }] });
  assert.equal(out.metrics[0].used, '12');
  assert.equal(out.metrics[0].windowMinutes, 300);
  assert.equal(out.metrics[1].used, '25');
  assert(out.metrics.every(m => m.unit === '%'));
  assert.equal(out.partialFailures.length, 1);
});

test('Kimi Code international and China use separate hosts without fallback', async () => {
  for (const [id, host] of [['kimi-code', 'api.kimi.ai'], ['kimi-code-cn', 'api.kimi.com']] as const) {
    const calls: string[] = [];
    const out = await adapter(id, { fetchFn: async (url, init) => { calls.push(url); assert.equal(init.method, 'GET'); return response({ usage: { limit: 100, used: 0 } }); } }).collect({ ...input, expectedSubject: keySubject(id) });
    assert.deepEqual(calls, [`https://${host}/coding/v1/usages`]);
    assert.equal(out.account.subject, keySubject(id));
  }
});

test('Kimi Work uses only the constant read-only POST RPC and no Code/model paths', async () => {
  const calls: string[] = [];
  const out = await adapter('kimi-work', {
    fetchFn: async () => { throw Error('GET must not be called'); },
    postFetchFn: async (url, init) => { calls.push(url); assert.equal(init.method, 'POST'); assert.equal(init.body, '{}'); assert.equal(init.redirect, 'error'); assert.equal(init.headers['Connect-Protocol-Version'], '1'); return response({ subscriptionBalance: { amountUsedRatio: 0.42 } }); },
  }).collect(input);
  assert.deepEqual(calls, ['https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats']);
  assert.equal(out.metrics[0].used, '42');
  assert.deepEqual(out.entitlements, {});
  assert.equal(out.metrics[0].resetAt, null);
});

test('Factory keeps Standard/Core pools distinct, converts cents and epoch milliseconds', async () => {
  const raw = { limits: { standard: { fiveHour: { usedPercent: 42, windowEnd: end }, weekly: { usedPercent: 10, windowEnd: 1791763200000 }, monthly: { usedPercent: 130 } }, core: { fiveHour: { usedPercent: 100 } } }, extraUsageBalanceCents: 1250, extraUsageAllowed: true };
  const out = await adapter('factory', { fetchFn: async (url, init) => { assert.equal(url, 'https://api.eu.factory.ai/api/billing/limits'); assert.equal(init.headers['X-Factory-Org-Id'], 'org-eu'); return response(raw); } }).collect({ ...input, secret: JSON.stringify({ accessToken: 'synthetic-key', region: 'eu', organizationId: 'org-eu', subject: 'factory:user-eu' }), expectedSubject: 'factory:user-eu' });
  assert.equal(out.metrics.length, 4);
  assert.equal(out.metrics[1].resetAt, '2026-10-12T00:00:00.000Z');
  assert.equal(out.metrics[2].remaining, '0');
  assert.notEqual(out.metrics[0].poolId, out.metrics[3].poolId);
  assert.equal(out.balances![0].amount.value, '12.5');
  assert.equal(out.balances![0].currency, 'USD');
});

test('Cline no-Pass 404 preserves zero USD balance; microdollars are not credits', async () => {
  const calls: string[] = [];
  const out = await adapter('cline', { fetchFn: async (url) => { calls.push(url); if (url.endsWith('usage-limits')) return response({}, 404); if (url.endsWith('/balance')) return response({ balance: '0' }); return response({ clineUserId: 'user/synthetic', plan: 'Free' }); } }).collect(input);
  assert(calls.includes('https://api.cline.bot/api/v1/users/user%2Fsynthetic/balance'));
  assert.equal(out.balances![0].amount.value, '0');
  assert.equal(out.balances![0].currency, 'USD');
  assert.deepEqual(out.partialFailures, []);
  assert.equal(normalize('cline', { balance: { balance: '1250000' } }).balances![0].amount.value, '1.25');
});

test('Cline limit failure retains wallet; balance failure retains Pass limits', async () => {
  for (const fail of ['limits', 'balance']) {
    const out = await adapter('cline', { fetchFn: async (url) => {
      if (url.endsWith('usage-limits')) return fail === 'limits' ? response({}, 503) : response({ limits: [{ type: 'five_hour', percentUsed: 20, resetsAt: end }] });
      if (url.endsWith('/balance')) return fail === 'balance' ? response({}, 403) : response({ balance: 2000000 });
      return response({ clineUserId: 'synthetic' });
    } }).collect(input);
    assert(out.partialFailures.some(f => f.field === fail));
    assert(fail === 'limits' ? out.balances!.length === 1 : out.metrics.length === 1);
  }
});

test('total auth failure is not misreported as schema change', async () => {
  await assert.rejects(adapter('cline', { fetchFn: async () => response({}, 401) }).collect(input), { code: 'AUTH_REQUIRED' });
});

test('Command Code keeps period and auto-renew but never invents static monthly total or payment', () => {
  const out = normalize('commandcode', { subscription: { success: true, data: { planId: 'individual-pro-v1', status: 'active', currentPeriodEnd: end, cancelAtPeriodEnd: false } }, credits: { credits: { monthlyCredits: 40, purchasedCredits: 10, freeCredits: 0 }, windowLimits: { fiveHour: { used: 2, cap: 10, resetAt: end } } } });
  assert.equal(out.entitlements!.billingPeriodEnd!.value!.value, '2026-11-01T00:00:00.000Z');
  assert.equal(out.entitlements!.autoRenew!.value, true);
  assert.equal(out.entitlements!.autoRenew!.evidence, 'derived');
  assert.equal(out.entitlements!.membershipExpiresAt, undefined);
  assert.equal(out.fields.find(f => f.field === 'price'), undefined);
  assert.equal(out.metrics.length, 1);
  assert.equal(out.balances!.length, 3);
  assert.equal(out.balances![2].amount.value, '0');
});

test('Command Code credit failure retains plan; unavailable subscription does not become No plan', async () => {
  const out = await adapter('commandcode', { fetchFn: async url => url.endsWith('/credits') ? response({}, 503) : response({ data: { planId: 'individual-pro', status: 'active', currentPeriodEnd: end, cancelAtPeriodEnd: true } }) }).collect(input);
  assert.equal(out.entitlements!.autoRenew!.value, false);
  assert(out.partialFailures.some(f => f.field === 'credits'));
  assert.throws(() => normalize('commandcode', { subscription: { success: false } }), { code: 'SCHEMA_CHANGED' });
});

test('Zed exact account authorization, selected org plan, no fabricated windows/expiry/renewal', async () => {
  const out = await adapter('zed', { fetchFn: async (url, init) => { assert.equal(url, 'https://cloud.zed.dev/client/users/me'); assert.equal(init.headers.Authorization, '4242 token'); return response({ organizations: [{ id: 'personal', is_personal: true }, { id: 'team' }], default_organization_id: 'personal', plans_by_organization: { personal: 'zed_free', team: 'zed_business' }, plan: { plan_v3: 'zed_free', subscription_period: { ended_at: end }, has_overdue_invoices: true } }); } }).collect({ ...input, secret: JSON.stringify({ accessToken: 'token', userId: '4242', subject: 'zed:4242' }), expectedSubject: 'zed:4242' });
  assert.equal(out.fields[0].value, 'business');
  assert.equal(out.account.organization, 'team');
  assert.deepEqual(out.metrics, []);
  assert.deepEqual(out.entitlements, {});
  assert(out.partialFailures.some(f => f.field === 'billing'));
});

test('Zed account period is billing boundary, not final membership expiration', () => {
  const out = normalize('zed', { plan: { plan_v3: 'zed_pro', subscription_period: { ended_at: end } } });
  assert(out.entitlements!.billingPeriodEnd);
  assert.equal(out.entitlements!.membershipExpiresAt, undefined);
  assert.equal(out.entitlements!.autoRenew, undefined);
  assert.throws(() => normalize('zed', { surprise: true }), { code: 'SCHEMA_CHANGED' });
});

test('Open Design refuses runtime key without sending any HTTP', async () => {
  let calls = 0;
  await assert.rejects(adapter('opendesign', { fetchFn: async () => { calls++; return response({}); } }).collect(input), { code: 'AUTH_REQUIRED' });
  assert.equal(calls, 0);
});

test('Open Design workspace, credits and wallet stay isolated with summary partial failure', async () => {
  const out = await adapter('opendesign', { fetchFn: async url => {
    if (url.endsWith('/current')) return response({ activeWorkspaceId: 'workspace/synthetic' });
    if (url.endsWith('/summary')) return response({}, 503);
    assert(url.endsWith('/workspace%2Fsynthetic/billing/preflight'));
    return response({ balanceUsd: 2, codingPlan: { windows: [{ usedCredits: 100, limitCredits: 1000, durationSeconds: 18000, resetsAt: end }] } });
  } }).collect({ ...input, secret: 'vela_ctrl_synthetic' });
  assert.equal(out.account.organization, 'workspace/synthetic');
  assert.equal(out.metrics[0].unit, 'credits');
  assert.equal(out.balances![0].currency, 'USD');
  assert.deepEqual(out.entitlements, {});
  assert(out.partialFailures.some(f => f.field === 'summary'));
});

test('Open Design blank balance is unknown, and auto-renew requires subscription status', () => {
  const out = normalize('opendesign', { preflight: { balanceUsd: '' }, summary: { membershipTier: 'pro', subscriptionCurrentPeriodEnd: end, subscriptionCancelAtPeriodEnd: false } });
  assert.deepEqual(out.balances, []);
  assert.equal(out.entitlements!.autoRenew, undefined);
  assert(out.entitlements!.billingPeriodEnd);
  assert(out.partialFailures.some(f => f.field === 'wallet'));
});

test('AutoClaw never queries/completes tasks, never falls back across regions, and has balance not usage', async () => {
  for (const [id, host] of [['autoclaw', 'autoglm-api.autoglm.ai'], ['autoclaw-cn', 'autoglm-api.zhipuai.cn']] as const) {
    const calls: string[] = [];
    const out = await adapter(id, { fetchFn: async (url, init) => { calls.push(url); assert.equal(init.method, 'GET'); assert(init.headers['X-Auth-Sign']); return response({ code: 0, data: { total_balance: '12.75', wallets: [{ balance: 10, display_name: '赠送' }, { balance: 2.75, display: false }, { balance: 12.75, display_name: 'total' }] } }); } }).collect(input);
    assert.deepEqual(calls, [`https://${host}/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw`]);
    assert.deepEqual(out.metrics, []);
    assert.deepEqual(out.entitlements, {});
    assert.equal(out.balances![0].amount.value, '12.75');
    assert.equal(out.balances![0].kind, 'total');
    assert.equal(out.balances!.length, 2);
  }
});

test('raw key identity matches service, explicit JSON subject/alias survives token rotation', async () => {
  const fetchFn: HttpFetchFn = async () => response({ usage: { limit: 100, used: 10 } });
  const a = adapter('kimi-code', { fetchFn });
  const out = await a.collect({ ...input, expectedSubject: keySubject('kimi-code') });
  assert.equal(out.account.subject, keySubject('kimi-code'));
  const first = await a.collect({ ...input, secret: JSON.stringify({ accessToken: 'rotated', subject: 'account:one', alias: '我的账号', source: 'external', management: 'follow', locator: 'official' }), expectedSubject: 'account:one' });
  const second = await a.collect({ ...input, secret: JSON.stringify({ accessToken: 'rotated-again', subject: 'account:one' }), expectedSubject: 'account:one' });
  assert.equal(first.account.alias, '我的账号');
  assert.equal(first.poolId, second.poolId);
  await assert.rejects(a.collect({ ...input, expectedSubject: 'other' }), { code: 'ACCOUNT_MISMATCH' });
  assert(!JSON.stringify(first).includes('rotated'));
});

test('401/403/429/5xx preserve categorized error and Retry-After', async () => {
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'PERMISSION_DENIED'], [429, 'RATE_LIMITED'], [503, 'UPSTREAM_UNAVAILABLE']] as const) {
    await assert.rejects(adapter('grok-build', { fetchFn: async () => response({}, status, '60') }).collect(input), (e: unknown) => {
      const error = e as { code: string; options?: { retryAfterMs?: number } }; assert.equal(error.code, code); if (status === 429) assert.equal(error.options?.retryAfterMs, 60000); return true;
    });
  }
});

test('cancellation and response-size limit apply to read-only RPC too', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const a = adapter('kimi-work', { postFetchFn: async () => { calls++; return response({}); } });
  await assert.rejects(a.collect({ ...input, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(calls, 0);
  await assert.rejects(adapter('kimi-work', { postFetchFn: async () => ({ status: 200, headers: { get: () => null }, text: async () => ' '.repeat(1024 * 1024 + 1) }) }).collect(input), { code: 'SCHEMA_CHANGED' });
});

test('Grok CLI auth is reread without mutation or refresh and expired login needs user action', async () => {
  const root = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  const home = mkdtempSync(path.join(root, 'extended-grok-fixture-'));
  const previous = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const file = path.join(home, 'auth.json');
    const write = (key: string, expires_at: string) => writeFileSync(file, JSON.stringify({ a: { key, user_id: 'synthetic-user', refresh_token: 'must-not-consume', expires_at } }));
    write('first', '2099-01-01T00:00:00Z');
    const before = readFileSync(file);
    const first = await resolveExtendedCredential('grok-build', { ...input, secret: undefined });
    assert.equal(first.accessToken, 'first');
    assert.equal(first.subject, 'grok-build:synthetic-user');
    assert.deepEqual(readFileSync(file), before);
    assert(!('refreshToken' in first));
    write('second', '2099-01-01T00:00:00Z');
    assert.equal((await resolveExtendedCredential('grok-build', { ...input, secret: undefined })).accessToken, 'second');
    write('expired', '2000-01-01T00:00:00Z');
    await assert.rejects(resolveExtendedCredential('grok-build', { ...input, secret: undefined }), { code: 'AUTH_REQUIRED' });
  } finally { if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous; rmSync(home, { recursive: true, force: true }); }
});

test('Windows Kimi desktop read verifies Work gateway, rereads rotated web token and does not write/refresh', { skip: process.platform !== 'win32' }, async () => {
  const root = path.join(process.env.LOCALAPPDATA!, 'Temp', 'opencode');
  const home = mkdtempSync(path.join(root, 'extended-work-fixture-'));
  const previous = process.env.APPDATA;
  process.env.APPDATA = home;
  try {
    const directory = path.join(home, 'kimi-desktop', 'daimon-share', 'daimon'); mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'config.json');
    const write = (webToken: string, baseUrl = 'https://agent-gw.kimi.com/coding/v1') => writeFileSync(file, JSON.stringify({ credentials: { kimiCode: { apiKey: 'work-token-not-for-stats', baseUrl }, kimiWeb: { accessToken: webToken, userId: 'work-user', refreshToken: 'must-not-consume' } } }));
    write('web-one'); const before = readFileSync(file);
    const first = await resolveExtendedCredential('kimi-work', { ...input, secret: undefined });
    assert.equal(first.accessToken, 'web-one');
    assert.deepEqual(readFileSync(file), before);
    write('web-two'); const second = await resolveExtendedCredential('kimi-work', { ...input, secret: undefined });
    assert.equal(second.accessToken, 'web-two'); assert.equal(second.subject, first.subject);
    assert(!('refreshToken' in second));
    write('web-two', 'https://api.kimi.com/coding/v1');
    await assert.rejects(resolveExtendedCredential('kimi-work', { ...input, secret: undefined }), { code: 'AUTH_REQUIRED' });
  } finally { if (previous === undefined) delete process.env.APPDATA; else process.env.APPDATA = previous; rmSync(home, { recursive: true, force: true }); }
});
