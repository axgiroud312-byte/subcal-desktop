import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react';
import type { PageProps } from '../contracts';
import type {
  CalendarEvent,
  EventKind,
  Subscription,
} from '../../shared/types';
import { addDays, dateInZone, daysBetween, money } from '../../shared/rules';
import { BrandIcon } from '../components/ui';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { FormSelect } from '../components/form-controls';
import './calendar.css';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const KIND_META: Record<
  EventKind,
  {
    label: string;
    badgeVariant: 'secondary' | 'destructive' | 'warning' | 'success' | 'outline';
  }
> = {
  renewal: {
    label: '续费',
    badgeVariant: 'secondary',
  },
  expiry: {
    label: '到期',
    badgeVariant: 'destructive',
  },
  trial: {
    label: '试用结束',
    badgeVariant: 'warning',
  },
  start: {
    label: '开始',
    badgeVariant: 'success',
  },
  reset: {
    label: '额度重置',
    badgeVariant: 'outline',
  },
};

function shiftMonth(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildMonthGrid(
  ym: string
): { date: string; day: number; inMonth: boolean }[] {
  const [y, m] = ym.split('-').map(Number);
  const firstDate = `${ym}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday = 0 ... Sunday = 6
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const startCellDate = addDays(firstDate, -firstDow);

  const cells: { date: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < totalCells; i++) {
    const cellDate = addDays(startCellDate, i);
    const cellDay = Number(cellDate.slice(8, 10));
    cells.push({
      date: cellDate,
      day: cellDay,
      inMonth: cellDate.slice(0, 7) === ym,
    });
  }
  return cells;
}

function formatInstantInZone(instant: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(instant));
  } catch {
    return instant;
  }
}

export function CalendarPage({
  snapshot,
  client,
  notify,
  onOpen,
  onCreate,
  onRecordPayment,
}: PageProps & { onRecordPayment?: (subscriptionId: string, planDate?: string) => void }) {
  const resetSwitchId = useId();
  const userTz = snapshot.preferences.timezone || 'Asia/Shanghai';
  const demoToday = useMemo(
    () => dateInZone(snapshot.now, userTz),
    [snapshot.now, userTz]
  );

  const [currentMonth, setCurrentMonth] = useState<string>(() =>
    demoToday.slice(0, 7)
  );
  const [selectedDate, setSelectedDate] = useState<string>(() => demoToday);
  const [includeReset, setIncludeReset] = useState<boolean>(false);
  const [kindFilter, setKindFilter] = useState<'all' | EventKind>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [agendaScope, setAgendaScope] = useState<'day' | 'month'>('day');
  const [viewTab, setViewTab] = useState<'month' | 'agenda'>('month');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);

  const paymentCountFor = (event: CalendarEvent): number => {
    if (event.kind !== 'renewal') return 0;
    const sub = snapshot.subscriptions.find((s) => s.id === event.subscriptionId);
    const group = sub?.billingGroupId ?? null;
    return snapshot.payments.filter(
      (payment) =>
        (payment.planDate === event.date || (payment.planDate == null && payment.paidOn === event.date)) &&
        (payment.subscriptionId === event.subscriptionId ||
          (group !== null && payment.billingGroupId === group)),
    ).length;
  };

  const lastScenarioRef = useRef<string>(snapshot.scenario);

  // Align currentMonth and selectedDate when switching demo scenarios;
  // within the same scenario, preserve selection when opening/closing details.
  useEffect(() => {
    if (lastScenarioRef.current !== snapshot.scenario) {
      lastScenarioRef.current = snapshot.scenario;
      const nextToday = dateInZone(
        snapshot.now,
        snapshot.preferences.timezone || 'Asia/Shanghai'
      );
      setCurrentMonth(nextToday.slice(0, 7));
      setSelectedDate(nextToday);
    }
  }, [snapshot.scenario, snapshot.now, snapshot.preferences.timezone]);

  // Load projected calendar events via async client with stale guard
  useEffect(() => {
    let cancelled = false;
    setLoadingEvents(true);
    client
      .events(includeReset)
      .then((res) => {
        if (!cancelled) {
          setEvents(res);
          setLoadingEvents(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadingEvents(false);
          notify((err as Error).message || '读取本地日历事件失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    snapshot.revision,
    snapshot.scenario,
    snapshot.now,
    includeReset,
    notify,
  ]);

  const subscriptionMap = useMemo(() => {
    const map = new Map<string, Subscription>();
    for (const s of snapshot.subscriptions) {
      map.set(s.id, s);
    }
    return map;
  }, [snapshot.subscriptions]);

  /**
   * A payment keeps pointing at the plan it paid, even after the plan advances.
   * Those paid occurrences stay visible so history is traceable in the calendar.
   */
  const visibleEvents = useMemo(() => {
    const result = [...events];
    const seen = new Set(
      events
        .filter((event) => event.kind === 'renewal')
        .map((event) => {
          const sub = subscriptionMap.get(event.subscriptionId);
          return `${sub?.billingGroupId ?? event.subscriptionId}:${event.date}`;
        }),
    );
    for (const payment of snapshot.payments) {
      if (!payment.planDate) continue;
      const sub = payment.subscriptionId ? subscriptionMap.get(payment.subscriptionId) : undefined;
      if (!sub) continue;
      const subject = sub.billingGroupId ?? sub.id;
      const key = `${payment.billingGroupId ?? subject}:${payment.planDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        id: `paid:${payment.id}`,
        subscriptionId: sub.id,
        product: sub.product,
        account: sub.account,
        kind: 'renewal',
        date: payment.planDate,
        precision: 'day',
        dateSemantic: 'billing_renewal',
        timezone: sub.timezone,
        expected: false,
        source: '已记录付款',
        revision: sub.revision,
        dataOrigin: 'manual',
      });
    }
    return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [events, snapshot.payments, subscriptionMap]);

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of snapshot.subscriptions) {
      if (s.product) set.add(s.product);
    }
    for (const e of visibleEvents) {
      if (e.product) set.add(e.product);
    }
    return [...set];
  }, [snapshot.subscriptions, visibleEvents]);

  useEffect(() => {
    if (productFilter !== 'all' && !productOptions.includes(productFilter)) {
      setProductFilter('all');
    }
  }, [productFilter, productOptions]);

  const filteredEvents = useMemo(() => {
    return visibleEvents.filter((e) => {
      if (!includeReset && e.kind === 'reset') return false;
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (productFilter !== 'all' && e.product !== productFilter) return false;
      return true;
    });
  }, [visibleEvents, includeReset, kindFilter, productFilter]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of filteredEvents) {
      const list = map.get(e.date);
      if (list) list.push(e);
      else map.set(e.date, [e]);
    }
    return map;
  }, [filteredEvents]);

  const monthCells = useMemo(
    () => buildMonthGrid(currentMonth),
    [currentMonth]
  );

  const monthEvents = useMemo(() => {
    return filteredEvents.filter((e) => e.date.slice(0, 7) === currentMonth);
  }, [filteredEvents, currentMonth]);

  const selectedDayEvents = useMemo(() => {
    return eventsByDate.get(selectedDate) || [];
  }, [eventsByDate, selectedDate]);

  const agendaEvents =
    agendaScope === 'day' ? selectedDayEvents : monthEvents;


  function handleSelectMonth(nextYm: string) {
    setCurrentMonth(nextYm);
    if (selectedDate.slice(0, 7) !== nextYm) {
      if (demoToday.slice(0, 7) === nextYm) {
        setSelectedDate(demoToday);
      } else {
        setSelectedDate(`${nextYm}-01`);
      }
    }
  }

  function handleJumpToday() {
    const todayYm = demoToday.slice(0, 7);
    setCurrentMonth(todayYm);
    setSelectedDate(demoToday);
    setAgendaScope('day');
  }

  function handleToggleIncludeReset(checked: boolean) {
    setIncludeReset(checked);
    if (!checked && kindFilter === 'reset') {
      setKindFilter('all');
    }
  }

  function isRenewalOverdue(e: CalendarEvent): boolean {
    if (e.kind !== 'renewal') return false;
    const todayInEventZone = dateInZone(snapshot.now, e.timezone);
    return daysBetween(todayInEventZone, e.date) <= 0;
  }

  function renderEventNatureBadge(e: CalendarEvent) {
    if (e.kind === 'renewal') {
      if (isRenewalOverdue(e)) {
        return (
          <Badge variant="warning">
            续费待确认
          </Badge>
        );
      }
      return <Badge variant="outline">预计续费</Badge>;
    }
    if (e.kind === 'reset') {
      return <Badge variant="outline">额度重置</Badge>;
    }
    if (e.kind === 'expiry') {
      return <Badge variant="destructive">有效期截止</Badge>;
    }
    if (e.kind === 'trial') {
      return <Badge variant="warning">已记录试用结束日</Badge>;
    }
    return <Badge variant="success">已记录开始日</Badge>;
  }


  const selectedDelta = daysBetween(demoToday, selectedDate);
  const selectedRelativeLabel =
    selectedDelta === 0
       ? '今天'
      : selectedDelta > 0
      ? `${selectedDelta} 天后`
      : `${Math.abs(selectedDelta)} 天前`;

  return (
    <div className="cal-page">
      {/* Top Header & Controls */}
      <section className="panel cal-header-panel" aria-label="本地日历控制栏">
        <div className="toolbar">
          <div className="cal-title-cluster">
            <h2 className="cal-page-title">
              {currentMonth.replace('-', ' 年 ')} 月
            </h2>
            {loadingEvents && (
              <span className="muted">读取中…</span>
            )}
          </div>

          <div className="row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSelectMonth(shiftMonth(currentMonth, -1))}
            >
              <ChevronLeft aria-hidden="true" />
              上个月
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleJumpToday}
            >
              今天
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSelectMonth(shiftMonth(currentMonth, 1))}
            >
              下个月
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>


        {/* Filter Bar & Narrow Screen View Tabs */}
        <div className="cal-filter-bar">
          <div className="cal-filter-controls">
            <div className="cal-filter-item">
              <span className="cal-filter-label">事件类型</span>
              <FormSelect
                id="cal-kind-filter"
                aria-label="按事件类型筛选"
                className="cal-select-trigger"
                value={kindFilter}
                onChange={(e) =>
                  setKindFilter(e.target.value as 'all' | EventKind)
                }
              >
                <option value="all">全部类型</option>
                <option value="renewal">续费（预计 / 待确认）</option>
                <option value="expiry">到期</option>
                <option value="trial">试用结束</option>
                <option value="start">开始</option>
                {includeReset && (
                  <option value="reset">额度重置（仅本地）</option>
                )}
              </FormSelect>
            </div>

            <div className="cal-filter-item">
              <span className="cal-filter-label">订阅产品</span>
              <FormSelect
                id="cal-product-filter"
                aria-label="按订阅产品筛选"
                className="cal-select-trigger"
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
              >
                <option value="all">
                  全部产品（{productOptions.length}）
                </option>
                {productOptions.map((prod) => (
                  <option key={prod} value={prod}>
                    {prod}
                  </option>
                ))}
              </FormSelect>
            </div>

            <div className="cal-switch-field">
              <Switch
                id={resetSwitchId}
                size="sm"
                checked={includeReset}
                onCheckedChange={(checked) =>
                  handleToggleIncludeReset(Boolean(checked))
                }
                aria-label="显示额度重置"
              />
              <Label htmlFor={resetSwitchId} className="cal-switch-field">
                显示额度重置
              </Label>
            </div>
          </div>

          {/* Narrow (<1100px) View Switcher */}
          <Tabs
            value={viewTab}
            onValueChange={(v) => setViewTab(v as 'month' | 'agenda')}
            className="cal-mobile-tabs"
          >
            <TabsList aria-label="视图切换">
              <TabsTrigger value="month">月历网格</TabsTrigger>
              <TabsTrigger value="agenda">
                日程列表（{agendaEvents.length}）
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </section>

      {snapshot.subscriptions.length === 0 ? (
        <section className="panel empty stack" style={{ alignItems: 'center' }}>
          <strong>暂无日程</strong>
          <p className="muted" style={{ margin: 0 }}>
            添加订阅日期后即可查看日程。
          </p>
          <div className="row">
            <Button type="button" variant="default" onClick={onCreate}>
              <Plus aria-hidden="true" />
              新增第一项订阅
            </Button>
          </div>
        </section>
      ) : (
        <div className="cal-layout" data-view-tab={viewTab}>
          {/* Left 65%: Month Date Grid */}
          <section className="panel cal-month-col stack" aria-label="月历视图">
            <div className="section-header">
              <div>
                <div className="cal-section-title">
                  {currentMonth.replace('-', ' 年 ')} 月 · 当月匹配日程{' '}
                  {monthEvents.length} 项
                </div>
              </div>
              <div className="cal-legend" aria-label="事件类型图例">
                <span className="cal-legend-item">
                  <span className="cal-legend-dot" data-kind="renewal" />
                  续费（预计 / 待确认）
                </span>
                <span className="cal-legend-item">
                  <span className="cal-legend-dot" data-kind="expiry" />
                  到期 / 试用结束
                </span>
                <span className="cal-legend-item">
                  <span className="cal-legend-dot" data-kind="start" />
                  开始
                </span>
                {includeReset && (
                  <span className="cal-legend-item">
                    <span className="cal-legend-dot" data-kind="reset" />
                    额度重置（仅本地）
                  </span>
                )}
              </div>
            </div>

            <div className="cal-weekdays" role="row">
              {WEEKDAYS.map((dayName) => (
                <div
                  key={dayName}
                  className="cal-weekday"
                  role="columnheader"
                >
                  {dayName}
                </div>
              ))}
            </div>

            <div
              className="cal-grid"
              role="grid"
              aria-label={`${currentMonth} 月历网格`}
            >
              {monthCells.map((cell) => {
                const cellEvents = eventsByDate.get(cell.date) || [];
                const visibleRows = cellEvents.slice(0, 2);
                const moreCount = Math.max(0, cellEvents.length - 2);
                const isSelected = cell.date === selectedDate;
                const isToday = cell.date === demoToday;

                return (
                  <div
                    key={cell.date}
                    role="gridcell"
                    tabIndex={isSelected ? 0 : -1}
                    aria-selected={isSelected}
                    aria-label={`${cell.date}，共 ${cellEvents.length} 项日程`}
                    data-date={cell.date}
                    className="cal-cell"
                    data-outside={!cell.inMonth}
                    data-today={isToday}
                    onClick={() => {
                      setSelectedDate(cell.date);
                      if (cell.date.slice(0, 7) !== currentMonth) {
                        setCurrentMonth(cell.date.slice(0, 7));
                      }
                      setAgendaScope('day');
                    }}
                    onKeyDown={(ev) => {
                      if (
                        ev.target === ev.currentTarget &&
                        [
                          'ArrowLeft',
                          'ArrowRight',
                          'ArrowUp',
                          'ArrowDown',
                        ].includes(ev.key)
                      ) {
                        ev.preventDefault();
                        const delta: Record<string, number> = {
                          ArrowLeft: -1,
                          ArrowRight: 1,
                          ArrowUp: -7,
                          ArrowDown: 7,
                        };
                        const nextDate = addDays(cell.date, delta[ev.key]);
                        setSelectedDate(nextDate);
                        setCurrentMonth(nextDate.slice(0, 7));
                        setAgendaScope('day');
                        requestAnimationFrame(() =>
                          document
                            .querySelector<HTMLElement>(
                              `[data-date="${nextDate}"]`
                            )
                            ?.focus()
                        );
                      }
                      if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) {
                        ev.preventDefault();
                        setSelectedDate(cell.date);
                        setAgendaScope('day');
                      }
                    }}
                  >
                    <div className="cal-cell-header">
                      <span className="cal-day-num">
                        {cell.day === 1
                          ? `${Number(cell.date.slice(5, 7))}月1日`
                          : cell.day}
                      </span>
                      {isToday && <span className="cal-today-tag">今</span>}
                    </div>

                    <div className="cal-cell-events">
                      {visibleRows.map((ev) => {
                        const kMeta = KIND_META[ev.kind];
                        const overdue = isRenewalOverdue(ev);
                        const natureText =
                          ev.kind === 'renewal'
                            ? overdue
                              ? '待确认'
                              : '预计'
                            : ev.kind === 'reset'
                            ? '本地'
                            : '';

                        return (
                          <button
                            key={ev.id}
                            type="button"
                            data-slot="cal-event-pill"
                            className="cal-event-pill"
                            data-kind={ev.kind}
                            data-overdue={overdue}
                            title={`${ev.product}（${ev.account}）· ${kMeta.label}${
                              natureText ? ` · ${natureText}` : ''
                            }${paymentCountFor(ev) > 0 ? ` · 已记录 ${paymentCountFor(ev)} 笔付款` : ''} · 点击查看订阅详情`}
                            onClick={(clickEv) => {
                              clickEv.stopPropagation();
                              setSelectedDate(cell.date);
                              setAgendaScope('day');
                              onOpen(ev.subscriptionId);
                            }}
                          >
                            <span className="cal-event-pill-text">
                              {kMeta.label} · {ev.product}
                            </span>
                            {natureText && (
                              <span className="cal-event-pill-nature">
                                {natureText}
                              </span>
                            )}
                          </button>
                        );
                      })}

                      {moreCount > 0 && (
                        <button
                          type="button"
                          data-slot="cal-more-btn"
                          className="cal-more-btn"
                          onClick={(clickEv) => {
                            clickEv.stopPropagation();
                            setSelectedDate(cell.date);
                            setAgendaScope('day');
                            setViewTab('agenda');
                          }}
                        >
                          更多 {moreCount} 项（共 {cellEvents.length} 项）
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right 35%: Selected Day / Whole-Month Agenda List */}
          <aside
            className="panel cal-agenda-col stack"
            aria-label="日程列表与来源详情"
          >
            <div className="section-header">
              <div>
                <div className="cal-section-title">
                  {agendaScope === 'day'
                    ? `选中日期：${selectedDate}（${selectedRelativeLabel}）`
                    : `当月日程汇总：${currentMonth}`}
                </div>
              </div>
              <Tabs
                value={agendaScope}
                onValueChange={(v) => setAgendaScope(v as 'day' | 'month')}
              >
                <TabsList aria-label="列表范围切换">
                  <TabsTrigger value="day">
                    选中日 ({selectedDayEvents.length})
                  </TabsTrigger>
                  <TabsTrigger value="month">
                    当月全部 ({monthEvents.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {agendaEvents.length === 0 ? (
              <div className="empty stack" style={{ alignItems: 'center' }}>
                <div>
                  {agendaScope === 'day'
                    ? `${selectedDate} 暂无符合当前筛选条件的日程安排。`
                    : `${currentMonth} 当月暂无符合当前筛选条件的日程安排。`}
                </div>
                {(kindFilter !== 'all' || productFilter !== 'all') && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setKindFilter('all');
                      setProductFilter('all');
                    }}
                  >
                    清除类型与产品筛选
                  </Button>
                )}
                {agendaScope === 'day' && monthEvents.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAgendaScope('month')}
                  >
                    查看当月全部 {monthEvents.length} 项日程
                  </Button>
                )}
              </div>
            ) : (
              <div className="cal-agenda-list">
                {agendaEvents.map((ev) => {
                  const kMeta = KIND_META[ev.kind];
                  const sub = subscriptionMap.get(ev.subscriptionId);
                  const overdue = isRenewalOverdue(ev);

                  return (
                    <article
                      key={ev.id}
                      className="cal-agenda-card"
                      data-overdue={overdue}
                    >
                      <div className="cal-agenda-card-header">
                        <div className="cal-agenda-title-row">
                          <Badge variant={kMeta.badgeVariant}>
                            {kMeta.label}
                          </Badge>
                          <BrandIcon product={ev.product} size={18} />
                          <strong>{ev.product}</strong>
                          <span className="muted">（{ev.account}）</span>
                        </div>
                        {renderEventNatureBadge(ev)}
                        {ev.kind === 'renewal' && paymentCountFor(ev) > 0 ? (
                          <Badge variant="secondary">已记录 {paymentCountFor(ev)} 笔付款</Badge>
                        ) : null}
                      </div>

                      <div className="cal-agenda-meta">
                        <div>
                          <span className="cal-agenda-meta-label">
                            日程日期：
                          </span>
                          <span>{ev.date}</span>
                          {ev.instant && (
                            <span>
                              {' '}
                              · {formatInstantInZone(ev.instant, ev.timezone)}
                            </span>
                          )}
                        </div>
                        <div>
                          <span className="cal-agenda-meta-label">
                            订阅时区：
                          </span>
                          <span>{ev.timezone}</span>
                          {sub?.anchorDate && (
                            <span>（锚点：{sub.anchorDate}）</span>
                          )}
                        </div>
                        <div>
                          <span className="cal-agenda-meta-label">
                            字段来源：
                          </span>
                          <span>{ev.source}</span>
                        </div>
                        <div>
                          <span className="cal-agenda-meta-label">
                            费用与套餐：
                          </span>
                          <span>
                            {sub
                              ? `${
                                  sub.price.value !== null
                                    ? money(sub.price.value, sub.currency)
                                    : '金额待补充'
                                }${
                                  sub.plan.value ? ` · ${sub.plan.value}` : ''
                                }`
                               : '订阅记录'}
                          </span>
                        </div>
                      </div>


                      <div className="cal-agenda-actions">
                        {ev.kind === 'renewal' && paymentCountFor(ev) === 0 ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onRecordPayment?.(ev.subscriptionId, ev.date)}
                          >
                            记录付款
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onOpen(ev.subscriptionId)}
                        >
                          查看 / 编辑订阅详情
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      )}

    </div>
  );
}
