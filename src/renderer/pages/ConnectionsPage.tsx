import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileCode2,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  Unplug,
  WifiOff,
} from 'lucide-react';
import type { PageProps } from '../contracts';
import type { Connection, ConnectionState, Probe } from '../../shared/types';
import { BrandIcon, Modal, StatusBadge } from '../components/ui';
import { FormSelect } from '../components/form-controls';
import { Button } from '../components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible';
import { Field, FieldLabel } from '../components/ui/field';
import './connections.css';

const STATE_META: Record<
  ConnectionState,
  {
    label: string;
    tone: 'neutral' | 'primary' | 'warning' | 'danger';
    summary: string;
  }
> = {
  ready: {
    label: '正常就绪（模拟）',
    tone: 'neutral',
    summary: '按计划执行模拟读取；仅更新适配器声明支持的字段',
  },
  refreshing: {
    label: '模拟采集中…',
    tone: 'primary',
    summary: '在途模拟任务执行中；重复点击自动合并，保留旧观察值防止闪空',
  },
  partial: {
    label: '部分成功（模拟）',
    tone: 'warning',
    summary: '仅成功字段更新采集时间，解析失败字段保留原历史时间',
  },
  auth: {
    label: '需要重新连接（模拟）',
    tone: 'danger',
    summary: '示例会话已过期；旧额度与订阅状态保留，不会将订阅改为已到期',
  },
  denied: {
    label: '权限不足（模拟）',
    tone: 'danger',
    summary: '当前示例身份无权读取该接口；可切换有权限的示例身份重新探测',
  },
  rate_limited: {
    label: '被限流（模拟）',
    tone: 'warning',
    summary: '遵守供应商退避时间；限流窗口内不无限重试，连续点击自动合并',
  },
  offline: {
    label: '离线暂停（模拟）',
    tone: 'warning',
    summary: '离线期间保留本地快照并允许手动编辑；恢复联网后只合并补查一次',
  },
  runtime_missing: {
    label: '缺少官方运行时（模拟）',
    tone: 'danger',
    summary: '需核实官方客户端运行时；不静默后台安装，也不误判为未订阅',
  },
  schema_changed: {
    label: '数据结构变化（模拟）',
    tone: 'danger',
    summary: '上游返回结构变化，已暂停自动覆盖并保留旧值；可模拟适配器恢复',
  },
  paused: {
    label: '用户已暂停（模拟）',
    tone: 'neutral',
    summary: '已暂停模拟周期查询；恢复后仅执行一次补查',
  },
  disconnected: {
    label: '未连接 / 已断开（模拟）',
    tone: 'neutral',
    summary: '已断开模拟绑定；本地订阅资料、手动价格与日历安排完整保留',
  },
};

const ADAPTER_ROUTE_INFO: Record<
  string,
  { method: string; heartbeat: string; boundary: string }
> = {
  'codex-local': {
    method: '官方 Codex App Server · account/rateLimits/read',
    heartbeat: '前台 5 分钟 / 托盘 15 分钟（最短 60 秒）',
    boundary:
      '动态识别实际返回的额度窗口与重置时间；不读取私有数据库，不代表 ChatGPT 全部消费者权益，不自动推断会员扣费日。',
  },
  'copilot-local': {
    method: '官方 Copilot SDK · account.getQuota（需官方 CLI 运行时）',
    heartbeat: '前台 10 分钟 / 托盘 30 分钟（最短 5 分钟）',
    boundary:
      '遍历 quotaSnapshots 并识别无限量特殊值；不从额度 resetDate 推断个人会员续费日期。',
  },
  'deepseek-balance': {
    method: '官方 REST · GET /user/balance',
    heartbeat: '默认 30 分钟（最短 5 分钟）',
    boundary:
      '按币种读取可用总余额、充值余额与赠送余额；按量钱包不自动制造月度续费日。',
  },
  'kimi-platform-cn': {
    method: 'Kimi 开放平台国内站 · GET /v1/users/me/balance',
    heartbeat: '默认 30 分钟（最短 5 分钟）',
    boundary:
      '读取人民币现金、代金券与可用余额；不套用 Kimi Code 会员窗口，不自动跨区替换国际站域名重试。',
  },
  'openrouter-key': {
    method: 'OpenRouter · GET /api/v1/key（当前 Key 范围）',
    heartbeat: '默认 30 分钟（最短 5 分钟）',
    boundary:
      '仅代表当前 Key 限额、用量与剩余预算；不声称获得账户总现金余额（总资金需后续 Management Key）。',
  },
};

const PROFILES = ['个人示例账号', '团队示例账号'] as const;

function formatTimeInZone(instant: string | null, zone: string): string {
  if (!instant) return '尚未记录';
  try {
    const formatted = new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(instant));
    return `${formatted}（${zone}）`;
  } catch {
    return instant;
  }
}

export function ConnectionsPage({
  snapshot,
  client,
  notify,
  onOpen,
  onCreate,
  focusId,
}: PageProps & { focusId?: string }) {
  const userTz = snapshot.preferences.timezone || 'Asia/Shanghai';
  const [filter, setFilter] = useState<'all' | 'abnormal' | 'ready' | 'paused'>('all');

  // Per-card collapsible state for capability / route details (default collapsed)
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [catalogExpanded, setCatalogExpanded] = useState(false);

  // Reconnect / Probe state per connection
  const [activeProbeConnId, setActiveProbeConnId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string>('个人示例账号');
  const [probingConnId, setProbingConnId] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<Probe | null>(null);
  const [bindingConnId, setBindingConnId] = useState<string | null>(null);
  const probeRequestSeq = useRef<number>(0);

  useEffect(() => {
    probeRequestSeq.current++;
    setActiveProbeConnId(null);
    setProbeResult(null);
    setProbingConnId(null);
  }, [snapshot.scenario]);

  // Diagnostics Modal state (raw JSON default collapsed inside modal)
  const [diagModal, setDiagModal] = useState<{
    open: boolean;
    connId?: string;
    text: string;
    loading: boolean;
    rawExpanded: boolean;
  }>({ open: false, text: '', loading: false, rawExpanded: false });

  // Resolve focusId (can be connection.id or subscription.id)
  const resolvedFocusConnId = useMemo(() => {
    if (!focusId) return null;
    const direct = snapshot.connections.find((c) => c.id === focusId);
    if (direct) return direct.id;
    const sub = snapshot.subscriptions.find((s) => s.id === focusId);
    return sub?.connectionId || focusId;
  }, [focusId, snapshot.connections, snapshot.subscriptions]);

  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!resolvedFocusConnId) return;
    setFilter('all');
    const el = cardRefs.current[resolvedFocusConnId];
    if (el) {
      el.scrollIntoView({
        behavior: snapshot.preferences.reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      });
      const focusable = el.querySelector<HTMLElement>('button, [tabindex="0"]');
      focusable?.focus({ preventScroll: true });
    }
  }, [resolvedFocusConnId, snapshot.preferences.reducedMotion]);

  const filteredConnections = useMemo(() => {
    return snapshot.connections.filter((c) => {
      if (filter === 'all') return true;
      if (filter === 'abnormal') {
        return [
          'partial',
          'auth',
          'denied',
          'rate_limited',
          'offline',
          'runtime_missing',
          'schema_changed',
        ].includes(c.state);
      }
      if (filter === 'ready') {
        return c.state === 'ready' || c.state === 'refreshing';
      }
      return c.state === 'paused' || c.state === 'disconnected';
    });
  }, [snapshot.connections, filter]);

  const allPaused =
    snapshot.connections.length > 0 &&
    snapshot.connections.every((c) => c.state === 'paused');

  const abnormalCount = useMemo(
    () =>
      snapshot.connections.filter((c) =>
        [
          'partial',
          'auth',
          'denied',
          'rate_limited',
          'offline',
          'runtime_missing',
          'schema_changed',
        ].includes(c.state)
      ).length,
    [snapshot.connections]
  );

  async function handleRefresh(connId?: string) {
    try {
      const msg = await client.refresh(connId);
      notify(msg);
    } catch (err) {
      notify((err as Error).message || '模拟刷新失败');
    }
  }

  async function handlePause(connId?: string) {
    try {
      await client.pause(connId);
      if (!connId) {
        notify(
          allPaused
            ? '已恢复全部连接并触发一次模拟补查'
            : '已暂停全部模拟连接'
        );
      } else {
        const c = snapshot.connections.find((x) => x.id === connId);
        notify(
          c?.state === 'paused'
            ? `已恢复 ${c.provider} 并执行一次模拟补查`
            : `已暂停 ${c?.provider || connId} 的模拟采集`
        );
      }
    } catch (err) {
      notify((err as Error).message || '切换暂停状态失败');
    }
  }

  async function handleDisconnect(c: Connection) {
    try {
      await client.disconnect(c.id);
      if (activeProbeConnId === c.id) {
        setProbeResult(null);
      }
      notify(`已断开 ${c.provider} 的模拟绑定；订阅资料与本地日程完整保留`);
    } catch (err) {
      notify((err as Error).message || '断开模拟连接失败');
    }
  }

  function handleOpenProbePanel(c: Connection) {
    if (activeProbeConnId === c.id) {
      return;
    }
    probeRequestSeq.current++;
    setActiveProbeConnId(c.id);
    setSelectedProfile(
      PROFILES.includes(c.account as (typeof PROFILES)[number])
        ? c.account
        : '个人示例账号'
    );
    setProbeResult(null);
    setProbingConnId(null);
  }

  function handleCancelProbe() {
    probeRequestSeq.current++;
    setProbingConnId(null);
    setProbeResult(null);
    setActiveProbeConnId(null);
    notify('已取消本次模拟连接探测');
  }

  async function handleStartProbe(c: Connection) {
    const seq = ++probeRequestSeq.current;
    setProbingConnId(c.id);
    setProbeResult(null);
    try {
      const res = await client.probe(c.id, selectedProfile);
      if (probeRequestSeq.current !== seq) return;
      setProbeResult(res);
      notify(
        `已完成 ${c.provider}（${res.account}）模拟探测，请核对可读取字段后确认绑定`
      );
    } catch (err) {
      if (probeRequestSeq.current !== seq) return;
      notify((err as Error).message || '模拟探测失败');
    } finally {
      if (probeRequestSeq.current === seq) {
        setProbingConnId(null);
      }
    }
  }

  async function handleConfirmBind(c: Connection) {
    if (!probeResult || probeResult.connectionId !== c.id) {
      notify('请先执行模拟探测并预览字段');
      return;
    }
    setBindingConnId(c.id);
    try {
      await client.bind(probeResult);
      setProbeResult(null);
      setActiveProbeConnId(null);
      notify(
        `已绑定示例身份「${probeResult.account}」至 ${c.provider}，并完成首次模拟读取`
      );
    } catch (err) {
      notify((err as Error).message || '确认绑定失败，请重新模拟探测');
    } finally {
      setBindingConnId(null);
    }
  }

  async function handleOpenDiagnostics(connId?: string) {
    setDiagModal((prev) => ({
      open: true,
      connId,
      text: '',
      loading: true,
      rawExpanded: prev.open ? prev.rawExpanded : false,
    }));
    try {
      const text = await client.diagnose(connId);
      setDiagModal((prev) => ({
        ...prev,
        open: true,
        connId,
        text,
        loading: false,
      }));
    } catch (err) {
      setDiagModal({
        open: false,
        connId,
        text: '',
        loading: false,
        rawExpanded: false,
      });
      notify((err as Error).message || '生成脱敏诊断失败');
    }
  }

  async function handleExportDiagnostics() {
    if (!diagModal.text) return;
    try {
      const res = await window.subcal.saveFile(
        'subcal-diagnostics.json',
        diagModal.text
      );
      if (res.saved) {
        notify(
          `脱敏诊断 JSON 已导出${res.path ? `：${res.path}` : ' (subcal-diagnostics.json)'}`
        );
      } else {
        notify('已取消导出诊断文件');
      }
    } catch (err) {
      notify((err as Error).message || '导出诊断文件失败');
    }
  }

  async function handleRecoverOffline() {
    try {
      await client.preview.recoverOffline();
      notify('已模拟恢复联网，并对各连接合并执行一次补查');
    } catch (err) {
      notify((err as Error).message || '模拟恢复联网失败');
    }
  }

  async function handleAdvanceClock5Min() {
    try {
      await client.preview.advance(5);
      notify('已通过预览工具推进演示时钟 5 分钟，现在可再次点击模拟刷新');
    } catch (err) {
      notify((err as Error).message || '推进演示时钟失败');
    }
  }

  return (
    <div className="conn-page">
      {/* Top Toolbar & Global Actions */}
      <section className="panel stack" aria-label="连接与采集总控栏">
        <div className="conn-header-bar">
          <div className="stack" style={{ gap: 'var(--space-1, 0.25rem)' }}>
            <div className="row">
              <h2 className="conn-page-title">
                连接能力矩阵与异常恢复（模拟）
              </h2>
              <StatusBadge tone="neutral">
                前端模拟预览 · 不索要真实 Key 或密码
              </StatusBadge>
            </div>
            <p className="conn-summary-line">
              演示当前空间内 5 个 V1 正式适配器的状态、采集时间与异常恢复动作。当前演示时钟：
              {formatTimeInZone(snapshot.now, userTz)}。
            </p>
          </div>

          <div className="row">
            <Button
              type="button"
              disabled={snapshot.connections.length === 0}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw />
              全部模拟刷新
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={snapshot.connections.length === 0}
              onClick={() => void handlePause()}
            >
              {allPaused ? <Play /> : <Pause />}
              {allPaused ? '全部恢复采集（模拟）' : '全部暂停采集（模拟）'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleOpenDiagnostics(undefined)}
            >
              <FileCode2 />
              查看 / 导出脱敏诊断 JSON
            </Button>
          </div>
        </div>

        {/* Offline Banner */}
        {snapshot.offline && (
          <div className="conn-error-box" role="alert">
            <div className="toolbar">
              <div className="stack" style={{ gap: 'var(--space-1, 0.25rem)' }}>
                <div className="conn-error-title">
                  <WifiOff className="size-4" />
                  <span>当前处于模拟离线状态（offline）</span>
                </div>
                <div className="conn-error-note">
                  网络断开期间暂停自动查询，不制造连续失败风暴；已有额度快照保留，您仍可正常查看与手动编辑订阅。恢复联网后每个连接只合并补查一次。
                </div>
              </div>
              <Button
                type="button"
                onClick={() => void handleRecoverOffline()}
              >
                模拟恢复联网并补查一次
              </Button>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div className="conn-filter-bar">
          <div className="row" role="group" aria-label="连接状态筛选">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              全部连接（{snapshot.connections.length}）
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={filter === 'abnormal'}
              onClick={() => setFilter('abnormal')}
            >
              需处理 / 部分成功（{abnormalCount}）
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={filter === 'ready'}
              onClick={() => setFilter('ready')}
            >
              正常就绪（
              {
                snapshot.connections.filter(
                  (c) => c.state === 'ready' || c.state === 'refreshing'
                ).length
              }
              ）
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={filter === 'paused'}
              onClick={() => setFilter('paused')}
            >
              已暂停 / 已断开（
              {
                snapshot.connections.filter(
                  (c) => c.state === 'paused' || c.state === 'disconnected'
                ).length
              }
              ）
            </Button>
          </div>
          {resolvedFocusConnId && (
            <StatusBadge tone="primary">
              已定位连接：{resolvedFocusConnId}
            </StatusBadge>
          )}
        </div>
      </section>

      {/* Five Official Adapter Cards */}
      {snapshot.connections.length === 0 ? (
        <section className="panel empty stack" style={{ alignItems: 'center' }}>
          <h3>当前演示场景未配置活动的模拟连接实例</h3>
          <p className="muted" style={{ margin: 0, maxWidth: '38rem' }}>
            您仍可随时手动录入任意 AI 订阅并使用本地日历提醒，或在「预览工具」切换到「标准混合」「认证失效与人工锁定」「限流与合并」等场景演练 5 个正式适配器的模拟采集与恢复。
          </p>
          <div className="row">
            <Button type="button" onClick={onCreate}>
              <Plus />
              手动新增订阅记录
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleOpenDiagnostics(undefined)}
            >
              <FileCode2 />
              查看脱敏诊断示例
            </Button>
          </div>
        </section>
      ) : filteredConnections.length === 0 ? (
        <section className="panel empty stack" style={{ alignItems: 'center' }}>
          <div>当前筛选条件下没有匹配的模拟连接。</div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setFilter('all')}
          >
            显示全部 {snapshot.connections.length} 个连接
          </Button>
        </section>
      ) : (
        <section className="conn-grid" aria-label="正式适配器模拟连接列表">
          {filteredConnections.map((c) => {
            const meta = STATE_META[c.state];
            const routeInfo = ADAPTER_ROUTE_INFO[c.id] || {
              method: '内置适配器（模拟）',
              heartbeat: '默认 30 分钟',
              boundary: '仅更新声明支持的字段，未知字段与收费日期独立保存。',
            };
            const linkedSubs = snapshot.subscriptions.filter(
              (s) => s.connectionId === c.id
            );
            const isFocused = resolvedFocusConnId === c.id;
            const isProbeOpen = activeProbeConnId === c.id;
            const isProbing = probingConnId === c.id;
            const isBinding = bindingConnId === c.id;
            const isDetailsOpen = Boolean(expandedDetails[c.id]);
            const currentProbe =
              probeResult && probeResult.connectionId === c.id
                ? probeResult
                : null;
            const isProbeStale = Boolean(
              currentProbe && currentProbe.generation !== c.generation
            );

            const needsRecovery = [
              'auth',
              'denied',
              'runtime_missing',
              'schema_changed',
              'disconnected',
            ].includes(c.state);

            const isDangerState = [
              'auth',
              'denied',
              'runtime_missing',
              'schema_changed',
            ].includes(c.state);

            return (
              <article
                key={c.id}
                ref={(el) => {
                  cardRefs.current[c.id] = el;
                }}
                className="conn-card"
                data-focused={isFocused}
                aria-label={`${c.provider} 连接卡片`}
              >
                {/* 1. Identity & Simulated Status */}
                <div className="conn-card-header">
                  <div className="conn-identity">
                    <div className="conn-title-row">
                      <BrandIcon product={c.provider} size={20} />
                      <span className="conn-provider-name">{c.provider}</span>
                      <StatusBadge tone="neutral">模拟来源</StatusBadge>
                    </div>
                    <div className="conn-account-meta">
                      <span>演示身份：</span>
                      <span className="conn-account-name">{c.account}</span>
                      <span>·</span>
                      <span>{c.region}</span>
                    </div>
                  </div>
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                </div>

                <p className="conn-summary-line">{meta.summary}</p>

                {/* 2. Update Times & Preserved Field Timestamps */}
                <div className="conn-time-strip" aria-label={`${c.provider} 更新时间`}>
                  <div className="conn-time-item">
                    <span className="conn-time-label">最后成功时间</span>
                    <span className="conn-time-value">
                      {formatTimeInZone(c.lastSuccess, userTz)}
                    </span>
                  </div>
                  <div className="conn-time-item">
                    <span className="conn-time-label">最后尝试时间</span>
                    <span className="conn-time-value">
                      {formatTimeInZone(c.lastAttempt, userTz)}
                    </span>
                  </div>

                  {c.nextAllowed && (
                    <div className="conn-retry-notice">
                      <Clock className="size-3.5" />
                      <span>下次允许重试时间：</span>
                      <span>{formatTimeInZone(c.nextAllowed, userTz)}</span>
                    </div>
                  )}

                  {c.state === 'partial' && linkedSubs.length > 0 && (
                    <div className="conn-field-time-note">
                      <span>字段级时间保留：</span>
                      {linkedSubs.map((s) => (
                        <span key={s.id} className="tabular">
                          {s.product} 额度观察{' '}
                          {formatTimeInZone(
                            s.metrics[0]?.remaining.observedAt ?? null,
                            userTz
                          )}{' '}
                          · 套餐保持旧观察{' '}
                          {formatTimeInZone(s.plan.observedAt, userTz)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Linked Subscriptions & Locked Field Conflict Hint */}
                <div className="conn-linked-row">
                  <span className="muted">关联订阅：</span>
                  {linkedSubs.length === 0 ? (
                    <span className="muted">暂无关联订阅（或已转为纯手动）</span>
                  ) : (
                    linkedSubs.map((s) => {
                      const hasProposedConflict = Boolean(
                        s.renewalDate.proposed !== undefined ||
                          s.price.proposed !== undefined ||
                          s.plan.proposed !== undefined
                      );
                      return (
                        <Button
                          key={s.id}
                          type="button"
                          variant={hasProposedConflict ? 'secondary' : 'outline'}
                          size="xs"
                          onClick={() => onOpen(s.id)}
                          title="点击在详情抽屉查看该订阅与字段来源"
                        >
                          {hasProposedConflict ? (
                            <TriangleAlert className="size-3.5 text-warning" />
                          ) : null}
                          <span>
                            {s.product}（{s.account}）
                            {hasProposedConflict ? ' · 有人工锁定差异待核对' : ''}
                          </span>
                        </Button>
                      );
                    })
                  )}
                </div>

                {/* 3. Directly Visible Failure Reason & Executable Recovery Advice */}
                {c.error && (
                  <div
                    className="conn-error-box"
                    data-tone={isDangerState ? 'danger' : 'warning'}
                    role="alert"
                  >
                    <div className="toolbar">
                      <span className="conn-error-title">
                        <ShieldAlert className="size-4" />
                        <span>
                          [{c.error.code}] {c.error.message}
                        </span>
                      </span>
                      <StatusBadge tone={isDangerState ? 'danger' : 'warning'}>
                        下一步：{c.error.action}
                      </StatusBadge>
                    </div>

                    {c.state === 'rate_limited' && (
                      <div className="toolbar">
                        <span className="conn-error-note">
                          限流窗口内手动刷新会直接拦截并提示下次允许时间，不发起无限重试。可推进演示时钟越过退避窗口：
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleAdvanceClock5Min()}
                        >
                          <Clock />
                          推进演示时钟 +5 分钟（预览工具操作）
                        </Button>
                      </div>
                    )}

                    {c.state === 'runtime_missing' && (
                      <div className="conn-error-note">
                        正式版引导前往官方渠道安装 CLI 运行时，不在后台静默安装；本预览中可通过下方「模拟重新连接 / 探测恢复」模拟运行时就绪。
                      </div>
                    )}

                    {c.state === 'schema_changed' && (
                      <div className="conn-error-note">
                        上游字段格式变化时立即熔断并保留旧快照，不把余额清空为 0；可通过下方「模拟重新连接 / 探测恢复」演练适配器恢复。
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Directly Executable Action Buttons */}
                <div className="conn-actions-bar">
                  <div className="row">
                    <Button
                      type="button"
                      variant={needsRecovery ? 'outline' : 'default'}
                      onClick={() => void handleRefresh(c.id)}
                    >
                      <RefreshCw
                        className={c.state === 'refreshing' ? 'animate-spin' : undefined}
                      />
                      {c.state === 'refreshing'
                        ? '模拟采集中（点击合并）'
                        : '模拟刷新'}
                    </Button>

                    <Button
                      type="button"
                      variant={needsRecovery ? 'default' : 'outline'}
                      aria-expanded={isProbeOpen}
                      onClick={() =>
                        isProbeOpen
                          ? handleCancelProbe()
                          : handleOpenProbePanel(c)
                      }
                    >
                      <KeyRound />
                      {isProbeOpen
                        ? '收起连接向导'
                        : needsRecovery
                        ? '模拟重新连接 / 探测恢复'
                        : '切换示例身份 / 重新探测'}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handlePause(c.id)}
                    >
                      {c.state === 'paused' ? <Play /> : <Pause />}
                      {c.state === 'paused' ? '恢复采集' : '暂停采集'}
                    </Button>
                  </div>

                  <div className="row">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleOpenDiagnostics(c.id)}
                    >
                      <FileCode2 />
                      脱敏诊断
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={c.state === 'disconnected'}
                      onClick={() => void handleDisconnect(c)}
                    >
                      <Unplug />
                      断开绑定
                    </Button>
                  </div>
                </div>

                {/* 5. Three-Step Reconnect / Probe -> Preview -> Bind Flow */}
                {isProbeOpen && (
                  <div
                    className="conn-probe-panel"
                    role="region"
                    aria-label={`${c.provider} 模拟连接与探测向导`}
                  >
                    <div className="toolbar">
                      <strong>
                        模拟连接向导：选择示例身份 → 模拟探测 → 预览字段 → 确认绑定
                      </strong>
                      <StatusBadge tone="neutral">无需真实凭据</StatusBadge>
                    </div>
                    <p className="conn-summary-line">
                      前端预览阶段仅选择预置示例身份，不提供真实 API Key 或密码输入。重新绑定将递增连接代次（当前代次 #{c.generation}），丢弃旧代次迟到响应。
                    </p>

                    <div className="conn-probe-controls">
                      <Field className="conn-probe-select-field">
                        <FieldLabel htmlFor={`probe-profile-${c.id}`}>
                          1. 选择预置示例身份
                        </FieldLabel>
                        <FormSelect
                          id={`probe-profile-${c.id}`}
                          aria-label="选择预置示例身份"
                          value={selectedProfile}
                          onChange={(e) => {
                            probeRequestSeq.current++;
                            setProbingConnId(null);
                            setSelectedProfile(e.target.value);
                            setProbeResult(null);
                          }}
                        >
                          {PROFILES.map((prof) => (
                            <option key={prof} value={prof}>
                              {prof}
                            </option>
                          ))}
                        </FormSelect>
                      </Field>

                      <div className="row">
                        <Button
                          type="button"
                          variant={!currentProbe || isProbeStale ? 'default' : 'outline'}
                          disabled={isProbing || isBinding}
                          onClick={() => void handleStartProbe(c)}
                        >
                          {isProbing
                            ? '正在执行模拟探测…'
                            : currentProbe
                            ? '重新执行模拟探测'
                            : '2. 开始模拟探测'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={isBinding}
                          onClick={handleCancelProbe}
                        >
                          取消
                        </Button>
                      </div>
                    </div>

                    {isProbeStale && (
                      <div className="conn-error-box" role="alert">
                        <strong>模拟探测结果已失效</strong>
                        <span>
                          连接状态或代次已发生变化（探测基于代次 #{currentProbe?.generation}，当前代次 #{c.generation}）。请重新点击「重新执行模拟探测」后再绑定。
                        </span>
                      </div>
                    )}

                    {currentProbe && !isProbeStale && (
                      <div className="conn-probe-result">
                        <div className="toolbar">
                          <strong>
                            探测结果预览（探测编号：{currentProbe.id} · 目标身份：
                            {currentProbe.account}）
                          </strong>
                          <StatusBadge tone="neutral">
                            探测通过（模拟）
                          </StatusBadge>
                        </div>
                        <div>
                          <strong>确认可读取字段：</strong>
                          {currentProbe.fields.join('、')}
                        </div>
                        <div>
                          <strong>模拟返回样本：</strong>
                          {currentProbe.samples.join('；')}
                        </div>
                        {currentProbe.account !== c.account && (
                          <div className="conn-attention-note">
                            <strong>账号身份变更保护：</strong>
                            从「{c.account}」切换为「{currentProbe.account}」后，系统将分配独立额度池并采用本次模拟探测值，不混入旧身份的额度；手动锁定的续费日与价格仍受保护。
                          </div>
                        )}
                        <div className="row" style={{ marginTop: 'var(--space-1, 0.25rem)' }}>
                          <Button
                            type="button"
                            disabled={isBinding || isProbeStale}
                            onClick={() => void handleConfirmBind(c)}
                          >
                            {isBinding
                              ? '正在绑定并执行首次模拟采集…'
                              : `3. 确认绑定「${currentProbe.account}」并恢复采集（模拟）`}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 6. Default Collapsed Capability Boundaries & Technical Route Details */}
                <Collapsible
                  open={isDetailsOpen}
                  onOpenChange={(open) =>
                    setExpandedDetails((prev) => ({ ...prev, [c.id]: open }))
                  }
                  className="conn-details-collapsible"
                >
                  <CollapsibleTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="conn-details-trigger"
                      />
                    }
                  >
                    <span>
                      {isDetailsOpen
                        ? '收起支持字段与采集路线详情'
                        : `展开支持字段与采集路线详情（支持 ${c.fields.length} 项 · 未提供 ${c.unsupported.length} 项 · 代次 #${c.generation}）`}
                    </span>
                    {isDetailsOpen ? <ChevronUp /> : <ChevronDown />}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="conn-boundary-box">
                      <div className="row">
                        <span className="muted">适配器标识：</span>
                        <code className="conn-mono">{c.id}</code>
                        <span className="muted">· 版本 {c.version}</span>
                        <span className="muted">
                          · 代次 #{c.generation}（已运行 {c.runs} 次）
                        </span>
                      </div>
                      <div>
                        <strong>后续计划自动读取字段：</strong>
                        {c.fields.join('、')}
                      </div>
                      <div>
                        <strong>当前读取方式未提供（需手动或官网核对）：</strong>
                        {c.unsupported.join('、')}
                      </div>
                      <div className="muted">
                        <strong>采集路线：</strong>
                        {routeInfo.method}（{routeInfo.heartbeat}）— {routeInfo.boundary}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </article>
            );
          })}
        </section>
      )}

      {/* Capability Matrix Catalog: Default Collapsed to Keep Primary View Scannable */}
      <Collapsible
        open={catalogExpanded}
        onOpenChange={setCatalogExpanded}
        className="panel"
        aria-label="接入能力目录与支持等级说明"
      >
        <div className="toolbar">
          <div className="stack" style={{ gap: 'var(--space-0-5, 0.125rem)' }}>
            <div className="row">
              <strong>订阅接入目录与支持等级边界（PRD 第 05 章对照）</strong>
              <StatusBadge tone="neutral">
                当前阶段：全部为本地 Mock 预览
              </StatusBadge>
            </div>
            <span className="muted">
              明确区分“正式自动、后续官方、自用实验、手动基线”四类等级，不将“目录内可建档”宣传成“全网 AI 订阅均可自动查询”。
            </span>
          </div>
          <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" />}>
            {catalogExpanded ? <ChevronUp /> : <ChevronDown />}
            {catalogExpanded ? '收起支持等级说明' : '展开支持等级说明'}
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="conn-catalog-grid">
            <div className="conn-catalog-card">
              <div className="toolbar">
                <strong>后续官方路线（已有文档 · V1 不默认要求）</strong>
                <StatusBadge tone="primary">后续官方</StatusBadge>
              </div>
              <ul className="conn-catalog-list">
                <li>
                  <strong>OpenRouter 账户总资金</strong>：GET /api/v1/credits，需权限更大的 Management Key，V1 默认仅用普通 Key 查当前预算。
                </li>
                <li>
                  <strong>OpenAI API 组织 Usage / Costs</strong>：组织管理 API，查询成本汇总而非预付余额，也不提供个人 ChatGPT 会员账期。
                </li>
                <li>
                  <strong>Cursor Teams / Enterprise</strong>：官方 Admin API 仅适用团队管理员（建议至多每小时查询），不可外推为个人 Pro 接口。
                </li>
                <li>
                  <strong>GitHub 个人 / 组织账单报告</strong>：Billing REST API，按报告周期统计，与 SDK 当前剩余额度分开建模。
                </li>
              </ul>
            </div>

            <div className="conn-catalog-card">
              <div className="toolbar">
                <strong>自用实验候选（默认关闭 · 非商业承诺）</strong>
                <StatusBadge tone="warning">自用实验</StatusBadge>
              </div>
              <ul className="conn-catalog-list">
                <li>
                  <strong>Claude Code 本地 CLI</strong>：仅在确认条款后解析本机官方 CLI <code>/usage</code> 输出，绝不抽取 Claude.ai Cookie 或 OAuth Token。
                </li>
                <li>
                  <strong>Kimi Code 与 Kimi 会员</strong>：跨功能共享积分窗口实验，不与国内站 API 钱包混同。
                </li>
                <li>
                  <strong>GLM Coding Plan / Z.ai、MiniMax Token Plan</strong>：存在非公开或变动中的配额路径，需独立核对合同，默认关闭。
                </li>
                <li>
                  <strong>SiliconFlow、Gemini CLI / Code Assist</strong>：仅作自用实验候选，失败随时退回手动记录。
                </li>
              </ul>
            </div>

            <div className="conn-catalog-card">
              <div className="toolbar">
                <strong>手动建档与提醒基线（支持任意服务）</strong>
                <StatusBadge tone="neutral">手动基线</StatusBadge>
              </div>
              <ul className="conn-catalog-list">
                <li>
                  <strong>ChatGPT Plus / Pro 消费者会员</strong>：支持与 Codex 关联共用付款（billingGroupId），但聊天与编程额度池保持独立。
                </li>
                <li>
                  <strong>Claude Pro / Max 网页版、Cursor 个人版、Gemini 消费者会员</strong>：手动记录续费日、价格、官网入口与本地日历提醒。
                </li>
                <li>
                  <strong>Windsurf、Perplexity、Poe、Grok、Factory</strong>：按各自账号与账期建档，未知额度显示“当前读取方式未提供此项”而非 0%。
                </li>
                <li>
                  <strong>Midjourney、Runway、可灵、海螺及任意自定义服务</strong>：支持分钟、积分、次等单位与周期核对提醒。
                </li>
              </ul>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Sanitized Diagnostics Modal (Raw JSON Default Collapsed) */}
      {diagModal.open && (
        <Modal
          title={
            diagModal.connId
              ? `脱敏诊断预览 · ${diagModal.connId}（模拟）`
              : '全局连接脱敏诊断预览（模拟）'
          }
          onClose={() =>
            setDiagModal({
              open: false,
              connId: undefined,
              text: '',
              loading: false,
              rawExpanded: false,
            })
          }
          wide
        >
          <div className="conn-diag-root">
            <p className="conn-summary-line">
              诊断内容由 <code>client.diagnose()</code> 实时生成，已剔除账号别名、官网链接、API Key 及本机路径，仅保留适配器版本、状态码、运行次数与脱敏引用编号。
            </p>

            <div className="toolbar">
              <div className="row" role="group" aria-label="脱敏诊断范围">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={!diagModal.connId}
                  onClick={() => void handleOpenDiagnostics(undefined)}
                >
                  全部连接诊断
                </Button>
                {snapshot.connections.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={diagModal.connId === c.id}
                    onClick={() => void handleOpenDiagnostics(c.id)}
                  >
                    仅 {c.provider}
                  </Button>
                ))}
              </div>

              <Button
                type="button"
                disabled={diagModal.loading || !diagModal.text}
                onClick={() => void handleExportDiagnostics()}
              >
                <Download />
                导出诊断文件 (subcal-diagnostics.json)
              </Button>
            </div>

            {diagModal.loading ? (
              <div className="empty">正在生成脱敏诊断 JSON…</div>
            ) : (
              <>
                <div className="conn-diag-summary">
                  <div>
                    <span className="muted">诊断范围：</span>
                    <strong>{diagModal.connId || `全部连接（${snapshot.connections.length}）`}</strong>
                  </div>
                  <div>
                    <span className="muted">当前场景：</span>
                    <strong>{snapshot.scenario}</strong>
                  </div>
                  <div>
                    <span className="muted">敏感字段过滤：</span>
                    <strong>已脱敏（无凭据/路径）</strong>
                  </div>
                </div>

                <Collapsible
                  open={diagModal.rawExpanded}
                  onOpenChange={(open) =>
                    setDiagModal((prev) => ({ ...prev, rawExpanded: open }))
                  }
                >
                  <CollapsibleTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="conn-details-trigger"
                      />
                    }
                  >
                    <span>
                      {diagModal.rawExpanded
                        ? '收起脱敏诊断 JSON 原文'
                        : '展开脱敏诊断 JSON 原文'}
                    </span>
                    {diagModal.rawExpanded ? <ChevronUp /> : <ChevronDown />}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="conn-diag-pre">{diagModal.text}</pre>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
