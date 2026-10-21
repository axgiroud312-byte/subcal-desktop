import type { PageProps, NavRoute } from '../contracts';
import { dateInZone } from '../../shared/rules';

export type Navigate = (route: NavRoute, options?: { month?: string }) => void;

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function buildCells(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((firstDow + days) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, 1 - firstDow + i));
    return d.toISOString().slice(0, 10);
  });
}

export function MiniCalendar({
  month,
  now,
  events,
  onOpenCalendar,
}: {
  month: string;
  now: string;
  events: { date: string; product: string; kind: string }[];
  onOpenCalendar: () => void;
}) {
  const today = dateInZone(now);
  const dates = new Set(events.filter((e) => e.date.startsWith(month)).map((e) => e.date));
  const [y, m] = month.split('-').map(Number);
  return (
    <section className="sc-panel" aria-label="本月订阅日历">
      <div className="sc-panel-head">
        <div>
          <h2>{y} 年 {m} 月</h2>
          <p>有安排的日期会标记出来</p>
        </div>
        <button type="button" className="sc-link" onClick={onOpenCalendar}>打开日历</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-extrabold text-(--sc-muted)">
        {WEEKDAYS.map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {buildCells(month).map((date) => {
          const inMonth = date.startsWith(month);
          const isToday = date === today;
          const has = dates.has(date);
          return (
            <button
              key={date}
              type="button"
              className={`relative grid h-8 place-items-center rounded-lg text-xs font-bold tabular-nums transition-colors ${
                isToday
                  ? 'bg-(--sc-accent) text-(--sc-accent-on)'
                  : has
                    ? 'bg-(--sc-accent-soft) text-(--sc-accent-ink)'
                    : inMonth
                      ? 'text-(--sc-fg-2) hover:bg-(--sc-neutral-soft)'
                      : 'text-(--sc-muted) opacity-45'
              }`}
              aria-label={`${date}${has ? '，有订阅事项' : ''}`}
              onClick={onOpenCalendar}
            >
              {Number(date.slice(8, 10))}
              {has && !isToday ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-(--sc-accent)" /> : null}
            </button>
          );
        })}
      </div>
      <p className="m-0 mt-3 flex items-center gap-1.5 text-[11px] text-(--sc-muted)">
        <span className="inline-block h-2 w-2 rounded-full bg-(--sc-accent)" /> 有订阅事项的日期
      </p>
    </section>
  );
}

export type { PageProps };
