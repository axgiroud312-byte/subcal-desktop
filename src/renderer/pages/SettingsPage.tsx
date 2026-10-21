import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  Database,
  Download,
  Monitor,
  Palette,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import type { PageProps } from '../contracts';
import type { ImportPreview, Preferences } from '../../shared/types';
import { Button } from '../components/ui/button';
import { exactMoney } from '../../shared/spending';

export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'workspace', label: '工作区', icon: Wallet },
  { id: 'reminders', label: '提醒', icon: Bell },
  { id: 'categories', label: '分类', icon: Archive },
  { id: 'backup', label: '备份', icon: Database },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

const ZONES = [
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC',
];
const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'HKD', 'GBP'];
const LEAD_DAYS = [1, 3, 7, 14];

type Draft = {
  density: Preferences['density'];
  quotaView: Preferences['quotaView'];
  timezone: string;
  reducedMotion: boolean;
  closeToTray: boolean;
  reminder: Preferences['reminder'];
  reminderLeadDays: number;
  dndStart: string;
  dndEnd: string;
  muted: boolean;
  workspaceName: string;
  statisticsCurrency: string;
  budgets: Record<string, string>;
  categories: string[];
};

export function SettingsPage({
  snapshot,
  client,
  notify,
  section: controlledSection,
  onSectionChange,
  bare = false,
}: PageProps & {
  section?: SettingsSectionId;
  onSectionChange?: (id: SettingsSectionId) => void;
  bare?: boolean;
}) {
  const prefs = snapshot.preferences;
  const [localSection, setLocalSection] = useState<SettingsSectionId>('appearance');
  const section = controlledSection ?? localSection;
  const setSection = (id: SettingsSectionId) => {
    setLocalSection(id);
    onSectionChange?.(id);
  };
  const [draft, setDraft] = useState<Draft>(() => ({
    density: prefs.density,
    quotaView: prefs.quotaView,
    timezone: prefs.timezone,
    reducedMotion: prefs.reducedMotion,
    closeToTray: prefs.closeToTray,
    reminder: prefs.reminder,
    reminderLeadDays: prefs.reminderLeadDays,
    dndStart: prefs.dndStart ?? '',
    dndEnd: prefs.dndEnd ?? '',
    muted: Boolean(prefs.notificationsMuted),
    workspaceName: prefs.workspaceName,
    statisticsCurrency: prefs.statisticsCurrency,
    budgets: { ...prefs.monthlyBudgets },
    categories: [...prefs.categories],
  }));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newBudgetCurrency, setNewBudgetCurrency] = useState('');
  const [selectionId, setSelectionId] = useState<string | null>(null);

  const resolvedTheme = snapshot.preferences.theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : snapshot.preferences.theme;

  const currencies = useMemo(
    () => [...new Set([...CURRENCIES, ...Object.keys(draft.budgets), ...snapshot.payments.map((p) => p.currency), ...snapshot.subscriptions.map((s) => s.currency)])],
    [draft.budgets, snapshot.payments, snapshot.subscriptions],
  );

  const patch = (next: Partial<Draft>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...next }));
  };

  // External changes (topbar currency, detail-drawer category, import) reach the
  // form only while it has no unsaved edits, so drafts are never clobbered.
  useEffect(() => {
    if (dirty) return;
    setDraft((current) => ({
      ...current,
      density: prefs.density,
      quotaView: prefs.quotaView,
      timezone: prefs.timezone,
      reducedMotion: prefs.reducedMotion,
      closeToTray: prefs.closeToTray,
      reminder: prefs.reminder,
      reminderLeadDays: prefs.reminderLeadDays,
      dndStart: prefs.dndStart ?? '',
      dndEnd: prefs.dndEnd ?? '',
      muted: Boolean(prefs.notificationsMuted),
      workspaceName: prefs.workspaceName,
      statisticsCurrency: prefs.statisticsCurrency,
      budgets: { ...prefs.monthlyBudgets },
      categories: [...prefs.categories],
    }));
  }, [dirty, prefs]);

  const save = async () => {
    setError(null);
    if (!draft.workspaceName.trim()) return setError('工作区名称不能为空');
    try {
      new Intl.DateTimeFormat('en', { timeZone: draft.timezone });
    } catch {
      return setError('时区无效，请选择或填写 IANA 时区');
    }
    const budgets: Record<string, string> = {};
    for (const [currency, amount] of Object.entries(draft.budgets)) {
      if (!amount.trim()) continue;
      if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount.trim())) return setError(`${currency} 预算请填写最多 12 位整数、6 位小数，留空表示未设置`);
      budgets[currency] = amount.trim();
    }
    if (draft.dndStart && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dndStart)) return setError('勿扰开始时间格式无效');
    if (draft.dndEnd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dndEnd)) return setError('勿扰结束时间格式无效');
    setSaving(true);
    try {
      await client.setPreferences({
        density: draft.density,
        quotaView: draft.quotaView,
        timezone: draft.timezone,
        reducedMotion: draft.reducedMotion,
        closeToTray: draft.closeToTray,
        reminder: draft.reminder,
        reminderLeadDays: draft.reminderLeadDays,
        dndStart: draft.dndStart || null,
        dndEnd: draft.dndEnd || null,
        notificationsMuted: draft.muted,
        workspaceName: draft.workspaceName.trim(),
        statisticsCurrency: draft.statisticsCurrency,
        monthlyBudgets: budgets,
        categories: draft.categories,
      });
      setDirty(false);
      notify('偏好设置已保存');
    } catch (err) {
      setError((err as Error).message || '保存失败，输入已保留');
    } finally {
      setSaving(false);
    }
  };

  const setTheme = async (theme: Preferences['theme']) => {
    try {
      await client.setPreferences({ theme });
      notify(theme === 'system' ? '主题已改为跟随系统' : `已切换为${theme === 'dark' ? '深色' : '浅色'}主题`);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const exportBackup = async () => {
    setBusy(true);
    try {
      const text = await client.exportData();
      if (!window.subcal?.saveFile) throw new Error('请在桌面应用内导出备份');
      const result = await window.subcal.saveFile(`subcal-backup-${new Date().toISOString().slice(0, 10)}.json`, text);
      if (result.saved) notify(`备份已导出${result.path ? `：${result.path}` : ''}`);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async () => {
    setBusy(true);
    try {
      const file = await window.subcal?.openFile();
      if (!file) return;
      const previewResult = await client.importPreview(file.contents);
      setPreview(previewResult);
      setPreviewText(file.contents);
      setSelectionId(file.selectionId);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!preview || !previewText) return;
    setBusy(true);
    try {
      const current = selectionId && window.subcal?.readSelectedFile
        ? await window.subcal.readSelectedFile(selectionId).catch(() => previewText)
        : previewText;
      await client.importCommit(preview.id, current);
      notify('已恢复备份：订阅、付款、预算和偏好已整体替换');
      setPreview(null);
      setPreviewText(null);
      setSelectionId(null);
      const next = await client.snapshot();
      setDraft((current) => ({
        ...current,
        budgets: { ...next.preferences.monthlyBudgets },
        categories: [...next.preferences.categories],
        statisticsCurrency: next.preferences.statisticsCurrency,
        workspaceName: next.preferences.workspaceName,
      }));
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (draft.categories.includes(name)) return setError('该分类已存在');
    patch({ categories: [...draft.categories, name] });
    setNewCategory('');
  };

  return (
    <div className="sc-page-inner">
      {bare ? null : (
        <header className="sc-heading">
          <div className="sc-heading-copy">
            <h1>设置</h1>
          </div>
          <div className="sc-heading-actions">
            <Button type="button" onClick={() => void save()} disabled={saving}>
              <Save /> {saving ? '正在保存…' : '保存设置'}
            </Button>
          </div>
        </header>
      )}

      {error ? <p role="alert" className="m-0 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <div className={bare ? 'flex max-w-[680px] flex-col gap-4' : 'grid gap-4 lg:grid-cols-[220px_minmax(0,680px)] lg:items-start'}>
        {bare ? null : (
          <nav className="sc-panel flex flex-row gap-1 overflow-x-auto p-2 lg:flex-col" aria-label="设置分区">
            {SETTINGS_SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex min-h-10 items-center gap-2 rounded-md px-3 text-left text-sm font-medium whitespace-nowrap ${
                    section === item.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                  aria-pressed={section === item.id}
                  onClick={() => setSection(item.id)}
                >
                  <Icon className="size-[18px]" /> {item.label}
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex flex-col gap-4">
          {section === 'appearance' ? (
            <>
              <section className="sc-panel" aria-label="主题">
                <div className="sc-panel-head">
                  <div><h2>主题</h2><p>选择偏好；实际显示会随系统解析，弹层与图表一起切换</p></div>
                  <span className="sc-badge" data-tone="accent">当前显示：{resolvedTheme === 'dark' ? '深色' : '浅色'}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([
                    { value: 'light', label: '浅色', hint: '始终使用浅色' },
                    { value: 'dark', label: '深色', hint: '始终使用深色' },
                    { value: 'system', label: '跟随系统', hint: '随 Windows 变化' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`rounded-(--sc-radius-sm) border-2 p-3 text-left ${
                        prefs.theme === option.value
                          ? 'border-(--sc-accent-line) bg-(--sc-accent-soft)'
                          : 'border-(--sc-border) bg-(--sc-surface)'
                      }`}
                      aria-pressed={prefs.theme === option.value}
                      onClick={() => void setTheme(option.value)}
                    >
                      <Monitor className="mb-1.5 size-4 text-(--sc-accent-ink)" />
                      <strong className="block text-sm font-extrabold">{option.label}</strong>
                      <small className="text-[11px] text-(--sc-muted)">{option.hint}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="sc-panel" aria-label="密度与额度显示">
                <div className="sc-panel-head"><div><h2>密度与额度显示</h2><p>这些设置继续作用于原有订阅卡片与详情</p></div></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sc-field">
                    <span>界面密度</span>
                    <select className="sc-select" value={draft.density} onChange={(e) => patch({ density: e.target.value as Draft['density'] })}>
                      <option value="comfortable">舒适</option>
                      <option value="compact">紧凑</option>
                    </select>
                  </label>
                  <label className="sc-field">
                    <span>额度显示方式</span>
                    <select className="sc-select" value={draft.quotaView} onChange={(e) => patch({ quotaView: e.target.value as Draft['quotaView'] })}>
                      <option value="remaining">显示剩余</option>
                      <option value="used">显示已用</option>
                    </select>
                  </label>
                  <label className="sc-checkbox flex items-center gap-2 text-sm font-bold">
                    <input type="checkbox" checked={draft.reducedMotion} onChange={(e) => patch({ reducedMotion: e.target.checked })} />
                    减少动效
                  </label>
                </div>
              </section>
            </>
          ) : null}

          {section === 'workspace' ? (
            <>
              <section className="sc-panel" aria-label="工作区">
                <div className="sc-panel-head"><div><h2>工作区</h2><p>名称只用于本地展示，不会建立新的账号模型</p></div></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sc-field sm:col-span-2">
                    <span>工作区名称</span>
                    <input className="sc-input" value={draft.workspaceName} maxLength={80} onChange={(e) => patch({ workspaceName: e.target.value })} />
                  </label>
                  <label className="sc-field">
                    <span>统计币种</span>
                    <select className="sc-select" value={draft.statisticsCurrency} onChange={(e) => patch({ statisticsCurrency: e.target.value })}>
                      {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="sc-field">
                    <span>时区</span>
                    <select className="sc-select" value={draft.timezone} onChange={(e) => patch({ timezone: e.target.value })}>
                      {[...new Set([draft.timezone, ...ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </label>
                </div>
                <p className="m-0 mt-2 text-xs text-(--sc-muted)">统计币种只切换查看的金额，不换算、也不改写订阅或付款的币种。</p>
              </section>

              <section className="sc-panel" aria-label="每月预算">
                <div className="sc-panel-head">
                  <div><h2>每月预算</h2><p>按币种设置，每月重复适用；留空表示未设置，0 表示确实为零</p></div>
                  <Wallet className="size-5 text-(--sc-muted)" />
                </div>
                <div className="flex flex-col gap-2">
                  {Object.entries(draft.budgets).length === 0 ? <p className="m-0 text-xs text-(--sc-muted)">还没有预算。添加一个币种后即可在消费页查看进度。</p> : null}
                  {Object.entries(draft.budgets).map(([currency, amount]) => (
                    <div key={currency} className="flex items-center gap-2">
                      <span className="w-14 text-sm font-extrabold">{currency}</span>
                      <input
                        className="sc-input tabular"
                        inputMode="decimal"
                        value={amount}
                        placeholder="留空表示未设置"
                        aria-label={`${currency} 每月预算`}
                        onChange={(e) => patch({ budgets: { ...draft.budgets, [currency]: e.target.value } })}
                      />
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`移除 ${currency} 预算`} onClick={() => {
                        const next = { ...draft.budgets };
                        delete next[currency];
                        patch({ budgets: next });
                      }}><Trash2 /></Button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <select className="sc-select w-32" value={newBudgetCurrency} onChange={(e) => setNewBudgetCurrency(e.target.value)} aria-label="添加预算币种">
                      <option value="">选择币种</option>
                      {currencies.filter((c) => draft.budgets[c] === undefined).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <Button type="button" variant="outline" size="sm" disabled={!newBudgetCurrency} onClick={() => { patch({ budgets: { ...draft.budgets, [newBudgetCurrency]: '' } }); setNewBudgetCurrency(''); }}>
                      <Plus /> 添加币种预算
                    </Button>
                  </div>
                </div>
                <p className="m-0 mt-2 text-xs text-(--sc-muted)">
                  当前 {draft.statisticsCurrency} 预算：
                  {draft.budgets[draft.statisticsCurrency]?.trim()
                    ? exactMoney(draft.budgets[draft.statisticsCurrency], draft.statisticsCurrency)
                    : '未设置'}
                  。消费预算与钱包阈值、供应商 Key 预算彼此独立。
                </p>
              </section>
            </>
          ) : null}

          {section === 'reminders' ? (
            <>
              <section className="sc-panel" aria-label="提醒">
                <div className="sc-panel-head"><div><h2>提醒</h2><p>提醒通道与提前天数是两个独立设置</p></div></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sc-field">
                    <span>提醒通道</span>
                    <select className="sc-select" value={draft.reminder} onChange={(e) => patch({ reminder: e.target.value as Draft['reminder'] })}>
                      <option value="local">本机系统通知</option>
                      <option value="external">外部日历（尚未接入）</option>
                      <option value="none">关闭全局提醒</option>
                    </select>
                  </label>
                  <label className="sc-field">
                    <span>全局提前提醒</span>
                    <select className="sc-select" value={draft.reminderLeadDays} onChange={(e) => patch({ reminderLeadDays: Number(e.target.value) })}>
                      {LEAD_DAYS.map((d) => <option key={d} value={d}>{d} 天前</option>)}
                    </select>
                  </label>
                  <label className="sc-field">
                    <span>勿扰开始</span>
                    <input className="sc-input" type="time" value={draft.dndStart} onChange={(e) => patch({ dndStart: e.target.value })} />
                  </label>
                  <label className="sc-field">
                    <span>勿扰结束</span>
                    <input className="sc-input" type="time" value={draft.dndEnd} onChange={(e) => patch({ dndEnd: e.target.value })} />
                  </label>
                </div>
                <div className="mt-1 flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input type="checkbox" checked={draft.muted} onChange={(e) => patch({ muted: e.target.checked })} />
                    暂停全部通知（勿扰与静音仍保留设置）
                  </label>
                  <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => patch({ dndStart: '', dndEnd: '' })}>
                    清空勿扰时段
                  </Button>
                </div>
                <p className="m-0 mt-2 text-xs text-(--sc-muted)">
                  外部日历通道目前尚未接入，选择它不会宣称已送达。系统通知的“已提交”与实际送达分别记录。
                </p>
              </section>

              <section className="sc-panel" aria-label="托盘">
                <div className="sc-panel-head"><div><h2>窗口与托盘</h2><p>关闭窗口时是否继续在后台上报提醒</p></div></div>
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input type="checkbox" checked={draft.closeToTray} onChange={(e) => patch({ closeToTray: e.target.checked })} />
                  关闭窗口后最小化到系统托盘
                </label>
                <p className="m-0 mt-2 text-xs text-(--sc-muted)">完全退出应用后不再查询连接，也不会发送本地提醒。</p>
              </section>
            </>
          ) : null}

          {section === 'categories' ? (
            <section className="sc-panel" aria-label="本地分类">
              <div className="sc-panel-head"><div><h2>本地分类</h2><p>分类是你自己的整理属性，不是供应商套餐；付款记录保留当时分类快照</p></div></div>
              <div className="flex flex-col gap-2">
                {draft.categories.map((category) => (
                  <div key={category} className="flex items-center justify-between gap-2 rounded-(--sc-radius-sm) bg-(--sc-canvas) px-3 py-2">
                    <span className="text-sm font-extrabold">{category}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除分类 ${category}`}
                      disabled={category === '其他'}
                      onClick={() => patch({ categories: draft.categories.filter((c) => c !== category) })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <input className="sc-input" value={newCategory} maxLength={80} placeholder="新分类名称" onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} />
                  <Button type="button" variant="outline" size="sm" onClick={addCategory}><Plus /> 添加</Button>
                </div>
                <p className="m-0 text-xs text-(--sc-muted)">“其他”是默认分类，不能删除。删除分类不会改写历史付款的分类快照。</p>
              </div>
            </section>
          ) : null}

          {section === 'backup' ? (
            <>
              <section className="sc-panel" aria-label="导出备份">
                <div className="sc-panel-head"><div><h2>导出备份</h2><p>包含订阅、付款账本、预算和偏好；不包含任何凭据</p></div><ShieldCheck className="size-5 text-(--sc-muted)" /></div>
                <p className="m-0 text-sm leading-relaxed text-(--sc-muted)">
                  JSON 备份可跨版本恢复，旧版 v1/v2 仍可读取。导入不会伪造历史付款，也不会把供应商数据带回。
                </p>
                <Button type="button" variant="default" className="mt-3" disabled={busy} onClick={() => void exportBackup()}>
                  <Download /> 导出 JSON 备份
                </Button>
              </section>

              <section className="sc-panel" aria-label="导入恢复">
                <div className="sc-panel-head"><div><h2>导入与恢复</h2><p>整体替换当前资料；先预览影响，再确认</p></div><Upload className="size-5 text-(--sc-muted)" /></div>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void chooseFile()}>
                  <Upload /> 选择备份文件并预览
                </Button>
                {preview ? (
                  <div className="mt-3 rounded-(--sc-radius-sm) border border-(--sc-border) bg-(--sc-canvas) p-3">
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold">
                      <span>订阅：{preview.count} 项（新增 {preview.added}，覆盖 {preview.overwritten}，删除 {preview.removed}）</span>
                      <span>付款：{preview.paymentCount ?? 0} 笔（将删除当前 {preview.removedPayments ?? 0} 笔）</span>
                    </div>
                    <p className="m-0 mt-1 text-[11px] text-(--sc-muted)">恢复会覆盖预算、分类、统计币种和提醒设置。取消不会改动现有资料。</p>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void restore()}>确认恢复</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => { setPreview(null); setPreviewText(null); }}>取消</Button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="sc-panel" aria-label="资料位置">
                <div className="sc-panel-head"><div><h2>资料与隐私</h2><p>正式空间为空，不包含演示账单</p></div></div>
                <p className="m-0 text-sm leading-relaxed text-(--sc-muted)">
                  订阅与付款保存在本机 SQLite 资料库；登录凭据由系统加密保护，不会进入页面草稿、日志或普通备份。
                  外部日历同步尚未接通，页面不会显示虚构的同步成功。
                </p>
              </section>
            </>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">主题立即生效，其余需保存。</span>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              <Save /> {saving ? '保存中…' : '保存设置'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
