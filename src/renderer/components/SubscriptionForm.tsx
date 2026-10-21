import React, { useMemo, useState } from 'react';
import { ClientError, type MockSubCalClient } from '../service/MockSubCalClient';
import type { Notify } from '../contracts';
import type {
  Availability,
  Cycle,
  Field as FieldType,
  Lifecycle,
  Metric,
  Snapshot,
  Subscription,
  SubscriptionInput,
} from '../../shared/types';
import { decimal } from '../../shared/rules';
import { BrandIcon, Modal, StatusBadge } from './ui';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { FormSelect } from './form-controls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Field, FieldDescription, FieldError, FieldLabel } from './ui/field';
import { ChevronDown, LockKeyhole, Pin, Plus, TriangleAlert } from 'lucide-react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import './subscription-details.css';

export interface CatalogPreset {
  id: string;
  product: string;
  brand: string;
  tier: 'auto' | 'experimental' | 'manual';
  tierLabel: string;
  kind: Subscription['kind'];
  currency: string;
  cycle: Cycle;
  defaultPrice: string;
  defaultPlan: string;
  connectionId: string | null;
  website: string;
  defaultMetrics: { label: string; unit: string; availability: Availability; total: string | null }[];
}

export const PRODUCT_CATALOG: CatalogPreset[] = [
  {
    id: 'cat-codex',
    product: 'Codex',
    brand: 'OpenAI',
    tier: 'auto',
    tierLabel: '正式自动目标',
    kind: 'window',
    currency: 'USD',
    cycle: 'monthly',
    defaultPrice: '20.00',
    defaultPlan: 'ChatGPT Plus 权益',
    connectionId: 'codex-local',
    website: 'https://chatgpt.com/',
    defaultMetrics: [
      { label: '5 小时额度', unit: '%', availability: 'unfetched', total: '100' },
      { label: '每周额度', unit: '%', availability: 'unfetched', total: '100' },
    ],
  },
  {
    id: 'cat-copilot',
    product: 'GitHub Copilot',
    brand: 'GitHub',
    tier: 'auto',
    tierLabel: '正式自动目标',
    kind: 'window',
    currency: 'USD',
    cycle: 'monthly',
    defaultPrice: '10.00',
    defaultPlan: 'Pro',
    connectionId: 'copilot-local',
    website: 'https://github.com/settings/copilot',
    defaultMetrics: [
      { label: '代码补全', unit: '%', availability: 'unlimited', total: '100' },
      { label: '高级交互', unit: '%', availability: 'unfetched', total: '100' },
    ],
  },
  {
    id: 'cat-deepseek',
    product: 'DeepSeek API',
    brand: 'DeepSeek',
    tier: 'auto',
    tierLabel: '正式自动目标',
    kind: 'wallet',
    currency: 'CNY',
    cycle: 'none',
    defaultPrice: '',
    defaultPlan: '按量钱包',
    connectionId: 'deepseek-balance',
    website: 'https://platform.deepseek.com/',
    defaultMetrics: [
      { label: '可用总余额', unit: 'CNY', availability: 'unfetched', total: null },
      { label: '充值余额', unit: 'CNY', availability: 'unfetched', total: null },
      { label: '赠送余额', unit: 'CNY', availability: 'unfetched', total: null },
    ],
  },
  {
    id: 'cat-kimi-api',
    product: 'Kimi API',
    brand: 'Kimi',
    tier: 'auto',
    tierLabel: '正式自动目标',
    kind: 'wallet',
    currency: 'CNY',
    cycle: 'none',
    defaultPrice: '',
    defaultPlan: '国内站 API 钱包',
    connectionId: 'kimi-platform-cn',
    website: 'https://platform.moonshot.cn/',
    defaultMetrics: [
      { label: '可用余额', unit: 'CNY', availability: 'unfetched', total: null },
    ],
  },
  {
    id: 'cat-openrouter',
    product: 'OpenRouter',
    brand: 'OpenRouter',
    tier: 'auto',
    tierLabel: '正式自动目标',
    kind: 'wallet',
    currency: 'USD',
    cycle: 'none',
    defaultPrice: '',
    defaultPlan: 'Key 预算 · 非账户资金',
    connectionId: 'openrouter-key',
    website: 'https://openrouter.ai/settings/keys',
    defaultMetrics: [
      { label: '剩余预算', unit: 'USD', availability: 'unfetched', total: '50.00' },
    ],
  },
  {
    id: 'cat-kimi-code',
    product: 'Kimi Code',
    brand: 'Kimi',
    tier: 'experimental',
    tierLabel: '实验适配',
    kind: 'window',
    currency: 'CNY',
    cycle: 'monthly',
    defaultPrice: '49.00',
    defaultPlan: '会员共享额度',
    connectionId: null,
    website: 'https://kimi.moonshot.cn/',
    defaultMetrics: [
      { label: '会员额度', unit: '%', availability: 'unfetched', total: '100' },
    ],
  },
  {
    id: 'cat-cursor',
    product: 'Cursor Pro',
    brand: 'Cursor',
    tier: 'experimental',
    tierLabel: '实验/手动',
    kind: 'manual',
    currency: 'USD',
    cycle: 'monthly',
    defaultPrice: '20.00',
    defaultPlan: 'Pro',
    connectionId: null,
    website: 'https://www.cursor.com/settings',
    defaultMetrics: [
      { label: '快速请求额度', unit: '%', availability: 'unsupported', total: '100' },
    ],
  },
  {
    id: 'cat-claude',
    product: 'Claude Pro',
    brand: 'Anthropic',
    tier: 'manual',
    tierLabel: '手动记录',
    kind: 'manual',
    currency: 'USD',
    cycle: 'monthly',
    defaultPrice: '20.00',
    defaultPlan: 'Pro',
    connectionId: null,
    website: 'https://claude.ai/',
    defaultMetrics: [
      { label: '额度与用量', unit: '%', availability: 'unsupported', total: '100' },
    ],
  },
  {
    id: 'cat-chatgpt',
    product: 'ChatGPT Plus',
    brand: 'OpenAI',
    tier: 'manual',
    tierLabel: '手动记录',
    kind: 'manual',
    currency: 'USD',
    cycle: 'monthly',
    defaultPrice: '20.00',
    defaultPlan: 'Plus',
    connectionId: null,
    website: 'https://chatgpt.com/',
    defaultMetrics: [
      { label: '聊天额度', unit: '%', availability: 'unsupported', total: '100' },
    ],
  },
  {
    id: 'cat-custom',
    product: '',
    brand: '',
    tier: 'manual',
    tierLabel: '自定义手动记录',
    kind: 'manual',
    currency: 'USD',
    cycle: 'monthly',
    defaultPrice: '',
    defaultPlan: '',
    connectionId: null,
    website: '',
    defaultMetrics: [],
  },
];

function makeFormField(
  value: string | null,
  now: string,
  locked = false,
  availability?: Availability,
  source = '手动记录（示例）'
): FieldType<string> {
  const trimmed = value && value.trim() ? value.trim() : null;
  const resolvedAvail: Availability =
    availability ?? (trimmed !== null ? 'known' : 'unfetched');
  return {
    value: resolvedAvail === 'known' ? trimmed : null,
    availability: resolvedAvail,
    source,
    observedAt: resolvedAvail === 'known' ? now : null,
    dataOrigin: 'demo',
    ...(locked ? { locked: true } : {}),
  };
}

interface MetricDraft {
  id: string;
  label: string;
  unit: string;
  value: string;
  total: string;
  availability: Availability;
  resetDate: string;
  staleAfterMinutes: number;
  source: string;
}

function presetMetricDrafts(preset: CatalogPreset): MetricDraft[] {
  return preset.defaultMetrics.map((metric, index) => ({
    id: `m-${index + 1}`, label: metric.label, unit: metric.unit, value: '', total: metric.total ?? '',
    availability: metric.availability, resetDate: '', staleAfterMinutes: metric.unit === '%' ? 30 : 120,
    source: '手动记录（示例）',
  }));
}

export interface SubscriptionFormProps {
  mode: 'create' | 'edit';
  initial?: Subscription;
  presetProduct?: string;
  snapshot: Snapshot;
  client: MockSubCalClient;
  notify: Notify;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

export function SubscriptionForm({
  mode,
  initial: initialRecord,
  presetProduct,
  snapshot,
  client,
  notify,
  onClose,
  onSaved,
}: SubscriptionFormProps) {
  const catalogPreset = mode === 'create' ? PRODUCT_CATALOG.find((item) => item.product === presetProduct && item.product !== '') : undefined;
  const [initial] = useState(initialRecord);
  const [idempotencyKey] = useState<string>(() =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const [expectedRevision, setExpectedRevision] = useState<number>(initial?.revision ?? 1);
  const [catalogQuery, setCatalogQuery] = useState('');

  // Form fields
  const [product, setProduct] = useState(initial?.product ?? presetProduct ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? catalogPreset?.brand ?? presetProduct ?? '');
  const [kind, setKind] = useState<Subscription['kind']>(initial?.kind ?? catalogPreset?.kind ?? 'manual');
  const [account, setAccount] = useState(initial?.account ?? '个人示例账号');
  const [region, setRegion] = useState(initial?.region ?? '未指定');
  const [organization, setOrganization] = useState(initial?.organization ?? '个人');

  const [planValue, setPlanValue] = useState(initial?.plan.value ?? catalogPreset?.defaultPlan ?? '');
  const [planLocked, setPlanLocked] = useState(Boolean(initial?.plan.locked));

  const [priceValue, setPriceValue] = useState(initial?.price.value ?? catalogPreset?.defaultPrice ?? '');
  const [priceLocked, setPriceLocked] = useState(Boolean(initial?.price.locked));
  const [currency, setCurrency] = useState(initial?.currency ?? catalogPreset?.currency ?? 'USD');
  const [cycle, setCycle] = useState<Cycle>(initial?.cycle ?? catalogPreset?.cycle ?? 'monthly');
  const [intervalDays, setIntervalDays] = useState<string>(
    String(initial?.intervalDays ?? 30)
  );

  const [lifecycle, setLifecycle] = useState<Lifecycle>(initial?.lifecycle ?? 'active');
  const [autoRenew, setAutoRenew] = useState<Subscription['autoRenew']>(
    initial?.autoRenew ?? (catalogPreset && catalogPreset.kind !== 'wallet' ? 'on' : 'unknown')
  );

  const [startDate, setStartDate] = useState(initial?.startDate.value ?? '');
  const [renewalDate, setRenewalDate] = useState(initial?.renewalDate.value ?? '');
  const [renewalLocked, setRenewalLocked] = useState(Boolean(initial?.renewalDate.locked));
  const [paidThrough, setPaidThrough] = useState(initial?.paidThrough.value ?? '');
  const [paidThroughConfirmedUnknown, setPaidThroughConfirmedUnknown] = useState(
    initial?.autoRenew === 'off' && !initial?.paidThrough.value
  );
  const [trialEnd, setTrialEnd] = useState(initial?.trialEnd.value ?? '');
  const [anchorDate, setAnchorDate] = useState(initial?.anchorDate ?? '');
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? snapshot.preferences.timezone ?? 'Asia/Shanghai'
  );

  const [billingGroupId, setBillingGroupId] = useState(initial?.billingGroupId ?? '');
  const [quotaPoolId, setQuotaPoolId] = useState(initial?.quotaPoolId ?? '');
  const [possibleSharedWallet, setPossibleSharedWallet] = useState(
    Boolean(initial?.possibleSharedWallet)
  );
  const [connectionId, setConnectionId] = useState(initial?.connectionId ?? (snapshot.connections.some((item) => item.id === catalogPreset?.connectionId) ? catalogPreset?.connectionId ?? '' : ''));
  const [website, setWebsite] = useState(initial?.website ?? catalogPreset?.website ?? '');
  const [reminder, setReminder] = useState<Subscription['reminder']>(
    initial?.reminder ?? snapshot.preferences.reminder ?? 'local'
  );
  const [pinned, setPinned] = useState(Boolean(initial?.pinned));
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const [metrics, setMetrics] = useState<MetricDraft[]>(() =>
    initial ? initial.metrics.map((m) => ({
      id: m.id,
      label: m.label,
      unit: m.unit,
      value: m.remaining.value ?? '',
      total: m.total ?? '',
      availability: m.remaining.availability,
      resetDate: m.resetAt ? m.resetAt.slice(0, 10) : '',
      staleAfterMinutes: m.staleAfterMinutes,
      source: m.remaining.source || '手动记录（示例）',
    })) : catalogPreset ? presetMetricDrafts(catalogPreset) : []
  );

  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const markDirty = () => {
    if (!dirty) setDirty(true);
  };

  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return PRODUCT_CATALOG;
    return PRODUCT_CATALOG.filter(
      (c) =>
        c.product.toLowerCase().includes(q) ||
        c.brand.toLowerCase().includes(q) ||
        c.tierLabel.toLowerCase().includes(q)
    );
  }, [catalogQuery]);

  const applyCatalogPreset = (preset: CatalogPreset) => {
    markDirty();
    setProduct(preset.product);
    setBrand(preset.brand);
    setKind(preset.kind);
    setCurrency(preset.currency);
    setCycle(preset.cycle);
    setPriceValue(preset.defaultPrice);
    setPlanValue(preset.defaultPlan);
    const hasConn =
      preset.connectionId &&
      snapshot.connections.some((c) => c.id === preset.connectionId);
    setConnectionId(hasConn ? preset.connectionId! : '');
    setWebsite(preset.website);
    if (preset.kind === 'wallet') {
      setAutoRenew('unknown');
    } else {
      setAutoRenew('on');
    }
    setMetrics(presetMetricDrafts(preset));
  };

  const buildInput = (): { input: SubscriptionInput; localErrors: Record<string, string> } => {
    const localErrors: Record<string, string> = {};
    const now = snapshot.now;

    // Spec requirement: cancelling auto-renew requires explicit paidThrough confirmation (never infer from renewalDate)
    if (
      kind !== 'wallet' &&
      autoRenew === 'off' &&
      !paidThrough.trim() &&
      !paidThroughConfirmedUnknown
    ) {
      localErrors.paidThrough =
        '关闭自动续费时，请填写已核对的“已付有效期至”日期，或勾选“有效期暂不确定（留空待补）”，系统不会从扣费日自动推断。';
    }

    // Validate custom metrics (note: negative values ARE allowed for wallet balances!)
    const builtMetrics: Metric[] = [];
    metrics.forEach((m, idx) => {
      const labelTrim = m.label.trim() || `指标 ${idx + 1}`;
      const valTrim = m.value.trim();
      const totalTrim = m.total.trim();
      let avail: Availability = m.availability;

      if (valTrim !== '') {
        try {
          decimal(valTrim);
          avail = 'known';
        } catch (e) {
          localErrors[`metric_${m.id}`] = `指标「${labelTrim}」：${(e as Error).message}`;
        }
      } else if (avail === 'known') {
        avail = 'unfetched';
      }

      if (totalTrim !== '') {
        try {
          decimal(totalTrim);
        } catch (e) {
          localErrors[`metric_${m.id}`] = `指标「${labelTrim}」上限：${(e as Error).message}`;
        }
      }

      builtMetrics.push({
        id: m.id.replace(/[^\w.:-]/g, '_') || `metric-${idx + 1}`,
        label: labelTrim,
        unit: m.unit || '%',
        remaining: {
          value: avail === 'known' && valTrim !== '' ? valTrim : null,
          availability: avail,
          source: '手动记录（示例）',
          observedAt: avail === 'known' && valTrim !== '' ? now : null,
          dataOrigin: 'demo',
        },
        total: totalTrim !== '' ? totalTrim : null,
        resetAt: m.resetDate.trim() ? `${m.resetDate.trim()}T00:00:00.000Z` : null,
        staleAfterMinutes: Number(m.staleAfterMinutes) > 0 ? Number(m.staleAfterMinutes) : 60,
      });
      const old = initial?.metrics.find(metric => metric.id === m.id);
      const built = builtMetrics[builtMetrics.length - 1];
      if (old && (old.remaining.value ?? '') === valTrim && old.remaining.availability === avail) built.remaining = structuredClone(old.remaining);
      if (old && (old.resetAt?.slice(0, 10) ?? '') === m.resetDate.trim()) built.resetAt = old.resetAt;
    });

    const trimmedProduct = product.trim();
    const trimmedBrand = brand.trim() || trimmedProduct || '自定义';
    const parsedInterval = Number(intervalDays);

    const renewalField =
      kind === 'wallet' && cycle === 'none' && !renewalDate.trim()
        ? makeFormField(null, now, false, 'na', '按量钱包')
        : {
            ...makeFormField(
              renewalDate,
              now,
              renewalLocked,
              undefined,
              initial?.renewalDate.value === renewalDate.trim() && initial?.renewalDate.source
                ? initial.renewalDate.source
                : '手动记录（示例）'
            ),
            ...(initial?.renewalDate.proposed !== undefined
              ? { proposed: initial.renewalDate.proposed }
              : {}),
          };

    const input: SubscriptionInput = {
      product: trimmedProduct,
      brand: trimmedBrand,
      kind,
      account: account.trim() || '个人示例账号',
      region: region.trim() || '未指定',
      organization: organization.trim() || '个人',
      plan: makeFormField(planValue, now, planLocked),
      price: makeFormField(priceValue, now, priceLocked),
      currency: currency.trim().toUpperCase() || 'USD',
      cycle,
      intervalDays: Number.isFinite(parsedInterval) ? parsedInterval : 30,
      anchorDate: anchorDate.trim() || renewalDate.trim() || null,
      timezone: timezone.trim() || 'Asia/Shanghai',
      startDate: makeFormField(startDate, now),
      renewalDate: renewalField,
      paidThrough: makeFormField(paidThrough, now),
      trialEnd: makeFormField(trialEnd, now),
      lifecycle: autoRenew === 'off' && lifecycle === 'active' ? 'ending' : lifecycle,
      autoRenew,
      billingGroupId: billingGroupId.trim() || null,
      quotaPoolId: quotaPoolId.trim() || null,
      possibleSharedWallet,
      metrics: builtMetrics,
      connectionId: connectionId.trim() || null,
      website: website.trim(),
      reminder,
      pinned,
      notes: notes.trim(),
      ...(initial?.scheduleOverrides ? { scheduleOverrides: initial.scheduleOverrides } : {}),
    };

    if (initial) {
      for (const key of ['plan','price','startDate','renewalDate','paidThrough','trialEnd'] as const) {
        if (input[key].value === initial[key].value) input[key] = {...structuredClone(initial[key]), locked: input[key].locked};
      }
      if (renewalDate.trim() !== (initial.renewalDate.value ?? '') && anchorDate === (initial.anchorDate ?? '')) input.anchorDate = renewalDate.trim() || null;
    }

    return { input, localErrors };
  };

  const handleSave = async (overrideRevision?: number) => {
    setErrors({});
    setConflictMessage(null);
    const { input, localErrors } = buildInput();

    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        const createdId = await client.create(input, idempotencyKey);
        setDirty(false);
        notify(`已新增订阅「${input.product}」（演示空间）`);
        onSaved?.(createdId);
        onClose();
      } else if (initial) {
        const revToUse = overrideRevision ?? expectedRevision;
        const patch = Object.fromEntries(Object.entries(input).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(initial[key as keyof SubscriptionInput]))) as Partial<SubscriptionInput>;
        await client.update(initial.id, revToUse, patch);
        setDirty(false);
        notify(`已保存「${input.product}」修改，卡片与日历投影已同步更新`);
        onSaved?.(initial.id);
        onClose();
      }
    } catch (err) {
      if (err instanceof ClientError) {
        if (err.code === 'VALIDATION' && err.details) {
          setErrors(err.details);
        } else if (err.code === 'REVISION_CONFLICT') {
          setConflictMessage(err.message);
        } else {
          setErrors({ form: err.message });
        }
      } else {
        setErrors({ form: (err as Error).message || '保存失败，当前输入已保留' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRequestClose = () => {
    if (saving) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const latestInSnapshot = initial
    ? snapshot.subscriptions.find((s) => s.id === initial.id)
    : undefined;

  return (
    <Modal
      title={mode === 'create' ? '新增订阅（演示空间）' : `编辑订阅 · ${initial?.product}`}
      onClose={handleRequestClose}
    >
      <form
        className="sub-form stack"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
        noValidate
      >
        {/* Preview Notice */}
        <p className="form-preview-banner">只保存本地演示记录，不收集真实密钥或密码。</p>

        <AlertDialog open={confirmDiscard} onOpenChange={(open, details) => {
          if (!open && (details.reason === 'escape-key' || details.reason === 'outside-press')) { details.cancel(); return; }
          setConfirmDiscard(open);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>有未保存的表单修改</AlertDialogTitle><AlertDialogDescription>输入仍然保留。请选择继续编辑、明确放弃，或保存后关闭。</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>继续编辑</AlertDialogCancel>
              <Button type="button" variant="outline" onClick={() => { setConfirmDiscard(false); setDirty(false); onClose(); }}>放弃修改并关闭</Button>
              <Button type="button" disabled={saving} onClick={() => { setConfirmDiscard(false); void handleSave(); }}>保存更改</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Revision Conflict Resolution Banner */}
        {conflictMessage ? (
          <div className="unsaved-guard-bar warning-guard" role="alert">
            <div>
              <strong><TriangleAlert className="inline-icon" /> 并发版本冲突</strong>
              <p className="muted">{conflictMessage}</p>
            </div>
            <div className="row">
              {latestInSnapshot ? (
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setExpectedRevision(latestInSnapshot.revision);
                    void handleSave(latestInSnapshot.revision);
                  }}
                >
                  基于最新版本号 (v{latestInSnapshot.revision}) 覆盖保存
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose}>
                放弃并关闭
              </Button>
            </div>
          </div>
        ) : null}

        {Object.keys(errors).length > 0 ? <div className="error-banner" role="alert">{[...new Set(Object.values(errors))].join('；')}</div> : null}

        {/* Brand & Service Catalog (Shown in Create Mode) */}
        {mode === 'create' ? (
          <Collapsible className="form-section catalog-section stack">
            <CollapsibleTrigger render={<Button type="button" variant="outline" className="catalog-trigger-btn" data-testid="form-catalog-trigger" />}><Plus />从品牌目录带入模板<ChevronDown className="catalog-chevron" /></CollapsibleTrigger>
            <CollapsibleContent className="stack">
            <div className="section-header">
              <FieldDescription>也可以直接填写下方名称，创建自定义服务。</FieldDescription>
              <Input
                type="search"
                className="catalog-search-input"
                placeholder="搜索品牌或规划等级（如 Codex、DeepSeek、手动）…"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
              />
            </div>
            <div className="catalog-grid">
              {filteredCatalog.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="outline"
                  className={`catalog-chip ${
                    product === preset.product && preset.product !== '' ? 'selected' : ''
                  }`}
                  onClick={() => applyCatalogPreset(preset)}
                >
                  <BrandIcon
                    product={preset.product || '自定义'}
                    brand={preset.brand}
                    size={20}
                  />
                  <div className="catalog-chip-info">
                    <strong>{preset.product || '+ 空白自定义服务'}</strong>
                    <StatusBadge
                      tone={
                        preset.tier === 'auto'
                          ? 'primary'
                          : preset.tier === 'experimental'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {preset.tierLabel}
                    </StatusBadge>
                  </div>
                </Button>
              ))}
            </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {/* Section 1: 基础与收费安排 */}
        <section className="form-section stack">
          <h3 className="form-section-title">基础与收费安排</h3>
          <FieldDescription>仅名称必填；未知金额和日期可留空，不会自动推断。</FieldDescription>

          <div className="form-grid">
            <Field className="field" data-invalid={Boolean(errors.product)}>
              <FieldLabel htmlFor="sub-product">产品名称 *</FieldLabel>
              <Input
                id="sub-product"
                type="text"
                required
                aria-invalid={Boolean(errors.product)}
                aria-describedby={errors.product ? 'sub-product-error' : undefined}
                placeholder="例如 Claude Pro / 自定义服务"
                value={product}
                onChange={(e) => {
                  markDirty();
                  setProduct(e.target.value);
                }}
              />
              {errors.product ? <FieldError id="sub-product-error" className="error-text">{errors.product}</FieldError> : null}
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-brand">所属品牌</FieldLabel>
              <Input
                id="sub-brand"
                type="text"
                placeholder="留空则默认与产品同名"
                value={brand}
                onChange={(e) => {
                  markDirty();
                  setBrand(e.target.value);
                }}
              />
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-kind">卡片与计量类型</FieldLabel>
              <FormSelect
                id="sub-kind"
                value={kind}
                onChange={(e) => {
                  markDirty();
                  const nextKind = e.target.value as Subscription['kind'];
                  setKind(nextKind);
                  if (nextKind === 'wallet') {
                    setCycle('none');
                  } else if (cycle === 'none') {
                    setCycle('monthly');
                  }
                }}
              >
                <option value="manual">手动会员</option>
                <option value="window">订阅额度</option>
                <option value="wallet">API 余额 / 预算</option>
              </FormSelect>
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-account">示例账号标识（请勿输入真实密钥）</FieldLabel>
              <Input
                id="sub-account"
                type="text"
                placeholder="个人示例账号"
                value={account}
                onChange={(e) => {
                  markDirty();
                  setAccount(e.target.value);
                }}
              />
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-plan">套餐名称（可选）</FieldLabel>
              <Input
                id="sub-plan"
                type="text"
                placeholder="例如 Pro / Plus / 按量钱包"
                value={planValue}
                onChange={(e) => {
                  markDirty();
                  setPlanValue(e.target.value);
                }}
              />
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={planLocked}
                  onChange={(e) => {
                    markDirty();
                    setPlanLocked(e.target.checked);
                  }}
                />
                <span><LockKeyhole className="inline-icon" /> 手动锁定套餐，防模拟刷新覆盖</span>
              </label>
            </Field>

            <Field className="field" data-invalid={Boolean(errors.price)}>
              <FieldLabel htmlFor="sub-price">周期价格（未知可留空，不可为负数）</FieldLabel>
              <div className="row money-field-row">
                <Input
                  id="sub-price"
                  type="text"
                  placeholder="例如 20.00"
                  value={priceValue}
                  onChange={(e) => {
                    markDirty();
                    setPriceValue(e.target.value);
                  }}
                />
                <FormSelect
                  aria-label="币种"
                  value={currency}
                  onChange={(e) => {
                    markDirty();
                    setCurrency(e.target.value);
                  }}
                >
                  <option value="USD">USD ($)</option>
                  <option value="CNY">CNY (¥)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="JPY">JPY (¥)</option>
                  <option value="HKD">HKD ($)</option>
                </FormSelect>
              </div>
              {errors.price ? <FieldError className="error-text">{errors.price}</FieldError> : null}
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={priceLocked}
                  onChange={(e) => {
                    markDirty();
                    setPriceLocked(e.target.checked);
                  }}
                />
                <span><LockKeyhole className="inline-icon" /> 手动锁定价格</span>
              </label>
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-cycle">计费周期</FieldLabel>
              <FormSelect
                id="sub-cycle"
                value={cycle}
                onChange={(e) => {
                  markDirty();
                  setCycle(e.target.value as Cycle);
                }}
              >
                <option value="monthly">按月（monthly）</option>
                <option value="yearly">按年（yearly）</option>
                <option value="days">自定义天数（days）</option>
                <option value="once">单次买断（once）</option>
                <option value="irregular">不定期（irregular）</option>
                <option value="none">无固定周期 / 按量钱包（none）</option>
              </FormSelect>
            </Field>

            {cycle === 'days' ? (
              <Field className="field" data-invalid={Boolean(errors.intervalDays)}>
                <FieldLabel htmlFor="sub-interval">自定义周期天数 (1–36500)</FieldLabel>
                <Input
                  id="sub-interval"
                  type="number"
                  min={1}
                  max={36500}
                  value={intervalDays}
                  onChange={(e) => {
                    markDirty();
                    setIntervalDays(e.target.value);
                  }}
                />
                {errors.intervalDays ? (
                  <FieldError className="error-text">{errors.intervalDays}</FieldError>
                ) : null}
              </Field>
            ) : null}

            <Field className="field">
              <FieldLabel htmlFor="sub-autorenew">自动续费状态</FieldLabel>
              <FormSelect
                id="sub-autorenew"
                value={autoRenew}
                onChange={(e) => {
                  markDirty();
                  setAutoRenew(e.target.value as Subscription['autoRenew']);
                }}
              >
                <option value="on">开启自动续费（on）</option>
                <option value="off">已关闭自动续费 / 到期不续（off）</option>
                <option value="unknown">待确认（unknown）</option>
              </FormSelect>
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-lifecycle">生命周期状态</FieldLabel>
              <FormSelect
                id="sub-lifecycle"
                value={lifecycle}
                onChange={(e) => {
                  markDirty();
                  setLifecycle(e.target.value as Lifecycle);
                }}
              >
                <option value="active">有效（active）</option>
                <option value="trial">试用期（trial）</option>
                <option value="ending">到期不续费（ending）</option>
                <option value="pending">待确认（pending）</option>
                <option value="cancelled">已停订（cancelled）</option>
                <option value="expired">已过期（expired）</option>
                <option value="archived">已归档（archived）</option>
              </FormSelect>
            </Field>

            <Field className="field" data-invalid={Boolean(errors.renewalDate)}>
              <FieldLabel htmlFor="sub-renewal-date">下次计划续费日（YYYY-MM-DD，可留空）</FieldLabel>
              <Input
                id="sub-renewal-date"
                type="text"
                placeholder="例如 2026-11-03"
                value={renewalDate}
                onChange={(e) => {
                  markDirty();
                  setRenewalDate(e.target.value);
                }}
              />
              {errors.renewalDate ? (
                <FieldError className="error-text">{errors.renewalDate}</FieldError>
              ) : null}
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={renewalLocked}
                  onChange={(e) => {
                    markDirty();
                    setRenewalLocked(e.target.checked);
                  }}
                />
                <span><LockKeyhole className="inline-icon" /> 手动锁定续费日，防模拟刷新覆盖</span>
              </label>
            </Field>

            <Field className="field" data-invalid={Boolean(errors.paidThrough)}>
              <FieldLabel htmlFor="sub-paid-through">已付有效期结束日（YYYY-MM-DD，可留空）</FieldLabel>
              <Input
                id="sub-paid-through"
                type="text"
                placeholder="例如 2026-10-22"
                value={paidThrough}
                onChange={(e) => {
                  markDirty();
                  setPaidThrough(e.target.value);
                }}
              />
              {errors.paidThrough ? (
                <FieldError className="error-text">{errors.paidThrough}</FieldError>
              ) : null}
              {autoRenew === 'off' ? (
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={paidThroughConfirmedUnknown}
                    onChange={(e) => {
                      markDirty();
                      setPaidThroughConfirmedUnknown(e.target.checked);
                    }}
                  />
                  <span>确认有效期暂不确定（留空待补，不从扣费日自动推断）</span>
                </label>
              ) : null}
            </Field>

            <Field className="field" data-invalid={Boolean(errors.startDate)}>
              <FieldLabel htmlFor="sub-start-date">开始生效日（YYYY-MM-DD，可留空）</FieldLabel>
              <Input
                id="sub-start-date"
                type="text"
                placeholder="例如 2026-09-03"
                value={startDate}
                onChange={(e) => {
                  markDirty();
                  setStartDate(e.target.value);
                }}
              />
              {errors.startDate ? (
                <FieldError className="error-text">{errors.startDate}</FieldError>
              ) : null}
            </Field>

            <Field className="field" data-invalid={Boolean(errors.trialEnd)}>
              <FieldLabel htmlFor="sub-trial-end">试用结束日（YYYY-MM-DD，可留空）</FieldLabel>
              <Input
                id="sub-trial-end"
                type="text"
                placeholder="例如 2026-10-25"
                value={trialEnd}
                onChange={(e) => {
                  markDirty();
                  setTrialEnd(e.target.value);
                }}
              />
              {errors.trialEnd ? <FieldError className="error-text">{errors.trialEnd}</FieldError> : null}
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-anchor-date">月末/闰年账期锚点日（可留空）</FieldLabel>
              <Input
                id="sub-anchor-date"
                type="text"
                placeholder="例如 2027-01-31"
                value={anchorDate}
                onChange={(e) => {
                  markDirty();
                  setAnchorDate(e.target.value);
                }}
              />
            </Field>

            <Field className="field" data-invalid={Boolean(errors.timezone)}>
              <FieldLabel htmlFor="sub-timezone">账单时区</FieldLabel>
              <Input
                id="sub-timezone"
                type="text"
                placeholder="Asia/Shanghai"
                value={timezone}
                onChange={(e) => {
                  markDirty();
                  setTimezone(e.target.value);
                }}
              />
              {errors.timezone ? <FieldError className="error-text">{errors.timezone}</FieldError> : null}
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-billing-group">共用付款组 ID（billingGroupId，独立于额度池）</FieldLabel>
              <Input
                id="sub-billing-group"
                type="text"
                placeholder="例如 billing-openai"
                value={billingGroupId}
                onChange={(e) => {
                  markDirty();
                  setBillingGroupId(e.target.value);
                }}
              />
            </Field>

            <Field className="field">
              <FieldLabel htmlFor="sub-quota-pool">共享额度池 ID（quotaPoolId，独立于付款关系）</FieldLabel>
              <Input
                id="sub-quota-pool"
                type="text"
                placeholder="例如 pool-codex"
                value={quotaPoolId}
                onChange={(e) => {
                  markDirty();
                  setQuotaPoolId(e.target.value);
                }}
              />
            </Field>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={possibleSharedWallet}
              onChange={(e) => {
                markDirty();
                setPossibleSharedWallet(e.target.checked);
              }}
            />
            <span>疑似与同供应商其他 Key 共享同一账户余额（标注防翻倍提示，不重复汇总）</span>
          </label>
        </section>

        {/* Section 2: 可选额度记录与模拟连接 */}
        <section className="form-section stack">
          <div className="section-header">
            <h3 className="form-section-title">可选额度与模拟连接</h3>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                markDirty();
                setMetrics((prev) => [
                  ...prev,
                  {
                    id: `m-${Date.now()}-${prev.length + 1}`,
                    label: kind === 'wallet' ? '可用余额' : '额度',
                    unit: kind === 'wallet' ? currency : '%',
                    value: '',
                    total: kind === 'wallet' ? '' : '100',
                    availability: 'known',
                    resetDate: '',
                    staleAfterMinutes: kind === 'wallet' ? 120 : 30,
                    source: '用户手动录入（示例）',
                  },
                ]);
              }}
            >
              <Plus />添加额度 / 余额指标
            </Button>
          </div>

          <Field className="field">
            <FieldLabel htmlFor="sub-connection">绑定模拟采集连接（无真实凭据输入）</FieldLabel>
            <FormSelect
              id="sub-connection"
              value={connectionId}
              onChange={(e) => {
                markDirty();
                setConnectionId(e.target.value);
              }}
            >
              <option value="">不绑定自动连接（纯手动记录）</option>
              {snapshot.connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider} ({c.id} · {c.account})
                </option>
              ))}
            </FormSelect>
          </Field>

          {metrics.length > 0 ? (
            <div className="metrics-editor-list stack">
              {metrics.map((m, idx) => (
                <div key={m.id} className="metric-editor-card stack">
                  <div className="row spread">
                    <strong>指标 #{idx + 1}</strong>
                    <Button
                      type="button"
                      variant="ghost"
                      className="danger-text"
                      onClick={() => {
                        markDirty();
                        setMetrics((prev) => prev.filter((item) => item.id !== m.id));
                      }}
                    >
                      移除此指标
                    </Button>
                  </div>
                  <div className="form-grid">
                    <Field className="field">
                      <FieldLabel htmlFor={`metric-${m.id}-label`}>指标名称</FieldLabel>
                      <Input
                        id={`metric-${m.id}-label`}
                        type="text"
                        value={m.label}
                        onChange={(e) => {
                          markDirty();
                          const val = e.target.value;
                          setMetrics((prev) =>
                            prev.map((item) =>
                              item.id === m.id ? { ...item, label: val } : item
                            )
                          );
                        }}
                      />
                    </Field>
                    <Field className="field">
                      <FieldLabel htmlFor={`metric-${m.id}-unit`}>单位（% 或 CNY / USD）</FieldLabel>
                      <Input
                        id={`metric-${m.id}-unit`}
                        type="text"
                        value={m.unit}
                        onChange={(e) => {
                          markDirty();
                          const val = e.target.value;
                          setMetrics((prev) =>
                            prev.map((item) =>
                              item.id === m.id ? { ...item, unit: val } : item
                            )
                          );
                        }}
                      />
                    </Field>
                    <Field className="field" data-invalid={Boolean(errors[`metric_${m.id}`])}>
                      <FieldLabel htmlFor={`metric-${m.id}-value`}>当前剩余数值（钱包支持负余额）</FieldLabel>
                      <Input
                        id={`metric-${m.id}-value`}
                        aria-invalid={Boolean(errors[`metric_${m.id}`])}
                        aria-describedby={errors[`metric_${m.id}`] ? `metric-${m.id}-error` : undefined}
                        type="text"
                        placeholder="留空则按状态显示"
                        value={m.value}
                        onChange={(e) => {
                          markDirty();
                          const val = e.target.value;
                          setMetrics((prev) =>
                            prev.map((item) =>
                              item.id === m.id
                                ? {
                                    ...item,
                                    value: val,
                                    availability: val.trim() ? 'known' : item.availability,
                                  }
                                : item
                            )
                          );
                        }}
                      />
                    </Field>
                    <Field className="field">
                      <FieldLabel htmlFor={`metric-${m.id}-availability`}>数据可用性状态</FieldLabel>
                      <FormSelect
                        id={`metric-${m.id}-availability`}
                        aria-label={`指标 ${idx + 1} 数据可用性状态`}
                        value={m.availability}
                        onChange={(e) => {
                          markDirty();
                          const val = e.target.value as Availability;
                          setMetrics((prev) =>
                            prev.map((item) =>
                              item.id === m.id ? { ...item, availability: val } : item
                            )
                          );
                        }}
                      >
                        <option value="known">已知数值（known）</option>
                        <option value="unfetched">尚未获取（unfetched）</option>
                        <option value="unsupported">当前读取方式未提供（unsupported）</option>
                        <option value="unlimited">无限量（unlimited）</option>
                        <option value="na">不适用（na）</option>
                      </FormSelect>
                    </Field>
                  </div>
                  {errors[`metric_${m.id}`] ? (
                    <FieldError id={`metric-${m.id}-error`} className="error-text">{errors[`metric_${m.id}`]}</FieldError>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <FieldDescription>未添加额度指标时，将以纯手动会员方式展示续费日期与价格安排。</FieldDescription>
          )}
        </section>

        {/* Section 3: 提醒、官网与备注 */}
        <section className="form-section stack">
          <h3 className="form-section-title">提醒与备注</h3>
          <div className="form-grid">
            <Field className="field">
              <FieldLabel htmlFor="sub-reminder">日程与提醒范围</FieldLabel>
              <FormSelect
                id="sub-reminder"
                value={reminder}
                onChange={(e) => {
                  markDirty();
                  setReminder(e.target.value as Subscription['reminder']);
                }}
              >
                <option value="local">本地日历与桌面提醒</option>
                <option value="external">本地 + 外部受管日历同步</option>
                <option value="none">不提醒</option>
              </FormSelect>
            </Field>

            <Field className="field" data-invalid={Boolean(errors.website)}>
              <FieldLabel htmlFor="sub-website">官网账单页（仅接受不含凭据的 HTTPS 网址）</FieldLabel>
              <Input
                id="sub-website"
                type="url"
                placeholder="https://..."
                value={website}
                onChange={(e) => {
                  markDirty();
                  setWebsite(e.target.value);
                }}
              />
              {errors.website ? <FieldError className="error-text">{errors.website}</FieldError> : null}
            </Field>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => {
                markDirty();
                setPinned(e.target.checked);
              }}
            />
            <span><Pin className="inline-icon" /> 置顶到概览与托盘摘要</span>
          </label>

          <Field className="field">
            <FieldLabel htmlFor="sub-notes">备注说明</FieldLabel>
            <Textarea
              id="sub-notes"
              rows={2}
              placeholder="记录付款方式、账号归属或退订备忘…"
              value={notes}
              onChange={(e) => {
                markDirty();
                setNotes(e.target.value);
              }}
            />
          </Field>
        </section>

        {/* Footer Actions */}
        <div className="form-footer row spread">
          <span className="muted">
            {mode === 'create'
              ? '保存后自动计算本地日历日程投影'
              : `当前修订版本 v${expectedRevision}`}
          </span>
          <div className="row">
            <Button type="button" variant="outline" onClick={handleRequestClose}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : mode === 'create' ? '创建订阅' : '保存更改'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
