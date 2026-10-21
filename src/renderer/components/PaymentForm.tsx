import { useMemo, useRef, useState } from 'react';
import { CalendarClock, Receipt, Wallet } from 'lucide-react';
import type { PaymentRecord, Snapshot, SubCalClient } from '../../shared/types';
import type { Notify } from '../contracts';
import { dateInZone } from '../../shared/rules';
import { paymentsForPlan, planOccurrenceId } from '../../shared/spending';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export type PaymentDraftContext = {
  subscriptionId?: string;
  planDate?: string;
  payment?: PaymentRecord;
};

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PaymentForm({
  open,
  context,
  snapshot,
  client,
  notify,
  onClose,
  onSaved,
}: {
  open: boolean;
  context: PaymentDraftContext | null;
  snapshot: Snapshot;
  client: SubCalClient;
  notify: Notify;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const editing = context?.payment ?? null;
  const presetSub = context?.subscriptionId
    ? snapshot.subscriptions.find((s) => s.id === context.subscriptionId) ?? null
    : null;
  const today = dateInZone(snapshot.now, snapshot.preferences.timezone);
  const [subscriptionId, setSubscriptionId] = useState(editing?.subscriptionId ?? presetSub?.id ?? '');
  const [name, setName] = useState(editing?.name ?? presetSub?.product ?? '');
  const [category, setCategory] = useState(
    editing?.category ?? presetSub?.category ?? snapshot.preferences.categories?.find((c) => c === '其他') ?? snapshot.preferences.categories?.[0] ?? '其他',
  );
  const [amount, setAmount] = useState(editing?.amount ?? '');
  const [currency, setCurrency] = useState(editing?.currency ?? presetSub?.currency ?? 'CNY');
  const [paidOn, setPaidOn] = useState(editing?.paidOn ?? today);
  const [note, setNote] = useState(editing?.note ?? '');
  const [advance, setAdvance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(newKey());

  const sub = subscriptionId
    ? snapshot.subscriptions.find((s) => s.id === subscriptionId) ?? null
    : null;
  const manualPlan = Boolean(sub && !sub.connectionId && sub.management !== 'automatic' && sub.renewalDate.value);
  const planDate = context?.planDate ?? sub?.renewalDate.value ?? null;
  const canAdvance = manualPlan && planDate !== null && sub?.renewalDate.value === planDate;
  const linkPlan = Boolean(context?.planDate) || advance;
  const existing = useMemo(
    () => (sub && planDate ? paymentsForPlan(snapshot.payments, sub, planDate) : []),
    [snapshot.payments, sub, planDate],
  );

  const chooseSubscription = (id: string) => {
    setSubscriptionId(id);
    const next = snapshot.subscriptions.find((s) => s.id === id);
    if (next) {
      setName(next.product);
      setCategory(next.category ?? category);
      setCurrency(next.currency);
      if (next.price.value && next.price.availability === 'known' && !amount) setAmount(next.price.value);
    }
    setAdvance(false);
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('请填写付款名称');
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount)) return setError('金额请填写最多 12 位整数、6 位小数，且不能为负数');
    if (!paidOn) return setError('请选择实际支付日期');
    if (!/^[A-Z]{3}$/.test(currency)) return setError('币种请填写三位大写代码');
    setBusy(true);
    try {
      if (editing) {
        await client.updatePayment(editing.id, editing.revision, {
          name: name.trim(),
          category,
          amount,
          currency,
          paidOn,
          note,
        });
        notify('付款记录已更新');
        onSaved?.(editing.id);
      } else {
        const planOccurrenceIdValue = linkPlan && sub && planDate ? planOccurrenceId(sub, planDate) : null;
        const id = await client.createPayment(
          {
            subscriptionId: subscriptionId || null,
            billingGroupId: sub ? sub.billingGroupId || sub.id : null,
            name: name.trim(),
            category,
            amount,
            currency,
            paidOn,
            planDate: linkPlan ? planDate : null,
            planOccurrenceId: planOccurrenceIdValue,
            note,
            source: 'manual',
          },
          keyRef.current,
          advance,
        );
        notify(advance ? '已记录付款并顺延一期计划' : '已记录付款');
        onSaved?.(id);
      }
      onClose();
    } catch (err) {
      // The same idempotency key is kept so a retry cannot create a second record.
      setError((err as Error).message || '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="sc-ui" data-testid="payment-form">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-extrabold">
            <Receipt className="size-5 text-(--sc-accent-ink)" />
            {editing ? '编辑付款记录' : '记录一笔真实付款'}
          </DialogTitle>
          <DialogDescription>
            只记录已经发生的支付。它不会改变供应商套餐、额度，也不会自动生成其他历史付款。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sc-field sm:col-span-2">
            <span>关联订阅（可选）</span>
            <select className="sc-select" value={subscriptionId} onChange={(e) => chooseSubscription(e.target.value)} disabled={Boolean(editing)}>
              <option value="">不关联订阅 · 独立支出</option>
              {snapshot.subscriptions.map((s) => (
                <option key={s.id} value={s.id}>{s.product} · {s.account || '未填写账号'}</option>
              ))}
            </select>
          </label>

          <label className="sc-field">
            <span>付款名称</span>
            <input className="sc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 Claude Pro" maxLength={200} />
          </label>
          <label className="sc-field">
            <span>分类</span>
            <select className="sc-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {[...new Set([category, ...(snapshot.preferences.categories ?? [])])].filter(Boolean).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <div className="sc-field">
            <span>实付金额</span>
            <div className="flex gap-2">
              <input
                className="sc-input tabular"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
                placeholder="0.00"
                aria-label="实付金额"
              />
              <select className="sc-select w-24" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="币种">
                {[...new Set([currency, 'CNY', 'USD', 'EUR', 'JPY', 'HKD'])].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="sc-field">
            <span>实际支付日</span>
            <input
              className="sc-input tabular"
              type="date"
              value={paidOn}
              max={today}
              min="1900-01-01"
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </label>

          <label className="sc-field sm:col-span-2">
            <span>备注</span>
            <textarea className="sc-textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如分笔支付、补付、发票号…" maxLength={2000} />
          </label>
        </div>

        {!editing && canAdvance && planDate ? (
          <div className="rounded-(--sc-radius-sm) border border-(--sc-border) bg-(--sc-canvas) p-3">
            <label className="flex items-start gap-2 text-sm font-bold">
              <input
                type="checkbox"
                className="mt-0.5 accent-(--sc-accent)"
                checked={advance}
                onChange={(e) => setAdvance(e.target.checked)}
              />
              <span>
                记录后顺延一期手动计划
                <small className="mt-0.5 block font-medium text-(--sc-muted)">
                  当前计划日 {planDate}，顺延后按原锚点计算下一期；同一期不会重复推进。
                  {existing.length > 0 ? ` 这一期已有 ${existing.length} 笔付款，保存将作为分笔/补付。` : ''}
                </small>
              </span>
            </label>
          </div>
        ) : null}

        {!editing && sub && planDate && existing.length > 0 ? (
          <p className="m-0 flex items-start gap-2 text-xs text-(--sc-muted)">
            <CalendarClock className="mt-0.5 size-4 flex-none" />
            本期已记录 {existing.length} 笔付款（共 {existing.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2)} {existing[0].currency}）。再次保存会新增一笔真实补付，而不是覆盖旧记录。
          </p>
        ) : null}

        {error ? <p role="alert" className="m-0 rounded-(--sc-radius-sm) bg-(--sc-red-soft) px-3 py-2 text-sm font-bold text-(--sc-red-ink)">{error}</p> : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="tactile-soft" size="tactile-sm" onClick={onClose} disabled={busy}>取消</Button>
          <Button type="button" variant="tactile" size="tactile" onClick={() => void save()} disabled={busy}>
            <Wallet />
            {busy ? '正在保存…' : editing ? '保存修改' : advance ? '记录并顺延' : '记录付款'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
