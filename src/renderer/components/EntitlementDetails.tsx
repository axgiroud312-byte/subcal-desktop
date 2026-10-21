import type { Subscription } from '../../shared/types';
import { fieldText } from '../../shared/rules';
import { balanceAmount, entitlementDate } from '../lib/entitlements';
import { formatRelativeTime } from './ui';

export function EntitlementDates({ subscription: sub }: { subscription: Subscription }) {
  const e = sub.entitlements;
  return <div className="entitlement-dates" aria-label="服务提供的日期">
    <span>有效至 <strong className="tabular">{entitlementDate(e?.membershipExpiresAt)}</strong></span>
    {e?.billingPeriodEnd && <span>账期结束 <strong className="tabular">{entitlementDate(e.billingPeriodEnd)}</strong></span>}
    {e?.nextBillingStart && <span>下次账期 <strong className="tabular">{entitlementDate(e.nextBillingStart)}</strong></span>}
    {e?.autoRenew && <span>自动续费 <strong>{e.autoRenew.availability === 'known' && e.autoRenew.value !== null ? e.autoRenew.value ? '开启' : '已关闭' : '暂未提供'}</strong></span>}
  </div>;
}

export function BalanceDetails({ subscription: sub, now }: { subscription: Subscription; now: string }) {
  if (!sub.balances?.length) return null;
  return <div className="balance-details" aria-label="余额分项">
    {sub.balances.map(balance => <div className="balance-item" key={balance.id}>
      <div className="balance-main"><span>{balance.scope === 'key' ? 'Key' : '账户'} · {balance.label}</span><strong className="tabular">{balance.amount.availability === 'known' && balance.amount.value !== null ? balanceAmount(balance.amount.value, balance.currency) : fieldText(balance.amount)}</strong></div>
      {balance.expiresAt && <span className="muted">{balance.kind === 'grant' || balance.kind === 'credit' ? '积分批次失效' : '有效至'} {entitlementDate(balance.expiresAt)}</span>}
      {balance.amount.observedAt && <span className="muted">{formatRelativeTime(balance.amount.observedAt, now)}观察</span>}
    </div>)}
  </div>;
}
