import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Home,
  Layers,
  LayoutDashboard,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  TriangleAlert,
  Wallet,
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
import { upcomingEvents } from '../shared/spending';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { CalendarPage } from './pages/CalendarPage';
import { ConnectionsPage, PROVIDERS } from './pages/ConnectionsPage';
import { AddSubscription } from './components/AddSubscription';
import { DetailDrawer } from './components/DetailDrawer';
import { SubscriptionForm } from './components/SubscriptionForm';
import { PaymentForm, type PaymentDraftContext } from './components/PaymentForm';
import { SearchDialog, type SearchTarget } from './components/SearchDialog';
import { StatusBadge } from './components/ui';
import { NotificationContext, type Notice } from './components/notifications';

const PreviewTools = lazy(() => import('./components/PreviewTools').then((module) => ({ default: module.PreviewTools })));
const previewClient = client as SubCalClient & { preview?: PreviewController; exportRawStorage?: () => Promise<string> };

const NAV: { route: NavRoute; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { route: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { route: 'subscriptions', label: '订阅管理', icon: Layers },
  { route: 'expenses', label: '消费管理', icon: Wallet },
  { route: 'calendar', label: '订阅日历', icon: CalendarDays },
  { route: 'accounts', label: '账号管理', icon: RefreshCw },
];
const PAGE_LABEL: Record<NavRoute, string> = {
  home: '产品首页',
  dashboard: '仪表盘',
  subscriptions: '订阅管理',
  expenses: '消费管理',
  calendar: '订阅日历',
  accounts: '账号管理',
  settings: '偏好设置',
};

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
  const [page, setPage] = useState<NavRoute>('dashboard');
  const [visited, setVisited] = useState<Set<NavRoute>>(() => new Set<NavRoute>(['dashboard']));
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formState, setFormState] = useState<
    { mode: 'create'; presetProduct?: string } | { mode: 'edit'; subscriptionId: string } | null
  >(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addProvider, setAddProvider] = useState<string | null>(null);
  const [connectionFocusId, setConnectionFocusId] = useState<string | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paymentContext, setPaymentContext] = useState<PaymentDraftContext | null>(null);
  const [paymentSeq, setPaymentSeq] = useState(0);
  const [expenseFocus, setExpenseFocus] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
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

  const navigate: Navigate = useCallback((route, options) => {
    setPage(route);
    setVisited((current) => (current.has(route) ? current : new Set([...current, route])));
    if (route === 'expenses' && options?.month) setExpenseFocus(options.month);
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
    if (!remindersOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setRemindersOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [remindersOpen]);

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

  const handleGlobalRefresh = async () => {
    setRefreshingAll(true);
    try {
      notify(await client.refresh());
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setRefreshingAll(false);
    }
  };

  if (!snapshot) {
    return (
      <div data-theme={resolvedTheme} className="app sc-shell sc-ui">
        <aside className="sc-sidebar" aria-label="工作台导航">
          <div className="sc-logo"><CalendarDays className="sc-logo-mark" /><span>subcal<span className="sc-logo-dot">.</span></span></div>
        </aside>
        <div className="sc-main">
          <header className="sc-topbar"><div className="sc-crumbs"><strong>工作空间</strong></div></header>
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

  const dueCount = upcomingEvents(snapshot.subscriptions, snapshot.now, 7).length;
  const reminderItems = upcomingEvents(snapshot.subscriptions, snapshot.now, 45);
  const reminderChannel = snapshot.preferences.reminder === 'local'
    ? `本机系统通知 · 提前 ${snapshot.preferences.reminderLeadDays} 天`
    : snapshot.preferences.reminder === 'external'
      ? '外部日历通道尚未接入'
      : '提醒通道已关闭';

  const navList = (mobile = false) => (
    <>
      <p className="sc-nav-label">工作空间</p>
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
              onClick={() => { navigate(item.route); setMobileOpen(false); }}
            >
              <Icon />
              <span>{item.label}</span>
              {item.route === 'subscriptions' ? (
                <span className="sc-nav-count">{snapshot.subscriptions.filter((s) => s.lifecycle !== 'archived').length}</span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="sc-sidebar-bottom">
        <button type="button" aria-label="偏好设置" title="偏好设置" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => { navigate('settings'); setMobileOpen(false); }}>
          <Settings2 /> <span>偏好设置</span>
        </button>
        <button type="button" aria-label="产品首页" title="产品首页" aria-current={page === 'home' ? 'page' : undefined} onClick={() => { navigate('home'); setMobileOpen(false); }}>
          <Home /> <span>产品首页</span>
        </button>
        <button type="button" aria-label="使用帮助" title="使用帮助" onClick={() => { navigate('home'); setMobileOpen(false); }}>
          <CircleHelp /> <span>使用帮助</span>
        </button>
      </div>
    </>
  );

  return (
    <NotificationContext.Provider value={notifications}>
      <div
        data-theme={resolvedTheme}
        data-scenario={snapshot.scenario}
        data-density={snapshot.preferences.density}
        data-reduced-motion={snapshot.preferences.reducedMotion ? 'true' : 'false'}
        className="app sc-shell sc-ui"
      >
        <aside className="sc-sidebar" aria-label="工作台导航">
          <button type="button" className="sc-logo" onClick={() => navigate('home')} aria-label="SubCal 产品首页">
            <CalendarDays className="sc-logo-mark" />
            <span>subcal<span className="sc-logo-dot">.</span></span>
          </button>
          {previewClient.preview ? <StatusBadge>开发预览</StatusBadge> : null}
          <button type="button" className="sc-workspace" onClick={() => navigate('settings')} aria-label="打开工作区设置">
            <span className="sc-workspace-avatar">{snapshot.preferences.workspaceName.slice(0, 1) || 'S'}</span>
            <span className="sc-workspace-copy">
              <strong>{snapshot.preferences.workspaceName}</strong>
              <small>个人空间 · 本地保存</small>
            </span>
            <ChevronRight className="size-4 text-(--sc-muted)" />
          </button>
          {navList()}
          <div className="sc-sidebar-note">
            <strong>少一点惦记，多一点从容</strong>
            <p>提前看看接下来的续费，把时间留给更重要的事。</p>
            <button type="button" className="sc-link" onClick={() => navigate('calendar')} style={{ color: 'var(--sc-accent-ink)' }}>
              查看我的日历 <ChevronRight className="size-4" />
            </button>
          </div>
        </aside>

        <div className="sc-main">
          <header className="sc-topbar">
            <button type="button" className="sc-icon-btn sc-mobile-menu" aria-label="打开导航菜单" onClick={() => setMobileOpen(true)}>
              <Menu />
            </button>
            <div className="sc-crumbs">
              <span>工作空间</span>
              <ChevronRight className="size-3.5" />
              <strong>{PAGE_LABEL[page]}</strong>
            </div>
            <div className="sc-topbar-right">
              <button type="button" className="sc-search-trigger" onClick={() => setSearchOpen(true)} aria-label="搜索订阅和页面，快捷键 Ctrl K">
                <Search className="size-4" />
                <span>搜索订阅、页面…</span>
                <kbd>Ctrl K</kbd>
              </button>
              <label className="sc-currency">
                <span>统计</span>
                <select
                  value={snapshot.preferences.statisticsCurrency}
                  aria-label="统计币种"
                  onChange={(e) => {
                    void client.setPreferences({ statisticsCurrency: e.target.value })
                      .then(() => notify(`统计币种已切换为 ${e.target.value}`))
                      .catch((err) => notify((err as Error).message));
                  }}
                >
                  {[...new Set([snapshot.preferences.statisticsCurrency, ...snapshot.payments.map((p) => p.currency), ...snapshot.subscriptions.map((s) => s.currency), 'CNY', 'USD'])].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="sc-icon-btn"
                aria-label="切换深浅色主题"
                title={`当前主题：${resolvedTheme === 'dark' ? '深色' : '浅色'}（点击切换到${resolvedTheme === 'dark' ? '浅色' : '深色'}）`}
                onClick={() => {
                  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
                  void client.setPreferences({ theme: next }).catch((e) => notify((e as Error).message));
                }}
              >
                {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
              </button>
              <div className="relative">
                <button
                  type="button"
                  className="sc-icon-btn"
                  data-alert={dueCount > 0}
                  aria-label={`提醒中心${dueCount > 0 ? `，${dueCount} 项近期事项` : ''}`}
                  aria-expanded={remindersOpen}
                  onClick={() => setRemindersOpen((open) => !open)}
                >
                  <CalendarDays />
                </button>
                {remindersOpen ? (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setRemindersOpen(false)} />
                    <div
                      role="dialog"
                      aria-label="提醒中心"
                      className="absolute right-0 top-[46px] z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-(--sc-radius-panel) border border-(--sc-border) bg-(--sc-surface) p-4 shadow-xl"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-base font-black">提醒中心</strong>
                        <span className="sc-badge" data-tone="accent">{reminderItems.length} 项 · 45 天</span>
                      </div>
                      <p className="m-0 text-[11px] font-bold text-(--sc-muted)">{reminderChannel}</p>
                      {reminderItems.length ? (
                        <div className="sc-list max-h-72 overflow-y-auto">
                          {reminderItems.slice(0, 8).map(({ event, sub, days }) => (
                            <button
                              key={event.id}
                              type="button"
                              className="sc-row border-0 bg-transparent p-0 text-left"
                              onClick={() => { setRemindersOpen(false); setDetailId(sub.id); }}
                            >
                              <span className="sc-brand-icon" aria-hidden="true">{sub.brand.slice(0, 1).toUpperCase()}</span>
                              <span className="sc-row-main">
                                <strong>{sub.product}</strong>
                                <small>{event.date} · {event.kind === 'renewal' ? '计划续费' : event.kind === 'expiry' ? '会员到期' : event.kind === 'trial' ? '试用结束' : '额度重置'}</small>
                              </span>
                              <span className="sc-row-end"><b>{days === 0 ? '今天' : `${days} 天后`}</b></span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="m-0 rounded-(--sc-radius-sm) bg-(--sc-canvas) px-3 py-4 text-center text-xs text-(--sc-muted)">
                          未来 45 天没有已知的续费或到期事项。日期未知的订阅不会编造日期。
                        </p>
                      )}
                      <div className="flex items-center justify-between border-t border-(--sc-border-soft) pt-2">
                        <button type="button" className="sc-link" onClick={() => { setRemindersOpen(false); navigate('calendar'); }}>
                          打开订阅日历 <ChevronRight className="size-4" />
                        </button>
                        <span className="text-[10px] text-(--sc-muted)">系统“已提交”不等于已送达</span>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
              <span className="sc-workspace-avatar" aria-label="个人工作区">{snapshot.preferences.workspaceName.slice(0, 1) || '我'}</span>
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
            <div className="sc-page" hidden={page !== 'home'}>
              {visited.has('home') ? <HomePage {...pageProps} onNavigate={navigate} /> : null}
            </div>

            <div className="sc-page" hidden={page !== 'dashboard'}>
              {visited.has('dashboard') ? (
                <DashboardPage
                  {...pageProps}
                  onNavigate={navigate}
                  onRecordPayment={(subscriptionId, planDate) => openPayment({ subscriptionId, planDate })}
                />
              ) : null}
            </div>

            <div className="sc-page" hidden={page !== 'subscriptions'}>
              {visited.has('subscriptions') ? (
                <div className="sc-page-inner">
                  <header className="sc-heading">
                    <div className="sc-heading-copy">
                      <p className="sc-eyebrow">SUBSCRIPTIONS</p>
                      <h1>每项服务，各得其所。</h1>
                      <p>保留原有订阅卡片的字号密度、额度条、账号分组与详情结构，只接入新的导航外壳。</p>
                    </div>
                    <div className="sc-heading-actions">
                      <Button type="button" variant="tactile" size="tactile" onClick={() => setAddOpen(true)}><Plus /> 添加订阅</Button>
                      <Button type="button" variant="tactile-soft" size="tactile" onClick={() => openPayment({})}>记录付款</Button>
                    </div>
                  </header>
                  <div className="subcal-magpie">
                    <SubscriptionsPage
                      {...pageProps}
                      onEdit={(sub) => setFormState({ mode: 'edit', subscriptionId: sub.id })}
                      onCreateWithPreset={(presetProduct) => {
                        const provider = PROVIDERS.find((p) => p.name === presetProduct || (p.id === 'deepseek-balance' && presetProduct === 'DeepSeek API'));
                        if (provider) setAddProvider(provider.id);
                        else setFormState({ mode: 'create', presetProduct });
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="sc-page" hidden={page !== 'expenses'}>
              {visited.has('expenses') ? (
                <ExpensesPage
                  {...pageProps}
                  focusMonth={expenseFocus}
                  onFocusMonthHandled={() => setExpenseFocus(null)}
                />
              ) : null}
            </div>

            <div className="sc-page" hidden={page !== 'calendar'}>
              {visited.has('calendar') ? (
                <div className="sc-page-inner">
                  <header className="sc-heading">
                    <div className="sc-heading-copy">
                      <p className="sc-eyebrow">SUBSCRIPTION CALENDAR</p>
                      <h1>让每次续费，都在计划里。</h1>
                      <p>续费、到期、试用和额度重置分开显示；已记录的付款会标在对应计划上。</p>
                    </div>
                    <div className="sc-heading-actions">
                      <Button type="button" variant="tactile" size="tactile" onClick={() => setAddOpen(true)}><Plus /> 添加订阅</Button>
                    </div>
                  </header>
                  <CalendarPage
                    {...pageProps}
                    onRecordPayment={(subscriptionId, planDate) => openPayment({ subscriptionId, planDate })}
                  />
                </div>
              ) : null}
            </div>

            <div className="sc-page" hidden={page !== 'accounts'}>
              {visited.has('accounts') ? (
                <div className="sc-page-inner">
                  <header className="sc-heading">
                    <div className="sc-heading-copy">
                      <p className="sc-eyebrow">YOUR ACCOUNTS</p>
                      <h1>常用账号，集中整理。</h1>
                      <p>发现本机已登录账号，或主动登录 / 填写 Key。真实状态优先于“未连接”的统一文案。</p>
                    </div>
                    <div className="sc-heading-actions">
                      <Button type="button" variant="tactile" size="tactile" onClick={() => setAddProvider('')}><Plus /> 添加账号</Button>
                    </div>
                  </header>
                  <ConnectionsPage {...pageProps} focusId={connectionFocusId} />
                </div>
              ) : null}
            </div>

            <div className="sc-page" hidden={page !== 'settings'}>
              {visited.has('settings') ? <SettingsPage {...pageProps} /> : null}
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
            <div className="relative z-10 flex w-64 flex-col gap-3 overflow-y-auto bg-(--sc-surface) p-4 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-lg font-black">subcal<span className="text-(--sc-accent)">.</span></span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭导航菜单" onClick={() => setMobileOpen(false)}><X /></Button>
              </div>
              {navList(true)}
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
          pages={NAV.map((item) => ({ route: item.route, label: item.label, hint: `${PAGE_LABEL[item.route]}页面` })).concat([
            { route: 'home', label: '产品首页', hint: 'SubCal 介绍与真实订阅概览' },
            { route: 'settings', label: '偏好设置', hint: '主题、提醒、预算与备份' },
          ])}
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
