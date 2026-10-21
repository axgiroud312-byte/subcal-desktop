import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarSync,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react';
import type { PageProps } from '../contracts';
import type {
  Backend,
  CalendarEvent,
  EventKind,
  Subscription,
} from '../../shared/types';
import { addDays, dateInZone, daysBetween, money } from '../../shared/rules';
import { BrandIcon, Modal } from '../components/ui';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { FormSelect } from '../components/form-controls';
import { SyncPreview } from '../components/SyncPreview';
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
}: PageProps) {
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
  const [syncModalState, setSyncModalState] = useState<{
    open: boolean;
    backend?: Backend;
  }>({ open: false });

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

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of snapshot.subscriptions) {
      if (s.product) set.add(s.product);
    }
    for (const e of events) {
      if (e.product) set.add(e.product);
    }
    return [...set];
  }, [snapshot.subscriptions, events]);

  useEffect(() => {
    if (productFilter !== 'all' && !productOptions.includes(productFilter)) {
      setProductFilter('all');
    }
  }, [productFilter, productOptions]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (!includeReset && e.kind === 'reset') return false;
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (productFilter !== 'all' && e.product !== productFilter) return false;
      return true;
    });
  }, [events, includeReset, kindFilter, productFilter]);

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

  const targetSummary = useMemo(() => {
    let conflictCount = 0;
    let abnormalTargetCount = 0;
    let firstConflictBackend: Backend | undefined;
    for (const t of snapshot.targets) {
      if (t.state !== 'ready') abnormalTargetCount++;
      const c = t.remote.filter(
        (r) =>
          r.managed &&
          !r.deleted &&
          !r.suppressed &&
          r.date !== r.baselineDate
      ).length;
      if (c > 0 && !firstConflictBackend) firstConflictBackend = t.id;
      conflictCount += c;
    }
    return { conflictCount, abnormalTargetCount, firstConflictBackend };
  }, [snapshot.targets]);

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
            已到计划续费日 · 待确认（未记为已扣费）
          </Badge>
        );
      }
      return <Badge variant="outline">预计续费安排（未扣费）</Badge>;
    }
    if (e.kind === 'reset') {
      return <Badge variant="outline">仅本地展示 · 不计入扣费</Badge>;
    }
    if (e.kind === 'expiry') {
      return <Badge variant="destructive">已记录有效期截止 / 到期</Badge>;
    }
    if (e.kind === 'trial') {
      return <Badge variant="warning">已记录试用结束日</Badge>;
    }
    return <Badge variant="success">已记录开始日</Badge>;
  }

  function renderEventTargetBadges(e: CalendarEvent) {
    if (e.kind === 'reset') {
      return (
        <Badge variant="outline">仅本地展示（不向外日历发布）</Badge>
      );
    }

    const badges: React.ReactNode[] = [];
    for (const t of snapshot.targets) {
      const r = t.remote.find((item) => item.id === e.id);
      if (!r) continue;
      const shortName =
        t.id === 'google'
          ? 'Google'
          : t.id === 'eventkit'
          ? 'macOS EventKit'
          : 'iCloud CalDAV';

      if (r.deleted || r.suppressed) {
        badges.push(
          <Badge key={t.id} variant="outline">
            {shortName}：{r.managed ? '外部已删除·已抑制' : '已解除管理'}
          </Badge>
        );
      } else if (r.date !== r.baselineDate) {
        badges.push(
          <Badge key={t.id} variant="warning">
            {shortName}：外部改期至 {r.date}（冲突待处理）
          </Badge>
        );
      } else if (
        t.state !== 'ready' ||
        r.date !== e.date ||
        r.product !== e.product
      ) {
        badges.push(
          <Badge key={t.id} variant="warning">
            {shortName}：
            {t.state !== 'ready'
              ? '模拟目标暂停 / 待核对'
              : '本地计划已更改 · 待模拟同步'}
          </Badge>
        );
      } else if (t.stage === 'verified') {
        badges.push(
          <Badge key={t.id} variant="secondary">
            {t.id === 'eventkit'
              ? 'EventKit：模拟本机读回一致（iCloud 云端未验证）'
              : `${shortName}：模拟远端读回一致`}
          </Badge>
        );
      } else {
        badges.push(
          <Badge key={t.id} variant="outline">
            {shortName}：{t.message}
          </Badge>
        );
      }
    }

    if (badges.length === 0) {
      return (
        <Badge variant="outline">
          仅本地日程 · 尚未同步至外部模拟目标
        </Badge>
      );
    }
    return <div className="row">{badges}</div>;
  }

  const selectedDelta = daysBetween(demoToday, selectedDate);
  const selectedRelativeLabel =
    selectedDelta === 0
      ? '演示今天'
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
              本地订阅日历 · {currentMonth.replace('-', ' 年 ')} 月
            </h2>
            <Badge variant="outline">
              演示今天：{demoToday}（{userTz}）
            </Badge>
            {loadingEvents && (
              <span className="muted">正在同步本地日程投影…</span>
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
              回到演示今天 ({demoToday})
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
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() =>
                setSyncModalState({
                  open: true,
                  backend: targetSummary.firstConflictBackend || 'google',
                })
              }
            >
              <CalendarSync aria-hidden="true" />
              管理外部日历同步 / 预演
              {targetSummary.conflictCount > 0
                ? `（${targetSummary.conflictCount} 项冲突）`
                : ''}
            </Button>
          </div>
        </div>

        {/* Alert strip if there are calendar conflicts or paused/readonly targets */}
        {(targetSummary.conflictCount > 0 ||
          targetSummary.abnormalTargetCount > 0) && (
          <div className="cal-conflict-strip" role="status">
            <div>
              <div className="cal-conflict-strip-title">
                <AlertTriangle aria-hidden="true" />
                <span>
                  外部日历模拟目标存在待处理项：
                  {targetSummary.conflictCount > 0 &&
                    ` ${targetSummary.conflictCount} 项外部改期冲突`}
                  {targetSummary.conflictCount > 0 &&
                    targetSummary.abnormalTargetCount > 0 &&
                    ' · '}
                  {targetSummary.abnormalTargetCount > 0 &&
                    ` ${targetSummary.abnormalTargetCount} 个目标处于非就绪保护状态`}
                </span>
              </div>
              <div className="muted">
                外部日历改动不会自动改写本地扣费事实；目标只读或移除时保持暂停，不会静默切到系统默认日历。
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSyncModalState({
                  open: true,
                  backend: targetSummary.firstConflictBackend || 'google',
                })
              }
            >
              打开同步预演与冲突裁决
            </Button>
          </div>
        )}

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
                aria-label="显示额度重置（仅本地展示 · 不计入扣费提醒 · 不向外同步）"
              />
              <Label htmlFor={resetSwitchId} className="cal-switch-field">
                显示额度重置（仅本地展示 · 不计入扣费提醒 · 不向外同步）
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
          <strong>当前演示空间暂无订阅记录</strong>
          <p className="muted" style={{ margin: 0 }}>
            添加第一条订阅并填写已知开始日、续费日或试用结束日后，本地月历与日程列表将自动投影对应安排；未知日期不会凭空制造假日程。
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
                <div className="muted">
                  点击日期查看当天安排；预计续费仍需与账单核对。
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
                            } · 点击查看订阅详情`}
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
                <div className="muted">
                  点击事件可在右侧抽屉查看或编辑详情，关闭后保留当前月份与选中日期。
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
                  const hasConflictTarget = snapshot.targets.find((t) =>
                    t.remote.some(
                      (r) =>
                        r.id === ev.id &&
                        r.managed &&
                        !r.deleted &&
                        !r.suppressed &&
                        r.date !== r.baselineDate
                    )
                  );

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
                              : '演示记录'}
                          </span>
                        </div>
                      </div>

                      <div className="cal-agenda-targets">
                        <span className="muted">
                          外部模拟日历确认状态（稳定 ID:{' '}
                          <code className="sync-mono">{ev.id}</code>）：
                        </span>
                        {renderEventTargetBadges(ev)}
                      </div>

                      <div className="cal-agenda-actions">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onOpen(ev.subscriptionId)}
                        >
                          查看 / 编辑订阅详情
                        </Button>
                        {hasConflictTarget ? (
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() =>
                              setSyncModalState({
                                open: true,
                                backend: hasConflictTarget.id,
                              })
                            }
                          >
                            处理 {hasConflictTarget.name} 冲突
                          </Button>
                        ) : (
                          ev.kind !== 'reset' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setSyncModalState({ open: true })}
                            >
                              同步预演
                            </Button>
                          )
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* SyncPreview Modal */}
      {syncModalState.open && (
        <Modal
          title="外部日历同步预演与冲突处理（模拟）"
          onClose={() => setSyncModalState({ open: false })}
          wide
        >
          <SyncPreview
            snapshot={snapshot}
            client={client}
            notify={notify}
            initialBackend={syncModalState.backend}
            modal={false}
          />
        </Modal>
      )}
    </div>
  );
}
