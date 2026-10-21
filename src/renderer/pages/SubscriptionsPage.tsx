import React, { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
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
import type { PageProps } from '../contracts';
import type { Subscription } from '../../shared/types';
import { fieldText, freshness, money, renewalText } from '../../shared/rules';
import { PRODUCT_CATALOG, SubscriptionForm } from '../components/SubscriptionForm';
import { SubscriptionCard } from '../components/SubscriptionCard';
import {
  BrandIcon,
  connectionStateMeta,
  cycleLabel,
  formatRelativeTime,
  lifecycleMeta,
  StatusBadge,
} from '../components/ui';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { FormSelect } from '../components/form-controls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  LayoutGrid,
  List,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import './subscriptions.css';

export interface SubscriptionsPageProps extends PageProps {
  onEdit?: (subscription: Subscription) => void;
  onCreateWithPreset?: (productName: string) => void;
}

type ArchiveFilter = 'active' | 'archived' | 'all';
type KindFilter = 'all' | 'window' | 'wallet' | 'manual';
type TableSort = 'default' | 'product' | 'renewal' | 'price' | 'status';
type ViewMode = 'table' | 'cards';

type CardGroup = { groupKey: string; primary: Subscription; accounts: Subscription[] };

function buildCardGroups(subscriptions: Subscription[]): CardGroup[] {
  const groups: CardGroup[] = [];
  const byKey = new Map<string, CardGroup>();
  for (const sub of subscriptions) {
    const groupKey = `${sub.brand}::${sub.product}::${sub.kind}`;
    const existing = byKey.get(groupKey);
    if (existing) existing.accounts.push(sub);
    else {
      const entry: CardGroup = { groupKey, primary: sub, accounts: [sub] };
      byKey.set(groupKey, entry);
      groups.push(entry);
    }
  }
  for (const group of groups) {
    group.accounts.sort(
      (a, b) => (a.connectionId ?? a.id).localeCompare(b.connectionId ?? b.id) || a.id.localeCompare(b.id),
    );
    group.primary = group.accounts[0];
  }
  return groups;
}

export function SubscriptionsPage({
  snapshot,
  client,
  notify,
  onOpen,
  onCreate,
  onConnection,
  onEdit,
  onCreateWithPreset,
}: SubscriptionsPageProps) {
  const [query, setQuery] = useState('');
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>('active');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sortBy, setSortBy] = useState<TableSort>('default');
  const [view, setView] = useState<ViewMode>('table');
  const [showCatalogBar, setShowCatalogBar] = useState(false);

  // Fallback local modal state if parent doesn't supply onEdit / onCreateWithPreset
  const [localEditing, setLocalEditing] = useState<Subscription | null>(null);
  const [localCreatingPreset, setLocalCreatingPreset] = useState<string | null>(null);

  // Scoped delete / archive confirmation per row (controlled AlertDialog)
  const [pendingAction, setPendingAction] = useState<{
    sub: Subscription;
    kind: 'archive' | 'delete';
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const archived = snapshot.subscriptions.filter((s) => s.lifecycle === 'archived').length;
    const active = snapshot.subscriptions.length - archived;
    return { active, archived, all: snapshot.subscriptions.length };
  }, [snapshot.subscriptions]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = snapshot.subscriptions.filter((s) => {
      if (archiveFilter === 'active' && s.lifecycle === 'archived') return false;
      if (archiveFilter === 'archived' && s.lifecycle !== 'archived') return false;
      if (kindFilter !== 'all' && s.kind !== kindFilter) return false;
      if (q) {
        const hay = [
          s.product,
          s.brand,
          s.account,
          s.plan.value || '',
          s.notes,
          s.billingGroupId || '',
          s.quotaPoolId || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const orderMap = new Map<string, number>();
    snapshot.preferences.order.forEach((id, i) => orderMap.set(id, i));

    list.sort((a, b) => {
      if (sortBy === 'product') {
        return (
          a.product.localeCompare(b.product, 'zh-CN') ||
          a.account.localeCompare(b.account, 'zh-CN')
        );
      }
      if (sortBy === 'renewal') {
        const da = a.renewalDate.value || a.paidThrough.value || a.trialEnd.value || '9999-12-31';
        const db = b.renewalDate.value || b.paidThrough.value || b.trialEnd.value || '9999-12-31';
        return da.localeCompare(db) || a.product.localeCompare(b.product, 'zh-CN');
      }
      if (sortBy === 'price') {
        const pa = a.price.value !== null ? Number(a.price.value) : -1;
        const pb = b.price.value !== null ? Number(b.price.value) : -1;
        return pb - pa;
      }
      if (sortBy === 'status') {
        return a.lifecycle.localeCompare(b.lifecycle);
      }
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });

    return list;
  }, [snapshot.subscriptions, snapshot.preferences.order, archiveFilter, kindFilter, query, sortBy]);

  const groupedCards = useMemo(() => buildCardGroups(filteredRows), [filteredRows]);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Persists whole product-card groups (all accounts) while keeping filtered-out
   * and archived IDs in their prior relative order.
   */
  const persistGroupOrder = (fromPrimaryId: string, toPrimaryId: string) => {
    if (fromPrimaryId === toPrimaryId) return;
    const orderMap = new Map<string, number>();
    snapshot.preferences.order.forEach((id, index) => orderMap.set(id, index));
    const active = snapshot.subscriptions
      .filter((s) => s.lifecycle !== 'archived')
      .sort((a, b) => {
        const ai = orderMap.get(a.id);
        const bi = orderMap.get(b.id);
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return 0;
      });
    const allGroups = buildCardGroups(active);
    const fromIndex = allGroups.findIndex((g) => g.accounts.some((a) => a.id === fromPrimaryId));
    const toIndex = allGroups.findIndex((g) => g.accounts.some((a) => a.id === toPrimaryId));
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const nextGroups = arrayMove(allGroups, fromIndex, toIndex);
    const activeIds = nextGroups.flatMap((g) => g.accounts.map((a) => a.id));
    const activeSet = new Set(activeIds);
    const rest = snapshot.subscriptions.filter((s) => !activeSet.has(s.id)).map((s) => s.id);
    void client.reorder([...activeIds, ...rest])
      .then(() => setSortBy('default'))
      .catch((error) => notify((error as Error).message));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    persistGroupOrder(String(event.active.id), String(event.over.id));
  };

  const moveOrder = (id: string, direction: -1 | 1) => {
    const ids = groupedCards.map((g) => g.primary.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    persistGroupOrder(id, ids[target]);
  };

  const handleCardKeyNav = (currentId: string, key: string) => {
    const ids = groupedCards.map((g) => g.primary.id);
    const index = ids.indexOf(currentId);
    if (index < 0) return;
    let next = index;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = Math.min(ids.length - 1, index + 1);
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = Math.max(0, index - 1);
    if (next !== index) requestAnimationFrame(() => cardRefs.current[ids[next]]?.focus());
  };

  const handleTriggerEdit = (sub: Subscription) => {
    if (onEdit) {
      onEdit(sub);
    } else {
      setLocalEditing(sub);
    }
  };

  const handleTriggerCreatePreset = (productName: string) => {
    if (onCreateWithPreset) {
      onCreateWithPreset(productName);
    } else {
      setLocalCreatingPreset(productName);
    }
  };

  const renderMetricSummary = (sub: Subscription) => {
    if (sub.metrics.length === 0) {
      return <span className="muted">当前读取方式未提供此项</span>;
    }
    const m = sub.metrics[0];
    const fState = freshness(m, snapshot.now);

    if (m.remaining.availability === 'unlimited') {
      return (
        <div className="table-metric-cell">
          <strong className="table-cell-amount">{m.label}：无限量</strong>
          <span className="muted">{m.remaining.source}</span>
        </div>
      );
    }
    if (m.remaining.availability !== 'known' || m.remaining.value === null) {
      return (
        <div className="table-metric-cell">
          <span className="muted">
            {m.label}：{fieldText(m.remaining)}
          </span>
        </div>
      );
    }
    if (fState === 'past_reset') {
      return (
        <div className="table-metric-cell">
          <strong className="warning-text">{m.label}：预计已重置，尚待核实</strong>
          <span className="muted">原记录 {m.remaining.value}%（不自动补 100%）</span>
        </div>
      );
    }

    // Percentages display the recorded value as-is (only bars clamp); non-currency units render as "值 单位"
    const remNum = Number(m.remaining.value);
    const anomalous =
      m.unit === '%' && (!Number.isFinite(remNum) || remNum < 0 || remNum > 100);
    const valDisplay =
      m.unit === '%'
        ? snapshot.preferences.quotaView === 'used'
          ? `已用 ${Number((100 - remNum).toFixed(6))}%${anomalous ? ' · 数据异常' : ''}`
          : `剩余 ${m.remaining.value}%${anomalous ? ' · 数据异常' : ''}`
        : /^[A-Z]{3}$/.test(m.unit)
          ? `${money(m.remaining.value, m.unit)}`
          : `${m.remaining.value} ${m.unit}`;

    return (
      <div className="table-metric-cell tabular">
        <strong className="table-cell-amount">
          {m.label}：{valDisplay}
        </strong>
        <span className="muted">
          {m.remaining.observedAt
            ? formatRelativeTime(m.remaining.observedAt, snapshot.now)
            : '未记录时间'}
          {fState === 'stale' ? ' · 已过时' : ''} · {m.remaining.source}
        </span>
      </div>
    );
  };

  const executePendingScope = async () => {
    if (!pendingAction) return;
    const { sub, kind } = pendingAction;
    setBusyId(sub.id);
    try {
      if (kind === 'archive') {
        const targetArchived = sub.lifecycle !== 'archived';
        await client.archive(sub.id, targetArchived, false);
        setPendingAction(null);
        notify(
          targetArchived
            ? `已归档「${sub.product}」（保留本地日程）`
            : `已恢复「${sub.product}」活跃跟踪`
        );
      } else {
        const productName = sub.product;
        const token = await client.remove(sub.id, false);
        setPendingAction(null);
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
      }
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="subscriptions-page stack">
      {/* Top Management Toolbar & Collapsible Brand Catalog */}
      <Collapsible
        open={showCatalogBar}
        onOpenChange={setShowCatalogBar}
        className="panel subscriptions-toolbar-panel"
      >
        <div className="subscriptions-toolbar-main">
          <div className="subscriptions-filters">
            <div className="subscriptions-search-wrap">
              <Search className="subscriptions-search-icon" aria-hidden="true" />
              <Input
                type="search"
                className="subscriptions-search-input pl-8"
                aria-label="搜索订阅"
                placeholder="搜索产品、品牌、账号、套餐、共用分组…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="segmented-group" role="group" aria-label="归档状态筛选">
              <Button
                type="button"
                variant={archiveFilter === 'active' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={archiveFilter === 'active'}
                onClick={() => setArchiveFilter('active')}
              >
                活跃中 ({counts.active})
              </Button>
              <Button
                type="button"
                variant={archiveFilter === 'archived' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={archiveFilter === 'archived'}
                onClick={() => setArchiveFilter('archived')}
              >
                已归档 ({counts.archived})
              </Button>
              <Button
                type="button"
                variant={archiveFilter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={archiveFilter === 'all'}
                onClick={() => setArchiveFilter('all')}
              >
                全部 ({counts.all})
              </Button>
            </div>

            <FormSelect
              aria-label="按类型筛选"
              className="subscriptions-select"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            >
              <option value="all">全部卡片类型</option>
              <option value="window">订阅额度</option>
              <option value="wallet">API 余额与预算</option>
              <option value="manual">手动会员</option>
            </FormSelect>

            <FormSelect
              aria-label="表格排序"
              className="subscriptions-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as TableSort)}
            >
              <option value="default">按概览顺序</option>
              <option value="product">按产品名称</option>
              <option value="renewal">按下次续费/到期日</option>
              <option value="price">按周期价格</option>
              <option value="status">按生命周期状态</option>
            </FormSelect>
          </div>

          <div className="subscriptions-toolbar-actions">
            <div className="segmented-group" role="group" aria-label="订阅显示方式">
              <Button
                type="button"
                variant={view === 'cards' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={view === 'cards'}
                onClick={() => setView('cards')}
              >
                <LayoutGrid /> 卡片
              </Button>
              <Button
                type="button"
                variant={view === 'table' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={view === 'table'}
                onClick={() => setView('table')}
              >
                <List /> 表格
              </Button>
            </div>
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  data-testid="toggle-catalog-bar-btn"
                />
              }
            >
              {showCatalogBar ? '收起品牌目录' : '常见品牌目录'}
              <ChevronDown className="catalog-chevron" />
            </CollapsibleTrigger>
            <Button type="button" onClick={onCreate}>
              <Plus />
              新增订阅
            </Button>
          </div>
        </div>

        <CollapsibleContent className="brand-directory-panel stack">
          <div className="section-header">
            <strong>内置品牌目录</strong>
            <span className="muted">点击任一品牌可快速带入模板新增记录</span>
          </div>
          <div className="catalog-grid">
            {PRODUCT_CATALOG.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="outline"
                className="catalog-chip"
                onClick={() => handleTriggerCreatePreset(item.product)}
              >
                <BrandIcon
                  product={item.product || '自定义'}
                  brand={item.brand}
                  size={20}
                />
                <div className="catalog-chip-info">
                  <strong>{item.product || '+ 自定义服务'}</strong>
                  <StatusBadge
                    tone={
                      item.tier === 'auto'
                        ? 'primary'
                        : item.tier === 'experimental'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {item.tierLabel}
                  </StatusBadge>
                </div>
              </Button>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Controlled AlertDialog for Scoped Archive / Delete Confirmation */}
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !busyId) {
            setPendingAction(null);
          }
        }}
      >
        <AlertDialogContent data-testid="subscriptions-scope-alert-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.kind === 'archive'
                ? pendingAction.sub.lifecycle === 'archived'
                  ? `确认将「${pendingAction.sub.product}」恢复为活跃跟踪？`
                  : `确认归档「${pendingAction.sub.product}」？`
                : `确认删除「${pendingAction?.sub.product ?? ''}」？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.kind === 'archive'
                ? '归档后不再计入首屏活跃提醒与固定月费汇总，保留历史记录与已有日程。'
                : '此操作仅删除本地记录，不会代替你在外部官网退订。删除后 8 秒内可撤销。'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>取消</AlertDialogCancel>
            {pendingAction ? (
              <Button
                type="button"
                variant={pendingAction.kind === 'delete' ? 'destructive' : 'default'}
                disabled={busyId === pendingAction.sub.id}
                onClick={() => void executePendingScope()}
              >
                {pendingAction.kind === 'delete'
                  ? '确认删除记录（8 秒内可撤销）'
                  : pendingAction.sub.lifecycle === 'archived'
                    ? '确认恢复'
                    : '确认归档'}
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Management Table */}
      {snapshot.subscriptions.length === 0 ? (
        <div className="empty panel stack">
          <h3>暂无订阅记录</h3>
          <p className="muted">
            你可以直接新增第一条自定义或目录订阅（仅名称必填，价格和日期允许留空后补）。
          </p>
          <div className="row center-row">
            <Button type="button" onClick={onCreate}>
              <Plus />
              新增第一项订阅
            </Button>
          </div>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="empty panel stack">
          <p>没有匹配当前搜索词或归档筛选条件的记录。</p>
          <div className="row center-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery('');
                setArchiveFilter('all');
                setKindFilter('all');
              }}
            >
              清除搜索与筛选条件
            </Button>
          </div>
        </div>
      ) : view === 'cards' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={groupedCards.map((g) => g.primary.id)}
            strategy={rectSortingStrategy}
          >
            <section
              className={`cards-grid ${
                snapshot.preferences.density === 'compact' ? 'density-compact' : 'density-comfortable'
              }`}
              aria-label="订阅卡片列表"
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
                      .catch((error) => notify((error as Error).message));
                  }}
                  onConnection={onConnection}
                  onMoveOrder={moveOrder}
                  onCardKeyNav={handleCardKeyNav}
                  cardRef={(el) => {
                    cardRefs.current[primary.id] = el;
                  }}
                  draggable
                />
              ))}
            </section>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="panel subscriptions-table-panel">
          <Table className="sub-table">
            <TableHeader>
              <TableRow>
                <TableHead>产品与品牌</TableHead>
                <TableHead>账号与套餐</TableHead>
                <TableHead>周期与价格</TableHead>
                <TableHead className="num-col">核心额度 / 余额</TableHead>
                <TableHead>下次续费 / 有效期安排</TableHead>
                <TableHead className="num-col">状态与操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((sub) => {
                const lifeMeta = lifecycleMeta(sub.lifecycle, sub.autoRenew);
                const conn = sub.connectionId
                  ? snapshot.connections.find((c) => c.id === sub.connectionId)
                  : null;
                const cMeta = conn ? connectionStateMeta(conn.state) : null;
                const hasProposed =
                  sub.renewalDate.proposed !== undefined ||
                  sub.price.proposed !== undefined ||
                  sub.plan.proposed !== undefined;

                return (
                  <TableRow
                    key={sub.id}
                    className={sub.lifecycle === 'archived' ? 'row-archived' : ''}
                  >
                    <TableCell>
                      <div className="table-product-cell">
                        <BrandIcon product={sub.product} brand={sub.brand} size={22} />
                        <div className="table-product-main">
                          <div className="table-product-title-row">
                            <button
                              type="button"
                              className="table-title-btn"
                              onClick={() => onOpen(sub.id)}
                            >
                              {sub.product}
                            </button>
                            {sub.pinned ? (
                              <span className="pin-indicator" title="已置顶">
                                <Pin className="inline-icon" aria-label="已置顶" />
                              </span>
                            ) : null}
                            {hasProposed ? (
                              <StatusBadge tone="warning">待裁决差异</StatusBadge>
                            ) : null}
                          </div>
                          <div className="row muted">
                            <span>
                              {sub.brand} ·{' '}
                              {sub.kind === 'window'
                                ? '订阅额度'
                                : sub.kind === 'wallet'
                                  ? '按量余额/预算'
                                  : '手动会员'}
                            </span>
                            {sub.billingGroupId ? (
                              <span className="table-rel-tag">
                                共用付款: {sub.billingGroupId}
                              </span>
                            ) : null}
                            {sub.quotaPoolId ? (
                              <span className="table-rel-tag">
                                额度池: {sub.quotaPoolId}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="table-cell-stack">
                        <span className="table-cell-primary">{sub.account}</span>
                        <span className="muted">
                          套餐：{fieldText(sub.plan)}
                          {sub.plan.locked ? (
                            <LockKeyhole
                              className="inline-icon"
                              aria-label="已手动锁定"
                            />
                          ) : null}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="tabular">
                      <div className="table-cell-stack">
                        <strong className="table-cell-amount">
                          {sub.kind === 'wallet' && sub.cycle === 'none'
                            ? '不适用（按量预付）'
                            : sub.price.availability === 'known' && sub.price.value !== null
                              ? `${money(sub.price.value, sub.currency)} / ${cycleLabel(
                                  sub.cycle,
                                  sub.intervalDays
                                )}`
                              : fieldText(sub.price)}
                        </strong>
                        <span className="muted">
                          {sub.price.source}
                          {sub.price.locked ? (
                            <LockKeyhole
                              className="inline-icon"
                              aria-label="已手动锁定"
                            />
                          ) : null}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="num-col">{renderMetricSummary(sub)}</TableCell>

                    <TableCell className="tabular">
                      <div className="table-cell-stack">
                        <strong className="table-cell-amount">
                          {renewalText(sub, snapshot.now)}
                        </strong>
                        <span className="muted">
                          {sub.renewalDate.locked ? (
                            <>
                              <LockKeyhole className="inline-icon" aria-hidden="true" />{' '}
                              手动锁定 ·{' '}
                            </>
                          ) : null}
                          {sub.renewalDate.source} ·{' '}
                          {sub.renewalDate.observedAt
                            ? formatRelativeTime(sub.renewalDate.observedAt, snapshot.now)
                            : '未记录时间'}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="num-col">
                      <div className="table-actions-cell">
                        <div className="table-status-badges">
                          <StatusBadge tone={lifeMeta.tone}>{lifeMeta.label}</StatusBadge>
                          {cMeta ? (
                            <StatusBadge tone={cMeta.tone}>{cMeta.label}</StatusBadge>
                          ) : null}
                        </div>
                        <div className="table-action-btns">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpen(sub.id)}
                          >
                            详情
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleTriggerEdit(sub)}
                          >
                            编辑
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`${sub.product} 更多操作`}
                                  data-testid={`sub-row-menu-${sub.id}`}
                                />
                              }
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleTriggerEdit(sub)}>
                                <Pencil />
                                编辑记录
                              </DropdownMenuItem>
                              {sub.connectionId ? (
                                <DropdownMenuItem
                                  disabled={conn?.state === 'refreshing'}
                                  onClick={() => {
                                    if (cMeta?.needsRecovery && conn) {
                                      onConnection(conn.id);
                                    } else {
                                      void client
                                        .refresh(sub.id)
                                        .then((msg) => notify(msg))
                                        .catch((e) => notify((e as Error).message));
                                    }
                                  }}
                                >
                                  <RefreshCw />
                                  {cMeta?.needsRecovery ? '恢复连接' : '刷新'}
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  setPendingAction({
                                    sub,
                                    kind: 'archive',
                                  })
                                }
                              >
                                {sub.lifecycle === 'archived' ? (
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
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  setPendingAction({
                                    sub,
                                    kind: 'delete',
                                  })
                                }
                              >
                                <Trash2 />
                                删除记录…
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Local fallback modals if SubscriptionsPage is rendered without App-level form handlers */}
      {localEditing ? (
        <SubscriptionForm
          mode="edit"
          initial={localEditing}
          snapshot={snapshot}
          client={client}
          notify={notify}
          onClose={() => setLocalEditing(null)}
        />
      ) : null}

      {localCreatingPreset !== null ? (
        <SubscriptionForm
          mode="create"
          presetProduct={localCreatingPreset}
          snapshot={snapshot}
          client={client}
          notify={notify}
          onClose={() => setLocalCreatingPreset(null)}
        />
      ) : null}
    </div>
  );
}
