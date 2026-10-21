import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Download,
  FolderOpen,
  RotateCcw,
  Save,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { PageProps } from '../contracts';
import type { ImportPreview, Preferences } from '../../shared/types';
import { Modal, StatusBadge } from './ui';
import { FormSelect } from './form-controls';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Separator } from './ui/separator';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from './ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import './settings.css';

const TIMEZONES = [
  'Asia/Shanghai',
  'America/New_York',
  'Europe/London',
  'Pacific/Auckland',
  'UTC',
] as const;

const isThresholdValueValid = (value: string) => value === '' || /^\d{1,12}(\.\d{1,6})?$/.test(value);

export function Settings({
  snapshot,
  client,
  notify,
  onClose,
}: PageProps & { onClose: () => void }) {
  const prefs = snapshot.preferences;
  const [tab, setTab] = useState<string>('显示与提醒');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{
    name: string;
    contents: string;
    selectionId: string;
  } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [thresholdError, setThresholdError] = useState('');
  const [notification, setNotification] = useState(false);

  const savedCNY = prefs.walletThresholds.CNY || '';
  const savedUSD = prefs.walletThresholds.USD || '';
  const [thresholds, setThresholds] = useState({
    CNY: savedCNY,
    USD: savedUSD,
  });

  // Sync wallet threshold inputs when external snapshot changes (e.g. after backup restore)
  useEffect(() => {
    setThresholds({
      CNY: prefs.walletThresholds.CNY || '',
      USD: prefs.walletThresholds.USD || '',
    });
  }, [prefs.walletThresholds.CNY, prefs.walletThresholds.USD]);

  const isThresholdsDirty =
    thresholds.CNY !== savedCNY || thresholds.USD !== savedUSD;

  // Controlled AlertDialogs for unsaved wallet thresholds and backup restore confirmation
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);

  const save = async (patch: Partial<Preferences>) => {
    try {
      await client.setPreferences(patch);
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const validateAndSaveThresholds = async (): Promise<boolean> => {
    setThresholdError('');
    const valid = Object.values(thresholds).every(isThresholdValueValid);
    if (!valid) {
      setThresholdError('阈值请填写非负金额，最多 6 位小数');
      return false;
    }
    try {
      await client.setPreferences({
        walletThresholds: Object.fromEntries(
          Object.entries(thresholds).filter(([, v]) => v !== '')
        ),
      });
      notify('钱包阈值已保存');
      return true;
    } catch (e) {
      setThresholdError((e as Error).message);
      return false;
    }
  };

  const handleRequestClose = () => {
    if (isThresholdsDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  const exportBackup = async () => {
    setBusy(true);
    setError('');
    try {
      const text = await client.exportData();
      const result = await window.subcal.saveFile(
        'subcal-demo-backup.json',
        text
      );
      if (result.saved) {
        notify(`演示备份已保存：${result.path}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async () => {
    setBusy(true);
    setError('');
    setPreview(null);
    setFile(null);
    setRestoreConfirmOpen(false);
    try {
      const selected = await window.subcal.openFile();
      if (!selected) return;
      setFile(selected);
      setPreview(await client.importPreview(selected.contents));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!file || !preview) return;
    setBusy(true);
    setError('');
    try {
      const current = await window.subcal.readSelectedFile(file.selectionId);
      if (current !== file.contents) {
        setRestoreConfirmOpen(false);
        setPreview(null);
        setFile(null);
        throw new Error(
          '文件在预览后发生变化，请重新选择并预览。当前资料未更改。'
        );
      }
      await client.importCommit(preview.id, current);
      setRestoreConfirmOpen(false);
      setPreview(null);
      setFile(null);
      notify('演示资料已恢复；模拟连接与日历目标已暂停，等待核对。');
    } catch (e) {
      setRestoreConfirmOpen(false);
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="设置" onClose={handleRequestClose} wide>
      <div className="settings-root">
        <Tabs
          value={tab}
          onValueChange={(next) => setTab(String(next))}
          className="settings-tabs"
        >
          <TabsList className="settings-tabs-list" aria-label="设置分组">
            <TabsTrigger value="显示与提醒">显示与提醒</TabsTrigger>
            <TabsTrigger value="备份与恢复">备份与恢复</TabsTrigger>
            <TabsTrigger value="隐私与许可">隐私与许可</TabsTrigger>
          </TabsList>

          <TabsContent value="显示与提醒" className="settings-content">
            {/* Group 1: Display & Window Preferences (Instant Save) */}
            <section className="settings-section" aria-label="界面与显示偏好">
              <div className="settings-section-header">
                <h3 className="settings-section-title">界面与显示偏好</h3>
                <StatusBadge tone="neutral">即时保存并持久生效</StatusBadge>
              </div>

              <FieldGroup className="settings-grid">
                <Field>
                  <FieldLabel htmlFor="pref-theme">主题</FieldLabel>
                  <FormSelect
                    id="pref-theme"
                    aria-label="主题"
                    value={prefs.theme}
                    onChange={(e) =>
                      void save({
                        theme: e.target.value as Preferences['theme'],
                      })
                    }
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                    <option value="system">跟随系统</option>
                  </FormSelect>
                </Field>

                <Field>
                  <FieldLabel htmlFor="pref-density">阅读密度</FieldLabel>
                  <FormSelect
                    id="pref-density"
                    aria-label="阅读密度"
                    value={prefs.density}
                    onChange={(e) =>
                      void save({
                        density: e.target.value as Preferences['density'],
                      })
                    }
                  >
                    <option value="comfortable">舒适 · 通常三列</option>
                    <option value="compact">紧凑 · 通常四列</option>
                  </FormSelect>
                </Field>

                <Field>
                  <FieldLabel htmlFor="pref-quota-view">额度显示</FieldLabel>
                  <FormSelect
                    id="pref-quota-view"
                    aria-label="额度显示"
                    value={prefs.quotaView}
                    onChange={(e) =>
                      void save({
                        quotaView: e.target.value as Preferences['quotaView'],
                      })
                    }
                  >
                    <option value="remaining">剩余</option>
                    <option value="used">已用</option>
                  </FormSelect>
                </Field>

                <Field>
                  <FieldLabel htmlFor="pref-timezone">显示时区</FieldLabel>
                  <FormSelect
                    id="pref-timezone"
                    aria-label="显示时区"
                    value={prefs.timezone}
                    onChange={(e) => void save({ timezone: e.target.value })}
                  >
                    {TIMEZONES.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </FormSelect>
                </Field>
              </FieldGroup>

              <FieldDescription>
                日期型续费安排保留原订阅日期。此时区只影响精确时间和演示时钟显示。
              </FieldDescription>

              <div className="settings-switch-list">
                <div className="settings-switch-row">
                  <FieldContent className="settings-switch-copy">
                    <FieldTitle id="label-reduced-motion">
                      减少动态效果
                    </FieldTitle>
                    <FieldDescription>
                      同步至根节点动效变量与多账号展开过渡（当前：
                      {prefs.reducedMotion ? '已开启减少动效' : '标准过渡'}）。
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="pref-reduced-motion"
                    aria-label="减少动态效果"
                    aria-labelledby="label-reduced-motion"
                    checked={prefs.reducedMotion}
                    onCheckedChange={(checked) =>
                      void save({ reducedMotion: Boolean(checked) })
                    }
                  />
                </div>

                <div className="settings-switch-row">
                  <FieldContent className="settings-switch-copy">
                    <FieldTitle id="label-close-to-tray">
                      关闭窗口后保留在系统托盘
                    </FieldTitle>
                    <FieldDescription>
                      点击窗口关闭按钮时隐藏至系统托盘，可通过托盘菜单重新打开或退出（当前：
                      {prefs.closeToTray ? '保留在托盘' : '直接关闭'}）。
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="pref-close-to-tray"
                    aria-label="关闭窗口后保留在系统托盘"
                    aria-labelledby="label-close-to-tray"
                    checked={prefs.closeToTray}
                    onCheckedChange={(checked) =>
                      void save({ closeToTray: Boolean(checked) })
                    }
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Group 2: Reminder Preferences */}
            <section className="settings-section" aria-label="提醒偏好（演示）">
              <div className="settings-section-header">
                <h3 className="settings-section-title">提醒偏好（演示）</h3>
                <StatusBadge tone="neutral">新记录默认项</StatusBadge>
              </div>

              <FieldGroup className="settings-grid">
                <Field>
                  <FieldLabel htmlFor="pref-reminder">
                    新增记录的提醒方式
                  </FieldLabel>
                  <FormSelect
                    id="pref-reminder"
                    aria-label="新增记录的提醒方式"
                    value={prefs.reminder}
                    onChange={(e) =>
                      void save({
                        reminder: e.target.value as Preferences['reminder'],
                      })
                    }
                  >
                    <option value="local">本地提醒（计划）</option>
                    <option value="external">仅外部日历提醒（计划）</option>
                    <option value="none">不提醒</option>
                  </FormSelect>
                  <FieldDescription>
                    保存默认偏好供新记录使用。仅外部日历提醒可以避免未来收到两处提醒；当前不会发出系统通知。
                  </FieldDescription>
                </Field>
              </FieldGroup>

              <div className="row">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setNotification(!notification)}
                >
                  <Bell />
                  预览页面内提醒样式
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  title="真实服务接入阶段实现"
                >
                  开机启动 · 后续实现
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  title="真实服务接入阶段实现"
                >
                  系统定时通知 · 后续实现
                </Button>
              </div>

              {notification && (
                <div role="status" className="notification-preview">
                  <strong>续费核对提醒 · 样式预览</strong>
                  <span>Claude Pro · 2 天后计划续费（示例）</span>
                  <span className="muted">
                    仅页面样式，没有发送系统通知。
                  </span>
                </div>
              )}
            </section>

            <Separator />

            {/* Group 3: Wallet Low Balance Thresholds */}
            <section className="settings-section" aria-label="钱包低余额阈值">
              <div className="settings-section-header">
                <h3 className="settings-section-title">钱包低余额阈值</h3>
                {isThresholdsDirty ? (
                  <StatusBadge tone="warning">待保存草稿</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">
                    已生效（CNY: {savedCNY || '未设'} · USD: {savedUSD || '未设'}）
                  </StatusBadge>
                )}
              </div>

              <FieldDescription>
                按币种独立判断，只使用新鲜值。留空表示不提示，不把金额换算成百分比。
              </FieldDescription>

              <FieldGroup className="settings-grid">
                {(['CNY', 'USD'] as const).map((currency) => (
                  <Field key={currency}>
                    <FieldLabel htmlFor={`threshold-${currency}`}>
                      {currency} 低余额阈值
                    </FieldLabel>
                    <Input
                      id={`threshold-${currency}`}
                      aria-label={`${currency} 低余额阈值`}
                      inputMode="decimal"
                      placeholder="留空不提示"
                      value={thresholds[currency]}
                      aria-invalid={Boolean(thresholdError && !isThresholdValueValid(thresholds[currency]))}
                      aria-describedby={thresholdError ? 'threshold-error' : undefined}
                      onChange={(e) => {
                        setThresholdError('');
                        setThresholds({
                          ...thresholds,
                          [currency]: e.target.value,
                        });
                      }}
                    />
                  </Field>
                ))}
              </FieldGroup>

              {thresholdError ? <FieldError id="threshold-error">{thresholdError}</FieldError> : null}

              <div className="row">
                <Button
                  type="button"
                  variant={isThresholdsDirty ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => void validateAndSaveThresholds()}
                >
                  <Save />
                  保存阈值
                </Button>
                {isThresholdsDirty && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setThresholds({ CNY: savedCNY, USD: savedUSD }); setThresholdError(''); }}
                  >
                    <RotateCcw />
                    还原已保存值
                  </Button>
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="备份与恢复" className="settings-content">
            <section className="settings-section" aria-label="演示资料备份与恢复">
              <div className="settings-section-header">
                <h3 className="settings-section-title">
                  演示空间 JSON 备份与差异恢复
                </h3>
                <StatusBadge tone="neutral">schemaVersion 1 · 上限 2 MB</StatusBadge>
              </div>

              <p style={{ margin: 0 }}>
                备份包含全部已保存演示场景、订阅记录、偏好和模拟日历快照。恢复会替换这些演示空间，并在恢复后自动暂停全部模拟连接与 3 个日历同步目标等待核对。
              </p>

              <div className="row">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void exportBackup()}
                >
                  <Download />
                  导出演示备份 JSON
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void chooseFile()}
                >
                  <FolderOpen />
                  选择备份并预览
                </Button>
              </div>

              <FieldDescription>
                仅接受 schemaVersion 1，文件上限 2 MB。原文件在最终确认提交前会重新读取并核对内容，预览后若被外部修改将拒绝覆盖。
              </FieldDescription>

              {error && (
                <p role="alert" className="settings-error">
                  {error}
                </p>
              )}

              {preview && file && (
                <div className="settings-preview-box">
                  <div className="toolbar">
                    <strong>导入预览 · {file.name}</strong>
                    <StatusBadge tone="warning">待确认恢复</StatusBadge>
                  </div>

                  <div className="settings-diff-stats">
                    <span>
                      当前空间 {preview.currentCount} 条 → 备份空间 {preview.count} 条（
                      {preview.scenario}）
                    </span>
                    <span>·</span>
                    <span>
                      新增 {preview.added} 条 · 覆盖 {preview.overwritten} 条 · 移除{' '}
                      {preview.removed} 条。
                    </span>
                  </div>

                  <p className="muted" style={{ margin: 0 }}>
                    以上数量比较当前活动空间；备份中的其他演示空间与显示偏好也将整体恢复。所有模拟连接和日历目标恢复后暂停，需重新核对。
                  </p>

                  <div className="row">
                    <Button
                      type="button"
                      data-testid="open-restore-confirm-btn"
                      disabled={busy}
                      onClick={() => setRestoreConfirmOpen(true)}
                    >
                      <Check />
                      恢复演示资料…
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setRestoreConfirmOpen(false);
                        setPreview(null);
                        setFile(null);
                      }}
                    >
                      取消导入
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="隐私与许可" className="settings-content">
            <section className="settings-info-card" aria-label="本地演示空间说明">
              <div className="toolbar">
                <strong>本地演示空间与凭据边界</strong>
                <StatusBadge tone="neutral">纯本地存储</StatusBadge>
              </div>
              <p>
                数据由统一 MockSubCalClient 保存到 SubCal-Preview 的浏览器本地存储。没有生产数据库或凭据存储；重置只影响明确选择的演示场景。
              </p>
              <p>
                预览不会读取密码、API Key、OAuth Token 或官方客户端登录文件，也不会调用订阅或外部日历接口。
              </p>
              <p className="muted">
                历史只记录实际发生的演示观察和本地编辑，最多保留每条记录最近 100 条。
              </p>
            </section>

            <section className="settings-info-card" aria-label="资源与第三方许可说明">
              <div className="toolbar">
                <strong>品牌资源、组件与第三方许可</strong>
                <StatusBadge tone="neutral">
                  <ShieldCheck className="size-3.5" />
                  仅指示性使用 · 不含商标授权
                </StatusBadge>
              </div>
              <p>
                SubCal 应用标识与托盘日历图形由本项目代码生成（<code>src/main/tray-icon.ts</code>）。常见供应商品牌标识采用仓库内置的本地单色 SVG（<code>src/renderer/assets/brands/</code>，固定版本源自 Simple Icons CC0-1.0 与 <code>@lobehub/icons-static-svg</code> MIT，内联随主题着色），未收录品牌自动回退至清晰品牌文字缩略后备，运行时不联网拉取图标。
              </p>
              <p>
                上游图标集的开源许可（CC0-1.0 / MIT）仅覆盖图标图形文件本身的版权贡献，<strong>不包括任何品牌的商标许可</strong>；各品牌名称与标识归对应权利人所有，仅作订阅归属的指示性显示，不暗示官方合作或背书。
              </p>
              <p>
                界面交互组件基于 shadcn/ui（<code>base-mira</code> / <code>@base-ui/react</code>）、操作图标采用 <code>lucide-react</code>。Magpie 界面仅作信息层级参考，未复制其图标或源码。完整素材来源、版本与对比度记录见 <code>docs/assets.md</code> 与 <code>docs/design/component-adoption.md</code>；运行依赖许可证保存在 <code>node_modules</code> 对应包目录。
              </p>
            </section>

            <p className="muted" style={{ margin: 0 }}>
              语言：简体中文。英文、SQLite、系统凭据保护和真实同步在后续阶段实施。
            </p>
          </TabsContent>
        </Tabs>

        {/* Controlled AlertDialog: Confirm Backup Restore */}
        <AlertDialog
          open={restoreConfirmOpen}
          onOpenChange={setRestoreConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认恢复演示资料？</AlertDialogTitle>
              <AlertDialogDescription>
                {preview && file
                  ? `即将从「${file.name}」恢复演示资料（当前活动空间 ${preview.currentCount} 条 → 备份空间 ${preview.count} 条，新增 ${preview.added} 条、覆盖 ${preview.overwritten} 条、移除 ${preview.removed} 条）。恢复后全部模拟连接与 3 个日历同步目标将自动暂停，提交前会再次校验原文件未发生变更。`
                  : '恢复将替换全部演示场景、订阅记录、偏好与日历快照。'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
              <Button
                type="button"
                data-testid="confirm-restore-btn"
                disabled={busy}
                onClick={() => void restore()}
              >
                确认恢复演示资料
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Controlled AlertDialog: Unsaved Wallet Thresholds Guard */}
        <AlertDialog
          open={discardConfirmOpen}
          onOpenChange={(open, details) => {
            if (!open && (details.reason === 'escape-key' || details.reason === 'outside-press')) { details.cancel(); return; }
            setDiscardConfirmOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <TriangleAlert className="inline-icon text-warning" /> 有未保存的钱包阈值修改
              </AlertDialogTitle>
              <AlertDialogDescription>
                您修改了钱包低余额阈值草稿（CNY: {thresholds.CNY || '留空'}，USD:{' '}
                {thresholds.USD || '留空'}）但尚未点击「保存阈值」。是否先保存修改，或放弃草稿关闭设置？
              </AlertDialogDescription>
            </AlertDialogHeader>
            {thresholdError ? <FieldError>{thresholdError}</FieldError> : null}
            <AlertDialogFooter>
              <AlertDialogCancel>继续编辑</AlertDialogCancel>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDiscardConfirmOpen(false);
                  setThresholds({ CNY: savedCNY, USD: savedUSD });
                  onClose();
                }}
              >
                放弃未保存修改
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void validateAndSaveThresholds().then((ok) => {
                    if (ok) {
                      setDiscardConfirmOpen(false);
                      onClose();
                    }
                  });
                }}
              >
                保存阈值并关闭
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Modal>
  );
}
