import React, { useState } from 'react';
import type { Notify } from '../contracts';
import type { Snapshot, SubCalClient, Subscription } from '../../shared/types';
import {
  anchoredDate,
  dateInZone,
  dateValid,
  daysBetween,
  fieldText,
  money,
  projectEvents,
  renewalText,
} from '../../shared/rules';
import {
  BrandIcon,
  connectionStateMeta,
  cycleLabel,
  FieldSource,
  formatDateTime,
  lifecycleMeta,
  Modal,
  QuotaMeter,
  StatusBadge,
} from './ui';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FormSelect } from './form-controls';
import { Field, FieldDescription, FieldError, FieldLabel } from './ui/field';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  LockKeyhole,
  Pause,
  Pin,
  Play,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import './subscription-details.css';
import { isAutomatic, uniqueWindows } from '../lib/entitlements';
import { exactMoney } from '../../shared/spending';
import { BalanceDetails, EntitlementDates } from './EntitlementDetails';

export interface DetailDrawerProps {
  subscription: Subscription;
  snapshot: Snapshot;
  client: SubCalClient;
  notify: Notify;
  onClose: () => void;
  onEdit: (subscription: Subscription) => void;
  onSelectAccount: (id: string) => void;
  onConnection: (connectionId: string) => void;
  onRecordPayment?: (subscriptionId: string, planDate?: string) => void;
}

export function DetailDrawer({
  subscription,
  snapshot,
  client,
  notify,
  onClose,
  onEdit,
  onSelectAccount,
  onConnection,
  onRecordPayment,
}: DetailDrawerProps) {
  const [busy, setBusy] = useState(false);
  const automatic = isAutomatic(subscription);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [cancelMode, setCancelMode] = useState<'known' | 'unknown'>(
    subscription.paidThrough.value ? 'known' : 'unknown'
  );
  const [cancelPaidThrough, setCancelPaidThrough] = useState<string>(
    subscription.paidThrough.value || ''
  );
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [confirmScope, setConfirmScope] = useState<'archive' | 'delete' | null>(null);

  const connection = subscription.connectionId
    ? snapshot.connections.find((c) => c.id === subscription.connectionId) || null
    : null;

  // Section 1 (收费与日期) & Section 2 (额度明细) expanded by default;
  // Section 3 (来源与历史) & Section 4 (日历提醒) collapsible on demand.
  const [openBilling, setOpenBilling] = useState(true);
  const [openQuota, setOpenQuota] = useState(true);
  const [openHistory, setOpenHistory] = useState(() => Boolean(connection?.error));
  const [openCalendar, setOpenCalendar] = useState(false);

  const peerAccounts = snapshot.subscriptions.filter(
    (s) => s.product === subscription.product && s.brand === subscription.brand
  );
  const billingPeers = subscription.billingGroupId
    ? snapshot.subscriptions.filter(
        (s) => s.id !== subscription.id && s.billingGroupId === subscription.billingGroupId
      )
    : [];
  const quotaPeers = subscription.quotaPoolId
    ? snapshot.subscriptions.filter(
        (s) => s.id !== subscription.id && s.quotaPoolId === subscription.quotaPoolId
      )
    : [];

  const recentPayments = snapshot.payments
    .filter((payment) => payment.subscriptionId === subscription.id)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn))
    .slice(0, 3);

  const connMeta = connection ? connectionStateMeta(connection.state) : null;
  const lifeMeta = lifecycleMeta(subscription.lifecycle, subscription.autoRenew);

  const today = dateInZone(snapshot.now, subscription.timezone);
  const renewalDays = subscription.renewalDate.value
    ? daysBetween(today, subscription.renewalDate.value)
    : null;
  const isPastDue =
    renewalDays !== null &&
    renewalDays <= 0 &&
    subscription.autoRenew !== 'off' &&
    !['ending', 'cancelled', 'expired', 'archived'].includes(subscription.lifecycle);

  const projectedEvents = projectEvents([subscription], snapshot.now, true);
  const futureRenewalCount = projectedEvents.filter(
    (e) => e.kind === 'renewal' && e.date >= today
  ).length;

  const proposedFields = (['renewalDate', 'price', 'plan'] as const).filter(
    (key) => !automatic && subscription[key].proposed !== undefined
  );

  const fieldTitle: Record<'renewalDate' | 'price' | 'plan', string> = {
    renewalDate: '下次计划续费日',
    price: '周期价格',
    plan: '套餐名称',
  };

  const primaryPriceDisplay =
    subscription.kind === 'wallet' && subscription.cycle === 'none'
      ? '不适用 · 按量钱包'
      : subscription.price.availability === 'known' && subscription.price.value !== null
        ? `${money(subscription.price.value, subscription.currency)} / ${cycleLabel(
            subscription.cycle,
            subscription.intervalDays
          )}`
        : fieldText(subscription.price);

  const handleOpenWebsite = async () => {
    if (!subscription.website) {
      notify('当前订阅未填写官网地址，可在编辑中补充 HTTPS 链接');
      return;
    }
    try {
      const u = new URL(subscription.website);
      if (u.protocol !== 'https:' || u.username || u.password) {
        notify('仅允许打开不含凭据的 HTTPS 安全链接');
        return;
      }
      if (window.subcal?.openExternal) {
        await window.subcal.openExternal(subscription.website);
        notify(`已请求系统浏览器打开 ${u.hostname}`);
      } else {
        notify('当前环境无法调用系统浏览器，请手动复制链接打开');
      }
    } catch {
      notify('官网链接格式无效，请检查是否为有效 HTTPS 网址');
    }
  };

  const handleResolveField = async (
    field: 'renewalDate' | 'price' | 'plan',
    accept: boolean
  ) => {
    setBusy(true);
    try {
      await client.resolveField(subscription.id, field, accept);
      notify(
        accept
          ? `已采纳「${fieldTitle[field]}」的探测新值`
          : `已保留「${fieldTitle[field]}」的手动锁定值`
      );
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPastDueRenewal = async () => {
    if (!subscription.renewalDate.value) return;
    if (!['monthly', 'yearly', 'days'].includes(subscription.cycle)) {
      notify('这项记录没有固定周期，请编辑并填写核对后的下一日期。');
      return;
    }
    setBusy(true);
    try {
      const anchor = subscription.anchorDate || subscription.renewalDate.value;
      let step = 1;
      let nextDate = anchoredDate(
        anchor,
        subscription.cycle,
        step,
        subscription.intervalDays
      );
      while (step < 240 && nextDate <= today) {
        step++;
        nextDate = anchoredDate(
          anchor,
          subscription.cycle,
          step,
          subscription.intervalDays
        );
      }
      await client.update(subscription.id, subscription.revision, {
        renewalDate: {
          value: nextDate,
          availability: 'known',
          source: '用户确认续费',
          observedAt: snapshot.now,
          dataOrigin: 'manual',
          locked: true,
        },
        anchorDate: anchor,
        lifecycle: 'active',
      });
      notify(`已确认续费并按锚点顺延至 ${nextDate}`);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmCancelAutoRenew = async () => {
    setCancelError(null);
    if (cancelMode === 'known') {
      if (!cancelPaidThrough.trim() || !dateValid(cancelPaidThrough.trim())) {
        setCancelError('请填写有效的已付有效期结束日（YYYY-MM-DD），或选择“有效期暂不确定”');
        return;
      }
      if (
        subscription.startDate.value &&
        cancelPaidThrough.trim() < subscription.startDate.value
      ) {
        setCancelError('已付有效期结束日不能早于开始日期');
        return;
      }
    }

    setBusy(true);
    try {
      const paidField =
        cancelMode === 'known'
          ? {
              value: cancelPaidThrough.trim(),
              availability: 'known' as const,
              source: '用户确认已付有效期',
              observedAt: snapshot.now,
              dataOrigin: 'manual' as const,
              locked: true,
            }
          : {
              value: null,
              availability: 'unfetched' as const,
              source: '已记录关闭自动续费 · 有效期待补充',
              observedAt: snapshot.now,
              dataOrigin: 'manual' as const,
            };

      await client.update(subscription.id, subscription.revision, {
        autoRenew: 'off',
        lifecycle: 'ending',
        paidThrough: paidField,
      });
      setShowCancelPanel(false);
      notify(
        cancelMode === 'known'
          ? `已记录关闭自动续费，已付有效期保留至 ${cancelPaidThrough.trim()}`
          : '已记录关闭自动续费，已付有效期待后续补充（未从扣费日自动推断）'
      );
    } catch (err) {
      setCancelError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePin = async () => {
    setBusy(true);
    try {
      await client.update(subscription.id, subscription.revision, {
        pinned: !subscription.pinned,
      });
      notify(subscription.pinned ? '已取消置顶' : '已置顶到概览与托盘摘要');
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReminderChange = async (reminder: Subscription['reminder']) => {
    setBusy(true);
    try {
      await client.update(subscription.id, subscription.revision, { reminder });
      notify('已更新提醒策略');
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCategoryChange = async (category: string) => {
    setBusy(true);
    try {
      await client.update(subscription.id, subscription.revision, { category });
      notify('已更新本地分类；自动来源的套餐与日期不受影响');
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveConfirm = async () => {
    setBusy(true);
    try {
      const targetArchived = subscription.lifecycle !== 'archived';
      await client.archive(subscription.id, targetArchived, false);
      setConfirmScope(null);
      notify(
        targetArchived
          ? `已归档「${subscription.product}」（保留已有日程）`
          : `已恢复「${subscription.product}」活跃跟踪`
      );
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setBusy(true);
    try {
      const productName = subscription.product;
      const token = await client.remove(subscription.id, false);
      setConfirmScope(null);
      onClose();
      notify(`已删除「${productName}」`, {
        label: '撤销删除 (8s)',
        duration: 8000,
        run: () => {
          void client
            .undo(token)
            .then(() => notify(`已恢复「${productName}」及关联日程`))
            .catch((e) => notify((e as Error).message));
        },
      });
    } catch (err) {
      notify((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`${subscription.product} · 订阅详情`} onClose={onClose} drawer>
      <div className="drawer-stack stack">
        {/* Top Identity, Always-Visible Key Amount/Date Summary & Actions */}
        <div className="drawer-hero-card">
          <div className="drawer-hero-top">
            <div className="drawer-brand-row">
              <BrandIcon product={subscription.product} brand={subscription.brand} size={28} />
              <div>
                <div className="drawer-product-line">
                  <strong className="drawer-product-name">{subscription.product}</strong>
                  <StatusBadge tone={lifeMeta.tone}>{lifeMeta.label}</StatusBadge>
                  {connMeta ? (
                    <StatusBadge tone={connMeta.tone}>{connMeta.label}</StatusBadge>
                  ) : null}
                </div>
                <div className="drawer-sub-meta muted">
                  品牌：{subscription.brand} · 账号：{subscription.account} · 组织：{subscription.organization}
                </div>
              </div>
            </div>
          </div>

          {/* Primary Amount & Next Date Summary (Always Visible, never hidden in collapsed sections) */}
          <div className="drawer-primary-summary" aria-label="核心金额与日期摘要">
            <div className="drawer-summary-item">
              <span className="drawer-summary-label">{automatic ? '实际支付金额' : '周期价格与计费'}</span>
              <strong className="drawer-summary-value">{automatic ? subscription.price.value === null ? '未记录' : money(subscription.price.value, subscription.currency) : primaryPriceDisplay}</strong>
            </div>
            <div className="drawer-summary-item">
              <span className="drawer-summary-label">{automatic ? '服务提供的日期' : '下次续费 / 有效期'}</span>
              <div className="drawer-summary-value">
                {automatic ? <EntitlementDates subscription={subscription} /> : renewalText(subscription, snapshot.now)}
              </div>
            </div>
          </div>

          {peerAccounts.length > 1 ? (
            <div className="drawer-account-switcher" role="tablist" aria-label="同产品多账号切换">
              <span className="switcher-label">切换账号：</span>
              <div className="switcher-pills">
                {peerAccounts.map((acc) => (
                  <Button
                    key={acc.id}
                    type="button"
                    role="tab"
                    variant={acc.id === subscription.id ? 'secondary' : 'ghost'}
                    size="xs"
                    aria-selected={acc.id === subscription.id}
                    className={`switcher-pill ${acc.id === subscription.id ? 'active' : ''}`}
                    onClick={() => onSelectAccount(acc.id)}
                  >
                    {acc.account}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="drawer-action-bar">
            <Button type="button" onClick={() => onEdit(subscription)}>
              {automatic ? '编辑实际支付' : '编辑记录'}
            </Button>
            {subscription.connectionId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || connection?.state === 'refreshing'}
                onClick={() => {
                  setBusy(true);
                  void client
                    .refresh(subscription.id)
                    .then((msg) => notify(msg))
                    .catch((e) => notify((e as Error).message))
                    .finally(() => setBusy(false));
                }}
              >
                <RefreshCw />
                {connection?.state === 'refreshing' ? '刷新中…' : '刷新'}
              </Button>
            ) : null}
            {connection ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void client
                    .pause(connection.id)
                    .then(() =>
                      notify(
                        connection.state === 'paused'
                          ? '已恢复连接并触发刷新'
                          : '已暂停该连接'
                      )
                    )
                    .catch((e) => notify((e as Error).message))
                    .finally(() => setBusy(false));
                }}
              >
                {connection.state === 'paused' ? (
                  <>
                    <Play />
                    恢复采集
                  </>
                ) : (
                  <>
                    <Pause />
                    暂停采集
                  </>
                )}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTogglePin}
              disabled={busy}
            >
              <Pin />
              {subscription.pinned ? '已置顶' : '置顶'}
            </Button>
            {subscription.website ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleOpenWebsite()}
              >
                <ExternalLink />
                去官网账单页
              </Button>
            ) : null}
          </div>
        </div>

        {/* Proposed vs Locked Field Conflict Resolution */}
        {proposedFields.length > 0 ? (
          <div className="drawer-conflict-box">
            <div className="row spread">
              <strong>
                <LockKeyhole className="inline-icon" /> 发现人工锁定字段与探测值差异
              </strong>
              <StatusBadge tone="warning">未静默覆盖</StatusBadge>
            </div>
            <p className="muted">
              以下字段已被你手动锁定。自动采集探测到了不同的值，请选择保留手动锁定值或采纳探测值：
            </p>
            {proposedFields.map((fieldKey) => {
              const fieldObj = subscription[fieldKey];
              return (
                <div key={fieldKey} className="conflict-field-row">
                  <div className="conflict-field-compare">
                    <div>
                      <span className="muted">{fieldTitle[fieldKey]}（当前手动锁定）：</span>
                      <strong className="tabular">
                        {fieldObj.value ?? '未填写'}{' '}
                        <LockKeyhole className="inline-icon" aria-label="已锁定" />
                      </strong>
                    </div>
                    <div>
                      <span className="muted">探测新值：</span>
                      <strong className="tabular highlight-proposed">
                        {fieldObj.proposed}
                      </strong>
                    </div>
                  </div>
                  <div className="conflict-field-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleResolveField(fieldKey, false)}
                    >
                      保留手动锁定值 ({fieldObj.value})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleResolveField(fieldKey, true)}
                    >
                      采纳探测值 ({fieldObj.proposed})
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Past-Due Renewal Confirmation Banner */}
        {!automatic && isPastDue ? (
          <div className="drawer-pastdue-box">
            <div>
              <strong>
                <CalendarClock className="inline-icon" /> 已到计划续费日（
                {subscription.renewalDate.value}），待人工确认
              </strong>
              <p className="muted">
                系统不会在无确切依据时自动将续费日推到下个月。请核对官网账单后确认：
              </p>
            </div>
            <div className="row">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void handleConfirmPastDueRenewal()}
              >
                确认已续费，顺延至下一周期
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpenBilling(true);
                  setShowCancelPanel(true);
                }}
              >
                我已在官网停订 / 不再续费
              </Button>
            </div>
          </div>
        ) : null}

        {/* Group 1: 收费与日期安排 (Default Expanded) */}
        <Collapsible
          open={openBilling}
          onOpenChange={setOpenBilling}
          className="drawer-collapsible-section"
        >
          <CollapsibleTrigger
            className="drawer-collapsible-trigger"
            data-testid="drawer-section-billing"
          >
            <span>1. 收费与日期安排</span>
            <span className="drawer-trigger-meta">
              {automatic ? '服务自动更新' : renewalText(subscription, snapshot.now)}
              <ChevronDown className="drawer-chevron" />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="drawer-section-body stack">
            <div className="detail-kv-grid">
              <div className="detail-kv-item">
                <span className="detail-kv-label">套餐方案</span>
                <strong className="detail-kv-value">{fieldText(subscription.plan)}</strong>
                <FieldSource field={subscription.plan} now={snapshot.now} />
              </div>

              <div className="detail-kv-item">
                <span className="detail-kv-label">{automatic ? '实际支付金额' : '周期价格与币种'}</span>
                <strong className="detail-kv-value tabular">{automatic ? subscription.price.value === null ? '未记录' : money(subscription.price.value, subscription.currency) : primaryPriceDisplay}</strong>
                <FieldSource field={subscription.price} now={snapshot.now} />
              </div>

              {!automatic && <><div className="detail-kv-item">
                <span className="detail-kv-label">下次计划续费日（扣款日）</span>
                <strong className="detail-kv-value tabular">
                  {subscription.renewalDate.availability === 'known' &&
                  subscription.renewalDate.value
                    ? subscription.renewalDate.value
                    : fieldText(subscription.renewalDate)}
                </strong>
                <FieldSource field={subscription.renewalDate} now={snapshot.now} />
              </div>

              <div className="detail-kv-item">
                <span className="detail-kv-label">已付有效期结束日（停用日）</span>
                <strong className="detail-kv-value tabular">
                  {subscription.paidThrough.availability === 'known' &&
                  subscription.paidThrough.value
                    ? subscription.paidThrough.value
                    : fieldText(subscription.paidThrough)}
                </strong>
                <FieldSource field={subscription.paidThrough} now={snapshot.now} />
              </div>

              <div className="detail-kv-item">
                <span className="detail-kv-label">订阅开始日</span>
                <strong className="detail-kv-value tabular">
                  {subscription.startDate.availability === 'known' && subscription.startDate.value
                    ? subscription.startDate.value
                    : fieldText(subscription.startDate)}
                </strong>
                <FieldSource field={subscription.startDate} now={snapshot.now} />
              </div>

              <div className="detail-kv-item">
                <span className="detail-kv-label">试用结束日</span>
                <strong className="detail-kv-value tabular">
                  {subscription.trialEnd.availability === 'known' && subscription.trialEnd.value
                    ? subscription.trialEnd.value
                    : fieldText(subscription.trialEnd)}
                </strong>
                <FieldSource field={subscription.trialEnd} now={snapshot.now} />
              </div></>}
              {automatic && <>
                <EntitlementDates subscription={subscription} />
                {subscription.entitlements?.listPrice && <div className="detail-kv-item">
                  <span className="detail-kv-label">服务标价（非实际支付）</span>
                  <strong>{subscription.entitlements.listPrice.availability === 'known' && subscription.entitlements.listPrice.value !== null
                    ? subscription.entitlements.listPriceCurrency ? money(subscription.entitlements.listPrice.value, subscription.entitlements.listPriceCurrency) : `${subscription.entitlements.listPrice.value}（币种暂未提供）`
                    : '暂未提供'}</strong>
                  <FieldSource field={subscription.entitlements.listPrice} now={snapshot.now} />
                </div>}
              </>}
            </div>

            {!automatic && <div className="detail-meta-strip">
              <span>
                自动续费：
                <strong>
                  {subscription.autoRenew === 'on'
                    ? '开启'
                    : subscription.autoRenew === 'off'
                      ? '已关闭（到期停止）'
                      : '待确认'}
                </strong>
              </span>
              <span>
                账期锚点日：
                <strong className="tabular">{subscription.anchorDate || '未设置'}</strong>
              </span>
              <span>
                账单时区：<strong className="tabular">{subscription.timezone}</strong>
              </span>
            </div>}

            {/* Shared Billing vs Shared Quota Pool Explanation */}
            {(subscription.billingGroupId || quotaPeers.length > 0 || subscription.possibleSharedWallet) && <div className="detail-relationship-card">
              <div className="relationship-line">
                <strong>共用付款：</strong>
                {subscription.billingGroupId ? (
                  <span>
                    {billingPeers.length > 0
                      ? billingPeers.map((p) => p.product).join('、')
                      : '已设置共用付款'}
                  </span>
                ) : (
                  <span className="muted">独立付款（未与其他记录共用账单）</span>
                )}
              </div>
              <div className="relationship-line">
                <strong>共享额度：</strong>
                {subscription.quotaPoolId ? (
                  <span>
                    {quotaPeers.length > 0
                      ? `与 ${quotaPeers.map((p) => `${p.product}(${p.account})`).join('、')} 共享额度`
                      : '此账号的额度'}
                  </span>
                ) : (
                  <span className="muted">未发现共享额度</span>
                )}
              </div>
              {subscription.possibleSharedWallet ? (
                <div className="relationship-line warning-text">
                  <strong>
                    <TriangleAlert className="inline-icon" /> 疑似共享账户余额：
                  </strong>
                  <span>
                    可能与其他 Key 共用余额，暂不计入汇总。
                  </span>
                </div>
              ) : null}
            </div>}

            {subscription.notes ? (
              <div className="drawer-notes-card">
                <span className="muted">备注说明</span>
                <p>{subscription.notes}</p>
              </div>
            ) : null}

            {/* "我已在官网关闭自动续费" Action & Panel */}
            {!automatic && subscription.kind !== 'wallet' && subscription.autoRenew !== 'off' ? (
              <div className="cancel-renew-wrapper">
                {!showCancelPanel ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCancelMode(subscription.paidThrough.value ? 'known' : 'unknown');
                      setCancelPaidThrough(subscription.paidThrough.value || '');
                      setCancelError(null);
                      setShowCancelPanel(true);
                    }}
                  >
                    我已在官网关闭自动续费…
                  </Button>
                ) : (
                  <div className="cancel-renew-panel stack">
                    <strong>记录“已在官网关闭自动续费”（仅更新本地记录）</strong>
                    <p className="muted">
                      请填写官网确认的有效期；不确定时可留空。
                    </p>
                    <label className="radio-row">
                      <input
                        type="radio"
                        name="cancel-paid-mode"
                        checked={cancelMode === 'known'}
                        onChange={() => setCancelMode('known')}
                      />
                      <span>我已核对官网，明确知道当前已付有效期结束日：</span>
                    </label>
                    {cancelMode === 'known' ? (
                      <Field>
                        <FieldLabel htmlFor="cancel-paid-date">
                          已付有效期至（YYYY-MM-DD）
                        </FieldLabel>
                        <Input
                          id="cancel-paid-date"
                          type="text"
                          placeholder="例如 2026-10-22"
                          value={cancelPaidThrough}
                          onChange={(e) => setCancelPaidThrough(e.target.value)}
                        />
                        {subscription.renewalDate.value ? (
                          <FieldDescription>
                            参考：当前记录的计划续费日为 {subscription.renewalDate.value}{' '}
                            <Button
                              type="button"
                              variant="link"
                              size="xs"
                              onClick={() =>
                                setCancelPaidThrough(subscription.renewalDate.value || '')
                              }
                            >
                              填入此日期作为已核对有效期
                            </Button>
                          </FieldDescription>
                        ) : null}
                      </Field>
                    ) : null}

                    <label className="radio-row">
                      <input
                        type="radio"
                        name="cancel-paid-mode"
                        checked={cancelMode === 'unknown'}
                        onChange={() => setCancelMode('unknown')}
                      />
                      <span>暂不确定具体停用日期（保留为“有效期待补充”，不伪造到期日程）</span>
                    </label>

                    <div className="cancel-calendar-preview">
                      <span>
                        本地日历影响预览：将移除未来 <strong>{futureRenewalCount}</strong> 条预计续费日程
                        {cancelMode === 'known' && dateValid(cancelPaidThrough.trim())
                          ? `，并在 ${cancelPaidThrough.trim()} 生成 1 条“到期”日程。`
                          : '。'}
                      </span>
                    </div>

                    {cancelError ? <FieldError>{cancelError}</FieldError> : null}

                    <div className="row">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleConfirmCancelAutoRenew()}
                      >
                        确认更新本地记录
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowCancelPanel(false)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>

        {/* Group 2: 额度与余额明细 (Default Expanded) */}
        <Collapsible
          open={openQuota}
          onOpenChange={setOpenQuota}
          className="drawer-collapsible-section"
        >
          <CollapsibleTrigger
            className="drawer-collapsible-trigger"
            data-testid="drawer-section-quota"
          >
            <span>2. 额度与余额明细</span>
            <span className="drawer-trigger-meta">
              共 {uniqueWindows(subscription.metrics).length + (subscription.balances?.length ?? 0)} 项
              <ChevronDown className="drawer-chevron" />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="drawer-section-body stack">
            <BalanceDetails subscription={subscription} now={snapshot.now} />
            {subscription.metrics.length > 0 ? (
              uniqueWindows(subscription.metrics).map((m) => (
                <div key={m.id} className="drawer-metric-card">
                  <QuotaMeter
                    metric={m}
                    now={snapshot.now}
                    view={snapshot.preferences.quotaView}
                  />
                  <div className="drawer-metric-meta">
                    <FieldSource field={m.remaining} now={snapshot.now} label="字段来源" />
                    <span className="muted">
                      超过 {m.staleAfterMinutes} 分钟未更新会提示数据过时
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="muted">当前订阅未记录自动或手动额度指标。</div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Group 3: 来源、连接与历史 (Collapsible on demand) */}
        <Collapsible
          open={openHistory}
          onOpenChange={setOpenHistory}
          className="drawer-collapsible-section"
        >
          <CollapsibleTrigger
            className="drawer-collapsible-trigger"
            data-testid="drawer-section-history"
          >
            <span>3. 来源、连接与历史</span>
            <span className="drawer-trigger-meta">
              {connection ? connMeta?.label : '纯手动记录'} · 历史 {subscription.history.length} 条
              <ChevronDown className="drawer-chevron" />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="drawer-section-body stack">
            {connection ? (
              <div className="drawer-connection-box stack">
                <div className="row spread">
                  <div>
                    <strong>账号：{subscription.account}</strong>
                  </div>
                  <StatusBadge tone={connMeta?.tone}>{connMeta?.label}</StatusBadge>
                </div>
                <div className="muted tabular">
                  最近成功：{formatDateTime(connection.lastSuccess)} · 最近尝试：
                  {formatDateTime(connection.lastAttempt)}
                  {connection.nextAllowed
                    ? ` · 下次允许查询：${formatDateTime(connection.nextAllowed)}`
                    : ''}
                </div>
                {connection.error ? (
                  <div className="conn-error-callout">
                    <span>{connection.error.message}</span>
                    <div className="muted">建议动作：{connection.error.action}</div>
                  </div>
                ) : null}
                <div className="row">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onClose();
                      onConnection(connection.id);
                    }}
                  >
                    查看账号 / 重新登录
                  </Button>
                </div>
              </div>
            ) : (
              <div className="muted">
                此订阅未绑定自动采集连接，所有字段由你手动维护。
              </div>
            )}

            <div className="drawer-history-block">
              <div className="section-header">
                <strong>观察与编辑记录</strong>
              </div>
              {subscription.history.length > 0 ? (
                <ul className="history-list">
                  {subscription.history.slice(0, 12).map((item, idx) => (
                    <li key={`${item.at}-${idx}`} className="history-item">
                      <span className="history-time tabular">{formatDateTime(item.at)}</span>
                      <span className="history-text">{item.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="muted">
                  暂无变更或刷新历史。
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Group 4: 日历事件与提醒设置 (Collapsible on demand) */}
        <Collapsible
          open={openCalendar}
          onOpenChange={setOpenCalendar}
          className="drawer-collapsible-section"
        >
          <CollapsibleTrigger
            className="drawer-collapsible-trigger"
            data-testid="drawer-section-calendar"
          >
            <span>4. 日历提醒与日程投影</span>
            <span className="drawer-trigger-meta">
              提醒：
              {subscription.reminder === 'local'
                ? '本地桌面提醒'
                : subscription.reminder === 'external'
                  ? '本地 + 外部日历'
                  : '关闭'}
              <ChevronDown className="drawer-chevron" />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="drawer-section-body stack">
            <Field>
              <FieldLabel htmlFor="drawer-reminder-select">单订阅提醒方式</FieldLabel>
              <FormSelect
                id="drawer-reminder-select"
                value={subscription.reminder}
                disabled={busy}
                onChange={(e) =>
                  void handleReminderChange(e.target.value as Subscription['reminder'])
                }
              >
                <option value="local">仅本地日程与桌面提醒</option>
                <option value="external">本地 + 外部日历提醒（待接入）</option>
                <option value="none">关闭提醒</option>
              </FormSelect>
            </Field>

            <div className="drawer-events-preview">
              <strong>近期日程投影（本地计算）：</strong>
              {projectedEvents.length > 0 ? (
                <ul className="mini-event-list">
                  {projectedEvents.slice(0, 6).map((ev) => (
                    <li key={ev.id} className="mini-event-item">
                      <span className="tabular">{ev.date}</span>
                      <span>
                        {ev.kind === 'renewal'
                          ? `${ev.expected ? '预计续费' : '续费'}`
                          : ev.kind === 'expiry'
                            ? '到期停止'
                            : ev.kind === 'trial'
                              ? '试用结束'
                              : ev.kind === 'start'
                                ? '开始生效'
                                : '额度重置（仅本地）'}
                      </span>
                      <span className="muted">{ev.source}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  暂无可生成的日程事件（按量钱包或未填写日期）。
                </p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="drawer-section stack" data-testid="drawer-section-payments">
          <div className="row spread">
            <span className="drawer-section-summary" style={{ border: 0, padding: 0 }}>
              5. 本地分类与最近付款
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onRecordPayment?.(subscription.id, subscription.renewalDate.value ?? undefined)}
            >
              记录付款
            </Button>
          </div>
          <Field>
            <FieldLabel htmlFor="drawer-category-select">本地分类</FieldLabel>
            <FormSelect
              id="drawer-category-select"
              value={subscription.category ?? '其他'}
              disabled={busy}
              onChange={(e) => void handleCategoryChange(e.target.value)}
            >
              {[...new Set([subscription.category ?? '其他', ...(snapshot.preferences.categories ?? [])])].filter(Boolean).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </FormSelect>
            <FieldDescription>分类是本机整理属性，不改变供应商套餐；付款记录保留发生时分类快照。</FieldDescription>
          </Field>
          {recentPayments.length > 0 ? (
            <ul className="mini-event-list">
              {recentPayments.map((payment) => (
                <li key={payment.id} className="mini-event-item">
                  <span className="tabular">{payment.paidOn}</span>
                  <span>{payment.category} · {payment.note || (payment.source === 'imported' ? '备份导入' : '手动记录')}</span>
                  <strong className="tabular">{exactMoney(payment.amount, payment.currency)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">还没有记录真实付款。预测扣费不会自动变成已付金额。</p>
          )}
          <p className="muted">完整账本、筛选和预算在「消费管理」页查看；删除订阅后这些付款仍会保留。</p>
        </div>

        {/* Scoped Archive & Delete Footer with Controlled AlertDialog */}
        <div className="drawer-danger-footer stack">
          <div className="row spread">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirmScope('archive');
              }}
            >
              {subscription.lifecycle === 'archived' ? (
                <>
                  <ArchiveRestore />
                  恢复活跃跟踪
                </>
              ) : (
                <>
                  <Archive />
                  归档并停止跟踪…
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirmScope('delete');
              }}
            >
              <Trash2 />
              删除记录…
            </Button>
          </div>

          <AlertDialog
            open={confirmScope !== null}
            onOpenChange={(open) => {
              if (!open && !busy) {
                setConfirmScope(null);
              }
            }}
          >
            <AlertDialogContent data-testid="drawer-scope-alert-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmScope === 'archive'
                    ? subscription.lifecycle === 'archived'
                      ? `确认恢复「${subscription.product}」活跃跟踪？`
                      : `确认归档「${subscription.product}」？`
                    : `确认删除「${subscription.product}」？`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmScope === 'archive'
                    ? '归档后停止活跃提醒与月费统计，保留历史记录与已有日程。'
                    : '此操作仅删除本地记录，不会退订任何外部服务。删除后 8 秒内可撤销。'}
                </AlertDialogDescription>
              </AlertDialogHeader>

              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
                {confirmScope === 'archive' ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleArchiveConfirm()}
                  >
                    {subscription.lifecycle === 'archived' ? '确认恢复' : '确认归档'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void handleDeleteConfirm()}
                  >
                    确认删除记录（8 秒内可撤销）
                  </Button>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </Modal>
  );
}
