import React, { useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { PageProps } from '../contracts';
import type { Subscription } from '../../shared/types';
import {
  dateInZone,
  daysBetween,
  isLow,
  money,
  monthlySummary,
  upcomingSummary,
} from '../../shared/rules';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { StatusBadge } from '../components/ui';
import { Button } from '../components/ui/button';
import { FormSelect } from '../components/form-controls';
import { LUCIDE_ICON_SM } from '../lib/utils';
import { DND_POINTER_ACTIVATION_CONSTRAINT } from '../lib/motion';
import './overview.css';

type FilterKind = 'all' | 'upcoming' | 'low' | 'attention' | 'manual';
type SortKind = 'custom' | 'renewal' | 'brand';

interface ActionItem {
  id: string;
  priority: number;
  tone: 'danger' | 'warning' | 'primary';
  badge: string;
  title: string;
  detail: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

interface CardGroup {
  groupKey: string;
  primary: Subscription;
  accounts: Subscription[];
}

function buildCardGroups(subscriptions: Subscription[]): CardGroup[] {
  const groups: CardGroup[] = [];
  const byKey = new Map<string, CardGroup>();

  for (const sub of subscriptions) {
    const groupKey = `${sub.brand}::${sub.product}::${sub.kind}`;
    const existing = byKey.get(groupKey);
    if (existing) {
      existing.accounts.push(sub);
    } else {
      const entry: CardGroup = { groupKey, primary: sub, accounts: [sub] };
      byKey.set(groupKey, entry);
      groups.push(entry);
    }
  }
  return groups;
}

export function OverviewPage({
  snapshot,
  client,
  notify,
  onOpen,
  onCreate,
  onConnection,
}: PageProps) {
  const [filter, setFilter] = useState<FilterKind>('all');
  const [sort, setSort] = useState<SortKind>('custom');
  const [showAllActions, setShowAllActions] = useState(false);
  const [expandedActionIds, setExpandedActionIds] = useState<
    Record<string, boolean>
  >({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: DND_POINTER_ACTIVATION_CONSTRAINT,
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: 'auto',
    })
  );

  const activeSubscriptions = useMemo(
    () => snapshot.subscriptions.filter((s) => s.lifecycle !== 'archived'),
    [snapshot.subscriptions]
  );

  // Custom-ordered active subscriptions respecting snapshot.preferences.order
  const customOrderedSubscriptions = useMemo(() => {
    const orderMap = new Map<string, number>();
    snapshot.preferences.order.forEach((id, idx) => orderMap.set(id, idx));

    const list = [...activeSubscriptions];
    list.sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });
    return list;
  }, [activeSubscriptions, snapshot.preferences.order]);

  // Ordered subscriptions according to selected sort mode
  const orderedSubscriptions = useMemo(() => {
    if (sort === 'custom') {
      return customOrderedSubscriptions;
    }
    const list = [...activeSubscriptions];
    if (sort === 'renewal') {
      list.sort((a, b) => {
        const da =
          a.renewalDate.value ||
          a.paidThrough.value ||
          a.trialEnd.value ||
          '9999-12-31';
        const db =
          b.renewalDate.value ||
          b.paidThrough.value ||
          b.trialEnd.value ||
          '9999-12-31';
        return da.localeCompare(db) || a.product.localeCompare(b.product);
      });
    } else if (sort === 'brand') {
      list.sort(
        (a, b) =>
          a.brand.localeCompare(b.brand, 'zh-CN') ||
          a.product.localeCompare(b.product, 'zh-CN')
      );
    }
    return list;
  }, [activeSubscriptions, customOrderedSubscriptions, sort]);

  // Action items computation following exact Spec Section 2.2 priority
  const actionItems = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [];
    const seenSubAction = new Set<string>();

    for (const s of activeSubscriptions) {
      const today = dateInZone(snapshot.now, s.timezone);
      const rDays = s.renewalDate.value
        ? daysBetween(today, s.renewalDate.value)
        : null;
      const pDays = s.paidThrough.value
        ? daysBetween(today, s.paidThrough.value)
        : null;
      const tDays = s.trialEnd.value
        ? daysBetween(today, s.trialEnd.value)
        : null;

      // Priority 1: 已到计划日待确认
      if (
        rDays !== null &&
        rDays <= 0 &&
        s.autoRenew !== 'off' &&
        !['ending', 'cancelled', 'expired'].includes(s.lifecycle)
      ) {
        items.push({
          id: `pastdue-${s.id}`,
          priority: 1,
          tone: 'danger',
          badge: '待人工确认',
          title: `${s.product} · 已到计划续费日 (${s.renewalDate.value})`,
          detail:
            '系统不自动跨期顺延，请核对官网扣款情况后确认顺延或标记停订。',
          primaryLabel: '打开详情核对',
          onPrimary: () => onOpen(s.id),
        });
        seenSubAction.add(s.id);
        continue;
      }

      // Priority 2: 今明两天续费
      if (
        rDays !== null &&
        rDays >= 1 &&
        rDays <= 2 &&
        s.autoRenew !== 'off' &&
        !['ending', 'cancelled', 'expired'].includes(s.lifecycle)
      ) {
        items.push({
          id: `soon2-${s.id}`,
          priority: 2,
          tone: 'warning',
          badge: `${rDays} 天后续费`,
          title: `${s.product} · ${s.renewalDate.value} 计划续费`,
          detail: `${
            s.price.value ? money(s.price.value, s.currency) : '金额待补充'
          } · 来源：${s.renewalDate.source}`,
          primaryLabel: '查看/处理续费',
          onPrimary: () => onOpen(s.id),
        });
        seenSubAction.add(s.id);
        continue;
      }

      // Priority 3: 其他七日内续费/到期
      if (
        rDays !== null &&
        rDays >= 3 &&
        rDays <= 7 &&
        s.autoRenew !== 'off' &&
        !['ending', 'cancelled', 'expired'].includes(s.lifecycle)
      ) {
        items.push({
          id: `soon7-${s.id}`,
          priority: 3,
          tone: 'warning',
          badge: `${rDays} 天后续费`,
          title: `${s.product} · ${s.renewalDate.value} 计划续费`,
          detail: `${
            s.price.value ? money(s.price.value, s.currency) : '金额待补充'
          } · 7 日内近期提醒`,
          primaryLabel: '核对详情',
          onPrimary: () => onOpen(s.id),
        });
        seenSubAction.add(s.id);
      } else if (pDays !== null && pDays >= 0 && pDays <= 7) {
        items.push({
          id: `expiry7-${s.id}`,
          priority: 3,
          tone: 'warning',
          badge: pDays === 0 ? '今天到期' : `${pDays} 天后到期`,
          title: `${s.product} · ${s.paidThrough.value} 到期停止`,
          detail: '已关闭自动续费，将在已付有效期结束后停用。',
          primaryLabel: '查看详情',
          onPrimary: () => onOpen(s.id),
        });
        seenSubAction.add(s.id);
      } else if (tDays !== null && tDays >= 0 && tDays <= 7) {
        items.push({
          id: `trial7-${s.id}`,
          priority: 3,
          tone: 'warning',
          badge: `${tDays} 天后试用结束`,
          title: `${s.product} · ${s.trialEnd.value} 试用期结束`,
          detail: '请及时决定是否继续订阅或取消试用。',
          primaryLabel: '查看详情',
          onPrimary: () => onOpen(s.id),
        });
        seenSubAction.add(s.id);
      }

      // Priority 4: 有效数据触发的低额度 (stale data automatically excluded by isLow)
      if (isLow(s, snapshot.now, snapshot.preferences)) {
        const lowMetric = s.metrics.find((m) => m.remaining.value !== null);
        items.push({
          id: `low-${s.id}`,
          priority: 4,
          tone: 'danger',
          badge: '低额度提醒',
          title: `${s.product} (${s.account}) · 剩余额度/余额偏低`,
          detail: lowMetric
            ? `${lowMetric.label} 当前剩余 ${
                lowMetric.unit === '%'
                  ? `${lowMetric.remaining.value}%`
                  : money(lowMetric.remaining.value, lowMetric.unit)
              }（有效新鲜数据触发）`
            : '低于设定阈值',
          primaryLabel: '查看额度详情',
          onPrimary: () => onOpen(s.id),
        });
      }

      // Priority 5a: 人工锁定字段与模拟探测差异
      if (
        s.renewalDate.proposed !== undefined ||
        s.price.proposed !== undefined ||
        s.plan.proposed !== undefined
      ) {
        items.push({
          id: `proposed-${s.id}`,
          priority: 5,
          tone: 'warning',
          badge: '锁定字段待裁决',
          title: `${s.product} · 手动锁定值与模拟探测值不一致`,
          detail: `当前锁定 ${s.renewalDate.value ?? ''}，模拟探测新值为 ${
            s.renewalDate.proposed ?? s.price.proposed ?? s.plan.proposed
          }（未静默覆盖）`,
          primaryLabel: '保留或采纳',
          onPrimary: () => onOpen(s.id),
        });
      }
    }

    // Priority 5b: 需恢复的连接
    for (const c of snapshot.connections) {
      if (
        [
          'auth',
          'denied',
          'runtime_missing',
          'schema_changed',
          'rate_limited',
          'partial',
        ].includes(c.state)
      ) {
        items.push({
          id: `conn-${c.id}`,
          priority: 5,
          tone:
            c.state === 'rate_limited' || c.state === 'partial'
              ? 'warning'
              : 'danger',
          badge: '模拟连接需处理',
          title: `${c.provider} · ${c.error?.code || c.state}`,
          detail:
            c.error?.message || '模拟连接异常，旧观察数据已保留未清零。',
          primaryLabel: c.error?.action || '前往连接恢复',
          onPrimary: () => onConnection(c.id),
        });
      }
    }

    // Priority 5c: 日历目标冲突或异常
    for (const t of snapshot.targets) {
      const hasConflict = t.remote.some(
        (r) => r.managed && !r.deleted && r.date !== r.baselineDate
      );
      if (
        hasConflict ||
        t.state === 'readonly' ||
        t.state === 'missing' ||
        t.state === 'auth'
      ) {
        items.push({
          id: `target-${t.id}`,
          priority: 5,
          tone: 'warning',
          badge: '模拟日历待核对',
          title: `${t.name} · ${hasConflict ? '存在外部改期冲突' : t.message}`,
          detail: '可在「日历」页执行同步预演或冲突三选一裁决。',
          primaryLabel: '查看详情',
          onPrimary: () => {
            const firstSub = activeSubscriptions[0];
            if (firstSub) onOpen(firstSub.id);
          },
        });
      }
    }

    // Priority 6: 日期待补充
    for (const s of activeSubscriptions) {
      if (
        s.kind !== 'wallet' &&
        s.cycle !== 'none' &&
        !s.renewalDate.value &&
        !s.paidThrough.value &&
        !s.trialEnd.value &&
        !seenSubAction.has(s.id)
      ) {
        items.push({
          id: `missing-date-${s.id}`,
          priority: 6,
          tone: 'primary',
          badge: '日期待补充',
          title: `${s.product} · 尚未填写下次续费或到期日`,
          detail:
            '系统不会按创建日期假定扣费日，请补充已知账单日期。',
          primaryLabel: '补充日期',
          onPrimary: () => onOpen(s.id),
        });
      }
    }

    return items.sort((a, b) => a.priority - b.priority);
  }, [
    activeSubscriptions,
    snapshot.connections,
    snapshot.now,
    snapshot.preferences,
    snapshot.targets,
    onConnection,
    onOpen,
  ]);

  // Filter predicates
  const matchesFilter = (s: Subscription, f: FilterKind): boolean => {
    if (f === 'all') return true;
    const today = dateInZone(snapshot.now, s.timezone);
    const rDays = s.renewalDate.value
      ? daysBetween(today, s.renewalDate.value)
      : null;
    const pDays = s.paidThrough.value
      ? daysBetween(today, s.paidThrough.value)
      : null;
    const tDays = s.trialEnd.value
      ? daysBetween(today, s.trialEnd.value)
      : null;

    if (f === 'upcoming') {
      return (
        (rDays !== null && rDays <= 7 && s.autoRenew !== 'off') ||
        (pDays !== null && pDays >= 0 && pDays <= 7) ||
        (tDays !== null && tDays >= 0 && tDays <= 7)
      );
    }
    if (f === 'low') {
      return isLow(s, snapshot.now, snapshot.preferences);
    }
    if (f === 'manual') {
      return s.kind === 'manual' || !s.connectionId;
    }
    if (f === 'attention') {
      const conn = s.connectionId
        ? snapshot.connections.find((c) => c.id === s.connectionId)
        : null;
      const connIssue =
        conn &&
        [
          'auth',
          'denied',
          'runtime_missing',
          'schema_changed',
          'rate_limited',
          'partial',
        ].includes(conn.state);
      const hasProposed =
        s.renewalDate.proposed !== undefined ||
        s.price.proposed !== undefined ||
        s.plan.proposed !== undefined;
      const missingDate =
        s.kind !== 'wallet' &&
        s.cycle !== 'none' &&
        !s.renewalDate.value &&
        !s.paidThrough.value &&
        !s.trialEnd.value;
      const pastDue = rDays !== null && rDays <= 0 && s.autoRenew !== 'off';
      return Boolean(
        connIssue ||
          hasProposed ||
          missingDate ||
          pastDue ||
          isLow(s, snapshot.now, snapshot.preferences)
      );
    }
    return true;
  };

  const filterCounts = useMemo(
    () => ({
      all: activeSubscriptions.length,
      upcoming: activeSubscriptions.filter((s) => matchesFilter(s, 'upcoming'))
        .length,
      low: activeSubscriptions.filter((s) => matchesFilter(s, 'low')).length,
      attention: activeSubscriptions.filter((s) =>
        matchesFilter(s, 'attention')
      ).length,
      manual: activeSubscriptions.filter((s) => matchesFilter(s, 'manual'))
        .length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeSubscriptions,
      snapshot.now,
      snapshot.preferences,
      snapshot.connections,
    ]
  );

  const filteredSubscriptions = useMemo(
    () => orderedSubscriptions.filter((s) => matchesFilter(s, filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      orderedSubscriptions,
      filter,
      snapshot.now,
      snapshot.preferences,
      snapshot.connections,
    ]
  );

  // Full custom-ordered groups (all active subscriptions) & currently visible groups
  const allCustomGroups = useMemo(
    () => buildCardGroups(customOrderedSubscriptions),
    [customOrderedSubscriptions]
  );

  const groupedCards = useMemo(
    () => buildCardGroups(filteredSubscriptions),
    [filteredSubscriptions]
  );

  const monthly = useMemo(
    () => monthlySummary(activeSubscriptions),
    [activeSubscriptions]
  );
  const upcoming = useMemo(
    () => upcomingSummary(activeSubscriptions, snapshot.now),
    [activeSubscriptions, snapshot.now]
  );
  const hasSharedWalletWarning = useMemo(
    () => activeSubscriptions.some((s) => s.possibleSharedWallet),
    [activeSubscriptions]
  );

  /**
   * Moves an entire product card group (including all its accounts) while preserving
   * filtered-out groups and archived subscription IDs in `preferences.order`.
   */
  const persistGroupOrder = (
    fromPrimaryId: string,
    toPrimaryId: string,
    restoreFocusId?: string
  ) => {
    if (fromPrimaryId === toPrimaryId) return;
    const allFromIdx = allCustomGroups.findIndex(
      (g) => g.accounts.some((account) => account.id === fromPrimaryId)
    );
    const allToIdx = allCustomGroups.findIndex(
      (g) => g.accounts.some((account) => account.id === toPrimaryId)
    );
    if (allFromIdx < 0 || allToIdx < 0 || allFromIdx === allToIdx) return;

    const reorderedGroups = arrayMove(allCustomGroups, allFromIdx, allToIdx);
    const activeOrderedIds = reorderedGroups.flatMap((g) =>
      g.accounts.map((a) => a.id)
    );
    const activeIdSet = new Set(activeOrderedIds);

    // Preserve archived or non-active IDs in their existing relative order
    const archivedIds = snapshot.subscriptions
      .filter((s) => !activeIdSet.has(s.id))
      .map((s) => s.id);
    const preservedArchivedOrder = [
      ...snapshot.preferences.order.filter(
        (id) => !activeIdSet.has(id) && archivedIds.includes(id)
      ),
      ...archivedIds.filter((id) => !snapshot.preferences.order.includes(id)),
    ];

    const nextOrder = [...activeOrderedIds, ...preservedArchivedOrder];
    void client.reorder(nextOrder).then(() => {
      if (sort !== 'custom') setSort('custom');
      if (restoreFocusId) {
        requestAnimationFrame(() => {
          cardRefs.current[restoreFocusId]?.focus();
        });
      }
    }).catch((error) => notify((error as Error).message));
  };

  const moveOrder = (id: string, direction: -1 | 1) => {
    const visibleIds = groupedCards.map((g) => g.primary.id);
    const idx = visibleIds.indexOf(id);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= visibleIds.length) return;
    persistGroupOrder(id, visibleIds[targetIdx], id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (sort !== 'custom') return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    persistGroupOrder(String(active.id), String(over.id));
  };

  const handleCardKeyNav = (currentId: string, key: string) => {
    const cardIds = groupedCards.map((g) => g.primary.id);
    const idx = cardIds.indexOf(currentId);
    if (idx < 0) return;
    let nextIdx = idx;
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      nextIdx = Math.min(cardIds.length - 1, idx + 1);
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      nextIdx = Math.max(0, idx - 1);
    }
    if (nextIdx !== idx) {
      cardRefs.current[cardIds[nextIdx]]?.focus();
    }
  };

  const toggleActionDetail = (id: string) => {
    setExpandedActionIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const visibleActions = showAllActions
    ? actionItems
    : actionItems.slice(0, 3);
  const sortableCardIds = useMemo(
    () => groupedCards.map((g) => g.primary.id),
    [groupedCards]
  );

  return (
    <div className="overview-page">
      {/* 1. 首屏近期事项区 (最多 3 条紧凑行，说明按需展开) */}
      <section className="action-zone" aria-label="近期需处理事项">
        {actionItems.length > 0 ? (
          <>
            <div className="action-zone-header">
              <div className="row">
                <span className="action-zone-title">
                  近期需核对与处理 ({actionItems.length})
                </span>
              </div>
              {actionItems.length > 3 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowAllActions((prev) => !prev)}
                >
                  {showAllActions ? (
                    <>
                      收起其余项 <ChevronUp {...LUCIDE_ICON_SM} />
                    </>
                  ) : (
                    <>
                      查看全部 ({actionItems.length}){' '}
                      <ChevronDown {...LUCIDE_ICON_SM} />
                    </>
                  )}
                </Button>
              ) : null}
            </div>

            <div className="action-rows-list">
              {visibleActions.map((item) => {
                const detailOpen = Boolean(expandedActionIds[item.id]);
                return (
                  <div
                    key={item.id}
                    className={`action-row-item tone-${item.tone}`}
                  >
                    <div className="action-row-main">
                      <div className="action-row-left">
                        <StatusBadge tone={item.tone}>{item.badge}</StatusBadge>
                        <span className="action-row-title">{item.title}</span>
                      </div>

                      <div className="action-row-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-expanded={detailOpen}
                          onClick={() => toggleActionDetail(item.id)}
                        >
                          {detailOpen ? '收起说明' : '说明'}
                        </Button>
                        <Button
                          type="button"
                          variant={
                            item.tone === 'danger' ? 'destructive' : 'outline'
                          }
                          size="xs"
                          onClick={item.onPrimary}
                        >
                          {item.primaryLabel}
                        </Button>
                        {item.secondaryLabel && item.onSecondary ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={item.onSecondary}
                          >
                            {item.secondaryLabel}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {detailOpen ? (
                      <p className="action-row-detail">{item.detail}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="action-zone-calm">
            <span>近期没有需要核对与处理的事项。</span>
          </div>
        )}
      </section>

      {/* 2. 轻量分币种汇总与筛选排序工具栏 */}
      <section
        className="overview-toolbar-panel"
        aria-label="筛选排序与费用汇总"
      >
        {/* Honest Multi-Currency Summary Strip */}
        <div className="honest-summary-strip">
          <div className="summary-metrics-group">
            {monthly.recurring === 0 ? (
              <span className="summary-segment">当前无固定周期订阅。</span>
            ) : (
              <>
                <span className="summary-segment">
                  <span>月均</span>
                  {monthly.totals.length > 0 ? (
                    <span className="summary-value-primary">
                      {monthly.totals
                        .map((t) => money(t.amount, t.currency))
                        .join(' · ')}
                    </span>
                  ) : (
                    <span className="summary-value-secondary">
                      暂无已知金额
                    </span>
                  )}
                </span>

                {monthly.unknown > 0 ? (
                  <StatusBadge
                    tone="warning"
                    title="另有周期订阅未填价格，未计入月均"
                  >
                    {monthly.unknown} 项未填价
                  </StatusBadge>
                ) : null}

                <span className="summary-divider">|</span>

                <span className="summary-segment">
                  <span>30 天内续费</span>
                  {upcoming.totals.length > 0 ? (
                    <span className="summary-value-secondary">
                      {upcoming.totals
                        .map((t) => money(t.amount, t.currency))
                        .join(' · ')}
                    </span>
                  ) : (
                    <span className="summary-value-secondary">无已知扣费</span>
                  )}
                  {upcoming.unknown > 0 ? (
                    <span>· {upcoming.unknown} 项待补充</span>
                  ) : null}
                </span>
              </>
            )}
          </div>

          {hasSharedWalletWarning ? (
            <StatusBadge
              tone="warning"
              title="包含疑似共享同一账户余额的多个 Key，不进行钱包总余额叠加"
            >
              疑似共享余额未叠加
            </StatusBadge>
          ) : null}
        </div>

        {/* Filter & Sort Controls Row */}
        <div className="overview-controls-row">
          <div className="filter-pills" role="group" aria-label="订阅筛选">
            {(
              [
                { id: 'all', label: `全部 (${filterCounts.all})` },
                { id: 'upcoming', label: `近期续费 (${filterCounts.upcoming})` },
                { id: 'low', label: `低额度 (${filterCounts.low})` },
                { id: 'attention', label: `需处理 (${filterCounts.attention})` },
                { id: 'manual', label: `手动记录 (${filterCounts.manual})` },
              ] as const
            ).map((f) => (
              <Button
                key={f.id}
                type="button"
                variant={filter === f.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <div className="overview-right-controls">
            <label className="inline-control">
              <span className="muted">排序</span>
              <FormSelect
                aria-label="排序方式"
                className="overview-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKind)}
              >
                <option value="custom">自定义顺序</option>
                <option value="renewal">按下次续费/到期日</option>
                <option value="brand">按品牌与产品名称</option>
              </FormSelect>
            </label>

            <div
              className="segmented-group"
              role="group"
              aria-label="额度显示方式"
            >
              <Button
                type="button"
                variant={
                  snapshot.preferences.quotaView === 'remaining'
                    ? 'secondary'
                    : 'ghost'
                }
                size="xs"
                aria-pressed={snapshot.preferences.quotaView === 'remaining'}
                onClick={() =>
                  void client.setPreferences({ quotaView: 'remaining' })
                }
              >
                显示剩余
              </Button>
              <Button
                type="button"
                variant={
                  snapshot.preferences.quotaView === 'used'
                    ? 'secondary'
                    : 'ghost'
                }
                size="xs"
                aria-pressed={snapshot.preferences.quotaView === 'used'}
                onClick={() =>
                  void client.setPreferences({ quotaView: 'used' })
                }
              >
                显示已用
              </Button>
            </div>

            <div
              className="segmented-group"
              role="group"
              aria-label="卡片密度"
            >
              <Button
                type="button"
                variant={
                  snapshot.preferences.density === 'comfortable'
                    ? 'secondary'
                    : 'ghost'
                }
                size="xs"
                aria-pressed={snapshot.preferences.density === 'comfortable'}
                onClick={() =>
                  void client.setPreferences({ density: 'comfortable' })
                }
              >
                标准密度
              </Button>
              <Button
                type="button"
                variant={
                  snapshot.preferences.density === 'compact'
                    ? 'secondary'
                    : 'ghost'
                }
                size="xs"
                aria-pressed={snapshot.preferences.density === 'compact'}
                onClick={() =>
                  void client.setPreferences({ density: 'compact' })
                }
              >
                紧凑密度
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 三类品牌订阅卡片网格 (dnd-kit Sortable) */}
      {activeSubscriptions.length === 0 ? (
        <div className="empty onboarding-empty panel stack">
          <h3>先花 1 分钟把正在使用的 AI 订阅或 API 钱包记下来</h3>
          <p className="muted">
            本阶段为前端交互预览（外部服务未连接，无需准备真实 API
            Key）。你可以从内置品牌目录添加订阅，也可以直接载入标准混合演示数据体验完整卡片与日历联动。
          </p>
          <div className="row center-row">
            <Button type="button" variant="default" onClick={onCreate}>
              <Plus {...LUCIDE_ICON_SM} />从品牌目录添加第一项订阅
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void client.preview
                  .switchScenario('normal_mixed')
                  .then(() => notify('已切换到「标准混合」示例场景'))
              }
            >
              载入「标准混合」演示数据集
            </Button>
          </div>
        </div>
      ) : groupedCards.length === 0 ? (
        <div className="empty panel stack">
          <p>当前筛选条件下没有匹配的订阅记录。</p>
          <div className="row center-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilter('all')}
            >
              重置为显示全部 ({activeSubscriptions.length})
            </Button>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          accessibility={{
            screenReaderInstructions: { draggable: '按空格键提起卡片，用方向键调整位置，再按空格键放下；按 Escape 取消排序。' },
            announcements: {
              onDragStart: ({ active }) => `已提起 ${activeSubscriptions.find((item) => item.id === active.id)?.product ?? '订阅卡片'}。`,
              onDragOver: ({ over }) => over ? `将放到 ${activeSubscriptions.find((item) => item.id === over.id)?.product ?? '目标卡片'} 的位置。` : '已移出可排序区域。',
              onDragEnd: () => '已放下卡片。',
              onDragCancel: () => '已取消排序，顺序未更改。',
            },
          }}
        >
          <SortableContext
            items={sortableCardIds}
            strategy={rectSortingStrategy}
          >
            <section
              className={`cards-grid ${
                snapshot.preferences.density === 'compact'
                  ? 'density-compact'
                  : 'density-comfortable'
              }`}
              aria-label="品牌订阅卡片列表"
            >
              {groupedCards.map(({ primary, accounts }) => (
                <SubscriptionCard
                  key={primary.id}
                  subscription={primary}
                  accounts={accounts}
                  allSubscriptions={snapshot.subscriptions}
                  connections={snapshot.connections}
                  now={snapshot.now}
                  preferences={snapshot.preferences}
                  onOpen={onOpen}
                  onRefresh={(id) => {
                    void client
                      .refresh(id)
                      .then((msg) => notify(msg))
                      .catch((e) => notify((e as Error).message));
                  }}
                  onConnection={onConnection}
                  onMoveOrder={moveOrder}
                  onCardKeyNav={handleCardKeyNav}
                  cardRef={(el) => {
                    cardRefs.current[primary.id] = el;
                  }}
                  draggable={sort === 'custom'}
                />
              ))}
            </section>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
