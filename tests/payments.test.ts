import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SubCalDatabase } from '../src/main/db/database';
import { CredentialVault, type SafeStorageBackend } from '../src/main/credentials';
import { SubCalService } from '../src/main/service';
import { NotificationService } from '../src/main/notifications';
import type { AdapterManifest } from '../src/main/adapters/types';
import type { IpcMethod } from '../src/shared/bridge';
import type { PaymentRecord, SubscriptionInput } from '../src/shared/types';
import { exactMoney, plannedMonth, recordedTotal, recordedTotals, budgetProgress, nextPlanDate } from '../src/shared/spending';
import { makeScenario } from '../src/renderer/service/scenarios';

const backend: SafeStorageBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x42)),
  decryptString: (b) => Buffer.from([...b].map((v) => v ^ 0x42)).toString(),
};
const manifest: AdapterManifest = {
  id: 'deepseek-balance', version: '1', brand: 'DeepSeek', product: 'DeepSeek API', region: 'cn',
  supportedFields: [], unsupportedFields: [], authMode: 'api_key',
  officialSourceUrl: 'https://api.deepseek.com', termsCheckedAt: '2026-01-01',
  allowedHosts: ['api.deepseek.com'], minIntervalSeconds: 300,
  defaultForegroundSeconds: 1800, defaultBackgroundSeconds: 1800, timeoutMs: 15000,
  supportTier: 'official_auto', permissions: 'read', credentialLocation: 'vault',
};
const unknown = () => ({ value: null, availability: 'unfetched' as const, source: '手动', observedAt: null, dataOrigin: 'manual' as const });
const input = (): SubscriptionInput => ({
  product: '测试订阅', brand: '测试', kind: 'manual', account: '本人', region: '中国', organization: '个人',
  plan: unknown(), price: { ...unknown(), value: '20.00', availability: 'known' }, currency: 'USD',
  cycle: 'monthly', intervalDays: 30, anchorDate: '2026-01-31', timezone: 'Asia/Shanghai',
  startDate: { ...unknown(), value: '2026-01-01', availability: 'known' },
  renewalDate: { ...unknown(), value: '2026-02-28', availability: 'known' },
  paidThrough: unknown(), trialEnd: unknown(), lifecycle: 'active', autoRenew: 'on',
  billingGroupId: null, quotaPoolId: null, possibleSharedWallet: false, metrics: [],
  connectionId: null, website: '', reminder: 'local', pinned: false, notes: '',
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcal-payments-'));
  let clock = Date.parse('2026-02-26T04:00:00Z');
  const db = new SubCalDatabase(dir);
  const vault = new CredentialVault(dir, backend);
  const service = new SubCalService(db, vault, { collect: async () => { throw new Error('unused'); }, cancel: () => {}, close: () => {} }, [manifest], () => clock);
  const call = async (method: IpcMethod, params: unknown = {}, extra: Record<string, unknown> = {}) => {
    const r = await service.handle({ version: 1, requestId: randomUUID(), idempotencyKey: randomUUID(), method, params, ...extra });
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.result as any;
  };
  return { dir, db, service, call, advance: (ms: number) => { clock += ms; }, close: () => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const payment = (over: Partial<Record<string, unknown>> = {}) => ({
  subscriptionId: null, billingGroupId: 'group-1', name: '测试订阅', category: '其他',
  amount: '18.00', currency: 'USD', paidOn: '2026-02-20', note: '手动记录', source: 'manual', ...over,
});

test('payments: idempotent replay, supplemental record, revision, remove/undo', async () => {
  const f = fixture();
  try {
    const key = randomUUID();
    const first = await f.call('payments.create', { input: payment(), advancePlan: false }, { idempotencyKey: key });
    assert.equal(await f.call('payments.create', { input: payment(), advancePlan: false }, { idempotencyKey: key }), first);
    assert.equal((await f.service.snapshot()).payments.length, 1, '同 key 重放只产生一笔');
    await f.call('payments.create', { input: payment({ amount: '2.00', note: '补付' }), advancePlan: false });
    assert.equal(recordedTotal((await f.service.snapshot()).payments, '2026-02', 'USD'), '20.000000');
    await assert.rejects(f.call('payments.update', { id: first, patch: { amount: '19.00' } }, { expectedRevision: 9 }), { code: 'REVISION_CONFLICT' });
    await f.call('payments.update', { id: first, patch: { amount: '19.00' } }, { expectedRevision: 1 });
    assert.equal(f.db.getPayment(first)?.amount, '19.00');
    await assert.rejects(f.call('payments.create', { input: payment({ paidOn: '2099-01-01' }), advancePlan: false }), { code: 'FUTURE_PAYMENT' });
    const token = await f.call('payments.remove', { id: first });
    assert.equal(f.db.getPayment(first), null);
    await f.call('payments.undo', { token });
    assert.equal(f.db.getPayment(first)?.amount, '19.00');
    assert.equal(f.db.listPayments().length, 2);
  } finally { f.close(); }
});

test('payments: deleting a subscription keeps its history; export/import round trip', async () => {
  const f = fixture();
  try {
    const subId = await f.call('subscriptions.create', { input: input() });
    const payId = await f.call('payments.create', { input: payment({ subscriptionId: subId }), advancePlan: false });
    await f.call('subscriptions.remove', { id: subId, removeFuture: false });
    assert.equal(f.db.getSubscription(subId), null);
    assert.equal(f.db.getPayment(payId)?.subscriptionId, subId);
    const text = await f.call('data.export');
    assert.ok(JSON.parse(text).payments.length === 1);
    const preview = await f.call('data.importPreview', { text });
    assert.equal(preview.paymentCount, 1);
    await f.call('data.importCommit', { id: preview.id, text });
    assert.equal(f.db.listPayments()[0].id, payId);
    assert.equal(f.service.snapshot().preferences.workspaceName, '个人工作区');
  } finally { f.close(); }
});

test('payments: manual plan advances once from the original anchor', async () => {
  const f = fixture();
  try {
    const subId = await f.call('subscriptions.create', { input: input() });
    const key = randomUUID();
    await f.call('payments.create', { input: payment({ subscriptionId: subId, planDate: '2026-02-28' }), advancePlan: true }, { idempotencyKey: key });
    assert.equal(f.db.getSubscription(subId)?.renewalDate.value, '2026-03-31', '1/31 锚点：2 月末之后回到 3/31');
    assert.equal(f.db.getSubscription(subId)?.anchorDate, '2026-01-31');
    await assert.rejects(f.call('payments.create', { input: payment({ subscriptionId: subId, planDate: '2026-02-28' }), advancePlan: true }), { code: 'PLAN_MISMATCH' });
    assert.equal(f.db.listPayments().length, 1, '重复顺延不产生第二笔');
  } finally { f.close(); }
});

test('payments: automatic source refuses manual advance without half-write', async () => {
  const f = fixture();
  try {
    f.db.ensureConnection('deepseek-balance');
    const sub = { ...input(), connectionId: 'deepseek-balance', management: 'automatic' as const };
    const subId = await f.call('subscriptions.create', { input: sub });
    const before = f.db.getSubscription(subId)!.renewalDate.value;
    await assert.rejects(f.call('payments.create', { input: payment({ subscriptionId: subId, planDate: before }), advancePlan: true }), { code: 'AUTOMATIC_PLAN' });
    assert.equal(f.db.listPayments().length, 0);
    assert.equal(f.db.getSubscription(subId)?.renewalDate.value, before);
    await f.call('payments.create', { input: payment({ subscriptionId: subId }), advancePlan: false });
    assert.equal(f.db.getSubscription(subId)?.renewalDate.value, before, '普通记账不改自动日期');
    assert.equal(f.db.listPayments().length, 1);
  } finally { f.close(); }
});

test('preferences: budgets distinguish unset from zero and persist', async () => {
  const f = fixture();
  try {
    await f.call('preferences.set', { patch: { monthlyBudgets: { USD: '0' }, workspaceName: '我的空间', statisticsCurrency: 'USD', reminderLeadDays: 7 } });
    const second = new SubCalDatabase(f.dir);
    try {
      const prefs = second.getPreferences();
      assert.equal(prefs.monthlyBudgets.USD, '0');
      assert.equal(prefs.monthlyBudgets.CNY, undefined);
      assert.equal(prefs.workspaceName, '我的空间');
      assert.equal(prefs.reminderLeadDays, 7);
    } finally { second.close(); }
  } finally { f.close(); }
});

test('spending selectors: plan dedupe, conflict exclusion, currencies and exact display', () => {
  const space = makeScenario('normal_mixed');
  const planned = plannedMonth(space.subscriptions, '2026-11', space.now);
  const usd = planned.totals.find((x) => x.currency === 'USD')?.amount;
  assert.equal(usd, '50.000000', '共用账单只计一次，其余按计划计');
  assert.equal(planned.excluded, 0);
  const conflicted = structuredClone(space.subscriptions);
  conflicted.find((s) => s.id === 'chatgpt')!.price.value = '25.00';
  const conflict = plannedMonth(conflicted, '2026-11', space.now);
  assert.equal(conflict.excluded, 1);
  assert.equal(conflict.totals.find((x) => x.currency === 'USD')?.amount, '30.000000');

  const payments: PaymentRecord[] = [
    { id: 'p1', revision: 1, subscriptionId: 'x', billingGroupId: 'x', name: 'A', category: 'AI 工具', amount: '0.10', currency: 'USD', paidOn: '2026-10-02', note: '', recordedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', source: 'manual' },
    { id: 'p2', revision: 1, subscriptionId: 'x', billingGroupId: 'x', name: 'A', category: 'AI 工具', amount: '0.20', currency: 'USD', paidOn: '2026-10-03', note: '', recordedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', source: 'manual' },
    { id: 'p3', revision: 1, subscriptionId: 'y', billingGroupId: 'y', name: 'B', category: '其他', amount: '100.00', currency: 'CNY', paidOn: '2026-10-04', note: '', recordedAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z', source: 'manual' },
  ];
  assert.equal(recordedTotal(payments, '2026-10', 'USD'), '0.300000');
  assert.deepEqual(recordedTotals(payments, '2026-10'), [{ currency: 'CNY', amount: '100.000000' }, { currency: 'USD', amount: '0.300000' }]);
  assert.equal(exactMoney('1234567.5', 'USD'), '$1,234,567.50');
  assert.deepEqual(budgetProgress('20.00', null), { percent: 0, remaining: null, over: false });
  assert.equal(budgetProgress('2.00', '10').remaining, '8.000000');
  assert.equal(budgetProgress('2.00', '0').over, true);
});

test('quarterly plan uses three calendar months and month-end clipping', () => {  const space = makeScenario('date_boundaries');
  const sub = structuredClone(space.subscriptions[0]);
  sub.cycle = 'quarterly';
  sub.anchorDate = '2027-01-31';
  sub.renewalDate = { ...sub.renewalDate, value: '2027-01-31' };
  assert.equal(nextPlanDate(sub, '2027-01-31'), '2027-04-30');
  assert.equal(nextPlanDate({ ...sub, renewalDate: { ...sub.renewalDate, value: '2027-04-30' } }, '2027-04-30'), '2027-07-31');
});

test('automatic source accepts local category and lead days but protects provider dates', async () => {
  const f = fixture();
  try {
    f.db.ensureConnection('deepseek-balance');
    const subId = await f.call('subscriptions.create', { input: { ...input(), connectionId: 'deepseek-balance' } });
    const revision = f.db.getSubscription(subId)!.revision;
    await f.call('subscriptions.update', {
      id: subId,
      patch: {
        category: '影音娱乐',
        reminderLeadDays: 7,
        renewalDate: { ...unknown(), value: '2027-01-01', availability: 'known' },
      },
    }, { expectedRevision: revision });
    const saved = f.db.getSubscription(subId)!;
    assert.equal(saved.category, '影音娱乐');
    assert.equal(saved.reminderLeadDays, 7);
    assert.notEqual(saved.renewalDate.value, '2027-01-01', '自动来源日期不能由页面提交覆盖');
  } finally { f.close(); }
});

test('reminder lead days are configurable per subscription and independent from the channel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcal-lead-'));
  const db = new SubCalDatabase(dir);
  const now = Date.parse('2026-10-01T02:00:00Z');
  try {
    const prefs = db.getPreferences();
    db.savePreferences({ ...prefs, reminder: 'local', notificationsMuted: false, dndStart: null, dndEnd: null, reminderLeadDays: 3 });
    const base = {
      ...input(),
      id: 'lead-check',
      revision: 1,
      history: [],
      renewalDate: { ...unknown(), value: '2026-10-06', availability: 'known' as const },
      anchorDate: '2026-10-06',
      reminderLeadDays: 7,
    };
    db.upsertSubscription(base);
    const shown: string[] = [];
    const service = new NotificationService(db, { available: () => true, show: (_title, body) => { shown.push(body); } }, () => now);
    service.tick();
    assert.equal(shown.length, 1, '单项提前 7 天应覆盖全局 3 天');
    const persisted = db.getSubscription('lead-check')!;
    persisted.reminderLeadDays = 1;
    db.upsertSubscription(persisted);
    service.tick();
    assert.equal(shown.length, 1, '提前 1 天时 5 天后的事项不提醒');
    const inherited = db.getSubscription('lead-check')!;
    inherited.reminderLeadDays = null;
    db.upsertSubscription(inherited);
    const prefs2 = db.getPreferences();
    db.savePreferences({ ...prefs2, reminderLeadDays: 7 });
    service.tick();
    assert.equal(shown.length, 1, '同一窗口已提交过，重启或改配置不会重复爆发');
    const muted = db.getSubscription('lead-check')!;
    muted.reminderLeadDays = 14;
    muted.reminder = 'none';
    db.upsertSubscription(muted);
    service.tick();
    assert.equal(shown.length, 1, '单项关闭提醒时不发送');
    service.close();
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
