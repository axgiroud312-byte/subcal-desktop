import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { SubCalService } from '../src/main/service';
import { SubCalDatabase } from '../src/main/db/database';
import { CredentialVault } from '../src/main/credentials';
import { getAdapter, manifests } from '../src/main/adapters';
import { SERVICE_ACCESS, EXISTING_LOGIN_SERVICES } from '../src/shared/service-access';
import { AdapterError, type CollectInput, type CollectOutput } from '../src/main/adapters/types';

const at = '2026-10-21T08:00:00.000Z';
function fixtureOutput(input: CollectInput): CollectOutput {
  return { account: { subject: input.expectedSubject!, alias: '合成协议账号', organization: '工作区A', region: '测试地区' }, poolId: input.connectionId,
    fields: [{ field: 'plan', value: '合成协议套餐', availability: 'known', observedAt: at, source: '合成协议测试，非真实账号', dataOrigin: 'official_api' }],
    metrics: [{ id: 'quota', label: '额度', unit: 'credits', remaining: '3.125', used: '1', total: '4.125', resetAt: '2026-11-01', observedAt: at, availability: 'known', source: '合成协议测试', dataOrigin: 'official_api', staleAfterMinutes: 60 }],
    balances: [{ id: 'gift', label: '赠送积分', scope: 'account', kind: 'grant', currency: 'credits', amount: { value: '0', availability: 'known', source: '合成协议测试', observedAt: at, dataOrigin: 'official_api' }, expiresAt: { value: { precision: 'day', value: '2026-11-02' }, availability: 'known', source: '合成协议测试', observedAt: at, dataOrigin: 'official_api' } }],
    entitlements: { membershipExpiresAt: { value: { precision: 'day', value: '2026-11-03' }, availability: 'known', source: '合成协议测试', observedAt: at, dataOrigin: 'official_api' } },
    discoveredOrganizations: [{id:'auto-team-a',name:'合成团队 A'},{id:'auto-team-b',name:'合成团队 B'}],
    partialFailures: [], samples: [], observedAt: at };
}
test('every active account entry is a real registered adapter, not a research capability or placeholder', () => {
  const ids = manifests.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of [...SERVICE_ACCESS, ...EXISTING_LOGIN_SERVICES]) assert.equal(getAdapter(entry.id).manifest.id, entry.id);
  assert.equal(ids.includes('opencode-zen'), false);
  assert.equal(ids.includes('opencode-zen-free'), false);
});
test('all added Key services traverse IPC → encrypted save → scheduled card → persistence; failures retain observations', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir(), 'subcal-services-'));
  const backend = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from([...Buffer.from(s)].map(v => v ^ 42)), decryptString: (b: Buffer) => Buffer.from([...b].map(v => v ^ 42)).toString() };
  let db = new SubCalDatabase(dir); const vault = new CredentialVault(dir, backend);
  let failing = false;
  let now=Date.parse(at);
  const service = new SubCalService(db, vault, { collect: async (_, input) => { if (failing) throw new AdapterError('UPSTREAM_UNAVAILABLE', '合成故障'); return fixtureOutput(input); }, cancel: () => {}, close: () => {} }, manifests, () => now);
  const call = async (method: string, params: unknown, revision?: number): Promise<any> => {
    const r = await service.handle({ version: 1, requestId: randomUUID(), idempotencyKey: randomUUID(), expectedRevision: revision, method, params });
    assert.equal(r.ok, true, r.ok ? undefined : r.error.message); return r.ok ? r.result : undefined;
  };
  try {
    for (const entry of SERVICE_ACCESS.filter(s => s.mode === 'api_key')) {
      const secret=entry.cloudRegion?JSON.stringify({accessKeyId:'synthetic-ak',secretAccessKey:'synthetic-key-cloud',teamId:'team-a'}):entry.id==='relay-wallet'?JSON.stringify({origin:'https://panel.example.test',template:'new-api-key',apiKey:'synthetic-key-relay'}):entry.id==='remote-magpie'?JSON.stringify({origin:'https://remote.example.test',apiKey:'synthetic-key-remote'}):`synthetic-key-${entry.id}`;
      const added = await call('accounts.add', { providerId: entry.id, secret });
      assert.equal(service.scheduler.job(added.connectionId)?.state, 'queued');
      await service.scheduler.run(added.connectionId, 'scheduled');
      const before = db.getSubscription(added.subscriptionId)!;
      assert.equal(before.management, 'automatic'); assert.equal(before.balances?.[0].amount.value, '0');
      assert.equal(before.balances?.[0].currency, 'credits');
      await call('subscriptions.update', { id: before.id, patch: { price: { ...before.price, value: '10', availability: 'known' }, currency: 'CNY', metrics: [], entitlements: {}, balances: [] } }, before.revision);
      const paid = db.getSubscription(before.id)!;
      assert.deepEqual(paid.metrics, before.metrics); assert.deepEqual(paid.entitlements, before.entitlements); assert.deepEqual(paid.balances, before.balances);
      assert.equal(paid.price.value, '10');
      failing = true;
      now+=7200000;
      await assert.rejects(service.scheduler.run(added.connectionId,'scheduled'));
      assert.deepEqual(db.getSubscription(before.id)?.metrics, before.metrics); failing = false;now+=7200000;
      await service.scheduler.run(added.connectionId,'scheduled');
      assert.equal(db.getSubscription(before.id)?.price.value,'10');
    }
    const cloudInput = { providerId:'tencent-token-plan-ap-guangzhou', secret:JSON.stringify({accessKeyId:'synthetic-ak-auto',secretAccessKey:'synthetic-key-auto'}) };
    const countBefore = db.listSubscriptions().length;
    const firstTeam = await call('accounts.add', cloudInput);
    assert.equal(db.listSubscriptions().length, countBefore + 2);
    assert.equal((await call('accounts.add', cloudInput)).subscriptionId, firstTeam.subscriptionId);
    assert.equal(db.listSubscriptions().length, countBefore + 2);
    const backup = await call('data.export', {});
    assert.doesNotMatch(backup, /synthetic-key|accessToken|refreshToken|"locator"/);
    const ids = db.listSubscriptions().map(s => s.id).sort();
    service.close(); db = new SubCalDatabase(dir);
    assert.deepEqual(db.listSubscriptions().map(s => s.id).sort(), ids);
  } finally { try { service.close(); } catch {} try { db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); }
});
