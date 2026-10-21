import { Menu, Tray } from 'electron';
import type { MenuItemConstructorOptions, NativeImage } from 'electron';
import type { TraySummary } from '../shared/bridge';
import { TRAY_PINNED_MAX } from './security';

export type TrayRendererAction = 'refresh' | 'toggle-pause' | 'settings';

export interface PreviewTrayDeps {
  icon: NativeImage;
  /** 打开/聚焦主窗口（托盘单击与菜单“打开主窗口”共用）。 */
  onOpen: () => void;
  /** 向渲染层转发动作（模拟刷新、暂停/恢复、设置）。 */
  onAction: (action: TrayRendererAction) => void;
  /** 完全退出本次预览进程。 */
  onQuit: () => void;
}

export interface PreviewTray {
  update(summary: TraySummary): void;
  destroy(): void;
}

const EMPTY_SUMMARY: TraySummary = {
  nextRenewal: '',
  pinned: [],
  reconnectCount: 0,
  paused: false,
  closeToTray: true,
};

function buildTemplate(summary: TraySummary, deps: PreviewTrayDeps): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    { label: 'SubCal · 本地订阅管理', enabled: false },
  ];
  const pinned = summary.pinned.slice(0, TRAY_PINNED_MAX);
  const hasInfo =
    summary.nextRenewal.length > 0 || pinned.length > 0 || summary.reconnectCount > 0;
  if (summary.nextRenewal.length > 0) {
    items.push({ label: `下一续费：${summary.nextRenewal}`, enabled: false });
  }
  for (const entry of pinned) {
    items.push({ label: entry, enabled: false });
  }
  if (summary.reconnectCount > 0) {
    items.push({
      label: `需要重新连接：${summary.reconnectCount} 项`,
      enabled: false,
    });
  }
  if (!hasInfo) {
    items.push({ label: '暂无置顶摘要', enabled: false });
  }
  items.push(
    { type: 'separator' },
    { label: '打开主窗口', click: deps.onOpen },
    { label: '刷新已启用连接', click: () => deps.onAction('refresh') },
    {
      label: summary.paused ? '恢复采集' : '暂停采集',
      click: () => deps.onAction('toggle-pause'),
    },
    { label: '打开设置', click: () => deps.onAction('settings') },
    { type: 'separator' },
    { label: '退出 SubCal', click: deps.onQuit },
  );
  return items;
}

function buildTooltip(summary: TraySummary): string {
  let tip = 'SubCal';
  if (summary.paused) tip += ' · 采集已暂停';
  if (summary.nextRenewal.length > 0) tip += `\n下一续费：${summary.nextRenewal}`;
  if (summary.reconnectCount > 0) tip += `\n需要重新连接：${summary.reconnectCount} 项`;
  return tip.slice(0, 120);
}

/** 创建原生托盘。Windows 下单击托盘图标同样打开主窗口。 */
export function createPreviewTray(deps: PreviewTrayDeps): PreviewTray {
  let summary: TraySummary = { ...EMPTY_SUMMARY };
  const tray = new Tray(deps.icon);

  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate(buildTemplate(summary, deps)));
    tray.setToolTip(buildTooltip(summary));
  };

  tray.on('click', deps.onOpen);
  rebuild();

  return {
    update(next: TraySummary) {
      summary = next;
      rebuild();
    },
    destroy() {
      tray.destroy();
    },
  };
}
