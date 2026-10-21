import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Receipt,
  Search,
  Target,
  Trash2,
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
import type { PageProps } from '../contracts';
import type { PaymentRecord } from '../../shared/types';
import { dateInZone, decimal } from '../../shared/rules';
import {
  budgetProgress,
  categoryTotals,
  exactMoney,
  monthOf,
  paymentsForMonth,
  plannedMonth,
  recordedTotal,
  shiftMonth,
} from '../../shared/spending';
import { PaymentForm, type PaymentDraftContext } from '../components/PaymentForm';
import { Button } from '../components/ui/button';

const PAGE_SIZE = 10;

export function ExpensesPage({
  snapshot,
  client,
  notify,
  focusMonth,
  onFocusMonthHandled,
  onCreate,
}: PageProps & {
  focusMonth?: string | null;
  onFocusMonthHandled?: () => void;
}) {
  const today = dateInZone(snapshot.now, snapshot.preferences.timezone);
  const [month, setMonth] = useState(() => monthOf(today));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<PaymentDraftContext | null>(null);
  const [formSeq, setFormSeq] = useState(0);
  const openForm = (context: PaymentDraftContext) => {
    setForm(context);
    setFormSeq((n) => n + 1);
  };

  useEffect(() => {
    if (!focusMonth) return;
    setMonth(focusMonth);
    setPage(1);
    onFocusMonthHandled?.();
  }, [focusMonth, onFocusMonthHandled]);

  const currency = snapshot.preferences.statisticsCurrency;
  const monthPayments = useMemo(
    () => paymentsForMonth(snapshot.payments, month, currency),
    [snapshot.payments, month, currency],
  );
  const total = recordedTotal(snapshot.payments, month, currency);
  const planned = plannedMonth(snapshot.subscriptions, month, snapshot.now);
  const plannedValue = planned.totals.find((t) => t.currency === currency)?.amount ?? null;
  const budget = snapshot.preferences.monthlyBudgets[currency] ?? null;
  const spentProgress = budgetProgress(total, budget);
  const planProgress = budget === null ? null : budgetProgress(plannedValue ?? '0', budget);
  const categories = categoryTotals(snapshot.payments, month, currency);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return monthPayments.filter((payment) => {
      if (category !== 'all' && payment.category !== category) return false;
      if (!q) return true;
      return [payment.name, payment.note, payment.category, payment.subscriptionId ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [monthPayments, query, category]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const chartMonths = useMemo(
    () => Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)),
    [month],
  );
  const chartData = chartMonths.map((m) => {
    const amount = recordedTotal(snapshot.payments, m, currency);
    return { month: m, amount, value: Number(amount) };
  });
  const hasLedger = chartData.some((point) => point.value > 0);

  const remove = async (payment: PaymentRecord) => {
    try {
      const token = await client.removePayment(payment.id);
      notify(`已删除「${payment.name}」的付款记录`, {
        label: '撤销删除',
        duration: 8000,
        run: () => {
          void client
            .undoPayment(token)
            .then(() => notify('已恢复付款记录'))
            .catch((e) => notify((e as Error).message));
        },
      });
    } catch (err) {
      notify((err as Error).message);
    }
  };

  return (
    <div className="sc-page-inner">
      <header className="sc-heading">
        <div className="sc-heading-copy">
          <p className="sc-eyebrow">SPENDING INSIGHTS</p>
          <h1>花在哪里，看得明白。</h1>
          <p>实际支出按付款日归月，计划扣费来自订阅计划，两种口径不混加。</p>
        </div>
        <div className="sc-heading-actions">
          <div className="inline-flex items-center gap-1 rounded-(--sc-radius-sm) border border-(--sc-border) bg-(--sc-surface) p-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="上个月" onClick={() => { setMonth((m) => shiftMonth(m, -1)); setPage(1); }}>
              <ChevronLeft />
            </Button>
            <input
              className="h-8 w-32 border-0 bg-transparent text-center text-sm font-extrabold tabular-nums"
              type="month"
              aria-label="统计月份"
              min="1900-01"
              max="2200-12"
              value={month}
              onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setPage(1); } }}
            />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="下个月" onClick={() => { setMonth((m) => shiftMonth(m, 1)); setPage(1); }}>
              <ChevronRight />
            </Button>
          </div>
          <Button type="button" variant="tactile" size="tactile" onClick={() => openForm({})}>
            <Plus /> 记录付款
          </Button>
        </div>
      </header>

      <section className="sc-stats" aria-label="消费汇总">
        <article className="sc-stat is-featured">
          <div className="sc-stat-label"><span>已记录支出</span><Receipt /></div>
          <div className="sc-stat-value">{exactMoney(total, currency)}</div>
          <p className="sc-stat-foot"><Receipt /> {monthPayments.length} 笔真实付款 · {month}</p>
        </article>
        <article className="sc-stat">
          <div className="sc-stat-label"><span>本月预计扣费</span><CalendarDays /></div>
          <div className="sc-stat-value">{plannedValue === null ? '—' : exactMoney(plannedValue, currency)}</div>
          <p className="sc-stat-foot">
            <CalendarDays />
            来自计划 · {planned.occurrences} 项
            {planned.unknown > 0 ? ` · ${planned.unknown} 项金额未知` : ''}
            {planned.excluded > 0 ? ` · ${planned.excluded} 组冲突已排除` : ''}
          </p>
        </article>
        <article className="sc-stat">
          <div className="sc-stat-label"><span>每月预算</span><Target /></div>
          <div className="sc-stat-value">{budget === null ? '未设置' : exactMoney(budget, currency)}</div>
          <p className="sc-stat-foot"><Target /> 与钱包阈值、供应商 Key 预算独立</p>
        </article>
        <article className="sc-stat">
          <div className="sc-stat-label"><span>按已记录支出的余量</span><Wallet /></div>
          <div className="sc-stat-value">
            {budget === null || spentProgress.remaining === null ? '—' : exactMoney(spentProgress.remaining.startsWith('-') ? spentProgress.remaining.slice(1) : spentProgress.remaining, currency)}
          </div>
          <p className="sc-stat-foot">
            <Wallet />
            {budget === null ? '在偏好设置中设置预算后计算' : spentProgress.over ? '本币种已超出预算' : '仅按实际付款计算'}
          </p>
        </article>
      </section>

      <div className="sc-grid-2">
        <section className="sc-panel" aria-label="支出趋势">
          <div className="sc-panel-head">
            <div>
              <h2>过去 6 个月的支出</h2>
              <p>只统计已记录的付款，点击数据点切换月份</p>
            </div>
            <span className="sc-badge" data-tone="accent">{currency}</span>
          </div>
          <div className="sc-panel-body">
            <div className="flex flex-wrap items-baseline gap-2">
              <strong className="text-[26px] font-black tabular-nums">{exactMoney(total, currency)}</strong>
              <span className="text-xs font-bold text-(--sc-muted)">{Number(month.slice(5))} 月已记录</span>
            </div>
            {hasLedger ? (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 8, right: 6, bottom: 0, left: -18 }}
                    onClick={(state) => {
                      const label = (state as { activeLabel?: string } | undefined)?.activeLabel;
                      if (label) { setMonth(label); setPage(1); }
                    }}
                  >
                    <defs>
                      <linearGradient id="expense-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--sc-chart-primary)" stopOpacity={0.26} />
                        <stop offset="100%" stopColor="var(--sc-chart-primary)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--sc-chart-track)" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={(v: string) => `${Number(v.slice(5))} 月`} axisLine={false} tickLine={false} tick={{ fill: 'var(--sc-muted)', fontSize: 11, fontWeight: 700 }} />
                    <YAxis axisLine={false} tickLine={false} width={62} tick={{ fill: 'var(--sc-muted)', fontSize: 11, fontWeight: 700 }} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as { month: string; amount: string };
                        return (
                          <div className="sc-ui rounded-(--sc-radius-sm) border border-(--sc-border) bg-(--sc-surface) px-3 py-2 text-xs shadow-lg">
                            <strong className="block text-sm">{row.month}</strong>
                            <span className="text-(--sc-muted)">{exactMoney(row.amount, currency)}</span>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="value" stroke="var(--sc-chart-primary)" strokeWidth={2.5} fill="url(#expense-area)" dot={{ r: 3, fill: 'var(--sc-chart-primary)' }} activeDot={{ r: 5 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="sc-empty">
                <Receipt />
                <h3>这 6 个月还没有付款记录</h3>
                <p>计划扣费只显示在上方统计中，不会替你画成已经花掉的金额。</p>
                <Button type="button" variant="tactile-soft" size="tactile-sm" onClick={() => openForm({})}>记录一笔付款</Button>
              </div>
            )}
          </div>
        </section>

        <section className="sc-panel" aria-label="预算与分类">
          <div className="sc-panel-head">
            <div>
              <h2>预算与支出流向</h2>
              <p>两种口径分开标注</p>
            </div>
            <Target className="size-5 text-(--sc-muted)" />
          </div>
          <div className="sc-panel-body">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
                <span>按已记录支出 {budget !== null ? `· ${Math.round(spentProgress.percent)}%` : ''}</span>
                <span className="text-(--sc-muted)">{budget === null ? '未设置预算' : `${exactMoney(total, currency)} / ${exactMoney(budget, currency)}`}</span>
              </div>
              <div className="sc-progress" data-over={spentProgress.over} role="img" aria-label={budget === null ? '未设置预算' : `已记录支出占预算 ${Math.round(spentProgress.percent)}%`}>
                <span style={{ width: `${Math.max(spentProgress.percent, total !== '0.000000' ? 2 : 0)}%` }} />
              </div>
            </div>
            {planProgress && plannedValue !== null ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
                  <span>按计划预计扣费 · {Math.round(planProgress.percent)}%</span>
                  <span className="text-(--sc-muted)">{exactMoney(plannedValue, currency)} / {exactMoney(budget!, currency)}</span>
                </div>
                <div className="sc-progress" data-over={planProgress.over}>
                  <span style={{ width: `${Math.max(planProgress.percent, 2)}%`, background: 'var(--sc-chart-secondary)' }} />
                </div>
              </div>
            ) : null}

            <div className="mt-1 flex flex-col gap-2">
              <strong className="text-xs font-extrabold text-(--sc-fg-2)">本月分类</strong>
              {categories.length ? (
                categories.map((item) => {
                  const percent = Number(decimal(item.amount)) / Math.max(Number(total) || 1, 0.000001);
                  return (
                    <button
                      key={item.category}
                      type="button"
                      className="flex flex-col gap-1 border-0 bg-transparent p-0 text-left"
                      onClick={() => { setCategory(item.category); setPage(1); }}
                    >
                      <span className="flex items-center justify-between gap-2 text-xs font-bold">
                        <span>{item.category} <span className="text-(--sc-muted)">· {item.count} 笔</span></span>
                        <span className="tabular-nums">{exactMoney(item.amount, currency)}</span>
                      </span>
                      <span className="sc-progress h-1.5"><span style={{ width: `${Math.max(percent * 100, 2)}%` }} /></span>
                    </button>
                  );
                })
              ) : (
                <p className="m-0 text-xs text-(--sc-muted)">记录付款后，这里会展示分类占比。</p>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="sc-panel" aria-label="付款明细">
        <div className="sc-panel-head">
          <div>
            <h2>付款明细</h2>
            <p>每笔支出都来自一条真实记录，可修改、删除和撤销</p>
          </div>
          <span className="sc-badge">{filtered.length} 笔</span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-(--sc-muted)" />
            <input
              className="sc-input pl-9"
              type="search"
              placeholder="搜索服务或备注"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              aria-label="搜索付款记录"
            />
          </label>
          <select className="sc-select w-40" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="付款分类">
            <option value="all">全部分类</option>
            {[...new Set([...(snapshot.preferences.categories ?? []), ...monthPayments.map((p) => p.category)])].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className="text-xs text-(--sc-muted)">{month} · {currency}</span>
        </div>

        {rows.length ? (
          <div className="sc-table-wrap">
            <table className="sc-table">
              <thead>
                <tr>
                  <th>订阅服务</th>
                  <th>付款日期</th>
                  <th>分类</th>
                  <th className="num">实付金额</th>
                  <th><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((payment) => {
                  const sub = payment.subscriptionId
                    ? snapshot.subscriptions.find((s) => s.id === payment.subscriptionId)
                    : null;
                  return (
                    <tr key={payment.id}>
                      <td>
                        <div className="sc-table-name">
                          <span className="sc-brand-icon" aria-hidden="true">{(sub?.brand ?? payment.name).slice(0, 1).toUpperCase()}</span>
                          <div>
                            <strong>{payment.name}</strong>
                            <small>
                              {sub ? (sub.lifecycle === 'archived' ? '订阅已归档 · 历史付款保留' : sub.product) : '独立支出'}
                              {payment.note ? ` · ${payment.note}` : ''}
                              {payment.source === 'imported' ? ' · 备份导入' : ''}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="tabular-nums">{payment.paidOn}</td>
                      <td><span className="sc-badge">{payment.category}</span></td>
                      <td className="num"><strong>{exactMoney(payment.amount, payment.currency)}</strong></td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`编辑 ${payment.name} 的付款`} onClick={() => openForm({ payment })}>
                            <Pencil />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除 ${payment.name} 的付款`} onClick={() => void remove(payment)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sc-empty">
            <Receipt />
            <h3>{monthPayments.length ? '没有匹配的付款记录' : '这个月还没有付款记录'}</h3>
            <p>
              {monthPayments.length
                ? '换个关键词或分类再看看，已记录的付款不会消失。'
                : '付款记录与预计扣费分开统计。记录一笔实际付款后，这里会立刻出现。'}
            </p>
            <div className="flex gap-2">
              {monthPayments.length ? (
                <Button type="button" variant="tactile-soft" size="tactile-sm" onClick={() => { setQuery(''); setCategory('all'); }}>清除筛选</Button>
              ) : (
                <>
                  <Button type="button" variant="tactile" size="tactile-sm" onClick={() => openForm({})}><Plus /> 记录付款</Button>
                  <Button type="button" variant="tactile-soft" size="tactile-sm" onClick={onCreate}>添加订阅</Button>
                </>
              )}
            </div>
          </div>
        )}

        {filtered.length > PAGE_SIZE ? (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-(--sc-muted)">
            <span>共 {filtered.length} 笔 · 第 {currentPage} / {pages} 页</span>
            <span className="flex gap-1">
              <Button type="button" variant="outline" size="icon-sm" aria-label="上一页" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft /></Button>
              <Button type="button" variant="outline" size="icon-sm" aria-label="下一页" disabled={currentPage >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}><ChevronRight /></Button>
            </span>
          </div>
        ) : null}
      </section>

      <p className="sc-footer-note">
        <span>付款记录不会触发真实扣款，也不改变供应商日期与额度。</span>
        <span>{total} {currency}</span>
      </p>

      <PaymentForm
        key={form ? `${formSeq}-${form.payment?.id ?? 'new'}-${form.payment?.revision ?? 0}` : 'closed'}
        open={form !== null}
        context={form}
        snapshot={snapshot}
        client={client}
        notify={notify}
        onClose={() => setForm(null)}
      />
    </div>
  );
}
