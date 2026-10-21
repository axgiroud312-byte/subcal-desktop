import { useMemo } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Layers,
  Plus,
  Receipt,
  Target,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PageProps, Navigate } from '../contracts';
import { dateInZone, decimal, decimalText, monthlySummary, projectEvents } from '../../shared/rules';
import {
  exactMoney,
  monthOf,
  paymentsForMonth,
  plannedMonth,
  recordedTotal,
  recordedTotals,
  shiftMonth,
  upcomingEvents,
} from '../../shared/spending';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { MiniCalendar } from '../components/MiniCalendar';
import { Button } from '../components/ui/button';
import './overview.css';

function monthStart(month: string): string {
  return `${month}-01`;
}

export function DashboardPage({
  snapshot,
  client,
  notify,
  onOpen,
  onConnection,
  onCreate,
  onNavigate,
  onRecordPayment,
}: PageProps & {
  onNavigate: Navigate;
  onRecordPayment: (subscriptionId?: string, planDate?: string) => void;
}) {
  const currency = snapshot.preferences.statisticsCurrency;
  const today = dateInZone(snapshot.now, snapshot.preferences.timezone);
  const month = monthOf(today);
  const payments = snapshot.payments;
  const active = useMemo(
    () => snapshot.subscriptions.filter((s) => s.lifecycle !== 'archived'),
    [snapshot.subscriptions],
  );

  const cost = useMemo(() => monthlySummary(snapshot.subscriptions), [snapshot.subscriptions]);
  const costCurrency = cost.totals.find((t) => t.currency === currency);
  const monthPayments = paymentsForMonth(payments, month, currency);
  const otherCurrencies = recordedTotals(payments, month).filter((item) => item.currency !== currency);
  const monthTotal = recordedTotal(payments, month, currency);
  const planned = plannedMonth(snapshot.subscriptions, month, snapshot.now);
  const plannedCurrency = planned.totals.find((t) => t.currency === currency);
  const upcoming = upcomingEvents(snapshot.subscriptions, snapshot.now, 7);
  const upcomingCost = useMemo(() => {
    const seen = new Set<string>();
    let total = 0n;
    for (const item of upcoming) {
      if (item.event.kind !== 'renewal') continue;
      const key = `${item.sub.billingGroupId || item.sub.id}:${item.event.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.sub.currency !== currency) continue;
      if (item.sub.price.availability !== 'known' || item.sub.price.value === null) continue;
      total += decimal(item.sub.price.value);
    }
    return decimalText(total);
  }, [upcoming, currency]);

  const chartMonths = useMemo(
    () => Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)),
    [month],
  );
  const chartData = useMemo(
    () =>
      chartMonths.map((m) => {
        const amount = recordedTotal(payments, m, currency);
        return { month: m, amount, value: Number(amount) };
      }),
    [chartMonths, payments, currency],
  );
  const hasLedger = chartData.some((point) => point.value > 0);

  const myCards = useMemo(() => {
    const list = active.filter((s) => s.lifecycle !== 'archived');
    return [...list]
      .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
      .slice(0, 2);
  }, [active]);

  const events = useMemo(
    () => projectEvents(active, snapshot.now),
    [active, snapshot.now],
  );

  const budget = snapshot.preferences.monthlyBudgets[currency];
  const remaining = budget === undefined ? null : decimalText(decimal(budget) - decimal(monthTotal));
  const overBudget = remaining !== null && remaining.startsWith('-');

  return (
    <div className="sc-page-inner">
      <header className="sc-heading">
        <div className="sc-heading-copy">
          <p className="sc-eyebrow">YOUR SUBSCRIPTIONS, IN SYNC</p>
          <h1>每一笔订阅，都心中有数。</h1>
          <p>
            今天是 {today.slice(0, 4)} 年 {Number(today.slice(5, 7))} 月 {Number(today.slice(8, 10))} 日。
            已记录支出与计划扣费分开统计，金额以原币种呈现。
          </p>
        </div>
        <div className="sc-heading-actions">
          <span className="sc-badge" data-tone="accent">
            <CalendarDays className="size-3.5" /> {monthStart(month).slice(0, 7)}
          </span>
          <Button type="button" variant="tactile" size="tactile" onClick={onCreate}>
            <Plus /> 添加订阅
          </Button>
        </div>
      </header>

      <section className="sc-stats" aria-label="订阅概览">
        <article className="sc-stat is-featured">
          <div className="sc-stat-label"><span>月均订阅成本</span><Wallet /></div>
          <div className="sc-stat-value">{costCurrency ? exactMoney(costCurrency.amount, currency) : '—'}</div>
          <p className="sc-stat-foot">
            <CircleDollarSign />
            {costCurrency ? `按当前周期折算 · ${currency}` : '尚无该币种的周期金额'}
            {cost.unknown > 0 ? ` · ${cost.unknown} 项金额未知` : ''}
          </p>
        </article>
        <article className="sc-stat">
          <div className="sc-stat-label"><span>本月已记录支出</span><Receipt /></div>
          <div className="sc-stat-value">{exactMoney(monthTotal, currency)}</div>
          <p className="sc-stat-foot">
            <Receipt /> 来自 {monthPayments.length} 笔真实付款记录
            {otherCurrencies.length ? ` · 另有 ${otherCurrencies.map((item) => `${item.currency} ${exactMoney(item.amount, item.currency)}`).join('、')}` : ''}
          </p>
        </article>
        <article className="sc-stat">
          <div className="sc-stat-label"><span>活跃订阅</span><Layers /></div>
          <div className="sc-stat-value">{active.length}<span className="unit">项</span></div>
          <p className="sc-stat-foot">
            <Layers /> {new Set(active.map((s) => s.category ?? '其他')).size} 个分类，有序管理中
          </p>
        </article>
        <article className="sc-stat">
          <div className="sc-stat-label"><span>未来 7 天待处理</span><CalendarDays /></div>
          <div className="sc-stat-value">{upcoming.length}<span className="unit">项</span></div>
          <p className="sc-stat-foot">
            <CalendarDays /> 其中预计扣费 {exactMoney(upcomingCost, currency)}
          </p>
        </article>
      </section>

      <div className="sc-grid-2">
        <section className="sc-panel" aria-label="支出走势">
          <div className="sc-panel-head">
            <div>
              <h2>支出走势</h2>
              <p>只统计已经记录的付款，不把计划当成已花</p>
            </div>
            <span className="sc-badge" data-tone="accent">{currency}</span>
          </div>
          <div className="sc-panel-body">
            <div className="flex flex-wrap items-baseline gap-2">
              <strong className="text-[26px] font-black tabular-nums">{exactMoney(monthTotal, currency)}</strong>
              <span className="text-xs font-bold text-(--sc-muted)">本月已记录 · {monthPayments.length} 笔</span>
            </div>
            {hasLedger ? (
              <div style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 8, right: 6, bottom: 0, left: -18 }}
                    onClick={(state) => {
                      const label = (state as { activeLabel?: string } | undefined)?.activeLabel;
                      if (label) onNavigate('expenses', { month: label });
                    }}
                  >
                    <defs>
                      <linearGradient id="sc-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--sc-chart-primary)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--sc-chart-primary)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--sc-chart-track)" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tickFormatter={(value: string) => `${Number(value.slice(5))} 月`}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--sc-muted)', fontSize: 11, fontWeight: 700 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={62}
                      tick={{ fill: 'var(--sc-muted)', fontSize: 11, fontWeight: 700 }}
                    />
                    <Tooltip
                      cursor={{ stroke: 'var(--sc-accent-line)', strokeDasharray: '4 4' }}
                      content={({ active: isActive, payload, label }) => {
                        if (!isActive || !payload?.length) return null;
                        const row = payload[0].payload as { month: string; amount: string };
                        return (
                          <div className="sc-ui rounded-(--sc-radius-sm) border border-(--sc-border) bg-(--sc-surface) px-3 py-2 text-xs shadow-lg">
                            <strong className="block text-sm">{row.month}</strong>
                            <span className="text-(--sc-muted)">已记录 {exactMoney(row.amount, currency)}</span>
                            <span className="mt-1 block text-[11px] text-(--sc-muted)">点击查看 {label} 的明细</span>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--sc-chart-primary)"
                      strokeWidth={2.5}
                      fill="url(#sc-area)"
                      activeDot={{ r: 5 }}
                      dot={{ r: 3, fill: 'var(--sc-chart-primary)' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="sc-empty">
                <Receipt />
                <h3>还没有可绘制的支出</h3>
                <p>记录第一笔真实付款后，这里会按实际支付月份显示趋势。计划扣费不会画成已花金额。</p>
                <Button type="button" variant="tactile-soft" size="tactile-sm" onClick={() => onRecordPayment()}>
                  记录付款
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 text-[11px] text-(--sc-muted)">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-(--sc-chart-primary)" /> 已记录支出</span>
              <span>按 {currency} 单独统计，不混合币种</span>
            </div>
          </div>
        </section>

        <section className="sc-panel" aria-label="近期续费与到期">
          <div className="sc-panel-head">
            <div>
              <h2>近期续费与到期</h2>
              <p>提前知道，从容安排</p>
            </div>
            <span className="sc-badge" data-tone="accent">{upcoming.length} 项</span>
          </div>
          {upcoming.length ? (
            <>
              <div className="mb-2 flex items-center gap-2 rounded-(--sc-radius-sm) bg-(--sc-accent-soft) px-3 py-2 text-[12px] font-bold text-(--sc-accent-ink)">
                <CalendarDays className="size-4" />
                下一项：{upcoming[0].sub.product}，
                {upcoming[0].days === 0 ? '今天' : upcoming[0].days === 1 ? '明天' : `${upcoming[0].days} 天后`}
                {upcoming[0].event.kind === 'renewal' ? ' 计划续费' : ' 到期'}
              </div>
              <div className="sc-list">
                {upcoming.slice(0, 4).map(({ event, sub, days }) => (
                  <div key={event.id} className="sc-row">
                    <span className="sc-brand-icon" aria-hidden="true">
                      {sub.brand.slice(0, 1).toUpperCase()}
                    </span>
                    <button type="button" className="sc-row-main border-0 bg-transparent p-0 text-left" onClick={() => onOpen(sub.id)}>
                      <strong>{sub.product}</strong>
                      <small>{event.date} · {event.kind === 'renewal' ? '计划续费' : event.kind === 'expiry' ? '会员到期' : event.kind === 'trial' ? '试用结束' : '额度重置'}</small>
                    </button>
                    <div className="sc-row-end">
                      <b>{event.kind === 'renewal' && sub.price.value ? exactMoney(sub.price.value, sub.currency) : days === 0 ? '今天' : `${days} 天后`}</b>
                      {event.kind === 'renewal' ? (
                        <button type="button" className="sc-link mt-1" onClick={() => onRecordPayment(sub.id, event.date)}>
                          记录付款
                        </button>
                      ) : <small>{days === 0 ? '今天' : `${days} 天后`}</small>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="sc-empty">
              <CalendarDays />
              <h3>近期没有待办</h3>
              <p>接下来 7 天没有续费或到期事项。日期未知的订阅不会在这里编造日期。</p>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <button type="button" className="sc-link" onClick={() => onNavigate('calendar')}>查看全部日程 <ArrowUpRight /></button>
            <span className="text-[11px] text-(--sc-muted)">
              {planned.excluded > 0 ? `${planned.excluded} 组计划存在金额/币种冲突，已从估算排除` : planned.unknown > 0 ? `${planned.unknown} 项计划金额未知` : ''}
            </span>
          </div>
        </section>
      </div>

      <div className="sc-grid-2">
        <section className="sc-panel" aria-label="我的订阅">
          <div className="sc-panel-head">
            <div>
              <h2>我的订阅</h2>
              <p>沿用原有订阅卡片，未改成简化价格卡</p>
            </div>
            <button type="button" className="sc-link" onClick={() => onNavigate('subscriptions')}>查看全部 <ArrowUpRight /></button>
          </div>
          {myCards.length ? (
            <div className="subcal-magpie">
              <section className="cards-grid density-comfortable" aria-label="订阅卡片">
                {myCards.map((sub) => (
                  <SubscriptionCard
                    key={sub.id}
                    subscription={sub}
                    accounts={snapshot.subscriptions.filter(
                      (s) => s.id !== sub.id && s.product === sub.product && s.brand === sub.brand,
                    )}
                    allSubscriptions={snapshot.subscriptions}
                    connections={snapshot.connections}
                    now={snapshot.now}
                    preferences={snapshot.preferences}
                    onOpen={onOpen}
                    onRefresh={(id) => {
                      void client.refresh(id).then((msg) => notify(msg)).catch((e) => notify((e as Error).message));
                    }}
                    onConnection={onConnection}
                  />
                ))}
              </section>
            </div>
          ) : (
            <div className="sc-empty">
              <Layers />
              <h3>从第一笔订阅开始</h3>
              <p>添加常用服务后，续费、支出和日历会一起整理。</p>
              <Button type="button" variant="tactile" size="tactile-sm" onClick={onCreate}><Plus /> 添加订阅</Button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-(--sc-border-soft) pt-3">
            <span className="flex items-center gap-1.5 text-[12px] font-bold text-(--sc-muted)">
              <Target className="size-4" />
              {budget === undefined ? '尚未设置本月预算' : `本月预算 ${exactMoney(budget, currency)} · ${overBudget ? `已超出 ${exactMoney(remaining!.slice(1), currency)}` : `余量 ${exactMoney(remaining ?? '0', currency)}`}`}
            </span>
            <button type="button" className="sc-link" onClick={() => onNavigate('expenses')}>查看消费管理 <ArrowUpRight /></button>
          </div>
        </section>

        <MiniCalendar
          month={month}
          now={snapshot.now}
          events={events}
          onOpenCalendar={() => onNavigate('calendar')}
        />
      </div>

      <p className="sc-footer-note">
        <span>本地工作区 · 数据保存在本机资料库</span>
        <span>{planned.occurrences} 项本月计划 · 实付 {monthPayments.length} 笔</span>
      </p>
    </div>
  );
}
