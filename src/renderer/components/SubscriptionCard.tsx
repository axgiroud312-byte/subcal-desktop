import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pin,
  RefreshCw,
} from 'lucide-react';
import type { Connection, Preferences, Subscription } from '../../shared/types';
import {
  dateInZone,
  daysBetween,
  fieldText,
  freshness,
  isLow,
  money,
  renewalText,
} from '../../shared/rules';
import {
  BrandIcon,
  connectionStateMeta,
  cycleLabel,
  formatRelativeTime,
  lifecycleMeta,
  QuotaMeter,
  StatusBadge,
} from './ui';
import { Button } from './ui/button';
import { LUCIDE_ICON_SM } from '../lib/utils';
import { getMotionTransition, getSortableTransition, isReducedMotionActive } from '../lib/motion';

export interface SubscriptionCardProps {
  subscription: Subscription;
  accounts?: Subscription[];
  allSubscriptions: Subscription[];
  connections: Connection[];
  now: string;
  preferences: Preferences;
  onOpen: (id: string) => void;
  onRefresh: (id: string) => void;
  onConnection: (connectionId: string) => void;
  onMoveOrder?: (id: string, direction: -1 | 1) => void;
  onCardKeyNav?: (id: string, key: string) => void;
  cardRef?: (el: HTMLElement | null) => void;
  draggable?: boolean;
}

function summarizeAccountMetric(
  sub: Subscription,
  now: string,
  quotaView: 'remaining' | 'used'
): string {
  const firstMetric = sub.metrics[0];
  if (!firstMetric) {
    if (sub.price.availability === 'known' && sub.price.value !== null) {
      return `${money(sub.price.value, sub.currency)} / ${cycleLabel(sub.cycle, sub.intervalDays)}`;
    }
    return '手动记录';
  }
  if (firstMetric.remaining.availability === 'unlimited') {
    return `${firstMetric.label} 无限量`;
  }
  if (
    firstMetric.remaining.availability !== 'known' ||
    firstMetric.remaining.value === null
  ) {
    return `${firstMetric.label}：${fieldText(firstMetric.remaining)}`;
  }
  const freshState = freshness(firstMetric, now);
  if (freshState === 'past_reset') {
    return `${firstMetric.label}：预计已重置，尚待核实`;
  }
  if (firstMetric.unit === '%') {
    const rem = Math.max(0, Math.min(100, Number(firstMetric.remaining.value)));
    const val = quotaView === 'used' ? 100 - rem : rem;
    return `${firstMetric.label} ${quotaView === 'used' ? '已用' : '剩余'} ${val}%${freshState === 'stale' ? ` · 已过时（${formatRelativeTime(firstMetric.remaining.observedAt, now)}）` : ''}`;
  }
  return `${firstMetric.label} ${money(firstMetric.remaining.value, firstMetric.unit)}${freshState === 'stale' ? ` · 已过时（${formatRelativeTime(firstMetric.remaining.observedAt, now)}）` : ''}`;
}

export function SubscriptionCard({
  subscription,
  accounts,
  allSubscriptions,
  connections,
  now,
  preferences,
  onOpen,
  onRefresh,
  onConnection,
  onMoveOrder,
  onCardKeyNav,
  cardRef,
  draggable = false,
}: SubscriptionCardProps) {
  const accountList =
    accounts && accounts.length > 0 ? accounts : [subscription];
  const isMultiAccount = accountList.length > 1;
  const secondaryAccounts = isMultiAccount ? accountList.slice(1) : [];

  // By default only the 1st account is fully expanded; secondary accounts keep summary + individual/batch expand
  const [expandedSecondaryIds, setExpandedSecondaryIds] = useState<
    Record<string, boolean>
  >({});
  const [expandedWalletIds, setExpandedWalletIds] = useState<
    Record<string, boolean>
  >({});

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: subscription.id,
    disabled: !draggable,
    transition: getSortableTransition(preferences.reducedMotion),
  });

  const reducedMotion = isReducedMotionActive(preferences.reducedMotion);
  const motionTransition = getMotionTransition('normal', preferences.reducedMotion);

  // Only dnd-kit controls transform on outer <article>; Motion is strictly scoped to inner collapsible panels
  const dndStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? 'none' : transition,
  };

  const primaryConn = subscription.connectionId
    ? connections.find((c) => c.id === subscription.connectionId) || null
    : null;
  const connMeta = primaryConn ? connectionStateMeta(primaryConn.state) : null;
  const lifeMeta = lifecycleMeta(
    subscription.lifecycle,
    subscription.autoRenew
  );

  const collapsedSecondaryCount = secondaryAccounts.filter(
    (acc) => !expandedSecondaryIds[acc.id]
  ).length;
  const allSecondaryExpanded =
    secondaryAccounts.length > 0 && collapsedSecondaryCount === 0;

  const toggleSingleSecondary = (id: string) => {
    setExpandedSecondaryIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const toggleAllSecondary = () => {
    const nextState = !allSecondaryExpanded;
    const nextMap: Record<string, boolean> = {};
    for (const acc of secondaryAccounts) {
      nextMap[acc.id] = nextState;
    }
    setExpandedSecondaryIds(nextMap);
  };

  const renderFullAccountSection = (
    sub: Subscription,
    index: number,
    options?: { hideSubtitleRow?: boolean }
  ) => {
    const conn = sub.connectionId
      ? connections.find((c) => c.id === sub.connectionId) || null
      : null;
    const low = isLow(sub, now, preferences);
    const hasProposed =
      sub.renewalDate.proposed !== undefined ||
      sub.price.proposed !== undefined ||
      sub.plan.proposed !== undefined;

    const today = dateInZone(now, sub.timezone);
    const renewalDays = sub.renewalDate.value
      ? daysBetween(today, sub.renewalDate.value)
      : null;
    const isPastDue =
      renewalDays !== null &&
      renewalDays <= 0 &&
      sub.autoRenew !== 'off' &&
      !['ending', 'cancelled', 'expired', 'archived'].includes(sub.lifecycle);
    const isSoon =
      renewalDays !== null &&
      renewalDays > 0 &&
      renewalDays <= 7 &&
      sub.autoRenew !== 'off' &&
      !['ending', 'cancelled', 'expired', 'archived'].includes(sub.lifecycle);

    const priceDisplay =
      sub.kind === 'wallet' && sub.cycle === 'none'
        ? '按量预付'
        : sub.price.availability === 'known' && sub.price.value !== null
          ? `${money(sub.price.value, sub.currency)} / ${cycleLabel(sub.cycle, sub.intervalDays)}`
          : '价格待补充';

    // Wallet primary & breakdown metrics
    const primaryWalletMetric = sub.kind === 'wallet' ? sub.metrics[0] : null;
    const breakdownMetrics =
      sub.kind === 'wallet' ? sub.metrics.slice(1) : [];
    const showBreakdown = expandedWalletIds[sub.id] ?? false;

    // For manual subscriptions, do not render meaningless "unsupported" quota placeholder boxes
    const meaningfulManualMetrics =
      sub.kind === 'manual'
        ? sub.metrics.filter(
            (m) =>
              m.remaining.availability !== 'unsupported' ||
              m.remaining.value !== null
          )
        : sub.metrics;

    const firstMetric = meaningfulManualMetrics[0];
    // A source and its timestamp must refer to the same field. In particular,
    // an unfetched short window must not borrow the known weekly observation.
    const metricObservedAt = firstMetric?.remaining.observedAt ?? null;
    // Card footer keeps only the freshest observation time; per-field sources
    // and full history stay in the detail drawer's 来源与历史 group.
    const latestObserved =
      [sub.renewalDate.observedAt, metricObservedAt]
        .filter((t): t is string => Boolean(t))
        .sort()
        .reverse()[0] ?? null;
    const freshnessFooter = latestObserved
      ? `${formatRelativeTime(latestObserved, now)} 更新${
          sub.renewalDate.locked ? ' · 已锁定' : ''
        }`
      : sub.renewalDate.locked
        ? '已锁定'
        : null;

    return (
      <div
        key={sub.id}
        className={`card-account-partition ${
          isMultiAccount ? 'multi-partition' : ''
        } ${index > 0 && !options?.hideSubtitleRow ? 'partition-divider' : ''}`}
      >
        {/* 2. Account & Plan Subtitle Row */}
        {!options?.hideSubtitleRow ? (
          <div className="card-subtitle-row">
            <div className="card-account-meta">
              <span className="card-account-name">{sub.account}</span>
              {sub.region && sub.region !== '未指定' ? (
                <span>· {sub.region}</span>
              ) : null}
              {sub.plan.value ? <span>· {fieldText(sub.plan)}</span> : null}
            </div>
            {isMultiAccount ? (
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => onOpen(sub.id)}
              >
                核对账号
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* 3. Core Metrics / Balance / Manual Hero */}
        <div className="card-metrics-area">
          {sub.kind === 'wallet' ? (
            <div className="wallet-metrics-block">
              {primaryWalletMetric ? (
                <QuotaMeter
                  metric={primaryWalletMetric}
                  now={now}
                  view={preferences.quotaView}
                />
              ) : (
                <div className="quota-meter quota-unavailable">
                  <div className="quota-header">
                    <span className="quota-label">可用余额</span>
                    <span className="quota-value unavailable-text">
                      尚未获取
                    </span>
                  </div>
                </div>
              )}
              {breakdownMetrics.length > 0 ? (
                <div className="wallet-breakdown-row">
                  {showBreakdown ? (
                    <div className="wallet-breakdown-items">
                      {breakdownMetrics.map((bm) => (
                        <span
                          key={bm.id}
                          className="wallet-breakdown-item tabular"
                        >
                          {bm.label}：
                          <strong>
                            {bm.remaining.availability === 'known' &&
                            bm.remaining.value !== null
                              ? money(bm.remaining.value, bm.unit)
                              : fieldText(bm.remaining)}
                          </strong>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedWalletIds((prev) => ({
                        ...prev,
                        [sub.id]: !showBreakdown,
                      }));
                    }}
                  >
                    {showBreakdown
                      ? '收起分项'
                      : `分项 (${breakdownMetrics.length})`}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : sub.kind === 'manual' ? (
            <div className="manual-focus-block">
              <div
                className={`manual-renewal-hero ${
                  isPastDue ? 'past-due' : isSoon ? 'soon' : ''
                }`}
              >
                <div className="manual-hero-top">
                  <strong className="manual-hero-price tabular">
                    {priceDisplay}
                  </strong>
                </div>
                <div className="manual-hero-date tabular">
                  {renewalText(sub, now)}
                </div>
              </div>
              {meaningfulManualMetrics.length > 0
                ? meaningfulManualMetrics.map((m) => (
                    <QuotaMeter
                      key={m.id}
                      metric={m}
                      now={now}
                      view={preferences.quotaView}
                    />
                  ))
                : null}
            </div>
          ) : (
            <div className="window-metrics-block">
              {sub.metrics.length > 0 ? (
                sub.metrics.map((m) => (
                  <QuotaMeter
                    key={m.id}
                    metric={m}
                    now={now}
                    view={preferences.quotaView}
                  />
                ))
              ) : (
                <div className="quota-meter quota-unavailable">
                  <div className="quota-header">
                    <span className="quota-label">额度</span>
                    <span className="quota-value unavailable-text">
                      尚未获取
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. Dedicated Renewal / Expiry Row (Separated from Quota Reset) */}
        {sub.kind !== 'manual' ? (
          <div
            className={`card-renewal-row ${
              isPastDue
                ? 'renewal-past-due'
                : isSoon
                  ? 'renewal-soon'
                  : ''
            }`}
          >
            <div className="renewal-main-line">
              <span className="renewal-date-text tabular">
                {renewalText(sub, now)}
              </span>
              <span className="renewal-price-text tabular">{priceDisplay}</span>
            </div>
          </div>
        ) : null}

        {/* Local exception indicators only; shared billing / quota pool relations live in the detail drawer */}
        {(sub.possibleSharedWallet || hasProposed || low) && (
          <div className="card-relation-row">
            {sub.possibleSharedWallet ? (
              <StatusBadge
                tone="warning"
                title="疑似与其他 Key 共享同一账户余额，汇总时不重复加总；详见抽屉"
              >
                疑似共享余额
              </StatusBadge>
            ) : null}
            {hasProposed ? (
              <StatusBadge
                tone="warning"
                title="手动锁定值与模拟探测值不一致，请在详情中保留或采纳"
              >
                待核对
              </StatusBadge>
            ) : null}
            {low ? (
              <StatusBadge tone="danger">余额偏低</StatusBadge>
            ) : null}
          </div>
        )}

        {conn && conn.error ? (
          <div className="card-conn-error-banner">
            <span>{conn.error.message}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onConnection(conn.id);
              }}
            >
              {conn.error.action || '处理模拟连接'}
            </Button>
          </div>
        ) : null}

        {/* 5. Single faint freshness line; per-field provenance lives in the drawer */}
        {freshnessFooter ? (
          <div className="card-provenance-footer">
            <span>{freshnessFooter}</span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderSecondaryAccount = (sub: Subscription, idx: number) => {
    const isExpanded = Boolean(expandedSecondaryIds[sub.id]);
    const summaryMetric = summarizeAccountMetric(
      sub,
      now,
      preferences.quotaView
    );
    const summaryDate = renewalText(sub, now);
    const accountConnection = connections.find((connection) => connection.id === sub.connectionId);
    const accountState = accountConnection && accountConnection.state !== 'ready' ? connectionStateMeta(accountConnection.state) : null;

    return (
      <div key={sub.id} className="secondary-account-slot">
        <div className="account-compact-summary">
          <div className="account-summary-main">
            <span className="card-account-name">{sub.account}</span>
            {accountState ? <StatusBadge tone={accountState.tone}>{accountState.label}</StatusBadge> : null}
            {!isExpanded ? (
              <>
                <span className="account-summary-metric">{summaryMetric}</span>
                <span className="account-summary-date">· {summaryDate}</span>
              </>
            ) : (
              <>
                {sub.region && sub.region !== '未指定' ? (
                  <span className="account-summary-date">· {sub.region}</span>
                ) : null}
                {sub.plan.value ? (
                  <span className="account-summary-date">
                    · {fieldText(sub.plan)}
                  </span>
                ) : null}
              </>
            )}
          </div>
          <div className="row">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? '收起' : '展开'} ${sub.account} 详情`}
              onClick={() => toggleSingleSecondary(sub.id)}
            >
              {isExpanded ? (
                <>
                  收起 <ChevronUp {...LUCIDE_ICON_SM} />
                </>
              ) : (
                <>
                  展开 <ChevronDown {...LUCIDE_ICON_SM} />
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => onOpen(sub.id)}
            >
              核对账号
            </Button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isExpanded ? (
            <motion.div
              key={`${sub.id}-expanded`}
              initial={reducedMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
              transition={motionTransition}
              style={{ overflow: 'hidden' }}
            >
              <div className="pt-2">
                {renderFullAccountSection(sub, idx + 1, {
                  hideSubtitleRow: true,
                })}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <article
      ref={setNodeRef}
      style={dndStyle}
      className={`sub-card ${subscription.pinned ? 'is-pinned' : ''} ${
        isMultiAccount ? 'is-multi-account' : ''
      } ${isDragging ? 'is-dragging' : ''}`}
      data-card-id={subscription.id}
      data-sort-over={isOver}
    >
      {/* 1. Card Top Header (Brand & Product + Card-Scoped Demo Badge + Actions) */}
      <div className="sub-card-header">
        <div className="sub-card-header-left">
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="card-drag-handle"
            aria-label={`排序 ${subscription.product}`}
            title={
              draggable
                ? `拖拽或按空格键排序 ${subscription.product}`
                : '切换到「固定/自定义顺序」后可拖拽排序'
            }
            disabled={!draggable}
            {...attributes}
            {...listeners}
          >
            <GripVertical {...LUCIDE_ICON_SM} />
          </button>

          <button
            ref={cardRef as React.Ref<HTMLButtonElement>}
            type="button"
            className="sub-card-title-btn"
            onClick={() => onOpen(subscription.id)}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                onMoveOrder?.(subscription.id, e.key === 'ArrowLeft' ? -1 : 1);
                return;
              }
              if (
                ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                  e.key
                )
              ) {
                e.preventDefault();
                onCardKeyNav?.(subscription.id, e.key);
              }
            }}
            aria-label={`查看 ${subscription.product} 详情${
              isMultiAccount ? `（共 ${accountList.length} 个账号）` : ''
            }`}
            title={`${subscription.brand} · ${subscription.product}`}
          >
            <BrandIcon
              product={subscription.product}
              brand={subscription.brand}
              size={20}
            />
            <span className="sub-card-product">{subscription.product}</span>
            {subscription.pinned ? (
              <span
                className="pin-indicator"
                title="已置顶到概览与系统托盘摘要"
              >
                <Pin {...LUCIDE_ICON_SM} />
              </span>
            ) : null}
          </button>
        </div>

        <div className="sub-card-actions">
          {primaryConn && connMeta?.needsRecovery ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              title="前往模拟连接恢复"
              onClick={() => onConnection(primaryConn.id)}
            >
              恢复连接
            </Button>
          ) : subscription.connectionId ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="card-hover-reveal"
              title="模拟刷新此卡片额度（不覆盖锁定续费日）"
              disabled={primaryConn?.state === 'refreshing'}
              onClick={() => onRefresh(subscription.id)}
              aria-label={`模拟刷新 ${subscription.product}`}
            >
              <RefreshCw {...LUCIDE_ICON_SM} />
              {primaryConn?.state === 'refreshing' ? '刷新中…' : '模拟'}
            </Button>
          ) : null}

        </div>
      </div>

      {connMeta && primaryConn?.state !== 'ready' ? <div className="card-status-row"><StatusBadge tone={connMeta.tone}>{connMeta.label}</StatusBadge></div> : lifeMeta.tone !== 'success' ? <div className="card-status-row"><StatusBadge tone={lifeMeta.tone}>{lifeMeta.label}</StatusBadge></div> : null}

      {/* Account Partitions: 1st account always expanded; secondary accounts keep compact summary + expandable detail */}
      <div className="sub-card-body">
        {renderFullAccountSection(accountList[0], 0)}
        {secondaryAccounts.map((accSub, idx) =>
          renderSecondaryAccount(accSub, idx)
        )}
      </div>

      {/* Multi-Account Batch Expand / Collapse Footer */}
      {isMultiAccount ? (
        <div className="sub-card-multi-footer">
          <span className="muted">共 {accountList.length} 个账号</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="multi-expand-btn"
            aria-expanded={allSecondaryExpanded}
            onClick={toggleAllSecondary}
          >
            {allSecondaryExpanded ? (
              <>
                收起其余账号详情（共 {accountList.length} 个）
                <ChevronUp {...LUCIDE_ICON_SM} />
              </>
            ) : (
              <>
                展开其余 {collapsedSecondaryCount} 个同产品账号
                <ChevronDown {...LUCIDE_ICON_SM} />
              </>
            )}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
