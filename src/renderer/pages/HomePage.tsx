import { ArrowRight, CalendarDays, Layers, Plus, Receipt, ShieldCheck, Wallet } from 'lucide-react';
import type { Navigate, PageProps } from '../contracts';
import { exactMoney, monthOf, recordedTotal } from '../../shared/spending';
import { monthlySummary } from '../../shared/rules';
import { Button } from '../components/ui/button';
import { BrandIcon } from '../components/ui';

const BRANDS = ['ChatGPT', 'Claude', 'Kimi API', 'DeepSeek API', 'GitHub Copilot', 'OpenRouter'];

export function HomePage({
  snapshot,
  onCreate,
  onNavigate,
}: PageProps & { onNavigate: Navigate }) {
  const currency = snapshot.preferences.statisticsCurrency;
  const month = monthOf(snapshot.now);
  const active = snapshot.subscriptions.filter((s) => s.lifecycle !== 'archived');
  const cost = monthlySummary(snapshot.subscriptions).totals.find((t) => t.currency === currency);
  const recorded = recordedTotal(snapshot.payments, month, currency);
  const upcomingCount = active.filter((s) => s.renewalDate.value).length;

  return (
    <div className="sc-page-inner">
      <section className="relative overflow-hidden rounded-(--sc-radius-panel) border border-(--sc-border) bg-(--sc-surface) px-7 py-9 sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-(--sc-accent-soft) blur-2xl" />
        <div className="relative grid items-center gap-9 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div>
            <p className="sc-eyebrow flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-(--sc-accent)" />
              给每一笔订阅，一个清晰的安排
            </p>
            <h1 className="my-4 text-[40px] leading-[1.08] font-black tracking-tight sm:text-[52px]">
              订阅有数，<br />生活有序。
            </h1>
            <p className="m-0 max-w-xl text-[15px] leading-relaxed text-(--sc-muted)">
              从每月账单到下次续费，把散落的订阅收在一起。花得明白，也记得从容。
              你的资料只保存在本机，不需要注册账号。
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button type="button" variant="tactile" size="tactile" onClick={() => onNavigate('dashboard')}>
                进入我的工作台 <ArrowRight />
              </Button>
              <Button type="button" variant="tactile-soft" size="tactile" onClick={onCreate}>
                <Plus /> 添加第一笔订阅
              </Button>
            </div>
            <p className="mt-5 mb-0 flex items-center gap-2 text-xs font-bold text-(--sc-muted)">
              <ShieldCheck className="size-4" /> 本地保存 · 无需注册 · 凭据不进入备份
            </p>
          </div>

          <div className="rounded-(--sc-radius-panel) border border-(--sc-border) bg-(--sc-canvas) p-5">
            <div className="mb-3 flex items-center justify-between">
              <strong className="text-sm font-black">我的订阅</strong>
              <span className="sc-badge" data-tone="accent">真实本地数据</span>
            </div>
            <div className="rounded-(--sc-radius) bg-(--sc-accent-soft) px-4 py-4">
              <small className="text-xs font-extrabold text-(--sc-accent-ink)">每月订阅成本 · {currency}</small>
              <strong className="mt-1 block text-[32px] leading-none font-black tabular-nums">
                {cost ? exactMoney(cost.amount, currency) : '—'}
              </strong>
              <p className="m-0 mt-1 text-xs font-bold text-(--sc-accent-ink)">
                {active.length} 项有效订阅 · {upcomingCount} 项有续费日期
              </p>
            </div>
            <div className="mt-3 flex flex-col">
              {active.slice(0, 3).map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  className="flex items-center gap-3 border-0 border-b border-(--sc-border-soft) bg-transparent py-2.5 text-left last:border-0"
                  onClick={() => onNavigate('subscriptions')}
                >
                  <span className="sc-brand-icon"><BrandIcon product={sub.product} brand={sub.brand} size={19} /></span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <strong className="truncate text-[13px] font-extrabold">{sub.product}</strong>
                    <small className="text-[11px] text-(--sc-muted)">{sub.plan.value ?? sub.category ?? '套餐待补充'}</small>
                  </span>
                  <span className="text-right">
                    <b className="block text-[13px] font-black tabular-nums">{sub.price.value ? exactMoney(sub.price.value, sub.currency) : '—'}</b>
                    <small className="text-[11px] text-(--sc-muted)">{sub.renewalDate.value ?? '日期待补充'}</small>
                  </span>
                </button>
              ))}
              {active.length === 0 ? (
                <p className="m-0 py-4 text-center text-xs text-(--sc-muted)">
                  还没有订阅。添加第一笔后，这里会显示真实资料，不使用演示账单。
                </p>
              ) : null}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-(--sc-border-soft) pt-3">
              <span className="text-[11px] font-bold text-(--sc-muted)">本月已记录 {exactMoney(recorded, currency)}</span>
              <button type="button" className="sc-link" onClick={() => onNavigate('dashboard')}>打开工作台 <ArrowRight /></button>
            </div>
          </div>
        </div>
      </section>

      <section className="sc-panel" aria-label="支持的服务">
        <p className="m-0 text-center text-xs font-extrabold tracking-wide text-(--sc-muted)">
          你的数字生活，不必散落在各个角落
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
          {BRANDS.map((name) => (
            <span key={name} className="flex items-center gap-2 text-sm font-extrabold text-(--sc-fg-2)">
              <BrandIcon product={name} size={22} /> {name}
            </span>
          ))}
        </div>
        <p className="m-0 mt-4 text-center text-[11px] text-(--sc-muted)">
          品牌图标用于识别已记录的服务；真实读取能力取决于各供应商接口与账号授权。
        </p>
      </section>

      <section className="sc-grid-2-even" aria-label="产品功能">
        {[
          {
            no: '01 / SUBSCRIPTIONS',
            title: '所有订阅，一目了然',
            body: '套餐、费用、账期和账号集中记录。保留原有订阅卡片的密度、额度条与账号分组。',
            action: () => onNavigate('subscriptions'),
            label: '整理我的订阅',
            icon: <Layers />,
          },
          {
            no: '02 / SPENDING',
            title: '知道钱花在哪里',
            body: '把已记录支出与计划扣费分开，按实际支付月份查看变化。不同币种独立统计。',
            action: () => onNavigate('expenses'),
            label: '查看消费趋势',
            icon: <Receipt />,
          },
          {
            no: '03 / CALENDAR',
            title: '到期之前，心里有数',
            body: '续费、会员到期、试用结束各有标记。月历与日程帮你安排接下来要处理的事。',
            action: () => onNavigate('calendar'),
            label: '打开订阅日历',
            icon: <CalendarDays />,
          },
          {
            no: '04 / ACCOUNTS',
            title: '账号集中整理',
            body: '用真实登录或 Key 添加账号，自动建立订阅并更新额度；失败时保留账号与旧观察值。',
            action: () => onNavigate('accounts'),
            label: '管理账号',
            icon: <Wallet />,
          },
        ].map((item) => (
          <article key={item.no} className="sc-panel flex flex-col gap-2">
            <span className="flex items-center gap-2 text-[11px] font-black tracking-wider text-(--sc-accent-ink)">
              {item.icon} {item.no}
            </span>
            <h2 className="m-0 text-xl font-black">{item.title}</h2>
            <p className="m-0 text-sm leading-relaxed text-(--sc-muted)">{item.body}</p>
            <button type="button" className="sc-link mt-1" onClick={item.action}>{item.label} <ArrowRight /></button>
          </article>
        ))}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-(--sc-radius-panel) bg-(--sc-accent-soft) px-7 py-6">
        <div>
          <h2 className="m-0 text-2xl font-black">从整理第一笔订阅开始。</h2>
          <p className="m-0 mt-1 text-sm font-semibold text-(--sc-accent-ink)">给每月支出一点秩序，给自己少一点惦记。</p>
        </div>
        <Button type="button" variant="tactile" size="tactile" onClick={() => onNavigate('dashboard')}>
          进入我的工作台 <ArrowRight />
        </Button>
      </section>

      <p className="sc-footer-note">
        <span>SubCal · 订阅有数，生活有序</span>
        <span>资料保存在本机；外部日历同步按实际接入状态显示</span>
      </p>
    </div>
  );
}
