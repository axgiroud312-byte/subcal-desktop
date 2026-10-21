import { useMemo, useState } from 'react';
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
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical, Plus, RefreshCw, Search } from 'lucide-react';
import type { PageProps } from '../contracts';
import type { Metric, Subscription } from '../../shared/types';
import {
  dateInZone,
  dateValid,
  daysBetween,
  fieldText,
  freshness,
  money,
  monthlySummary,
  renewalText,
} from '../../shared/rules';
import { balanceAmount, entitlementDate, isAutomatic, uniqueWindows } from '../lib/entitlements';
import { BrandIcon, formatDateTime, lifecycleMeta } from '../components/ui';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { DND_POINTER_ACTIVATION_CONSTRAINT } from '../lib/motion';
import './board.css';

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
    group.accounts.sort((a, b) => (a.connectionId ?? a.id).localeCompare(b.connectionId ?? b.id) || a.id.localeCompare(b.id));
    group.primary = group.accounts[0];
  }
  return groups;
}

function maskAccount(value: string, on: boolean): string {
  if (!on || !value) return value || '账号待确认';
  const at = value.indexOf('@');
  if (at > 0) return `${value.slice(0, 1)}••••${value.slice(at)}`;
  if (value.length <= 2) return '••••';
  return `${value.slice(0, 1)}••••${value.slice(-1)}`;
}

function windowName(metric: Metric): string {
  const minutes = metric.windowMinutes;
  if (minutes && minutes > 0) {
    if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
    if (minutes % 60 === 0) return `${minutes / 60} 小时`;
    return `${minutes} 分钟`;
  }
  return metric.label;
}

function cycleShort(cycle: Subscription['cycle']): string {
  if (cycle === 'monthly') return '月';
  if (cycle === 'quarterly') return '季';
  if (cycle === 'yearly') return '年';
  return '';
}

function priceChip(sub: Subscription): string | null {
  if (sub.price.availability !== 'known' || sub.price.value === null) return null;
  const cycle = sub.cycle === 'days' ? `${sub.intervalDays} 天` : sub.cycle === 'once' ? '次' : sub.cycle === 'irregular' ? '不定期' : cycleShort(sub.cycle);
  return `${money(sub.price.value, sub.currency)}${cycle ? `/${cycle}` : ''}`;
}

function planLine(sub: Subscription): string {
  const plan = sub.plan.availability === 'known' && sub.plan.value ? sub.plan.value : '';
  const until = sub.entitlements?.membershipExpiresAt;
  const untilText = until?.availability === 'known' && until.value ? `有效期至${entitlementDate(until).replace(/\s.*/, '')}` : '';
  return [plan, untilText].filter(Boolean).join(' · ');
}

function meter(metric: Metric, view: 'remaining' | 'used', now: string): { text: string; width: number | null; low: boolean } {
  const fresh = freshness(metric, now);
  if (fresh === 'past_reset') return { text: '待核实', width: null, low: false };
  const { remaining, unit } = metric;
  const total = metric.totalObservation ? (metric.totalObservation.availability === 'known' ? metric.totalObservation.value : null) : metric.total;
  if (view === 'used' && metric.used?.availability === 'known' && metric.used.value !== null) {
    const used = Number(metric.used.value);
    const limit = unit === '%' ? 100 : Number(total);
    return { text: `已用 ${/^[A-Z]{3}$/.test(unit) ? money(metric.used.value, unit) : `${metric.used.value}${unit === '%' ? '' : ' '}${unit}`}`, width: Number.isFinite(used) && limit > 0 ? Math.max(0, Math.min(100, used / limit * 100)) : null, low: false };
  }
  if (remaining.availability === 'unlimited') return { text: '无限', width: 100, low: false };
  if (remaining.availability !== 'known' || remaining.value === null) {
    return { text: fieldText(remaining), width: null, low: false };
  }
  if (unit === '%') {
    const rem = Number(remaining.value);
    const display = view === 'used' ? Number((100 - rem).toFixed(1)) : rem;
    return {
      text: `${view === 'used' ? '已用' : '剩余'} ${display}%`,
      width: Number.isFinite(display) ? Math.max(0, Math.min(100, display)) : null,
      low: Number.isFinite(rem) && rem <= 20,
    };
  }
  if (total) {
    try {
      const rem = Number(remaining.value);
      const tot = Number(total);
      if (tot > 0) {
        const ratio = view === 'used' ? ((tot - rem) / tot) * 100 : (rem / tot) * 100;
         const amount = view === 'used' ? String(Number((tot - rem).toFixed(6))) : remaining.value;
         const shown = /^[A-Z]{3}$/.test(unit) ? money(amount, unit) : `${amount} ${unit}`;
        return { text: view === 'used' ? `已用 ${shown}` : shown, width: Math.max(0, Math.min(100, ratio)), low: false };
      }
    } catch { /* fall through to plain amount */ }
  }
  const shown = /^[A-Z]{3}$/.test(unit) ? money(remaining.value, unit) : `${remaining.value} ${unit}`;
  return { text: view === 'used' ? '已用量未知' : `剩余 ${shown}`, width: null, low: false };
}

function resetHint(metric: Metric, now: string): string | null {
  const observed = metric.resetObservation?.availability === 'known' ? metric.resetObservation.value : null;
  const raw = observed?.value ?? metric.resetAt;
  if (!raw) return null;
  const day = observed?.precision === 'day' || dateValid(raw);
  if (day) return `重置 ${raw.slice(0, 10)}（日期）`;
  const label = day ? raw.slice(0, 10) : formatDateTime(raw);
  const target = day ? Date.parse(`${raw.slice(0, 10)}T00:00:00`) : Date.parse(raw);
  if (!Number.isFinite(target)) return `重置 ${label}`;
  const diff = target - Date.parse(now);
  if (diff <= 0) return `重置 ${label}`;
  if (diff < 3_600_000) return `重置 ${label} · ${Math.ceil(diff / 60_000)} 分钟后`;
  const hours = Math.ceil(diff / 3_600_000);
  const when = hours < 48 ? `${hours} 小时后` : `${Math.round(diff / 86_400_000)} 天后`;
  return `重置 ${label} · ${when}`;
}

function BoardCard({
  group,
  now,
  quotaView,
  mask,
  connections,
  onOpen,
  onRefresh,
  onConnection,
  draggable,
}: {
  group: CardGroup;
  now: string;
  quotaView: 'remaining' | 'used';
  mask: boolean;
  connections: PageProps['snapshot']['connections'];
  onOpen: (id: string) => void;
  onRefresh: (id: string) => void;
  onConnection: (id: string) => void;
  draggable: boolean;
}) {
  const [selectedId, setSelectedId] = useState(group.primary.id);
  const sub = group.accounts.find((item) => item.id === selectedId) ?? group.primary;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: group.primary.id,
    disabled: !draggable,
  });
  const windows = uniqueWindows(sub.metrics);
  const conn = sub.connectionId ? connections.find((item) => item.id === sub.connectionId) : null;
  const life = lifecycleMeta(sub.lifecycle, sub.autoRenew);
  const price = priceChip(sub);
  const plan = planLine(sub);
  const renewal = !isAutomatic(sub) && sub.renewalDate.value
    ? (() => {
        const days = daysBetween(dateInZone(now, sub.timezone), sub.renewalDate.value);
        return days <= 0 ? sub.renewalDate.value : `${days} 天后续费`;
      })()
    : null;

  return (
    <article
      ref={setNodeRef}
      className={`board-card${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-card-id={sub.id}
    >
      <header className="board-card-head">
        <button type="button" className="board-card-title" onClick={() => onOpen(sub.id)}>
          <BrandIcon product={sub.product} brand={sub.brand} size={18} />
          <span>{sub.product}</span>
        </button>
        <div className="board-card-tools">
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="board-grip"
            aria-label={`排序 ${sub.product}`}
            disabled={!draggable}
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </button>
          {sub.connectionId ? (
            <button
              type="button"
              className="board-grip"
              aria-label={`更新 ${sub.product}`}
              disabled={conn?.state === 'refreshing'}
              onClick={() => (conn && ['auth', 'denied', 'runtime_missing', 'schema_changed'].includes(conn.state) ? onConnection(conn.id) : onRefresh(sub.id))}
            >
              <RefreshCw />
            </button>
          ) : null}
        </div>
      </header>

      <button type="button" className="board-price" onClick={() => onOpen(sub.id)} aria-label={`${sub.product} 价格与详情`}>
        {price ?? (sub.kind === 'wallet' ? '按量计费' : '价格待补充')}
      </button>

      {group.accounts.length > 1 ? (
        <select className="board-account-select" aria-label={`${sub.product} 切换账号`} value={sub.id} onChange={(event) => setSelectedId(event.target.value)}>
          {group.accounts.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {maskAccount(item.account, mask)}</option>)}
        </select>
      ) : null}

      <div className="board-card-sub">
        <span>{maskAccount(sub.account, mask)}</span>
        <span>{plan || renewal || (life.tone === 'success' ? '' : life.label)}</span>
      </div>
      {sub.lifecycle !== 'active' ? <div className="board-hint">{life.label}</div> : null}
      {sub.billingGroupId ? <div className="board-hint">共用付款 · 总花费按付款组计一次</div> : null}
      {windows.length > 0 && !isAutomatic(sub) ? <div className="board-hint">{renewalText(sub, now)}</div> : null}

      {conn?.error ? (
        <button type="button" className="board-alert" onClick={() => onConnection(conn.id)}>{conn.error.message}</button>
      ) : null}

      {windows.length > 0 ? (
        <div className="board-windows">
          {windows.map((metric) => {
            const value = meter(metric, quotaView, now);
            const hint = resetHint(metric, now);
            return (
              <div key={metric.id} className="board-window">
                <div className="board-window-top">
                  <span>{windowName(metric)}</span>
                  <b data-low={value.low || undefined}>{value.text}</b>
                </div>
                {value.width !== null ? (
                  <div className="board-bar" aria-hidden="true"><i data-low={value.low || undefined} style={{ width: `${value.width}%` }} /></div>
                ) : null}
                {hint ? <div className="board-hint">{hint}</div> : null}
                {metric.remaining.availability === 'known' && freshness(metric, now) === 'stale' ? <div className="board-hint">数据已过时 · 待更新</div> : null}
              </div>
            );
          })}
        </div>
      ) : sub.kind === 'manual' ? (
        <div className="board-manual">
          <span>{renewalText(sub, now)}</span>
        </div>
      ) : (
        <div className="board-hint">{conn?.state === 'refreshing' ? '正在查询' : '尚未获取'}</div>
      )}

      {sub.balances?.length ? (
        <div className="board-balances">
          {sub.balances.slice(0, 2).map((balance) => (
            <div key={balance.id} className="board-balance">
              <span>{balance.label}</span>
              <strong>
                {balance.amount.availability === 'known' && balance.amount.value !== null
                  ? balanceAmount(balance.amount.value, balance.currency)
                  : fieldText(balance.amount)}
              </strong>
            </div>
          ))}
        </div>
      ) : null}

      {group.accounts.length > 1 ? (
        <button type="button" className="board-more" onClick={() => onOpen(sub.id)}>
          共 {group.accounts.length} 个账号
        </button>
      ) : null}
    </article>
  );
}

export function BoardPage({ snapshot, client, notify, onOpen, onCreate, onConnection }: PageProps) {
  const [query, setQuery] = useState('');
  const [mask, setMask] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: DND_POINTER_ACTIVATION_CONSTRAINT }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const active = useMemo(
    () => snapshot.subscriptions.filter((item) => item.lifecycle !== 'archived'),
    [snapshot.subscriptions],
  );
  const ordered = useMemo(() => {
    const order = new Map(snapshot.preferences.order.map((id, index) => [id, index]));
    return [...(showArchived ? snapshot.subscriptions.filter((item) => item.lifecycle === 'archived') : active)].sort((a, b) => {
      const ai = order.get(a.id);
      const bi = order.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.product.localeCompare(b.product, 'zh-CN');
    });
  }, [active, snapshot.subscriptions, snapshot.preferences.order, showArchived]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((item) => [item.product, item.brand, item.account, item.plan.value ?? ''].join(' ').toLowerCase().includes(q));
  }, [ordered, query]);
  const groups = useMemo(() => buildCardGroups(visible), [visible]);
  const monthly = useMemo(() => monthlySummary(active), [active]);

  const persistOrder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const all = buildCardGroups(ordered);
    const from = all.findIndex((group) => group.accounts.some((item) => item.id === fromId));
    const to = all.findIndex((group) => group.accounts.some((item) => item.id === toId));
    if (from < 0 || to < 0 || from === to) return;
    const next = arrayMove(all, from, to).flatMap((group) => group.accounts.map((item) => item.id));
    const rest = snapshot.subscriptions.filter((item) => !next.includes(item.id)).map((item) => item.id);
    void client.reorder([...next, ...rest]).catch((error) => notify((error as Error).message));
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    persistOrder(String(event.active.id), String(event.over.id));
  };

  return (
    <div className="board-page">
      <div className="board-toolbar">
        <div className="board-toolbar-main">
          <h1>订阅</h1>
        </div>
        <div className="board-toolbar-actions">
          <label className="board-search">
            <Search aria-hidden="true" />
            <Input
              type="search"
              aria-label="搜索订阅"
              placeholder="搜索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Button type="button" variant="outline" size="sm" aria-pressed={mask} onClick={() => setMask((value) => !value)}>
            {mask ? <EyeOff /> : <Eye />} 账号打码
          </Button>
          <div className="segmented-group" role="group" aria-label="额度显示">
            <Button
              type="button"
              size="sm"
              variant={snapshot.preferences.quotaView === 'used' ? 'secondary' : 'ghost'}
              aria-pressed={snapshot.preferences.quotaView === 'used'}
              onClick={() => void client.setPreferences({ quotaView: 'used' }).catch((error) => notify((error as Error).message))}
            >
              已用
            </Button>
            <Button
              type="button"
              size="sm"
              variant={snapshot.preferences.quotaView === 'remaining' ? 'secondary' : 'ghost'}
              aria-pressed={snapshot.preferences.quotaView === 'remaining'}
              onClick={() => void client.setPreferences({ quotaView: 'remaining' }).catch((error) => notify((error as Error).message))}
            >
              剩余
            </Button>
          </div>
          <Button type="button" onClick={onCreate}><Plus /> 添加订阅</Button>
        </div>
      </div>

      <section className="board-total" aria-label="当前订阅总花费">
        <span>当前订阅总花费 <span className="board-total-label">/ 折算月费</span></span>
        <div className="board-total-values">
          {monthly.totals.length ? monthly.totals.map((item) => <strong key={item.currency}>{money(item.amount, item.currency)} <small>{item.currency} / 月</small></strong>) : <strong>{monthly.unknown ? '金额待补充' : '暂无周期费用'}</strong>}
        </div>
        <span className="board-total-note">{monthly.recurring} 项周期订阅 · 年付、季付按月折算 · 不同币种分别统计{monthly.unknown ? ` · ${monthly.unknown} 项价格未知，未计入` : ''}</span>
      </section>
      <div className="board-view-switch">
        <Button size="sm" variant={!showArchived ? 'secondary' : 'ghost'} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>当前订阅</Button>
        <Button size="sm" variant={showArchived ? 'secondary' : 'ghost'} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>已归档</Button>
      </div>

      {active.length === 0 && !showArchived ? (
        <div className="board-empty">
          <p>还没有订阅</p>
          <Button type="button" onClick={onCreate}><Plus /> 添加订阅</Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="board-empty"><p>{showArchived && !query.trim() ? '没有已归档的订阅' : '没有匹配的订阅'}</p></div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={groups.map((group) => group.primary.id)} strategy={rectSortingStrategy}>
            <section className="board-grid" aria-label="订阅">
              {groups.map((group) => (
                <BoardCard
                  key={group.primary.id}
                  group={group}
                  now={snapshot.now}
                  quotaView={snapshot.preferences.quotaView}
                  mask={mask}
                  connections={snapshot.connections}
                  onOpen={onOpen}
                  onRefresh={(id) => {
                    void client.refresh(id).then((message) => notify(message)).catch((error) => notify((error as Error).message));
                  }}
                  onConnection={onConnection}
                  draggable={!query.trim() && !showArchived}
                />
              ))}
            </section>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
