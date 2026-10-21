import type { EntitlementDate, Field, Metric, Subscription } from '../../shared/types';
import { money } from '../../shared/rules';

export function balanceAmount(value: string, currency: string): string {
  return /^[A-Z]{3}$/.test(currency) ? money(value, currency) : `${value} ${currency === 'credits' ? '积分' : currency}`;
}

export function isAutomatic(sub: Subscription): boolean {
  if (sub.management) return sub.management === 'automatic';
  return Boolean(sub.connectionId || ['official_api', 'local_client'].includes(sub.plan.dataOrigin) || sub.metrics.some(m => ['official_api', 'local_client'].includes(m.remaining.dataOrigin)));
}

export function entitlementDate(field?: Field<EntitlementDate>): string {
  if (field?.availability !== 'known' || !field.value) return '暂未提供';
  if (field.value.precision === 'day') return field.value.value;
  const date = new Date(field.value.value);
  return Number.isNaN(date.getTime()) ? '暂未提供' : date.toLocaleString('zh-CN', { hour12: false });
}

export function uniqueWindows(metrics: Metric[]): Metric[] {
  // A shared pool only deduplicates the same window, never different windows.
  const seen = new Map<string, Metric>();
  const result: Metric[] = [];
  for (const m of metrics) {
    if (!m.poolId) { result.push(m); continue; }
    const key = JSON.stringify([m.poolId, m.unit, m.windowMinutes, m.windowStart?.value, m.windowEnd?.value, m.resetObservation?.value ?? m.resetAt]);
    const existing = seen.get(key);
    if (existing) {
      existing.models = [...new Set([...(existing.models ?? []), ...(m.models ?? [])])];
      continue;
    }
    const copy = { ...m, models: m.models ? [...m.models] : undefined };
    seen.set(key, copy); result.push(copy);
  }
  return result;
}

export function latestObservation(sub: Subscription): string | null {
  const fields = [sub.plan, ...Object.values(sub.entitlements ?? {}), ...(sub.balances ?? []).map(b => b.amount), ...sub.metrics.flatMap(m => [m.remaining, m.used, m.totalObservation, m.resetObservation, m.windowStart, m.windowEnd])];
  return fields.flatMap(field => typeof field === 'object' && field && 'observedAt' in field && field.observedAt && ['known','unlimited'].includes(field.availability) ? [field.observedAt] : []).sort().at(-1) ?? null;
}
