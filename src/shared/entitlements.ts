import type { Balance, Entitlements, Field, Subscription, SubscriptionInput } from './types';

/** An unsuccessful observation is not an assertion that the old value disappeared. */
export function mergeObservation<T>(old: Field<T> | undefined, next: Field<T> | undefined): Field<T> | undefined {
  if (!next || ['unfetched','denied','unsupported'].includes(next.availability) || (next.availability==='known' && next.value===null)) return old ?? next;
  if (old?.observedAt && next.observedAt && Date.parse(old.observedAt) > Date.parse(next.observedAt)) return old;
  return next;
}
export function mergeEntitlements(old: Entitlements = {}, next: Entitlements = {}): Entitlements {
  const merged = {...old};
  for (const key of ['membershipExpiresAt','billingPeriodEnd','nextBillingStart','autoRenew','listPrice'] as const) {
    const value = mergeObservation(old[key] as Field<unknown> | undefined, next[key] as Field<unknown> | undefined);
    if (value) (merged as Record<string, unknown>)[key] = value;
  }
  if (next.listPriceCurrency && merged.listPrice === next.listPrice) merged.listPriceCurrency = next.listPriceCurrency;
  return merged;
}
export function mergeBalances(old: Balance[] = [], next: Balance[] = []): Balance[] {
  const result = [...old];
  for (const balance of next) {
    const index = result.findIndex(b => b.id === balance.id && b.scope === balance.scope && b.currency === balance.currency && b.kind === balance.kind);
    const previous = result[index], amount = mergeObservation(previous?.amount, balance.amount)!;
    const merged = {...previous, ...balance, amount, expiresAt:mergeObservation(previous?.expiresAt,balance.expiresAt)};
    if(merged.expiresAt===undefined)delete merged.expiresAt;
    if (index < 0) result.push(merged); else result[index] = merged;
  }
  return result;
}
export function isAutomatic(sub: Subscription): boolean {
  return sub.management === 'automatic' || Boolean(sub.connectionId);
}
/** Explicit allowlist protects future automatic fields from form round trips too. */
export function writableSubscriptionPatch(sub: Subscription, patch: Partial<SubscriptionInput>): Partial<SubscriptionInput> {
  if (!isAutomatic(sub)) return patch;
  const result: Partial<SubscriptionInput> = {};
  for (const key of ['price','currency','website','reminder','pinned','notes'] as const) {
    if (patch[key] !== undefined) (result as Record<string, unknown>)[key] = patch[key];
  }
  if (result.price) result.price = {...result.price, dataOrigin:'manual', evidence:'configured', source:'用户实际支付', locked:undefined, proposed:undefined};
  return result;
}
