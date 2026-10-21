import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  KeyRound,
  Layers,
  Menu,
  Moon,
  PanelLeft,
  Search,
  Settings2,
  Sun,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-react';
import { toast as showToast } from 'sonner';
import { Button } from './components/ui/button';
import { Toaster } from './components/ui/sonner';
import { Skeleton } from './components/ui/skeleton';
import { syncDocumentTheme } from './lib/utils';
import { client } from './service/client';
import type { Navigate, NavRoute, Notify, PageProps } from './contracts';
import { scenarioIds, type ScenarioId, type Snapshot, type SubCalClient, type PreviewController } from '../shared/types';
import type { TraySummary } from '../shared/bridge';
import { dateInZone, daysBetween, freshness, money, renewalText } from '../shared/rules';
import { BoardPage } from './pages/BoardPage';
import { SettingsPage, SETTINGS_SECTIONS, type SettingsSectionId } from './pages/SettingsPage';
import { CalendarPage } from './pages/CalendarPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { AddSubscription } from './components/AddSubscription';
import { DetailDrawer } from './components/DetailDrawer';
import { SubscriptionForm } from './components/SubscriptionForm';
import { PaymentForm, type PaymentDraftContext } from './components/PaymentForm';
import { SearchDialog, type SearchTarget } from './components/SearchDialog';
import { NotificationContext, type Notice } from './components/notifications';

const PreviewTools = lazy(() => import('./components/PreviewTools').then((module) => ({ default: module.PreviewTools })));
const previewClient = client as SubCalClient & { preview?: PreviewController; exportRawStorage?: () => Promise<string> };

type WorkspaceRoute = 'subscriptions' | 'calendar' | 'accounts' | 'settings';

const NAV: { route: Exclude<WorkspaceRoute, 'settings'>; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { route: 'subscriptions', label: '订阅', icon: Layers },
  { route: 'calendar', label: '日历', icon: CalendarDays },
  { route: 'accounts', label: '账号', icon: KeyRound },
];

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<{ id: ScenarioId; name: string }[]>(() =>
    scenarioIds.map((id) => ({ id, name: DEFAULT_SCENARIO_LABELS[id] })),
  );
  const [page, setPage] = useState<WorkspaceRoute>('subscriptions');
  const [visited, setVisited] = useState<Set<WorkspaceRoute>>(() => new Set<WorkspaceRoute>(['subscriptions']));
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('subcal-sidebar') === '1');
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('appearance');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formState, setFormState] = useState<
    { mode: 'create'; presetProduct?: string } | { mode: 'edit'; subscriptionId: string } | null
  >(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addProvider, setAddProvider] = useState<string | null>(null);
  const [connectionFocusId, setConnectionFocusId] = useState<string | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paymentContext, setPaymentContext] = useState<PaymentDraftContext | null>(null);
  const [paymentSeq, setPaymentSeq] = useState(0);
  useEffect(() => {
    window.localStorage.setItem('subcal-sidebar', collapsed ? '1' : '0');
  }, [collapsed]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  const reqGuardRef = useRef(0);

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
      onDismiss: () => setNotice((current) => (current?.id === id ? null : current)),
    });
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
        setLoadError(null);
      }
    } catch (err) {
      if (reqId === reqGuardRef.current) setLoadError((err as Error).message || '读取资料失败');
    }
  }, []);

  const navigate: Navigate = useCallback((route) => {
    const next: WorkspaceRoute = route === 'calendar' || route === 'accounts' || route === 'settings' ? route : 'subscriptions';
    setPage(next);
    setVisited((current) => (current.has(next) ? current : new Set([...current, next])));
    setMobileOpen(false);
  }, []);

  const openPayment = useCallback((context: PaymentDraftContext) => {
    setPaymentContext(context);
    setPaymentSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    void loadSnapshot();
    void previewClient.preview?.scenarios().then(setScenarios).catch(() => {});
    const unsubscribe = client.subscribe(() => { void loadSnapshot(); });
    const timer = window.setInterval(() => void loadSnapshot(), 60000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [loadSnapshot]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  useEffect(() => {
    if (!snapshot || !window.subcal?.updateTray) return;
    const activeSubs = snapshot.subscriptions.filter((s) => s.lifecycle !== 'archived');
    const withRenewal = activeSubs
      .filter((s) => s.renewalDate.value && s.autoRenew !== 'off')
      .map((s) => ({ sub: s, days: daysBetween(dateInZone(snapshot.now, s.timezone), s.renewalDate.value!) }))
      .sort((a, b) => a.days - b.days);
    const nextRenewal = withRenewal.length > 0
      ? `${withRenewal[0].sub.product} · ${renewalText(withRenewal[0].sub, snapshot.now)}`
      : '暂无近期续费';
    const pinned = activeSubs.filter((s) => s.pinned).map((s) => {
      const m = s.metrics[0];
      const mText = m && m.remaining.availability === 'known' && m.remaining.value !== null
        ? m.unit === '%' ? `剩余 ${m.remaining.value}%` : /^[A-Z]{3}$/.test(m.unit) ? money(m.remaining.value, m.unit) : `${m.remaining.value} ${m.unit}`
        : renewalText(s, snapshot.now);
      return `${s.product}：${mText}${m && freshness(m, snapshot.now) !== 'fresh' ? ' · 待更新' : ''}`;
    });
    const reconnectCount = snapshot.connections.filter((c) =>
      ['auth', 'denied', 'runtime_missing', 'schema_changed'].includes(c.state)).length;
    const paused = snapshot.connections.length > 0 && snapshot.connections.every((c) => c.state === 'paused');
    const summary: TraySummary = { nextRenewal, pinned, reconnectCount, paused, closeToTray: snapshot.preferences.closeToTray };
    void window.subcal.updateTray(summary).catch(() => {});
  }, [snapshot]);

  useEffect(() => {
    if (!window.subcal?.onAction) return;
    return window.subcal.onAction((action) => {
      if (action === 'refresh') {
        void client.refresh().then((msg) => notify(msg)).catch((e) => notify((e as Error).message));
      } else if (action === 'toggle-pause') {
        void client.pause().then(() => notify('已更新采集状态')).catch((e) => notify((e as Error).message));
      } else if (action === 'settings') {
        navigate('settings');
      }
    });
  }, [notify, navigate]);

  const resolvedTheme = useMemo(() => {
    const pref = snapshot?.preferences.theme ?? 'light';
    if (pref === 'system') return systemDark ? 'dark' : 'light';
    return pref;
  }, [snapshot?.preferences.theme, systemDark]);

  useLayoutEffect(() => {
    syncDocumentTheme({
      theme: resolvedTheme,
      density: snapshot?.preferences.density ?? 'comfortable',
      reducedMotion: snapshot?.preferences.reducedMotion ?? false,
    });
  }, [resolvedTheme, snapshot?.preferences.density, snapshot?.preferences.reducedMotion]);

  const toggleCollapsed = () => setCollapsed((value) => !value);

  if (!snapshot) {
    return (
      <div data-theme={resolvedTheme} data-collapsed={collapsed ? 'true' : 'false'} className="app sc-shell">
        <aside className="sc-sidebar" aria-label="工作台导航">
          <div className="sc-logo"><span className="sc-logo-mark">S</span><span className="sc-brand-name">SubCal</span></div>
        </aside>
        <div className="sc-main">
          <header className="sc-topbar" />
          <main className="sc-scroll">
            <div className="sc-page"><div className="sc-page-inner">
              {loadError ? (
                <div className="sc-panel" role="alert">
                  <p className="m-0 text-sm font-bold">{loadError}</p>
                  <Button className="mt-3" variant="outline" onClick={() => void loadSnapshot()}>重试</Button>
                </div>
              ) : (
                <div className="sc-panel" role="status">
                  <span className="text-sm font-bold text-(--sc-muted)">正在读取资料…</span>
                  <div className="mt-3 flex flex-col gap-2"><Skeleton className="h-8 w-48" /><Skeleton className="h-24 w-full" /></div>
                </div>
              )}
            </div></div>
          </main>
        </div>
        <Toaster theme={resolvedTheme} position="bottom-right" visibleToasts={1} closeButton />
      </div>
    );
  }

  const detailSubscription = detailId ? snapshot.subscriptions.find((s) => s.id === detailId) ?? null : null;
  const editingSubscription = formState?.mode === 'edit'
    ? snapshot.subscriptions.find((s) => s.id === formState.subscriptionId) ?? null
    : undefined;

  const pageProps: PageProps = {
    snapshot,
    client,
    notify,
    onOpen: (id: string) => setDetailId(id),
    onCreate: () => setAddOpen(true),
    onConnection: (connId: string) => { setConnectionFocusId(connId); navigate('accounts'); },
  };

  const navList = () => (
    page === 'settings' ? (
      <>
        <button type="button" className="sc-back" onClick={() => navigate('subscriptions')}>
          <ArrowLeft /> <span>返回</span>
        </button>
        <nav className="sc-nav" aria-label="设置">
          {SETTINGS_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-current={settingsSection === item.id ? 'page' : undefined}
                onClick={() => { setSettingsSection(item.id); setMobileOpen(false); }}
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </>
    ) : (
      <>
        <nav className="sc-nav" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.route}
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-current={page === item.route ? 'page' : undefined}
                onClick={() => navigate(item.route)}
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sc-sidebar-bottom">
          <button type="button" aria-label="设置" title="设置" onClick={() => navigate('settings')}>
            <Settings2 /> <span>设置</span>
          </button>
        </div>
      </>
    )
  );

  return (
    <NotificationContext.Provider value={notifications}>
      <div
        data-theme={resolvedTheme}
        data-scenario={snapshot.scenario}
        data-density={snapshot.preferences.density}
        data-reduced-motion={snapshot.preferences.reducedMotion ? 'true' : 'false'}
        data-collapsed={collapsed ? 'true' : 'false'}
        className="app sc-shell"
      >
        <aside className="sc-sidebar" aria-label="工作台导航">
          <div className="sc-brand-row">
            <button type="button" className="sc-logo" onClick={() => navigate('subscriptions')} aria-label="订阅">
              <span className="sc-logo-mark">S</span>
              <span className="sc-brand-name">SubCal</span>
            </button>
            <button type="button" className="sc-collapse" aria-label={collapsed ? '展开侧栏' : '折叠侧栏'} onClick={toggleCollapsed}>
              <PanelLeft />
            </button>
          </div>
          {navList()}
        </aside>

        <div className="sc-main">
          <header className="sc-topbar">
            <button type="button" className="sc-icon-btn sc-mobile-menu" aria-label="打开导航菜单" onClick={() => setMobileOpen(true)}>
              <Menu />
            </button>
            <div className="sc-topbar-right">
              <button type="button" className="sc-icon-btn" onClick={() => setSearchOpen(true)} aria-label="搜索订阅，快捷键 Ctrl K">
                <Search />
              </button>
              <button
                type="button"
                className="sc-icon-btn"
                aria-label="切换深浅色主题"
                onClick={() => {
                  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
                  void client.setPreferences({ theme: next }).catch((e) => notify((e as Error).message));
                }}
              >
                {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
              </button>
            </div>
          </header>

          {loadError ? (
            <div className="global-alert-banner danger-banner" role="alert">
              <span>{loadError}</span>
              <Button variant="outline" onClick={() => void loadSnapshot()}>重试</Button>
            </div>
          ) : null}
          {snapshot.storageError ? (
            <div className="global-alert-banner danger-banner" role="alert">
              <div className="alert-banner-text">
                <strong><TriangleAlert /> 本地存储读取异常：</strong>
                <span>{snapshot.storageError}</span>
              </div>
              {previewClient.preview ? (
                <div className="row">
                  <Button variant="outline" type="button" onClick={() => {
                    void previewClient.exportRawStorage?.().then((raw) => window.subcal?.saveFile('subcal-raw-recovery.json', raw)).catch((e) => notify((e as Error).message));
                  }}>导出原始损坏副本</Button>
                  <Button type="button" onClick={() => {
                    void previewClient.preview!.recoverStorage()
                      .then(() => notify('已将损坏存储另存为恢复副本并重置当前空间'))
                      .catch((e) => notify((e as Error).message));
                  }}>备份并恢复存储</Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {snapshot.offline ? (
            <div className="global-alert-banner warning-banner" role="status">
              <div className="alert-banner-text">
                <strong><WifiOff /> 网络不可用</strong>
                <span>已保留上次数据，可继续编辑订阅。</span>
              </div>
              {previewClient.preview ? (
                <Button type="button" onClick={() => {
                  void previewClient.preview!.recoverOffline().then(() => notify('已模拟恢复联网并合并补查一次')).catch((e) => notify((e as Error).message));
                }}>模拟恢复联网（合并补查一次）</Button>
              ) : null}
            </div>
          ) : null}

          <main className="sc-scroll" id="main-content">
            <div className="sc-page" hidden={page !== 'subscriptions'}>
              {visited.has('subscriptions') ? <BoardPage {...pageProps} /> : null}
            </div>

            <div className="sc-page" hidden={page !== 'calendar'}>
              {visited.has('calendar') ? (
                <CalendarPage
                  {...pageProps}
                  onRecordPayment={(subscriptionId, planDate) => openPayment({ subscriptionId, planDate })}
                />
              ) : null}
            </div>

            <div className="sc-page" hidden={page !== 'accounts'}>
              {visited.has('accounts') ? <ConnectionsPage {...pageProps} focusId={connectionFocusId} /> : null}
            </div>

            <div className="sc-page" hidden={page !== 'settings'}>
              {visited.has('settings') ? (
                <SettingsPage {...pageProps} section={settingsSection} onSectionChange={setSettingsSection} bare />
              ) : null}
            </div>

            {previewClient.preview && previewClient.exportRawStorage ? (
              <div className="sc-page" style={{ paddingTop: 0 }}>
                <div className="sc-page-inner">
                  <Suspense fallback={null}>
                    <PreviewTools
                      snapshot={snapshot}
                      scenarios={scenarios}
                      client={previewClient as SubCalClient & { preview: PreviewController; exportRawStorage: () => Promise<string> }}
                      notify={notify}
                      editing={formState !== null}
                      onScenarioChange={() => setDetailId(null)}
                    />
                  </Suspense>
                </div>
              </div>
            ) : null}
          </main>
        </div>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="导航菜单">
            <div className="absolute inset-0 bg-black/45" onClick={() => setMobileOpen(false)} />
            <div className="relative z-10 flex w-64 flex-col gap-3 overflow-y-auto bg-card p-3 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">SubCal</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭导航菜单" onClick={() => setMobileOpen(false)}><X /></Button>
              </div>
              {navList()}
            </div>
          </div>
        ) : null}

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
            onConnection={(connId) => { setDetailId(null); setConnectionFocusId(connId); navigate('accounts'); }}
            onRecordPayment={(subscriptionId, planDate) => openPayment({ subscriptionId, planDate })}
          />
        ) : null}

        {(addOpen || addProvider !== null) ? (
          <AddSubscription
            client={client}
            notify={notify}
            initialProvider={addProvider ?? undefined}
            onClose={() => { setAddOpen(false); setAddProvider(null); }}
            onAdded={() => { void loadSnapshot(); }}
            onManual={() => { setAddOpen(false); setAddProvider(null); setFormState({ mode: 'create' }); }}
          />
        ) : null}
        {formState ? (
          <SubscriptionForm
            mode={formState.mode}
            initial={editingSubscription ?? undefined}
            presetProduct={formState.mode === 'create' ? formState.presetProduct : undefined}
            snapshot={snapshot}
            client={client}
            notify={notify}
            onClose={() => setFormState(null)}
            onSaved={(savedId) => { if (formState.mode === 'create') setDetailId(savedId); }}
          />
        ) : null}

        <PaymentForm
          key={paymentContext ? `pay-${paymentSeq}-${paymentContext.subscriptionId ?? 'new'}-${paymentContext.planDate ?? ''}-${paymentContext.payment?.id ?? ''}` : 'pay-closed'}
          open={paymentContext !== null}
          context={paymentContext}
          snapshot={snapshot}
          client={client}
          notify={notify}
          onClose={() => setPaymentContext(null)}
        />

        <SearchDialog
          open={searchOpen}
          snapshot={snapshot}
          pages={[
            ...NAV.map((item) => ({ route: item.route, label: item.label, hint: item.label })),
            { route: 'settings', label: '设置', hint: '外观、提醒与备份' },
          ]}
          onClose={() => setSearchOpen(false)}
          onPick={(target: SearchTarget) => {
            if (target.kind === 'page') navigate(target.route as NavRoute);
            else setDetailId(target.id);
          }}
        />

        <Toaster theme={resolvedTheme} position="bottom-right" visibleToasts={1} closeButton />
      </div>
    </NotificationContext.Provider>
  );
}
