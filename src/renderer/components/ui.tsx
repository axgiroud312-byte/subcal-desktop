import React, { useContext, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ConnectionState, Field, Metric } from '../../shared/types';
import { decimal, fieldText, freshness, money } from '../../shared/rules';
import { LockKeyhole, X } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { ModalNotice, NotificationContext } from './notifications';
import openaiLogo from '../assets/brands/openai.svg?raw';
import codexLogo from '../assets/brands/codex.svg?raw';
import copilotLogo from '../assets/brands/github-copilot.svg?raw';
import claudeLogo from '../assets/brands/claude.svg?raw';
import anthropicLogo from '../assets/brands/anthropic.svg?raw';
import kimiLogo from '../assets/brands/kimi.svg?raw';
import moonshotLogo from '../assets/brands/moonshot.svg?raw';
import deepseekLogo from '../assets/brands/deepseek.svg?raw';
import openrouterLogo from '../assets/brands/openrouter.svg?raw';
import cursorLogo from '../assets/brands/cursor.svg?raw';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
}

const modalStack: string[] = [];
const modalListeners = new Set<() => void>();
const subscribeModals = (listener: () => void) => { modalListeners.add(listener); return () => { modalListeners.delete(listener); }; };
const activeModal = () => modalStack.at(-1) ?? null;
function publishModals() {
  document.documentElement.dataset.modalOpen = String(modalStack.length > 0);
  modalListeners.forEach((listener) => listener());
}
let lastPageFocus: HTMLElement | null = null;

export function Modal({ title, onClose, children, wide = false, drawer = false }: ModalProps) {
  const instanceId = useId();
  const topModalId = useSyncExternalStore(subscribeModals, activeModal, () => null);
  const notifications = useContext(NotificationContext);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => {
    const opener = previousFocus.current;
    if (opener && opener !== document.body && !opener.closest('[role="dialog"],[role="alertdialog"]')) lastPageFocus = opener;
    modalStack.push(instanceId);
    publishModals();
    return () => { const index = modalStack.indexOf(instanceId); if (index >= 0) modalStack.splice(index, 1); publishModals(); };
  }, [instanceId]);

  // App-level detail/edit are imperative sibling roots. Only the top root may
  // request dismissal; focus trapping and nested Select Escape stay in Base UI.
  const changeOpen = (open: boolean, details: { cancel: () => void }) => {
    if (open) return;
    if (modalStack.at(-1) !== instanceId) { details.cancel(); return; }
    onClose();
  };
  const finalFocus = () => previousFocus.current?.isConnected
    ? previousFocus.current
    : lastPageFocus?.isConnected ? lastPageFocus : document.querySelector<HTMLElement>('[aria-current="page"]');
  const closeButton = <Button type="button" variant="ghost" size="icon" className="modal-close" aria-label={`关闭 ${title}`} onClick={onClose}><X /></Button>;
  const feedback = topModalId === instanceId && notifications.notice ? <ModalNotice notice={notifications.notice} dismiss={notifications.dismiss} /> : null;

  return drawer ? (
    <Sheet open onOpenChange={changeOpen}>
      <SheetContent side="right" showCloseButton={false} finalFocus={finalFocus} className="modal-surface modal-drawer flex w-[var(--size-sheet,28.75rem)] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[var(--size-sheet,28.75rem)]">
        <header className="modal-header"><SheetTitle className="modal-title text-sm font-semibold">{title}</SheetTitle>{closeButton}</header>
        {feedback}
        <div className="modal-body">{children}</div>
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open onOpenChange={changeOpen}>
      <DialogContent showCloseButton={false} finalFocus={finalFocus} className={`modal-surface modal-dialog flex w-[var(--dialog-width)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[var(--dialog-width)] ${wide ? 'modal-wide' : ''}`}>
        <header className="modal-header"><DialogTitle className="modal-title text-sm font-semibold">{title}</DialogTitle>{closeButton}</header>
        {feedback}
        <div className="modal-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export interface BrandIconProps {
  product: string;
  brand?: string;
  size?: number;
}

const BRAND_LOGOS = [
  { match: 'codex', svg: codexLogo },
  { match: 'copilot', svg: copilotLogo },
  { match: 'claude', svg: claudeLogo },
  { match: 'anthropic', svg: anthropicLogo },
  { match: 'kimi', svg: kimiLogo },
  { match: 'moonshot', svg: moonshotLogo },
  { match: 'deepseek', svg: deepseekLogo },
  { match: 'openrouter', svg: openrouterLogo },
  { match: 'cursor', svg: cursorLogo },
  { match: 'chatgpt', svg: openaiLogo },
  { match: 'openai', svg: openaiLogo },
];

export function BrandIcon({ product, brand, size = 22 }: BrandIconProps) {
  const key = `${product} ${brand || ''}`.toLowerCase();
  const matched = BRAND_LOGOS.find((item) => key.includes(item.match));

  if (matched) {
    return (
      <span
        className="brand-icon brand-icon-local"
        style={{ width: size, height: size }}
        aria-hidden="true"
        data-brand-logo={matched.match}
        // Only bundled, reviewed SVG files. Never interpolate user input here.
        dangerouslySetInnerHTML={{ __html: matched.svg }}
      />
    );
  }

  const label = (product || brand || 'SC').trim().replace(/^[^\p{L}\p{N}]+/u, '');
  const monogram = label.slice(0, 2).toUpperCase() || 'SC';

  return (
    <span
      className="brand-icon brand-icon-fallback"
      style={{
        width: size,
        height: size,
      }}
      aria-hidden="true"
      data-brand-fallback="true"
    >
      {monogram}
    </span>
  );
}

export interface StatusBadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' | string;
  className?: string;
  title?: string;
}

export function StatusBadge({ children, tone = 'neutral', className = '', title }: StatusBadgeProps) {
  return <Badge variant={tone === 'danger' ? 'destructive' : tone === 'warning' ? 'warning' : 'secondary'} className={`badge ${tone} ${className}`.trim()} title={title}>{children}</Badge>;
}

export function formatRelativeTime(observedAt: string | null, now?: string): string {
  if (!observedAt) return '未记录时间';
  if (!now) {
    return formatDateTime(observedAt);
  }
  const diffMs = Date.parse(now) - Date.parse(observedAt);
  if (!Number.isFinite(diffMs)) return formatDateTime(observedAt);
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays <= 14) return `${diffDays} 天前`;
  return formatDateTime(observedAt);
}

export function formatDateTime(instant: string | null, zone = 'Asia/Shanghai'): string {
  if (!instant) return '未记录';
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
    return instant.slice(0, 16).replace('T', ' ');
  }
}

export interface FieldSourceProps {
  field: Field<string>;
  now?: string;
  label?: string;
}

export function FieldSource({ field, now, label }: FieldSourceProps) {
  const timeText = field.observedAt ? formatRelativeTime(field.observedAt, now) : '无观察时间';
  const availNote =
    field.availability === 'unfetched'
      ? '尚未获取'
      : field.availability === 'unsupported'
        ? '当前读取方式未提供'
        : field.availability === 'na'
          ? '不适用'
          : field.availability === 'denied'
            ? '权限受限'
            : field.availability === 'unlimited'
              ? '无限量'
              : null;

  return (
    <span className="field-source">
      {label ? <span className="field-source-label">{label}：</span> : null}
      {field.locked ? (
        <span className="field-lock-tag" title="用户已手动锁定此字段，模拟采集不会静默覆盖">
          <LockKeyhole aria-hidden="true" /> 手动锁定
        </span>
      ) : null}
      <span>{field.source || '手动记录（示例）'}</span>
      <span className="field-source-sep">·</span>
      <span>{timeText}</span>
      {availNote && field.availability !== 'known' ? (
        <>
          <span className="field-source-sep">·</span>
          <span>{availNote}</span>
        </>
      ) : null}
      {field.proposed !== undefined ? (
        <StatusBadge tone="warning" className="field-proposed-pill">待裁决模拟新值：{field.proposed}</StatusBadge>
      ) : null}
    </span>
  );
}

export interface QuotaMeterProps {
  metric: Metric;
  now?: string;
  view?: 'remaining' | 'used';
}

export function QuotaMeter({ metric, now = '2026-10-20T01:00:00.000Z', view = 'remaining' }: QuotaMeterProps) {
  const { remaining, unit, label, total, resetAt } = metric;
  const freshState = freshness(metric, now);
  const relTime = remaining.observedAt ? formatRelativeTime(remaining.observedAt, now) : '无时间戳';
  const resetText = resetAt ? formatDateTime(resetAt) : null;

  if (remaining.availability === 'unlimited') {
    return (
      <div className="quota-meter quota-unlimited">
        <div className="quota-header">
          <span className="quota-label">{label}</span>
          <strong className="quota-value unlimited-text">无限量</strong>
        </div>
        <div className="quota-sub">
          <span>{remaining.source}</span>
        </div>
      </div>
    );
  }

  if (remaining.availability !== 'known' || remaining.value === null) {
    const statusText = fieldText(remaining);
    return (
      <div className="quota-meter quota-unavailable">
        <div className="quota-header">
          <span className="quota-label">{label}</span>
          <span className="quota-value unavailable-text">{statusText}</span>
        </div>
        <div className="quota-sub">
          <span>来源：{remaining.source || '手动记录（示例）'}</span>
          {remaining.observedAt ? <span>{relTime}</span> : <span>不等于 0%</span>}
        </div>
      </div>
    );
  }

  if (unit === '%') {
    const remNum = Math.max(0, Math.min(100, Number(remaining.value)));
    const usedNum = Math.max(0, Math.min(100, 100 - remNum));
    const displayNum = view === 'used' ? usedNum : remNum;
    const modePrefix = view === 'used' ? '已用' : '剩余';

    const isLowQuota = freshState === 'fresh' && remNum <= 20;
    const barTone =
      freshState === 'past_reset'
        ? 'past-reset'
        : freshState === 'stale'
          ? 'stale'
          : isLowQuota
            ? 'danger'
            : remNum <= 40
              ? 'warning'
              : 'primary';

    return (
      <div className={`quota-meter ${freshState !== 'fresh' ? `quota-${freshState}` : ''}`}>
        <div className="quota-header">
          <span className="quota-label">{label}</span>
          <div className="quota-value-group">
            {freshState === 'past_reset' ? (
              <strong className="quota-value past-reset-text">预计已重置，尚待核实</strong>
            ) : (
              <strong className={`quota-value tabular ${isLowQuota ? 'danger-text' : ''}`}>
                {modePrefix} {displayNum}%
              </strong>
            )}
          </div>
        </div>
        {freshState !== 'past_reset' ? <Progress
          className={`quota-progress tone-${barTone}`}
          tone={barTone === 'danger' ? 'destructive' : barTone === 'warning' ? 'warning' : barTone === 'stale' ? 'muted' : 'default'}
          value={displayNum}
          aria-label={`${label} ${modePrefix}百分比`}
        /> : null}
        <div className="quota-sub">
          <span>
            {freshState === 'past_reset'
              ? `原记录剩余 ${remNum}% · ${relTime}观察`
              : freshState === 'stale'
                ? `${relTime} · 已过时 · ${remaining.source}`
                : `${relTime} · ${remaining.source}`}
          </span>
          {resetText ? <span className="quota-reset-tag">额度重置：{resetText}（非续费日）</span> : null}
        </div>
      </div>
    );
  }

  // Currency / Wallet / Key Budget metric
  const hasTotal = total !== null && total !== undefined;
  let primaryDisplay = money(remaining.value, unit);
  let pctWidth: number | null = null;

  if (hasTotal) {
    try {
      const remDec = decimal(remaining.value);
      const totDec = decimal(total);
      const usedDec = totDec - remDec;
      if (totDec > 0n) {
        const ratio = Number(((view === 'used' ? usedDec : remDec) * 100n) / totDec);
        pctWidth = Math.max(0, Math.min(100, ratio));
      }
      if (view === 'used') {
        const usedNum = (Number(totDec - remDec) / 1_000_000).toFixed(2);
        primaryDisplay = `已用 ${money(usedNum, unit)} / ${money(total, unit)}`;
      } else {
        primaryDisplay = `${money(remaining.value, unit)} / ${money(total, unit)}`;
      }
    } catch {
      primaryDisplay = `${money(remaining.value, unit)} / ${money(total, unit)}`;
    }
  }

  return (
    <div className={`quota-meter quota-wallet ${freshState !== 'fresh' ? `quota-${freshState}` : ''}`}>
      <div className="quota-header">
        <span className="quota-label">{label}</span>
        {freshState === 'past_reset' ? (
          <strong className="quota-value past-reset-text">预计已重置，尚待核实</strong>
        ) : (
          <strong className="quota-value quota-money tabular">{primaryDisplay}</strong>
        )}
      </div>
      {pctWidth !== null && freshState !== 'past_reset' ? <Progress value={pctWidth} aria-label={`${label} ${view === 'used' ? '已用' : '剩余'}比例`} className="quota-progress" /> : null}
      <div className="quota-sub">
        <span>
          {freshState === 'past_reset'
            ? `原观察值 ${money(remaining.value, unit)}（${relTime}），已过重置时间待复查`
            : freshState === 'stale'
              ? `${relTime} · 已过时 · ${remaining.source}`
              : `${relTime} · ${remaining.source}`}
        </span>
        {resetText ? <span className="quota-reset-tag">限额重置：{resetText}（非续费日）</span> : null}
      </div>
    </div>
  );
}

export function connectionStateMeta(state: ConnectionState): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'primary';
  needsRecovery: boolean;
} {
  switch (state) {
    case 'ready':
      return { label: '模拟就绪', tone: 'neutral', needsRecovery: false };
    case 'refreshing':
      return { label: '模拟刷新中…', tone: 'primary', needsRecovery: false };
    case 'partial':
      return { label: '部分成功（模拟）', tone: 'warning', needsRecovery: true };
    case 'auth':
      return { label: '需要重新连接（模拟）', tone: 'danger', needsRecovery: true };
    case 'denied':
      return { label: '权限不足（模拟）', tone: 'danger', needsRecovery: true };
    case 'rate_limited':
      return { label: '触发限流（模拟）', tone: 'warning', needsRecovery: true };
    case 'offline':
      return { label: '离线保留快照（模拟）', tone: 'warning', needsRecovery: false };
    case 'runtime_missing':
      return { label: '缺少运行时（模拟）', tone: 'danger', needsRecovery: true };
    case 'schema_changed':
      return { label: '结构变化待恢复（模拟）', tone: 'danger', needsRecovery: true };
    case 'paused':
      return { label: '模拟已暂停', tone: 'neutral', needsRecovery: false };
    case 'disconnected':
      return { label: '未绑定模拟连接', tone: 'neutral', needsRecovery: true };
  }
}

export function cycleLabel(cycle: string, intervalDays = 30): string {
  switch (cycle) {
    case 'monthly':
      return '月度';
    case 'yearly':
      return '年度';
    case 'days':
      return `每 ${intervalDays} 天`;
    case 'once':
      return '单次付费';
    case 'irregular':
      return '不定期';
    case 'none':
      return '不适用（按量/无周期）';
    default:
      return cycle;
  }
}

export function lifecycleMeta(lifecycle: string, autoRenew?: string): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'primary';
} {
  if (lifecycle === 'archived') return { label: '已归档', tone: 'neutral' };
  if (lifecycle === 'cancelled') return { label: '已停订', tone: 'neutral' };
  if (lifecycle === 'expired') return { label: '已过期', tone: 'danger' };
  if (lifecycle === 'ending' || autoRenew === 'off') return { label: '到期不续费', tone: 'warning' };
  if (lifecycle === 'trial') return { label: '试用期', tone: 'primary' };
  if (lifecycle === 'pending') return { label: '待确认', tone: 'warning' };
  return { label: '有效', tone: 'success' };
}
