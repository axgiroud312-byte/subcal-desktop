import type { CalendarEvent, PaymentRecord, Subscription } from './types';
import {
  anchoredDate,
  dateInZone,
  daysBetween,
  decimal,
  decimalText,
  projectEvents,
} from './rules';

export type MoneyTotal = { currency: string; amount: string };

const REGULAR_CYCLES = ['monthly', 'quarterly', 'yearly', 'days'] as const;

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}

/** Recorded spending only: actual payment date decides the month. */
export function paymentsForMonth(
  payments: readonly PaymentRecord[],
  month: string,
  currency?: string,
): PaymentRecord[] {
  return payments
    .filter((p) => monthOf(p.paidOn) === month && (currency === undefined || p.currency === currency))
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || a.name.localeCompare(b.name));
}

export function recordedTotals(payments: readonly PaymentRecord[], month: string): MoneyTotal[] {
  const sums = new Map<string, bigint>();
  for (const payment of paymentsForMonth(payments, month)) {
    const next = (sums.get(payment.currency) ?? 0n) + decimal(payment.amount);
    sums.set(payment.currency, next);
  }
  return [...sums.entries()]
    .map(([currency, amount]) => ({ currency, amount: decimalText(amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function recordedTotal(
  payments: readonly PaymentRecord[],
  month: string,
  currency: string,
): string {
  let total = 0n;
  for (const payment of paymentsForMonth(payments, month, currency)) {
    total += decimal(payment.amount);
  }
  return decimalText(total);
}

export function spentCurrencies(payments: readonly PaymentRecord[]): string[] {
  return [...new Set(payments.map((p) => p.currency))].sort();
}

export function categoryTotals(
  payments: readonly PaymentRecord[],
  month: string,
  currency: string,
): { category: string; amount: string; count: number }[] {
  const sums = new Map<string, { total: bigint; count: number }>();
  for (const payment of paymentsForMonth(payments, month, currency)) {
    const current = sums.get(payment.category) ?? { total: 0n, count: 0 };
    current.total += decimal(payment.amount);
    current.count += 1;
    sums.set(payment.category, current);
  }
  return [...sums.entries()]
    .map(([category, value]) => ({ category, amount: decimalText(value.total), count: value.count }))
    .sort((a, b) => decimal(b.amount) > decimal(a.amount) ? 1 : decimal(b.amount) < decimal(a.amount) ? -1 : 0);
}

/**
 * Stable identity for one planned occurrence. It is derived from the original
 * anchor plus period index, never from the mutable "next renewal" slot, so an
 * advanced or rescheduled plan keeps its identity.
 */
export function planOccurrenceId(sub: Subscription, planDate: string): string {
  const anchor = sub.anchorDate || sub.renewalDate.value;
  if (!anchor) return `${sub.id}:${sub.cycle}:${planDate}`;
  const index = planIndex(sub, anchor, planDate);
  return index === null
    ? `${sub.id}:${sub.cycle}:${anchor}:at:${planDate}`
    : `${sub.id}:${sub.cycle}:${anchor}:${index}`;
}

function planIndex(sub: Subscription, anchor: string, date: string): number | null {
  const cycle = sub.cycle;
  if (!(REGULAR_CYCLES as readonly string[]).includes(cycle)) return null;
  for (let i = 0; i < 2000; i++) {
    const candidate = anchoredDate(anchor, cycle, i, sub.intervalDays);
    if (candidate === date) return i;
    if (candidate > date) return null;
  }
  return null;
}

/** Next occurrence strictly after the current one, keeping the original anchor. */
export function nextPlanDate(sub: Subscription, currentDate: string): string | null {
  if (!(REGULAR_CYCLES as readonly string[]).includes(sub.cycle)) return null;
  const anchor = sub.anchorDate || currentDate;
  const index = planIndex(sub, anchor, currentDate);
  if (index === null) return null;
  return anchoredDate(anchor, sub.cycle, index + 1, sub.intervalDays);
}

export type PlannedMonth = {
  totals: MoneyTotal[];
  unknown: number;
  excluded: number;
  /** Plan deduplicated by billing subject (not by quota pool). */
  occurrences: number;
};

/**
 * Expected charges for a month come from planned occurrences, never from the
 * recorded ledger. A shared billing subject counts once; conflicting members
 * are reported as excluded instead of silently picking the first value.
 */
export function plannedMonth(
  subs: readonly Subscription[],
  month: string,
  now: string,
): PlannedMonth {
  const active = subs.filter((s) => s.lifecycle !== 'archived');
  const groups = new Map<string, Subscription[]>();
  for (const sub of active) {
    if (sub.kind === 'wallet') continue;
    const subject = sub.billingGroupId || sub.id;
    groups.set(subject, [...(groups.get(subject) ?? []), sub]);
  }
  const sums = new Map<string, bigint>();
  let unknown = 0;
  let excluded = 0;
  let occurrences = 0;
  for (const members of groups.values()) {
    const withEvents = members
      .map((sub) => ({
        sub,
        events: projectEvents([sub], now).filter(
          (event) => event.kind === 'renewal' && monthOf(event.date) === month,
        ),
      }))
      .filter((entry) => entry.events.length > 0);
    if (withEvents.length === 0) continue;
    const dates = new Set(withEvents.flatMap((entry) => entry.events.map((event) => event.date)));
    occurrences += dates.size;
    const priced = withEvents.filter(
      (entry) => entry.sub.price.availability === 'known' && entry.sub.price.value !== null,
    );
    const currencies = new Set(priced.map((entry) => entry.sub.currency));
    const amounts = new Set(priced.map((entry) => entry.sub.price.value));
    if (priced.length === 0) {
      unknown += 1;
      continue;
    }
    if (currencies.size > 1 || amounts.size > 1) {
      excluded += 1;
      continue;
    }
    const amount = decimal(priced[0].sub.price.value!);
    const currency = priced[0].sub.currency;
    sums.set(currency, (sums.get(currency) ?? 0n) + amount * BigInt(dates.size));
  }
  return {
    totals: [...sums.entries()]
      .map(([currency, amount]) => ({ currency, amount: decimalText(amount) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    unknown,
    excluded,
    occurrences,
  };
}

export type UpcomingItem = {
  event: CalendarEvent;
  sub: Subscription;
  days: number;
};

export function upcomingEvents(
  subs: readonly Subscription[],
  now: string,
  days: number,
): UpcomingItem[] {
  const active = subs.filter((s) => s.lifecycle !== 'archived');
  const items: UpcomingItem[] = [];
  for (const event of projectEvents(active, now)) {
    const sub = active.find((item) => item.id === event.subscriptionId);
    if (!sub) continue;
    const delta = daysBetween(dateInZone(now, event.timezone), event.date);
    if (delta < 0 || delta > days) continue;
    items.push({ event, sub, days: delta });
  }
  return items.sort((a, b) => a.days - b.days || a.event.date.localeCompare(b.event.date));
}

export function budgetProgress(spent: string, budget: string | null): {
  percent: number;
  remaining: string | null;
  over: boolean;
} {
  if (budget === null) return { percent: 0, remaining: null, over: false };
  const limit = decimal(budget);
  const used = decimal(spent);
  if (limit === 0n) return { percent: used > 0n ? 100 : 0, remaining: decimalText(-used), over: used > 0n };
  const percent = Number((used * 10000n) / limit) / 100;
  return {
    percent: Math.max(0, Math.min(percent, 100)),
    remaining: decimalText(limit - used),
    over: used > limit,
  };
}

/** Payments that describe the same planned occurrence (split / supplemental). */
export function paymentsForPlan(
  payments: readonly PaymentRecord[],
  sub: Subscription,
  planDate: string,
): PaymentRecord[] {
  const occurrence = planOccurrenceId(sub, planDate);
  return payments.filter(
    (p) =>
      p.subscriptionId === sub.id &&
      ((p.planOccurrenceId && p.planOccurrenceId === occurrence) || p.planDate === planDate || p.paidOn === planDate),
  );
}

export function occurrencesPaidCount(
  payments: readonly PaymentRecord[],
  sub: Subscription,
  planDate: string,
): number {
  const seen = new Set<string>();
  for (const payment of paymentsForPlan(payments, sub, planDate)) seen.add(payment.id);
  return seen.size;
}

/** Display helper that keeps the exact decimal text instead of re-parsing to Number. */
export function exactMoney(value: string, currency: string): string {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const grouped = new Intl.NumberFormat('zh-CN').format(BigInt(whole || '0'));
  const trimmed = fraction.replace(/0+$/, '').padEnd(2, '0').slice(0, 6);
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${grouped}.${trimmed}`;
}
