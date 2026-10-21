import test from 'node:test';
import assert from 'node:assert/strict';
import type { AccountCredential } from '../src/main/account-access';
import { TencentTokenPlanAdapter, type SignedFetchFn } from '../src/main/adapters/signed-adapters';
import { tencentTeamCredential } from '../src/main/tencent-account-teams';

const providerId = 'tencent-token-plan-ap-guangzhou';
const credential: AccountCredential = { providerId, subject: 'original-account', alias: 'Account', secret: JSON.stringify({ management: 'static', provider: providerId, region: 'ap-guangzhou', subject: 'original-account', accessKeyId: 'AK', secretAccessKey: 'SK' }) };
const teams = [{ id: 'zero', name: '零额度' }, { id: 'missing', name: '缺额度' }];
const plans = [{ TeamId: 'zero', Name: '零额度', ProductType: 'enterprise', PackageInfo: { CycleQuota: 0, TotalQuota: 0, TotalUsed: 0 } }, { TeamId: 'missing', Name: '缺额度', ProductType: 'enterprise' }];
const reply = (Response: unknown): Awaited<ReturnType<SignedFetchFn>> => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ Response }) });

test('Tencent discovery enumerates real plans even when every team lacks usable quota', async () => {
  const calls: string[] = [];
  const adapter = new TencentTokenPlanAdapter('ap-guangzhou', async (_url, init) => {
    calls.push(init.headers['X-TC-Action']);
    return reply(init.headers['X-TC-Action'] === 'DescribeTokenPlanList' ? { TokenPlanSet: plans, TotalCount: 2 } : {});
  });
  const out = await adapter.collect({ connectionId: 'probe', generation: 1, reason: 'probe', secret: credential.secret });
  assert.deepEqual(out.discoveredOrganizations, teams);
  assert.equal(out.metrics.length, 0);
  assert.equal(out.partialFailures.length, 2);
  assert.deepEqual(calls, ['DescribeTokenPlanList', 'DescribeTokenPlan', 'DescribeTokenPlan']);
});

test('team credentials isolate subject, organization, secret and collection identity', async () => {
  const a = tencentTeamCredential(credential, teams[0]), b = tencentTeamCredential(credential, teams[1]);
  assert.notEqual(a.subject, b.subject);
  assert.notEqual(a.subject, credential.subject);
  assert.equal(a.organization, 'zero');
  assert.equal(a.alias, '零额度');
  assert.equal(JSON.parse(a.secret).teamId, 'zero');
  assert.equal(JSON.parse(b.secret).teamId, 'missing');
  assert.equal(JSON.parse(credential.secret).teamId, undefined);
  assert.equal(tencentTeamCredential(a, teams[0]).subject, a.subject);
  assert.equal(tencentTeamCredential(a, teams[1]).subject, b.subject);
  for (const c of [a, b]) {
    const details: string[] = [];
    const adapter = new TencentTokenPlanAdapter('ap-guangzhou', async (_url, init) => {
      if (init.headers['X-TC-Action'] === 'DescribeTokenPlanList') return reply({ TokenPlanSet: plans, TotalCount: 2 });
      const { TeamId } = JSON.parse(init.body!); details.push(TeamId); return reply({ TeamId });
    });
    const out = await adapter.collect({ connectionId: c.subject, generation: 1, reason: 'probe', secret: c.secret, expectedSubject: c.subject });
    assert.deepEqual(details, [c.organization]);
    assert.equal(out.account.subject, c.subject);
    assert.equal(out.account.organization, c.organization);
    assert.equal(out.poolId, `pool-${c.subject}`);
    assert.deepEqual(out.discoveredOrganizations, [teams.find(t => t.id === c.organization)]);
  }
});

test('normalization deduplicates team IDs and uses ID for missing names', () => {
  const out = new TencentTokenPlanAdapter().normalize({ plans: [{ TeamId: ' x ' }, { TeamId: 'x' }, { Name: 'not-a-team' }] }, new Date().toISOString());
  assert.deepEqual(out.discoveredOrganizations, [{ id: 'x', name: 'x' }]);
});

test('external source is not silently converted to an unrefreshable team credential', () => {
  const external = { ...credential, secret: JSON.stringify({ ...JSON.parse(credential.secret), management: 'external', locator: { kind: 'service', path: 'auth.json' } }) };
  const bound = JSON.parse(tencentTeamCredential(external, teams[0]).secret);
  assert.equal(bound.management, 'external');
  assert.equal(bound.tencentBaseSubject, credential.subject);
  assert.deepEqual(bound.locator, { kind: 'service', path: 'auth.json' });
  assert.throws(() => tencentTeamCredential({ ...external, secret: JSON.stringify({ management: 'external' }) }, teams[0]));
});
