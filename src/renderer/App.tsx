import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, LayoutDashboard, List, Plug, Plus, RefreshCw, Settings2, Sun, Moon, WifiOff, TriangleAlert } from 'lucide-react';
import { toast as showToast } from 'sonner';
import { Button } from './components/ui/button';
import { Toaster } from './components/ui/sonner';
import { Skeleton } from './components/ui/skeleton';
import { syncDocumentTheme } from './lib/utils';
import { client } from './service/MockSubCalClient';
import type { Notify, PageProps } from './contracts';
import { scenarioIds, type ScenarioId, type Snapshot } from '../shared/types';
import type { TraySummary } from '../shared/bridge';
import { dateInZone, daysBetween, freshness, money, renewalText } from '../shared/rules';
import { OverviewPage } from './pages/OverviewPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { CalendarPage } from './pages/CalendarPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { Settings } from './components/Settings';
import { DetailDrawer } from './components/DetailDrawer';
import { SubscriptionForm } from './components/SubscriptionForm';
import { StatusBadge } from './components/ui';
import { PreviewTools } from './components/PreviewTools';
import { NotificationContext, type Notice } from './components/notifications';

const NAV_PAGES = ['概览', '订阅', '日历', '连接'] as const;
type NavPage = (typeof NAV_PAGES)[number];

const DEFAULT_SCENARIO_LABELS: Record<ScenarioId, string> = {
  empty_first_run: '首次空白',
  normal_mixed: '标准混合',
  multi_account_shared: '多账号与独立共享关系',
  unknown_and_na: '未知与不适用',
  zero_vs_unfetched: '明确零值与尚未获取',
  stale_and_past_reset: '过时与已过重置点',
  partial_success: '部分成功',
  auth_and_locked_fields: '认证失效与人工锁定',
  rate_limited: '限流与合并',
  offline_recovery: '离线与恢复',
  date_boundaries: '月末、闰年与时区',
  calendar_conflicts: '日历冲突与阶段',
};

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [scenarios, setScenarios] = useState<{ id: ScenarioId; name: string }[]>(() =>
    scenarioIds.map((id) => ({ id, name: DEFAULT_SCENARIO_LABELS[id] }))
  );
  const [page, setPage] = useState<NavPage>('概览');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formState, setFormState] = useState<
    { mode: 'create'; presetProduct?: string } | { mode: 'edit'; subscriptionId: string } | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionFocusId, setConnectionFocusId] = useState<string | undefined>(undefined);

  const [refreshingAll, setRefreshingAll] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  );

  const reqGuardRef = useRef(0);
  const pageScroll = useRef<Record<NavPage, number>>({ 概览: 0, 订阅: 0, 日历: 0, 连接: 0 });
  const navBtnRefs = useRef<Record<NavPage, HTMLButtonElement | null>>({
    概览: null,
    订阅: null,
    日历: null,
    连接: null,
  });

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
    showToast.dismiss('subcal-notification');
  }, []);
  const notify: Notify = useCallback((message, action) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    const id = Date.now() + Math.random();
    const duration = action?.duration ?? (action ? 8000 : 4500);
    const run = action ? () => { dismissNotice(); action.run(); } : undefined;
    setNotice({ id, message, action: action && run ? { ...action, run } : undefined });
    showToast(message, {
      id: 'subcal-notification',
      duration,
      action: action && run ? { label: action.label, onClick: run } : undefined,
      closeButton: true,
      onDismiss: () => setNotice((current) => current?.id === id ? null : current),
    });
    // Sonner normally pauses on hover. An undo transaction must still expire
    // at its real eight-second deadline, including while displayed in a modal.
    noticeTimer.current = window.setTimeout(dismissNotice, duration);
  }, [dismissNotice]);
  const notifications = useMemo(() => ({ notice, dismiss: dismissNotice }), [notice, dismissNotice]);
  useEffect(() => () => { if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current); }, []);

  const loadSnapshot = useCallback(async () => {
    const reqId = ++reqGuardRef.current;
    try {
      const next = await client.snapshot();
      if (reqId === reqGuardRef.current) {
        setSnapshot(next);
      }
    } catch (err) {
      if (reqId === reqGuardRef.current) {
        notify((err as Error).message || '读取本地演示空间快照失败');
      }
    }
  }, [notify]);

  useEffect(() => {
    void loadSnapshot();
    void client.preview.scenarios().then(setScenarios).catch(() => {});
    return client.subscribe(() => {
      void loadSnapshot();
    });
  }, [loadSnapshot]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Wire window.subcal tray summary & action listeners
  useEffect(() => {
    if (!snapshot || !window.subcal?.updateTray) return;
    const activeSubs = snapshot.subscriptions.filter((s) => s.lifecycle !== 'archived');
    const withRenewal = activeSubs
      .filter((s) => s.renewalDate.value && s.autoRenew !== 'off')
      .map((s) => ({
        sub: s,
        days: daysBetween(dateInZone(snapshot.now, s.timezone), s.renewalDate.value!),
      }))
      .sort((a, b) => a.days - b.days);

    const nextRenewal =
      withRenewal.length > 0
        ? `${withRenewal[0].sub.product} · ${renewalText(withRenewal[0].sub, snapshot.now)}`
        : '当前演示空间无近期续费';

    const pinned = activeSubs
      .filter((s) => s.pinned)
      .map((s) => {
        const m = s.metrics[0];
        const mText =
          m && m.remaining.availability === 'known' && m.remaining.value !== null
            ? m.unit === '%'
              ? `剩余 ${m.remaining.value}%`
              : money(m.remaining.value, m.unit)
            : renewalText(s, snapshot.now);
        return `${s.product}：${mText}${m && freshness(m,snapshot.now)!=='fresh' ? ' · 旧观察/待更新' : ''}（示例）`;
      });

    const reconnectCount = snapshot.connections.filter((c) =>
      ['auth', 'denied', 'runtime_missing', 'schema_changed'].includes(c.state)
    ).length;

    const paused =
      snapshot.connections.length > 0 &&
      snapshot.connections.every((c) => c.state === 'paused');

    const summary: TraySummary = {
      nextRenewal,
      pinned,
      reconnectCount,
      paused,
      closeToTray: snapshot.preferences.closeToTray,
    };

    void window.subcal.updateTray(summary).catch(() => {});
  }, [snapshot]);

  useEffect(() => {
    if (!window.subcal?.onAction) return;
    return window.subcal.onAction((action) => {
      if (action === 'refresh') {
        void client
          .refresh()
          .then((msg) => notify(msg))
          .catch((e) => notify((e as Error).message));
      } else if (action === 'toggle-pause') {
        void client
          .pause()
          .then(() => notify('已切换全部模拟连接暂停/恢复状态'))
          .catch((e) => notify((e as Error).message));
      } else if (action === 'settings') {
        setSettingsOpen(true);
      }
    });
  }, [notify]);

  const resolvedTheme = useMemo(() => {
    const pref = snapshot?.preferences.theme ?? 'light';
    if (pref === 'system') return systemDark ? 'dark' : 'light';
    return pref;
  }, [snapshot?.preferences.theme, systemDark]);

  // Portal 浮层挂在 body；主题必须属于 html，而不是只属于应用内容。
  useLayoutEffect(() => {
    syncDocumentTheme({ theme: resolvedTheme, density: snapshot?.preferences.density ?? 'comfortable', reducedMotion: snapshot?.preferences.reducedMotion ?? false });
  }, [resolvedTheme, snapshot?.preferences.density, snapshot?.preferences.reducedMotion]);

  const handleGlobalRefresh = async () => {
    setRefreshingAll(true);
    try {
      const msg = await client.refresh();
      notify(msg);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setRefreshingAll(false);
    }
  };

  const navigateToPage = (next: NavPage) => {
    if (next === page) return;
    pageScroll.current[page] = window.scrollY;
    setPage(next);
  };
  useLayoutEffect(() => { window.scrollTo(0, pageScroll.current[page]); }, [page]);

  const handleNavKeyDown = (current: NavPage, e: React.KeyboardEvent) => {
    const idx = NAV_PAGES.indexOf(current);
    let nextIdx = idx;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % NAV_PAGES.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + NAV_PAGES.length) % NAV_PAGES.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = NAV_PAGES.length - 1;
    else return;

    e.preventDefault();
    const targetPage = NAV_PAGES[nextIdx];
    navigateToPage(targetPage);
    navBtnRefs.current[targetPage]?.focus();
  };

  const handleExportRawRecovery = async () => {
    try {
      const raw = await client.exportRawStorage();
      if (!raw) {
        notify('当前没有可导出的原始存储内容');
        return;
      }
      if (window.subcal?.saveFile) {
        const res = await window.subcal.saveFile('subcal-raw-recovery.json', raw);
        if (res.saved) {
          notify(`已保存原始恢复副本：${res.path || 'subcal-raw-recovery.json'}`);
        }
      } else {
        await navigator.clipboard?.writeText(raw);
        notify('已将原始存储副本复制到剪贴板');
      }
    } catch (err) {
      notify((err as Error).message);
    }
  };

  if (!snapshot) {
    return (
      <div data-theme={resolvedTheme} className="app loading-shell">
        <header className="top-nav">
          <div className="brand-cluster">
            <strong className="app-logo"><CalendarDays /> SubCal</strong>
            <StatusBadge>本地预览</StatusBadge>
          </div>
        </header>
        <main className="main-content">
          <div className="panel stack" role="status"><span className="muted">正在载入本地演示空间快照…</span><Skeleton className="h-8 w-48" /><Skeleton className="h-24 w-full" /></div>
        </main>
        <Toaster theme={resolvedTheme} position="bottom-left" visibleToasts={1} closeButton />
      </div>
    );
  }

  const detailSubscription = detailId
    ? snapshot.subscriptions.find((s) => s.id === detailId) ?? null
    : null;

  const editingSubscription =
    formState?.mode === 'edit'
      ? snapshot.subscriptions.find((s) => s.id === formState.subscriptionId) ?? null
      : undefined;

  const pageProps: PageProps = {
    snapshot,
    client,
    notify,
    onOpen: (id: string) => setDetailId(id),
    onCreate: () => setFormState({ mode: 'create' }),
    onConnection: (connId: string) => {
      setConnectionFocusId(connId);
      navigateToPage('连接');
    },
  };

  return (
    <NotificationContext.Provider value={notifications}>
    <div
      data-theme={resolvedTheme}
      data-scenario={snapshot.scenario}
      data-density={snapshot.preferences.density}
      data-reduced-motion={snapshot.preferences.reducedMotion ? 'true' : 'false'}
      className="app"
    >
      {/* Top Navigation Bar (Magpie style, native window frame compatible) */}
      <header className="top-nav">
        <div className="brand-cluster">
          <strong className="app-logo" title="SubCal Desktop 前端预览">
            <CalendarDays className="app-logo-mark" /> SubCal
          </strong>
          <StatusBadge
            className="preview-global-pill"
            title="当前为前端先行预览阶段，所有刷新、连接与日历同步均为本地模拟，不连接外部服务器"
          >
            本地预览
          </StatusBadge>
        </div>

        <nav className="top-segmented-nav" aria-label="主导航">
          {NAV_PAGES.map((p) => (
            <Button
              key={p}
              ref={(el) => {
                navBtnRefs.current[p] = el;
              }}
              type="button"
              variant="ghost"
              className={`nav-tab-btn ${page === p ? 'active bg-muted text-foreground' : 'text-muted-foreground'}`}
              aria-pressed={page === p}
              aria-current={page === p ? 'page' : undefined}
              onClick={() => navigateToPage(p)}
              onKeyDown={(e) => handleNavKeyDown(p, e)}
            >
              {p === '概览' ? <LayoutDashboard /> : p === '订阅' ? <List /> : p === '日历' ? <CalendarDays /> : <Plug />}{p}
            </Button>
          ))}
        </nav>

        <div className="top-right-actions">
          <Button
            type="button"
            className="btn-add-sub"
            aria-label="新增订阅"
            onClick={() => setFormState({ mode: 'create' })}
          >
            <Plus /> 新增订阅
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={refreshingAll}
            onClick={() => void handleGlobalRefresh()}
            title="对当前场景中的所有模拟连接执行一次模拟刷新"
          >
            <RefreshCw className={refreshingAll ? 'animate-spin' : undefined} />{refreshingAll ? '模拟刷新中…' : '模拟刷新'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
              void client.setPreferences({ theme: nextTheme });
            }}
            aria-label="切换深浅色主题"
            title={`当前主题：${resolvedTheme === 'dark' ? '深色' : '浅色'}（点击切换）`}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="打开设置与备份"
          >
            <Settings2 />
          </Button>
        </div>
      </header>

      {/* Global Storage Error Banner */}
      {snapshot.storageError ? (
        <div className="global-alert-banner danger-banner" role="alert">
          <div className="alert-banner-text">
            <strong><TriangleAlert /> 本地存储读取异常：</strong>
            <span>{snapshot.storageError}</span>
          </div>
          <div className="row">
            <Button variant="outline" type="button" onClick={() => void handleExportRawRecovery()}>
              导出原始损坏副本
            </Button>
            <Button
              type="button"
              onClick={() =>
                void client.preview
                  .recoverStorage()
                  .then(() => notify('已将损坏存储另存为恢复副本并重置当前空间'))
                  .catch((e) => notify((e as Error).message))
              }
            >
              备份并恢复存储
            </Button>
          </div>
        </div>
      ) : null}

      {/* Global Simulated Offline Banner */}
      {snapshot.offline ? (
        <div className="global-alert-banner warning-banner" role="status">
          <div className="alert-banner-text">
            <strong><WifiOff /> 当前处于模拟离线状态：</strong>
            <span>
              自动采集已暂停并保留离线前快照；你仍可正常浏览卡片、手动新增与修改本地记录。
            </span>
          </div>
          <div className="row">
            <Button
              type="button"
              onClick={() =>
                void client.preview
                  .recoverOffline()
                  .then(() => notify('已模拟恢复联网并合并补查一次'))
                  .catch((e) => notify((e as Error).message))
              }
            >
              模拟恢复联网（合并补查一次）
            </Button>
          </div>
        </div>
      ) : null}

      {/* Main Page Content */}
      <main className="main-content">
        {page === '概览' ? <OverviewPage {...pageProps} /> : null}
        {page === '订阅' ? (
          <SubscriptionsPage
            {...pageProps}
            onEdit={(sub) => setFormState({ mode: 'edit', subscriptionId: sub.id })}
            onCreateWithPreset={(presetProduct) =>
              setFormState({ mode: 'create', presetProduct })
            }
          />
        ) : null}
        {page === '日历' ? <CalendarPage {...pageProps} /> : null}
        {page === '连接' ? (
          <ConnectionsPage {...pageProps} focusId={connectionFocusId} />
        ) : null}

        <PreviewTools snapshot={snapshot} scenarios={scenarios} client={client} notify={notify} editing={formState !== null} onScenarioChange={() => setDetailId(null)} />
      </main>

      {/* Shared Right Detail Drawer */}
      {detailSubscription ? (
        <DetailDrawer
          key={detailId}
          subscription={detailSubscription}
          snapshot={snapshot}
          client={client}
          notify={notify}
          onClose={() => setDetailId(null)}
          onEdit={(sub) => setFormState({ mode: 'edit', subscriptionId: sub.id })}
          onSelectAccount={(id) => setDetailId(id)}
          onConnection={(connId) => {
            setDetailId(null);
            setConnectionFocusId(connId);
            navigateToPage('连接');
          }}
        />
      ) : null}

      {/* Shared Create / Edit Subscription Modal */}
      {formState ? (
        <SubscriptionForm
          mode={formState.mode}
          initial={editingSubscription ?? undefined}
          presetProduct={formState.mode === 'create' ? formState.presetProduct : undefined}
          snapshot={snapshot}
          client={client}
          notify={notify}
          onClose={() => setFormState(null)}
          onSaved={(savedId) => {
            if (formState.mode === 'create') {
              setDetailId(savedId);
            }
          }}
        />
      ) : null}

      {/* Settings Modal */}
      {settingsOpen ? (
        <Settings {...pageProps} onClose={() => setSettingsOpen(false)} />
      ) : null}

      <Toaster theme={resolvedTheme} position="bottom-left" visibleToasts={1} closeButton />
    </div>
    </NotificationContext.Provider>
  );
}
