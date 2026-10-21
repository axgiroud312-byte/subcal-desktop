import { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import type { Notify } from '../contracts';
import type { MockSubCalClient } from '../service/MockSubCalClient';
import type {
  Backend,
  CalendarTarget,
  EventKind,
  Snapshot,
  SyncChange,
  SyncPreview as SyncPreviewData,
} from '../../shared/types';
import { projectEvents } from '../../shared/rules';
import { Modal } from './ui';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { FormSelect } from './form-controls';
import './sync-preview.css';

export type SyncPreviewProps = {
  snapshot: Snapshot;
  client: MockSubCalClient;
  notify: Notify;
  onClose?: () => void;
  initialBackend?: Backend;
  modal?: boolean;
};

const EVENT_KIND_LABELS: Record<EventKind, string> = {
  renewal: '续费',
  expiry: '到期',
  trial: '试用结束',
  start: '开始',
  reset: '额度重置',
};

const ACTION_META: Record<
  SyncChange['action'],
  {
    label: string;
    badgeVariant: 'success' | 'secondary' | 'destructive' | 'warning' | 'outline';
    desc: string;
  }
> = {
  add: {
    label: '模拟新增',
    badgeVariant: 'success',
    desc: '将在模拟目标日历创建新受管事件（写入稳定逻辑 ID）',
  },
  update: {
    label: '模拟改期/更新',
    badgeVariant: 'secondary',
    desc: '沿用同一稳定逻辑 ID 更新原事件日期或标题，不重复新建',
  },
  remove: {
    label: '模拟移除',
    badgeVariant: 'destructive',
    desc: '本地计划已取消或移除，将清理该未来受管事件',
  },
  conflict: {
    label: '外部改期冲突',
    badgeVariant: 'warning',
    desc: '模拟远端日期与上次同步基线不一致，需先人工裁决',
  },
  suppressed: {
    label: '已抑制（不复活）',
    badgeVariant: 'outline',
    desc: '外部已删除或已解除管理，保留抑制标记，普通刷新与同步不会自动重建',
  },
};

const TARGET_STATE_META: Record<
  CalendarTarget['state'],
  {
    label: string;
    badgeVariant: 'secondary' | 'warning' | 'destructive';
  }
> = {
  ready: { label: '可写就绪（模拟）', badgeVariant: 'secondary' },
  paused: { label: '已暂停（模拟）', badgeVariant: 'warning' },
  readonly: { label: '目标只读（模拟）', badgeVariant: 'destructive' },
  missing: { label: '目标日历缺失（模拟）', badgeVariant: 'destructive' },
  auth: { label: '授权失效待核对（模拟）', badgeVariant: 'destructive' },
};

const BACKEND_SPEC: Record<
  Backend,
  {
    title: string;
    routeSummary: string;
    permissionSummary: string;
    confirmBoundary: string;
    finalStepLabel: string;
  }
> = {
  google: {
    title: 'Google Calendar API',
    routeSummary:
      'Windows / macOS 均通过官方 API 写入 SubCal 专用次级日历（calendar.app.created）。',
    permissionSummary:
      '正式版采用系统浏览器 OAuth + PKCE；本预览无需登录、不收集密码，不请求全部私人日历权限。',
    confirmBoundary: '模拟已排队 → 模拟已写入 → 模拟远端读回一致',
    finalStepLabel: '3. 模拟远端读回一致',
  },
  eventkit: {
    title: 'macOS 系统日历 (EventKit)',
    routeSummary:
      'macOS 首选原生 EventKit 写入用户选定的 SubCal 专用日历（Windows 环境仅作跨平台案例演示）。',
    permissionSummary:
      '需日历完整访问权限以完成幂等读回更新，但业务层仅操作带 SubCal 稳定标记的专用日历事件。',
    confirmBoundary:
      '模拟已排队 → 模拟写入系统日历 → 模拟本机读回一致（iCloud 云端由系统同步，本预览未验证）',
    finalStepLabel: '3. 模拟本机读回一致（云端未验证）',
  },
  'icloud-caldav': {
    title: 'Windows iCloud CalDAV',
    routeSummary:
      'Windows 通过 HTTPS CalDAV (RFC 4791) 写入用户在 iCloud 创建的 SubCal 专用日历，由 Apple 日历展示。',
    permissionSummary:
      '正式版使用 Apple 专用密码且不索要 Apple ID 主密码；本前端预览不索要任何密码或凭据。',
    confirmBoundary: '模拟已排队 → 模拟已写入 → 模拟远端读回一致',
    finalStepLabel: '3. 模拟远端读回一致',
  },
};

export function SyncPreview({
  snapshot,
  client,
  notify,
  onClose,
  initialBackend = 'google',
  modal = true,
}: SyncPreviewProps) {
  const failSwitchId = useId();
  const [selectedBackend, setSelectedBackend] =
    useState<Backend>(initialBackend);
  const [previewRecord, setPreviewRecord] = useState<{
    data: SyncPreviewData;
    targetRevision: number;
  } | null>(null);
  const [failAfterWrite, setFailAfterWrite] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedRemoteEventId, setSelectedRemoteEventId] =
    useState<string>('');
  const [targetSettingsOpen, setTargetSettingsOpen] = useState(false);
  const [externalDrillOpen, setExternalDrillOpen] = useState(false);

  useEffect(() => {
    setSelectedBackend(initialBackend);
  }, [initialBackend]);

  const activeTarget = useMemo(
    () =>
      snapshot.targets.find((t) => t.id === selectedBackend) ||
      snapshot.targets[0],
    [snapshot.targets, selectedBackend]
  );

  const localEventsMap = useMemo(() => {
    const list = projectEvents(snapshot.subscriptions, snapshot.now, false);
    return new Map(list.map((e) => [e.id, e]));
  }, [snapshot.subscriptions, snapshot.now]);

  useEffect(() => {
    if (!activeTarget) return;
    if (activeTarget.remote.length === 0) {
      setSelectedRemoteEventId('');
      return;
    }
    if (!activeTarget.remote.some((r) => r.id === selectedRemoteEventId)) {
      setSelectedRemoteEventId(activeTarget.remote[0].id);
    }
  }, [activeTarget, selectedRemoteEventId]);

  const activePreview =
    previewRecord && previewRecord.data.backend === activeTarget.id
      ? previewRecord.data
      : null;

  const isPreviewStale = Boolean(
    previewRecord &&
      previewRecord.data.backend === activeTarget.id &&
      (previewRecord.data.revision !== snapshot.revision ||
        previewRecord.targetRevision !== activeTarget.revision)
  );

  const activeConflicts = useMemo(() => {
    return activeTarget.remote.filter(
      (r) =>
        r.managed &&
        !r.deleted &&
        !r.suppressed &&
        r.date !== r.baselineDate
    );
  }, [activeTarget.remote]);

  const hasConflicts =
    activeConflicts.length > 0 ||
    Boolean(activePreview?.changes.some((c) => c.action === 'conflict'));

  const isStageRunning =
    activeTarget.stage === 'queued' ||
    activeTarget.stage === 'written' ||
    busyAction === 'sync';

  const platformName =
    typeof window !== 'undefined' && window.subcal?.platform
      ? window.subcal.platform
      : 'win32';

  async function handlePreview(backend: Backend = activeTarget.id) {
    setBusyAction('preview');
    try {
      const targetNow =
        snapshot.targets.find((t) => t.id === backend) || activeTarget;
      const res = await client.previewSync(backend);
      setPreviewRecord({ data: res, targetRevision: targetNow.revision });
      notify(
        `已生成 ${targetNow.name} 的模拟同步预演清单（共 ${res.changes.length} 项记录）`
      );
    } catch (err) {
      notify((err as Error).message || '生成同步预演清单失败');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSync() {
    if (!activePreview || isPreviewStale) {
      notify('请先计算最新的同步预演清单，再执行模拟同步');
      return;
    }
    setBusyAction('sync');
    try {
      await client.sync(activePreview.id, failAfterWrite);
      setPreviewRecord(null);
      const finished = (await client.snapshot()).targets.find(
        (t) => t.id === activeTarget.id
      );
      if (
        !finished ||
        finished.stage !== 'verified' ||
        finished.state !== 'ready'
      ) {
        notify(finished?.message || '模拟同步已取消，请重新预览');
      } else if (failAfterWrite) {
        notify(
          '已模拟“写入后读回失败”：已写入快照保留，请重新预览后继续核对重试（模拟）'
        );
      } else if (activeTarget.id === 'eventkit') {
        notify(
          'EventKit 模拟本机读回一致；iCloud 云端由系统同步，本预览未验证'
        );
      } else {
        notify(`${activeTarget.name}：模拟远端读回一致`);
      }
    } catch (err) {
      notify((err as Error).message || '执行模拟同步失败');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTargetState(state: CalendarTarget['state']) {
    setBusyAction(`state:${state}`);
    try {
      await client.targetState(activeTarget.id, state);
      notify(
        state === 'ready'
          ? `已恢复 ${activeTarget.name} 为可写状态（模拟），请重新计算预览`
          : `已切换 ${activeTarget.name} 状态为 ${TARGET_STATE_META[state].label}`
      );
    } catch (err) {
      notify((err as Error).message || '更新目标状态失败');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResolveConflict(
    eventId: string,
    choice: 'local' | 'remote' | 'unlink'
  ) {
    setBusyAction(`conflict:${eventId}:${choice}`);
    try {
      await client.resolveConflict(activeTarget.id, eventId, choice);
      const updatedSnap = await client.snapshot();
      const updatedTarget =
        updatedSnap.targets.find((t) => t.id === activeTarget.id) ||
        activeTarget;
      const freshPreview = await client.previewSync(activeTarget.id);
      setPreviewRecord({
        data: freshPreview,
        targetRevision: updatedTarget.revision,
      });
      const labelMap = {
        local: '已恢复为本地计划日期（模拟），预演清单已刷新',
        remote:
          '已采纳模拟外部日期为新的手动计划（非已扣款），本地日历与详情已同步',
        unlink:
          '已解除该事件受管绑定并保留模拟外部事件，后续普通刷新不再覆盖',
      };
      notify(labelMap[choice]);
    } catch (err) {
      notify((err as Error).message || '处理模拟冲突失败');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSimulateExternal(kind: 'move' | 'delete') {
    if (!selectedRemoteEventId) {
      notify('请先选择一个已写入的模拟远端事件');
      return;
    }
    setBusyAction(`ext:${kind}`);
    try {
      await client.simulateExternal(
        activeTarget.id,
        selectedRemoteEventId,
        kind
      );
      const updatedSnap = await client.snapshot();
      const updatedTarget =
        updatedSnap.targets.find((t) => t.id === activeTarget.id) ||
        activeTarget;
      const freshPreview = await client.previewSync(activeTarget.id);
      setPreviewRecord({
        data: freshPreview,
        targetRevision: updatedTarget.revision,
      });
      notify(
        kind === 'move'
          ? '已模拟外部日历改期 (+3 天)，请在冲突面板裁决处理'
          : '已模拟外部日历删除，已记录抑制标记（suppressed），普通刷新与同步不会自动复活'
      );
    } catch (err) {
      notify((err as Error).message || '模拟外部变更失败');
    } finally {
      setBusyAction(null);
    }
  }

  const changeCounts = useMemo(() => {
    const counts = { add: 0, update: 0, remove: 0, conflict: 0, suppressed: 0 };
    if (!activePreview) return counts;
    for (const c of activePreview.changes) {
      counts[c.action]++;
    }
    return counts;
  }, [activePreview]);

  const spec = BACKEND_SPEC[activeTarget.id];

  const content = (
    <div className="sync-preview-root">
      {/* 1. Three Backends Selection + On-Demand Target Settings */}
      <section className="sync-section" aria-label="外部日历同步后端与目标设置">
        <div className="section-header">
          <div>
            <div className="sync-section-title">
              1. 选择日历同步后端（前端模拟预演）
            </div>
            <div className="muted">
              仅在演示空间预演，发布产品、日期与预计性质；无真实外部写入。
            </div>
          </div>
          <Badge variant="outline">模拟日历预演 · 无真实外部写入</Badge>
        </div>

        <div
          className="sync-backend-grid"
          role="group"
          aria-label="外部日历同步后端选择"
        >
          {snapshot.targets.map((t) => {
            const tSpec = BACKEND_SPEC[t.id];
            const stateMeta = TARGET_STATE_META[t.state];
            const tConflicts = t.remote.filter(
              (r) =>
                r.managed &&
                !r.deleted &&
                !r.suppressed &&
                r.date !== r.baselineDate
            ).length;
            return (
              <button
                key={t.id}
                type="button"
                data-slot="sync-backend-card"
                className="sync-backend-card"
                aria-pressed={t.id === activeTarget.id}
                onClick={() => setSelectedBackend(t.id)}
              >
                <div className="sync-backend-card-header">
                  <span className="sync-backend-card-title">{tSpec.title}</span>
                  <Badge variant={stateMeta.badgeVariant}>
                    {stateMeta.label}
                  </Badge>
                </div>
                <div className="sync-backend-meta">目标名称：{t.name}</div>
                <div className="sync-backend-meta">示例身份：{t.account}</div>
                <div className="sync-backend-meta">位置与范围：{t.location}</div>
                {t.id === 'eventkit' && platformName !== 'darwin' && (
                  <Badge variant="outline">
                    Windows 下展示 macOS 演示案例（非本机调用）
                  </Badge>
                )}
                <div className="row" style={{ marginTop: 2 }}>
                  <Badge variant="outline">
                    {t.id === 'eventkit' ? '模拟本机记录' : '模拟远端记录'}：
                    {t.remote.filter((r) => !r.deleted).length} 条
                  </Badge>
                  {tConflicts > 0 && (
                    <Badge variant="warning">待裁决冲突：{tConflicts} 项</Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Non-ready warning & direct recovery */}
        {activeTarget.state !== 'ready' && (
          <div className="sync-alert-box" data-tone="danger" role="alert">
            <div className="sync-alert-title">
              <AlertTriangle
                aria-hidden="true"
                className="inline-icon"
                style={{ marginRight: 4 }}
              />
              目标当前不可写（{TARGET_STATE_META[activeTarget.state].label}）
            </div>
            <span>
              {activeTarget.message}
              。保护策略：目标被移除、只读、授权失效或备份恢复后保持暂停，绝不自动改写到系统默认日历。
            </span>
            <div className="row">
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={busyAction !== null}
                onClick={() => handleTargetState('ready')}
              >
                核对原目标并恢复为可写（模拟）
              </Button>
            </div>
          </div>
        )}

        {/* Current Target Summary & On-Demand Target Settings / Boundary / Abnormal Drill */}
        <div className="toolbar">
          <div>
            <strong>
              当前目标：{activeTarget.name}（{spec.title}）
            </strong>
            <div className="muted">{spec.routeSummary}</div>
          </div>
          {activeTarget.id === 'eventkit' ? (
            <Badge variant="warning">
              EventKit 终点：模拟本机读回一致 · iCloud 云端未验证
            </Badge>
          ) : (
            <Badge variant="outline">终点：模拟远端读回一致</Badge>
          )}
        </div>

        <Collapsible
          open={targetSettingsOpen}
          onOpenChange={setTargetSettingsOpen}
          className="sync-collapsible"
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sync-collapsible-trigger"
            >
              <span>
                <SlidersHorizontal
                  aria-hidden="true"
                  className="inline-icon"
                  style={{ marginRight: 6 }}
                />
                目标设置、路线权限说明与目标异常演练
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="sync-collapsible-body">
            <div>
              <strong>权限与无凭据说明：</strong>
              {spec.permissionSummary}
            </div>
            <div>
              <strong>确认边界要求：</strong>
              {spec.confirmBoundary}
            </div>
            {activeTarget.id === 'eventkit' && (
              <div className="warning-text">
                重要边界：EventKit 终点仅代表“模拟本机读回一致”；iCloud 云端由系统同步，本预览未验证，绝不记为云端已确认。
              </div>
            )}
            <div className="stack">
              <span className="muted">预览工具：目标异常与恢复演练</span>
              <div className="row">
                {(
                  ['ready', 'paused', 'readonly', 'missing', 'auth'] as const
                ).map((st) => (
                  <Button
                    key={st}
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-pressed={activeTarget.state === st}
                    disabled={busyAction !== null && st !== 'paused'}
                    onClick={() => handleTargetState(st)}
                  >
                    {st === 'ready'
                      ? '设为可写 (ready)'
                      : st === 'paused'
                      ? '模拟暂停 (paused)'
                      : st === 'readonly'
                      ? '模拟只读 (readonly)'
                      : st === 'missing'
                      ? '模拟目标缺失 (missing)'
                      : '模拟授权失效 (auth)'}
                  </Button>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>

      {/* Conflict Resolution Panel (Directly visible when conflicts exist) */}
      {activeConflicts.length > 0 && (
        <section
          className="sync-section"
          role="region"
          aria-label="外部改期冲突裁决"
        >
          <div className="section-header">
            <div>
              <div className="sync-section-title">
                发现外部改期冲突（共 {activeConflicts.length} 项需裁决）
              </div>
              <div className="muted">
                外部日历中的受管事件日期已被修改。SubCal 不会把外部日历改动自动当成已扣费事实，请选择处理方式：
              </div>
            </div>
            <Badge variant="warning">需人工裁决</Badge>
          </div>

          {activeConflicts.map((r) => {
            const localEv = localEventsMap.get(r.id);
            const localDate = localEv ? localEv.date : r.baselineDate;
            return (
              <div key={r.id} className="sync-conflict-card">
                <div className="toolbar">
                  <div>
                    <strong>
                      {r.product} · {EVENT_KIND_LABELS[r.kind]}
                    </strong>{' '}
                    <span className="muted">（{r.account}）</span>
                  </div>
                  <code className="sync-mono">稳定 ID: {r.id}</code>
                </div>
                <div className="row">
                  <Badge variant="secondary">
                    SubCal 本地计划日期：{localDate}
                  </Badge>
                  <Badge variant="outline">
                    上次同步基线：{r.baselineDate}
                  </Badge>
                  <Badge variant="warning">
                    模拟外部日历当前日期：{r.date}
                  </Badge>
                </div>
                <div className="row">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={busyAction !== null}
                    onClick={() => handleResolveConflict(r.id, 'local')}
                  >
                    1. 恢复本地计划（以 {localDate} 为准）
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyAction !== null}
                    onClick={() => handleResolveConflict(r.id, 'remote')}
                  >
                    2. 采纳 {r.date} 为新的手动计划（非已扣款）
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyAction !== null}
                    onClick={() => handleResolveConflict(r.id, 'unlink')}
                  >
                    3. 解除管理并保留模拟外部事件
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* 2. Compute Diff -> Structured List -> Simulated Stage Execution & Failure Recovery */}
      <section
        className="sync-section"
        aria-label="预演变更清单与执行模拟同步"
      >
        <div className="section-header">
          <div>
            <div className="sync-section-title">
              2. 计算本次差异清单与执行模拟同步
            </div>
            <div className="muted">
              先计算并核对本次模拟新增、改期更新、移除及抑制清单，再执行模拟同步。同一日程改期保留原逻辑 ID。
            </div>
          </div>
          <div className="row">
            <Button
              type="button"
              variant={!activePreview || isPreviewStale ? 'default' : 'outline'}
              size="sm"
              disabled={busyAction !== null}
              onClick={() => handlePreview(activeTarget.id)}
            >
              <RefreshCw aria-hidden="true" />
              {busyAction === 'preview'
                ? '正在计算预演清单…'
                : activePreview
                ? '重新计算同步预演清单（模拟）'
                : '1. 计算同步预演清单（模拟）'}
            </Button>
          </div>
        </div>

        {isPreviewStale && !isStageRunning && (
          <div className="sync-alert-box" role="alert">
            <div className="sync-alert-title">当前预演清单已过期失效</div>
            <span>
              底层订阅记录或目标日历状态已发生变更（预演基于版本 #
              {activePreview?.revision}，当前空间版本 #{snapshot.revision}
              ）。为防止盲目覆盖，请先点击「重新计算同步预演清单（模拟）」。
            </span>
          </div>
        )}

        {!activePreview ? (
          <div className="empty">
            尚未生成 {activeTarget.name}{' '}
            的预演清单。请先点击上方「1. 计算同步预演清单（模拟）」查看将发生的变更，再执行同步。
          </div>
        ) : (
          <div className="stack">
            <div className="row">
              <Badge variant="success">新增：{changeCounts.add}</Badge>
              <Badge variant="secondary">
                改期/更新：{changeCounts.update}
              </Badge>
              <Badge variant="destructive">移除：{changeCounts.remove}</Badge>
              <Badge variant="warning">冲突：{changeCounts.conflict}</Badge>
              <Badge variant="outline">
                已抑制（不重建）：{changeCounts.suppressed}
              </Badge>
              <span className="muted">
                预演批次：{activePreview.id} · 对应资料版本 #
                {activePreview.revision}
              </span>
            </div>

            {activePreview.changes.length === 0 ? (
              <div className="empty">
                当前本地未来日程与 {activeTarget.name}{' '}
                已完全一致，无需重复创建或修改模拟事件。
              </div>
            ) : (
              <div className="sync-table-wrap">
                <Table className="sync-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>预演动作</TableHead>
                      <TableHead>产品与账号</TableHead>
                      <TableHead>事件类型与性质</TableHead>
                      <TableHead>本地计划日 / 远端对照</TableHead>
                      <TableHead>稳定逻辑 ID 与说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activePreview.changes.map((c) => {
                      const meta = ACTION_META[c.action];
                      return (
                        <TableRow key={`${c.action}:${c.event.id}`}>
                          <TableCell>
                            <Badge variant={meta.badgeVariant}>
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <strong>{c.event.product}</strong>
                            <div className="muted">{c.event.account}</div>
                          </TableCell>
                          <TableCell>
                            <span>{EVENT_KIND_LABELS[c.event.kind]}</span>{' '}
                            <Badge variant="outline">
                              {c.event.expected ? '预计' : '已记录'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div>本地：{c.event.date}</div>
                            {c.remote && (
                              <div className="muted">
                                远端：{c.remote.date}（基线：
                                {c.remote.baselineDate}）
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <code className="sync-mono">{c.event.id}</code>
                            <div className="muted">{meta.desc}</div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="toolbar">
              <div className="sync-switch-row">
                <Switch
                  id={failSwitchId}
                  size="sm"
                  checked={failAfterWrite}
                  onCheckedChange={(checked) =>
                    setFailAfterWrite(Boolean(checked))
                  }
                  aria-label="模拟写入后读回失败（用于演练半程异常恢复与不重复创建幂等性）"
                />
                <Label htmlFor={failSwitchId} className="sync-switch-row">
                  模拟写入后读回失败（用于演练半程异常恢复与不重复创建幂等性）
                </Label>
              </div>

              <div className="row">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={
                    !activePreview ||
                    isPreviewStale ||
                    activeTarget.state !== 'ready' ||
                    hasConflicts ||
                    isStageRunning
                  }
                  onClick={handleSync}
                >
                  <Play aria-hidden="true" />
                  {isStageRunning
                    ? '模拟同步执行中…'
                    : `2. 执行模拟同步（写入 ${activeTarget.name}）`}
                </Button>
              </div>
            </div>

            {(activeTarget.state !== 'ready' ||
              hasConflicts ||
              isPreviewStale) && (
              <div className="muted">
                {activeTarget.state !== 'ready'
                  ? '提示：当前目标未处于可写就绪状态，请先在上方恢复目标状态。'
                  : hasConflicts
                  ? '提示：存在外部改期冲突，请先在冲突面板完成裁决后再同步。'
                  : '提示：预演清单已过期，请先重新计算同步预演清单。'}
              </div>
            )}
          </div>
        )}

        {/* Stage Progress Bar & Failure Recovery */}
        <div className="stack">
          <div className="toolbar">
            <span>
              <strong>当前同步阶段：</strong>
              {activeTarget.message}
            </span>
            <span className="muted">目标版本 #{activeTarget.revision}</span>
          </div>
          <div className="sync-stage-bar" role="status" aria-live="polite">
            <div
              className="sync-stage-step"
              data-active={activeTarget.stage === 'queued'}
              data-done={
                activeTarget.stage === 'written' ||
                activeTarget.stage === 'verified'
              }
            >
              <span className="sync-stage-step-title">1. 模拟已排队</span>
              <span className="muted">
                {activeTarget.stage === 'idle'
                  ? '等待发起'
                  : '已进入模拟待同步队列'}
              </span>
            </div>
            <div
              className="sync-stage-step"
              data-active={activeTarget.stage === 'written'}
              data-done={activeTarget.stage === 'verified'}
            >
              <span className="sync-stage-step-title">
                2.{' '}
                {activeTarget.id === 'eventkit'
                  ? '模拟写入系统日历'
                  : '模拟已写入'}
              </span>
              <span className="muted">
                {activeTarget.stage === 'written' ||
                activeTarget.stage === 'verified'
                  ? '已写入模拟目标，保留稳定事件 ID'
                  : activeTarget.stage === 'failed'
                  ? '模拟过程未完成，已写入项保留稳定 ID'
                  : '仅排队不代表已写入'}
              </span>
            </div>
            <div
              className="sync-stage-step"
              data-active={
                activeTarget.stage === 'verified' ||
                activeTarget.stage === 'failed'
              }
              data-done={activeTarget.stage === 'verified'}
              data-failed={activeTarget.stage === 'failed'}
            >
              <span className="sync-stage-step-title">
                {spec.finalStepLabel}
              </span>
              <span className="muted">
                {activeTarget.stage === 'verified'
                  ? activeTarget.message
                  : activeTarget.stage === 'failed'
                  ? `未完成：${activeTarget.message}`
                  : '必须读回核对一致才算完成'}
              </span>
            </div>
          </div>

          {activeTarget.stage === 'failed' && (
            <div className="sync-alert-box" role="alert">
              <div className="sync-alert-title">
                模拟写入后读回校验未完成（局部恢复说明）
              </div>
              <span>
                {activeTarget.message}
                。已写入模拟目标的事件已绑定稳定逻辑 ID，关闭上方「模拟写入后读回失败」开关后，重新计算预演清单并执行模拟同步即可完成核对，不会产生重复事件。
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 3. Simulate External Move / Delete & Existing Remote Events (Collapsible) */}
      <section className="sync-section" aria-label="外部日历改期与删除演练及静态导出说明">
        <Collapsible
          open={externalDrillOpen}
          onOpenChange={setExternalDrillOpen}
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sync-collapsible-trigger"
            >
              <span>
                3. 预览工具：外部日历改期与外部删除演练（当前记录{' '}
                {activeTarget.remote.length} 条）
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="sync-collapsible-body">
            <div className="muted">
              选择已写入模拟目标的远端事件，模拟用户在外部日历客户端改期或删除受管事件，验证冲突检测与抑制不复活机制。
            </div>

            {activeTarget.remote.length === 0 ? (
              <div className="empty">
                当前目标（{activeTarget.name}
                ）尚无模拟远端事件。请先在上方点击「1. 计算同步预演清单」并「2. 执行模拟同步」，即可在此选择远端事件模拟外部改期或删除。
              </div>
            ) : (
              <div className="stack">
                <div className="toolbar">
                  <div className="row" style={{ flex: 1, minWidth: 240 }}>
                    <span>选择模拟远端事件：</span>
                    <FormSelect
                      id="sync-remote-event-select"
                      aria-label="选择模拟远端事件"
                      className="sync-select-trigger"
                      value={selectedRemoteEventId}
                      onChange={(e) => setSelectedRemoteEventId(e.target.value)}
                    >
                      {activeTarget.remote.map((r) => {
                        const statusText =
                          r.deleted || r.suppressed
                            ? r.managed
                              ? '外部已删除·已抑制'
                              : '已解除管理·保留外部事件'
                            : r.date !== r.baselineDate
                            ? `外部已改期至 ${r.date}`
                            : '正常受管';
                        return (
                          <option key={r.id} value={r.id}>
                            {r.product} · {EVENT_KIND_LABELS[r.kind]} | 日期:{' '}
                            {r.date} | [{statusText}] ({r.id})
                          </option>
                        );
                      })}
                    </FormSelect>
                  </div>

                  <div className="row">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!selectedRemoteEventId || busyAction !== null}
                      onClick={() => handleSimulateExternal('move')}
                    >
                      模拟外部日历改期 (+3 天)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!selectedRemoteEventId || busyAction !== null}
                      onClick={() => handleSimulateExternal('delete')}
                    >
                      模拟外部日历删除（记录抑制标记）
                    </Button>
                  </div>
                </div>

                <div className="sync-table-wrap">
                  <Table className="sync-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>稳定逻辑 ID</TableHead>
                        <TableHead>产品与事件</TableHead>
                        <TableHead>远端当前日期 / 基线日期</TableHead>
                        <TableHead>受管与抑制状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeTarget.remote.slice(0, 12).map((r) => {
                        const isConflict =
                          r.managed &&
                          !r.deleted &&
                          !r.suppressed &&
                          r.date !== r.baselineDate;
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <code className="sync-mono">{r.id}</code>
                            </TableCell>
                            <TableCell>
                              <strong>{r.product}</strong> ·{' '}
                              {EVENT_KIND_LABELS[r.kind]}
                            </TableCell>
                            <TableCell>
                              <span>{r.date}</span>
                              {r.date !== r.baselineDate && (
                                <span className="muted">
                                  （原基线 {r.baselineDate}）
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {r.deleted ? (
                                <Badge variant="outline">
                                  外部已删除 · 已抑制（普通刷新不复活）
                                </Badge>
                              ) : !r.managed ? (
                                <Badge variant="outline">
                                  已解除管理 · 保留外部事件
                                </Badge>
                              ) : isConflict ? (
                                <Badge variant="warning">
                                  外部已改期 · 待裁决
                                </Badge>
                              ) : (
                                <Badge variant="secondary">
                                  SubCal 受管中
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {activeTarget.remote.length > 12 && (
                  <div className="muted">
                    共 {activeTarget.remote.length}{' '}
                    条远端模拟事件（上方展示前 12 条，下拉框可选择全部事件）。
                  </div>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* .ics Static Export Future Notice */}
        <div className="toolbar sync-collapsible">
          <div>
            <strong>备用方案：.ics 静态日历文件导出（后续阶段提供）</strong>
            <div className="muted">
              .ics 仅属于单次静态快照导出，不具备自动同步、幂等改期或冲突读回能力，不属于本预览阶段必选交付，也不以假提示冒充文件已生成。
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            title="真实服务接入与后续阶段实现"
          >
            导出 .ics 静态文件（后续阶段实现）
          </Button>
        </div>
      </section>
    </div>
  );

  if (modal && onClose) {
    return (
      <Modal
        title="外部日历同步预演与冲突处理（模拟）"
        onClose={onClose}
        wide
      >
        {content}
      </Modal>
    );
  }

  return content;
}
