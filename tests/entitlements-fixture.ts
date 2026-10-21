import type { EntitlementDate, Field, Subscription } from '../src/shared/types';

/** Design-only observations. Never imported by the application or real-account data. */
export const observed = <T>(value: T): Field<T> => ({ value, availability: 'known', source: '设计夹具（非真实账号）', observedAt: '2026-10-21T08:00:00Z', dataOrigin: 'demo', evidence: 'reported' });
const unknown = (): Field<string> => ({ ...observed(''), value: null, availability: 'unfetched', observedAt: null });
const unknownDate = (): Field<EntitlementDate> => ({ value: null, availability: 'unfetched', source: '设计夹具（非真实账号）', observedAt: null, dataOrigin: 'demo' });
export function entitlementFixture(): Subscription {
  return {
    id: 'design-entitlements', revision: 1, product: '多窗口设计样板（非真实账号）', brand: 'OpenAI', account: '很长的中文账号名称与工作区名称用于窄卡片换行检查', organization: '设计工作区', region: '未指定', kind: 'window', management: 'automatic', connectionId: 'design-account',
    plan: observed('团队套餐 · 设计夹具'), price: observed('18.5'), currency: 'USD', cycle: 'monthly', intervalDays: 30, anchorDate: null, timezone: 'Asia/Shanghai', startDate: unknown(), renewalDate: unknown(), paidThrough: unknown(), trialEnd: unknown(), autoRenew: 'unknown', lifecycle: 'active', billingGroupId: null, quotaPoolId: null, possibleSharedWallet: false,
    entitlements: { membershipExpiresAt: unknownDate(), billingPeriodEnd: observed({ precision: 'day', value: '2026-11-01' }), nextBillingStart: observed({ precision: 'instant', value: '2026-11-02T08:00:00Z' }), autoRenew: observed(false), listPrice: observed('20'), listPriceCurrency: 'USD' },
    balances: [
      { id: 'account', label: '可用余额', scope: 'account', kind: 'total', currency: 'USD', amount: observed('10') },
      { id: 'cash', label: '现金', scope: 'account', kind: 'cash', currency: 'USD', amount: observed('8') },
      { id: 'grant', label: '赠送积分', scope: 'account', kind: 'grant', currency: 'USD', amount: observed('2'), expiresAt: observed({ precision: 'day', value: '2026-12-01' }) },
      { id: 'budget', label: '剩余预算', scope: 'key', kind: 'budget', currency: 'USD', amount: observed('0') },
      { id: 'denied', label: '信用额度', scope: 'account', kind: 'credit', currency: 'CNY', amount: { ...unknown(), availability: 'denied' } },
    ],
    metrics: [
      { id: 'short', label: '会话额度', unit: '%', remaining: observed('68'), total: '100', resetAt: null, staleAfterMinutes: 15, windowMinutes: 180, models: ['模型甲', '模型乙'], scope: 'organization', poolId: 'shared-short', resetObservation: observed({ precision: 'day', value: '2026-10-22' }) },
      { id: 'weekly', label: '一周额度', unit: '次', remaining: observed('120'), total: '200', resetAt: null, staleAfterMinutes: 15, windowMinutes: 10080, scope: 'account', resetObservation: observed({ precision: 'instant', value: '2026-10-28T08:00:00Z' }) },
      { id: 'unlimited', label: '代码补全', unit: '次', remaining: { ...unknown(), availability: 'unlimited' }, total: null, resetAt: null, staleAfterMinutes: 15 },
    ], website: '', reminder: 'none', pinned: false, notes: '', history: [],
  };
}
