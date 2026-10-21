import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeArtsAdapter, TencentTokenPlanAdapter, VolcenginePlanAdapter, createSignedAdapters, signHuawei, signTencent, signVolcengine, signedCanonicalQuery, type SignedFetchFn } from '../src/main/adapters/signed-adapters';
import { AdapterError, type CollectInput, type ProviderAdapter } from '../src/main/adapters/types';
import { mergeBalances } from '../src/shared/entitlements';

const at = '2026-10-21T00:00:00.000Z', now = () => new Date(at);
const error = (code: string) => (e: unknown) => e instanceof AdapterError && e.code === code;
const reply = (v: unknown, status = 200): Awaited<ReturnType<SignedFetchFn>> => ({ status, headers: { get: () => '7' }, text: async () => JSON.stringify(v) });
function input(a: ProviderAdapter, extra: Record<string, unknown> = {}): CollectInput {
  return { connectionId: 'connection', generation: 1, reason: 'probe', secret: JSON.stringify({ provider: a.manifest.id, region: a.manifest.region, accessKeyId: 'AK', secretAccessKey: 'SK', securityToken: 'ST', ...extra }) };
}
const tcPlan = (id: string, extra: Record<string, unknown> = {}) => ({ TeamId: id, Name: id, ProductType: 'enterprise', PackageInfo: { CycleQuota: '0.3', TotalUsed: '0.2', ExpireTime: '2027-01-01' }, TokenSummary: { CycleStartTime: '2026-10-01T00:00:00Z', CycleEndTime: '2026-11-01T00:00:00Z' }, ...extra });
const stats = { package: { package_name_cn: '专业版' }, end_date: '2026-11-01', metrics: [{ name: 'usageBasicPackageCredit', package_credit_amount: '0.3', package_credit_remain: '0.1' }, { name: 'usageBonusPackageCredit', package_credit_amount: 5, package_credit_remain: 0 }] };

test('Volcengine fixed SDK signature vectors (Magpie upstream fixtures)', () => {
  for (const [region, action, signature] of [['cn-beijing', 'GetCodingPlanUsage', 'deb80c0cd8bd77768ca40f6d47c7204621c0994428f6ab77e23b76e15dc4c047'], ['cn-shanghai', 'GetAFPUsage', '8a241be0996c93de4dfcd9e8b1db37494bf63170804fcaebe8380ff7dca2bb23']]) {
    const h = signVolcengine('AKLTexample', 'c2VjcmV0LWV4YW1wbGU=', region, action, '{}', new Date('2026-10-09T08:30:15Z'));
    assert.equal(h.Authorization, `HMAC-SHA256 Credential=AKLTexample/20261009/${region}/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${signature}`);
    assert.equal(h['x-content-sha256'], '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  }
});
test('Tencent fixed official-document signature vector (escaped JSON bytes)', () => {
  const payload = '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}';
  assert.equal(signTencent('AKID' + '*'.repeat(32), '*'.repeat(32), 'cvm', 'cvm.tencentcloudapi.com', 'DescribeInstances', payload, new Date(1551113065000)), `TC3-HMAC-SHA256 Credential=AKID${'*'.repeat(32)}/2019-02-25/cvm/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=10b1a37a7301a02ca19a647ad722d5e43b4b3cff309d421d85b46093f6ab6c4f`);
});
test('Huawei fixed independent Python HMAC vector; canonical query and trailing slash', () => {
  const h = signHuawei('AK', 'SK', 'ST', 'POST', 'https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/package/credit/page?b=2&a=1', '{}', now());
  assert.equal(h.Authorization, 'SDK-HMAC-SHA256 Access=AK,SignedHeaders=content-type;host;x-sdk-content-sha256;x-sdk-date;x-security-token,Signature=c463f6d028351b423b2d22618a8b0935e8ac41aa7610c352fcd3c1d0de3c3170');
  assert.equal(signedCanonicalQuery(new URL('https://example.test/?x=(1)*&a=b+c&a=a')), 'a=a&a=b%20c&x=%281%29%2A');
  assert.equal(signHuawei('AK', 'SK', 'other', 'POST', 'https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/package/credit/page?b=2&a=1', '{}', now()).Authorization === h.Authorization, false);
});
test('Ark POST queries control-plane only and preserves explicit region/temporary token', async () => {
  const a = new VolcenginePlanAdapter('coding', 'cn-shanghai', async (url, init) => {
    assert.equal(url, 'https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01'); assert.equal(init.method, 'POST'); assert.equal(init.body, '{}');
    assert.match(init.headers.Authorization, /20261021\/cn-shanghai\/ark\/request/); assert.match(init.headers.Authorization, /x-security-token/); assert.equal(init.headers['x-security-token'], 'STS');
    return reply({ Result: { QuotaUsage: [{ Level: 'session', Percent: 0, ResetTimestamp: 1793491200 }, { Level: 'monthly', Percent: '10.5' }, { Level: 'weekly' }] } });
  }, now);
  const out = await a.collect(input(a, { securityToken: 'STS' }));
  assert.deepEqual(out.metrics.map(m => m.remaining), ['100', '89.5']); assert.equal(out.metrics[1].windowMinutes, undefined); assert.equal(out.partialFailures.length, 1); assert.equal(out.entitlements, undefined);
});
test('AFP raw quantity has unknown unit, retain percentage without inventing tokens', () => {
  const a = new VolcenginePlanAdapter('agent');
  const out = a.normalize({ Result: { Tier: 'Pro', AFPFiveHour: { Used: 2, Total: 4, ResetTime: 1793491200000 }, AFPWeekly: { Percent: 0 }, AFPMonthly: { Used: 0 } } }, at);
  assert.deepEqual(out.metrics.map(m => [m.unit, m.used, m.remaining]), [['%', '50', '50'], ['%', '0', '100']]); assert.equal(out.partialFailures.length, 1); assert.equal(out.fields[0].value, 'Agent Plan Pro');
  assert.throws(() => a.normalize({ Result: {} }, at), error('SCHEMA_CHANGED'));
});
test('Tencent pages beyond 100; details and pools remain TeamId-bound', async () => {
  const offsets: number[] = [], details: string[] = [];
  const a = new TencentTokenPlanAdapter('ap-singapore', async (url, init) => {
    assert.equal(url, 'https://tokenhub.tencentcloudapi.com/'); assert.equal(init.headers['X-TC-Region'], 'ap-singapore'); assert.equal(init.headers['X-TC-Token'], 'ST'); assert.equal(init.headers['X-TC-Version'], '2026-03-22');
    const body = JSON.parse(init.body!);
    if (init.headers['X-TC-Action'] === 'DescribeTokenPlanList') { offsets.push(body.Offset); return reply({ Response: { TotalCount: 101, TokenPlanSet: body.Offset === 0 ? Array.from({ length: 100 }, (_, n) => tcPlan(`t${n}`)) : [tcPlan('t100')] } }); }
    details.push(body.TeamId); return reply({ Response: tcPlan(body.TeamId) });
  }, now);
  const out = await a.collect(input(a));
  assert.deepEqual(offsets, [0, 100]); assert.equal(details.length, 101); assert.equal(out.metrics.length, 101); assert.equal(new Set(out.metrics.map(m => m.poolId)).size, 101); assert.equal(out.metrics[100].remaining, '0.1');
  assert.equal(out.entitlements, undefined); assert.equal(out.partialFailures.filter(f => f.field.includes('membership-date')).length, 101);
});
test('Tencent single-team credentials preserve membership vs cycle end; no invented renewal', async () => {
  const details: string[] = [];
  const a = new TencentTokenPlanAdapter('ap-guangzhou', async (_url, init) => {
    if (init.headers['X-TC-Action'] === 'DescribeTokenPlanList') return reply({ Response: { TokenPlanSet: [tcPlan('a'), tcPlan('b')] } });
    const id = JSON.parse(init.body!).TeamId; details.push(id); return reply({ Response: tcPlan(id, { ProductType: 'enterprise-auto' }) });
  }, now);
  const out = await a.collect(input(a, { TeamId: 'b' })); assert.deepEqual(details, ['b']); assert.equal(out.account.organization, 'b');
  assert.equal(out.entitlements?.membershipExpiresAt?.value?.value, '2027-01-01'); assert.equal(out.entitlements?.billingPeriodEnd?.value?.value, '2026-11-01T00:00:00.000Z');
  assert.equal(out.entitlements?.autoRenew, undefined); assert.equal(out.metrics[0].unit, 'tokens'); assert.equal(out.metrics[0].resetAt, '2026-11-01T00:00:00.000Z');
});
test('Tencent list fallback after detail outage, late page failure and unknown units do not erase successful teams', async () => {
  const a = new TencentTokenPlanAdapter('ap-guangzhou', async (_url, init) => {
    if (init.headers['X-TC-Action'] === 'DescribeTokenPlan') return reply({}, 503);
    const offset = JSON.parse(init.body!).Offset;
    return offset ? reply({}, 503) : reply({ Response: { TotalCount: 101, TokenPlanSet: Array.from({ length: 100 }, (_, n) => tcPlan(`t${n}`)) } });
  }, now);
  const out = await a.collect(input(a)); assert.equal(out.metrics.length, 100); assert.ok(out.partialFailures.some(f => f.field === 'list:100')); assert.ok(out.partialFailures.some(f => f.field === 'team:t0'));
  const unknown = a.normalize({ plans: [tcPlan('unknown', { ProductType: 'new-tier', TokenSummary: {} })] }, at);
  assert.equal(unknown.metrics.length, 0); assert.equal(unknown.entitlements?.billingPeriodEnd, undefined); assert.equal(unknown.entitlements?.membershipExpiresAt?.value?.value, '2027-01-01');
});
test('Tencent mismatched detail TeamId rejects entire observation rather than merging another team', async () => {
  const a = new TencentTokenPlanAdapter('ap-guangzhou', async (_url, init) => reply({ Response: init.headers['X-TC-Action'] === 'DescribeTokenPlanList' ? { TokenPlanSet: [tcPlan('a')] } : tcPlan('b') }), now);
  await assert.rejects(a.collect(input(a)), error('ACCOUNT_MISMATCH'));
});
test('CodeArts reads actual signed GET/POST protocols with paged packages and campaign grants; no side effects', async () => {
  const seen: string[] = [], pages: number[] = [];
  const a = new CodeArtsAdapter(async (url, init) => {
    const u = new URL(url); seen.push(u.pathname); assert.match(init.headers.Authorization, /^SDK-HMAC-SHA256 /); assert.equal(init.headers['x-security-token'], 'ST');
    if (u.pathname.endsWith('/statistics/plugin')) return reply({ code: 0, data: stats });
    if (u.pathname.endsWith('/tokens/balance')) return reply({ code: '0000', result: { daily_token_limit: 100, daily_tokens_used: 0 } });
    if (u.pathname.endsWith('/credit/page')) {
      assert.equal(init.method, 'POST'); const b = JSON.parse(init.body!); assert.equal(b.pageSize, 100);
      if (b.packageTypes[0] === 'bonus') return reply({ code: 0, data: { list: [] } });
      pages.push(b.pageNum);
      return reply({ code: 0, data: { total: 101, list: b.pageNum === 1 ? Array.from({ length: 100 }, (_, n) => ({ id: `p${n}`, packageType: 'ondemand', creditAmount: '0.3', creditUsed: '0.2', expiredTime: '2026-12-01 08:00:00' })) : [{ id: 'p100', packageType: 'basic', creditAmount: 5, creditUsed: 0 }] } });
    }
    if (u.pathname.endsWith('/credit/overview')) return reply({ code: 0, data: { items: [{ campaignId: 'campaign/a' }] } });
    if (u.pathname.endsWith('/campaign/campaign%2Fa')) return reply({ code: 0, data: { benefits: [{ id: 'g', claimedAmount: 5, consumedAmount: 1, expiredAmount: 1, expireAt: '2026-11-09' }] } });
    throw new Error('unexpected endpoint');
  }, now);
  const out = await a.collect(input(a)); assert.deepEqual(pages, [1, 2]);
  assert.ok(seen.every(p => !/claim|confirm|delivery|model|onboard|oauth|chat|agents/.test(p)));
  assert.equal(out.balances?.find(b => b.id === 'package::p0')?.amount.value, '0.1'); assert.equal(out.balances?.find(b => b.id === 'package::p0')?.expiresAt?.value?.value, '2026-12-01T00:00:00.000Z');
  assert.equal(out.balances?.find(b => b.id === 'grant:campaign/a:g')?.amount.value, '3'); assert.equal(out.balances?.find(b => b.id === 'grant:campaign/a:g')?.expiresAt?.value?.precision, 'day');
  const daily = out.metrics.find(m => m.unit === 'tokens')!; assert.equal(daily.remaining, '100'); assert.equal(daily.resetAt, '2026-10-21T16:00:00.000Z'); assert.equal(daily.resetObservation?.evidence, 'derived');
  assert.equal(out.entitlements, undefined); assert.equal(out.metrics.find(m => m.id === 'usageBonusPackageCredit')?.resetAt, null);
});
test('CodeArts partial failures retain stats/known zero and balance merge preserves previous batches', async () => {
  const a = new CodeArtsAdapter(async url => url.endsWith('/statistics/plugin') ? reply({ code: 0, data: stats }) : reply({}, 503), now);
  const out = await a.collect(input(a)); assert.equal(out.fields[0].value, '专业版'); assert.equal(out.metrics[1].remaining, '0'); assert.ok(out.partialFailures.length >= 4);
  const previous = a.normalize({ packages: [{ id: 'old', creditAmount: 3, creditUsed: 1, expiredTime: '2026-12-01' }] }, at);
  assert.ok(mergeBalances(previous.balances, out.balances).some(b => b.id === 'package::old'));
  const missing = a.normalize({ statistics: { ...stats, metrics: [{ name: 'usageBasicPackageCredit', package_credit_amount: 100 }] } }, at);
  assert.equal(missing.metrics.length, 0); assert.equal(missing.balances?.length, 0); assert.equal(missing.partialFailures.length, 1);
});
test('CodeArts invalid dates remain unknown; total/grants do not inherit basic reset', () => {
  const a = new CodeArtsAdapter();
  for (const expiry of ['2026-02-31', '2026-13-01', 'not a date']) {
    const out = a.normalize({ packages: [{ id: 'x', creditAmount: 1, creditUsed: 0, expiredTime: expiry }] }, at); assert.equal(out.balances?.[0].expiresAt, undefined);
  }
  const out = a.normalize({ statistics: { metrics: [{ name: 'usageTotalPackageCredit', package_credit_remain: 5 }], end_date: '2026-11-01' } }, at);
  assert.equal(out.metrics[0].resetAt, null); assert.equal(out.metrics[0].used, null); assert.equal(out.metrics[0].total, null);
});
test('OpenCode envelope access JSON and metadata are preserved for signed credentials', async () => {
  const a = new CodeArtsAdapter(async (url, init) => {
    assert.equal(init.headers['x-security-token'], 'TEMP'); assert.match(init.headers.Authorization, /Access=temporary-ak,/);
    return url.endsWith('/statistics/plugin') ? reply({ data: stats }) : url.endsWith('/credit/overview') ? reply({ data: { items: [] } }) : reply({ data: { list: [] } });
  }, now);
  const envelope = { provider: 'codearts', type: 'oauth', metadata: { region: 'cn-north-4', accountId: 'verified-account' }, access: JSON.stringify({ access_key_id: 'temporary-ak', secret_access_key: 'temporary-sk', security_token: 'TEMP', expires_at: '2026-10-22T00:00:00Z' }) };
  const secret = JSON.stringify(envelope), out = await a.collect({ ...input(a), secret });
  assert.equal(out.credentialExpiresAt?.value?.value, '2026-10-22T00:00:00.000Z'); assert.equal(out.entitlements, undefined); assert.equal(secret, JSON.stringify(envelope));
});
test('source/region/temporary credential expiry/expectedSubject rejected before network', async () => {
  let calls = 0;
  for (const a of createSignedAdapters(async () => { calls++; return reply({}); }, now)) {
    await assert.rejects(a.collect(input(a, { region: 'wrong' })), error('AUTH_REQUIRED'));
    await assert.rejects(a.collect(input(a, { provider: 'other-provider' })), error('AUTH_REQUIRED'));
    await assert.rejects(a.collect(input(a, { expires_at: '2026-10-20T00:00:00Z' })), error('AUTH_REQUIRED'));
    await assert.rejects(a.collect({ ...input(a), reason: 'manual', expectedSubject: 'wrong-subject' }), error('ACCOUNT_MISMATCH'));
  }
  assert.equal(calls, 0);
});
test('region and TeamId are part of subject; temporary token rotation stays in same verified account', async () => {
  const fn: SignedFetchFn = async () => reply({ Result: { QuotaUsage: [{ Level: 'session', Percent: 0 }] } });
  const a = new VolcenginePlanAdapter('coding', 'cn-beijing', fn, now), b = new VolcenginePlanAdapter('coding', 'cn-shanghai', fn, now);
  const first = await a.collect(input(a, { accountId: 'verified' }));
  const second = await a.collect({ ...input(a, { accountId: 'verified', accessKeyId: 'new-ak', secretAccessKey: 'new-sk', securityToken: 'rotated' }), expectedSubject: first.account.subject });
  assert.equal(first.account.subject, second.account.subject); assert.notEqual(first.account.subject, (await b.collect(input(b, { accountId: 'verified' }))).account.subject);
  const t = new TencentTokenPlanAdapter('ap-guangzhou', async (_url, init) => reply({ Response: init.headers['X-TC-Action'] === 'DescribeTokenPlanList' ? { TokenPlanSet: [tcPlan('a'), tcPlan('b')] } : tcPlan(JSON.parse(init.body!).TeamId) }), now);
  assert.notEqual((await t.collect(input(t, { teamId: 'a' }))).account.subject, (await t.collect(input(t, { teamId: 'b' }))).account.subject);
});
test('late old-subject response is cancelled after newer generation; no secrets in result', async () => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const a = new VolcenginePlanAdapter('coding', 'cn-beijing', async () => { if (++calls === 1) await gate; return reply({ Result: { QuotaUsage: [{ Level: 'session', Percent: 0 }] } }); }, now);
  const old = a.collect(input(a, { accountId: 'old-account' }));
  const latest = await a.collect({ ...input(a, { accountId: 'new-account' }), generation: 2 });
  release(); await assert.rejects(old, error('CANCELLED'));
  assert.ok(!JSON.stringify(latest).includes('new-account')); assert.ok(!JSON.stringify(latest).includes('secretAccessKey'));
});
test('timeouts and cancellation reject transports ignoring AbortSignal; disconnect invalidates pending replies', async () => {
  const stalled = new VolcenginePlanAdapter('coding', 'cn-beijing', async () => new Promise(() => {}), now);
  await assert.rejects(stalled.collect({ ...input(stalled), timeoutMs: 5 }), error('TIMEOUT'));
  const controller = new AbortController(), pending = stalled.collect({ ...input(stalled), signal: controller.signal }); controller.abort(); await assert.rejects(pending, error('CANCELLED'));
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const a = new VolcenginePlanAdapter('coding', 'cn-beijing', async () => { await gate; return reply({ Result: { QuotaUsage: [{ Level: 'weekly', Percent: 0 }] } }); }, now);
  const late = a.collect(input(a)); await a.disconnect(); release(); await assert.rejects(late, error('CANCELLED'));
});
test('HTTP/business failures are sanitized and mapped; no credential/response body leakage', async () => {
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'PERMISSION_DENIED'], [429, 'RATE_LIMITED'], [500, 'UPSTREAM_UNAVAILABLE']] as const) {
    const a = new CodeArtsAdapter(async () => reply({ secret: 'do-not-echo' }, status), now);
    await assert.rejects(a.collect(input(a)), e => error(code)(e) && !(e as Error).message.includes('do-not-echo'));
  }
  const tc = new TencentTokenPlanAdapter('ap-guangzhou', async () => reply({ Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: 'private-provider-message' } } }), now);
  await assert.rejects(tc.collect(input(tc)), e => error('AUTH_REQUIRED')(e) && !(e as Error).message.includes('private-provider-message'));
  const volc = new VolcenginePlanAdapter('coding', 'cn-beijing', async () => reply({ ResponseMetadata: { Error: { Code: 'AccessDenied' } } }), now);
  await assert.rejects(volc.collect(input(volc)), error('PERMISSION_DENIED'));
});

test('accessToken-only external STS envelope works without splitting tokens; subject survives key rotation', async () => {
  const a = new CodeArtsAdapter(async url => url.endsWith('/statistics/plugin') ? reply({ data: stats }) : url.endsWith('/credit/overview') ? reply({ data: { items: [] } }) : reply({ data: { list: [] } }), now);
  const envelope = (key: string) => JSON.stringify({ source: 'codearts', management: 'external', subject: 'stable-external-account', alias: 'Existing account', locator: 'auth.json:codearts', accessToken: JSON.stringify({ access_key_id: key, secret_access_key: 'temporary-secret', security_token: 'temporary-session', expires_at: '2026-10-22T00:00:00Z' }) });
  const first = await a.collect({ ...input(a), secret: envelope('first-ak') });
  const second = await a.collect({ ...input(a), secret: envelope('rotated-ak'), expectedSubject: first.account.subject });
  assert.equal(first.account.subject, second.account.subject);
  assert.equal(first.account.alias, 'Existing account'); assert.equal(first.account.region, 'cn-north-4');
  assert.equal(JSON.stringify(first).includes('temporary-session'), false);
  assert.equal(first.entitlements, undefined);
  await assert.rejects(a.collect(input(a, { expires_at: 'bad-expiration' })), error('AUTH_REQUIRED'));
});

test('authentication/permission failure is fatal even if sibling statistics or team list succeeded', async () => {
  const a = new CodeArtsAdapter(async url => url.endsWith('/statistics/plugin') ? reply({ data: stats }) : reply({ error_code: 'APIG.0301', error_msg: 'private-message' }), now);
  await assert.rejects(a.collect(input(a)), error('AUTH_REQUIRED'));
  const tc = new TencentTokenPlanAdapter('ap-guangzhou', async (_url, init) => init.headers['X-TC-Action'] === 'DescribeTokenPlanList' ? reply({ Response: { TokenPlanSet: [tcPlan('a')] } }) : reply({}, 403), now);
  await assert.rejects(tc.collect(input(tc)), error('PERMISSION_DENIED'));
});

test('Tencent repeated final page cannot masquerade as complete TotalCount', async () => {
  const offsets: number[] = [];
  const a = new TencentTokenPlanAdapter('ap-guangzhou', async (_url, init) => {
    if (init.headers['X-TC-Action'] === 'DescribeTokenPlanList') { offsets.push(JSON.parse(init.body!).Offset); return reply({ Response: { TotalCount: 200, TokenPlanSet: Array.from({ length: 100 }, (_, n) => tcPlan(`t${n}`)) } }); }
    return reply({ Response: tcPlan(JSON.parse(init.body!).TeamId) });
  }, now);
  const out = await a.collect(input(a));
  assert.deepEqual(offsets, [0, 100]); assert.equal(out.metrics.length, 100);
  assert.ok(out.partialFailures.some(f => f.field === 'list:100:duplicate-or-missing-team'));
});

test('CodeArts repeated package page is partial, does not loop or duplicate batches', async () => {
  let paidPages = 0;
  const a = new CodeArtsAdapter(async (url, init) => {
    if (url.endsWith('/statistics/plugin')) return reply({ data: stats });
    if (url.endsWith('/credit/overview')) return reply({ data: { items: [] } });
    if (url.endsWith('/credit/page') && JSON.parse(init.body!).packageTypes[0] === 'basic') {
      paidPages++; return reply({ data: { total: 200, list: Array.from({ length: 100 }, (_, n) => ({ id: `p${n}`, creditAmount: 3, creditUsed: 1, expiredTime: '2026-12-01' })) } });
    }
    return reply({ data: { list: [] } });
  }, now);
  const out = await a.collect(input(a));
  assert.equal(paidPages, 2); assert.equal(out.balances?.filter(b => b.id.startsWith('package:')).length, 100);
  assert.ok(out.partialFailures.some(f => f.field === 'packages:paid:pagination-repeated'));
});

test('CodeArts does not expose expired, exhausted or negative existing batches as available credit', () => {
  const a = new CodeArtsAdapter();
  const out = a.normalize({ statistics: stats, packages: [
    { id: 'expired', creditAmount: 10, creditUsed: 1, expiredTime: '2026-10-20' },
    { id: 'used-up', creditAmount: 10, creditUsed: 10, expiredTime: '2026-12-01' },
    { id: 'negative', creditAmount: -10, creditUsed: 0, expiredTime: '2026-12-01' },
    { id: 'available', creditAmount: 10, creditUsed: 1, expiredTime: '2026-12-01' },
  ] }, at);
  assert.deepEqual(out.balances?.filter(b => b.id.startsWith('package:')).map(b => b.id), ['package::available']);
  assert.ok(out.partialFailures.some(f => f.field === 'package:negative-amount'));
});
