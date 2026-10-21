import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
  safeStorage,
  powerMonitor,
  Notification,
  net,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OPEN_FILE_MAX_BYTES,
  SAVE_FILE_MAX_BYTES,
  assertOfficialHttpsUrl,
  normalizeLoopbackDevUrl,
  sanitizeExportFileName,
  sanitizeTraySummary,
} from './security';
import { DEFAULT_SHELL_PREFS, loadShellPrefs, saveShellPrefs } from './settings';
import type { ShellPrefs } from './settings';
import { createTrayIcon, createWindowIcon } from './tray-icon';
import { createPreviewTray } from './tray';
import type { PreviewTray, TrayRendererAction } from './tray';
import { SubCalDatabase } from './db/database';
import { CredentialVault } from './credentials';
import { SubCalService } from './service';
import { Collector } from './collector';
import { manifests } from './adapters';
import { NotificationService } from './notifications';
import { AccountAccess } from './account-access';

/** 渲染层动作通道（主 → 渲染），合同见 src/shared/bridge.ts。 */
const ACTION_CHANNEL = 'subcal:action';

const DEFAULT_DEV_URL = 'http://localhost:5173/';
const WINDOW_TARGET = { width: 1280, height: 820 };
const WINDOW_MIN = { width: 960, height: 640 };

let mainWindow: BrowserWindow | null = null;
let trayHandle: PreviewTray | null = null;
let prefs: ShellPrefs = { ...DEFAULT_SHELL_PREFS };
let prefsFile = '';
let devServerUrl = DEFAULT_DEV_URL;
let isQuitting = false;
let selectedImport: { id: string; path: string } | null = null;
let service:SubCalService;
let notifications:NotificationService;

/* —— 启动路径与用户数据目录 —— */

function setupUserDataPath(): void {
  const override = process.env.SUBCAL_USER_DATA;
  if (override) {
    if (path.isAbsolute(override)) {
      app.setPath('userData', override);
      return;
    }
    console.warn('[SubCal] SUBCAL_USER_DATA 必须是绝对路径，已忽略:', override);
  }
  // 开发期独立目录，避免与任何未来正式安装共用 userData。
  app.setPath('userData', path.join(app.getPath('appData'), app.isPackaged?'SubCal':'SubCal-Development'));
}

app.setName('SubCal');
setupUserDataPath();
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => showMainWindow());

/* —— 窗口 —— */

function isAllowedNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.origin === new URL(devServerUrl).origin) return true;
    // 打包形态（本阶段不使用）允许本地文件
    if (app.isPackaged && url.protocol === 'file:') return true;
  } catch {
    /* fallthrough */
  }
  return false;
}

function clampWindowBounds(): { width: number; height: number; minWidth: number; minHeight: number } {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(WINDOW_TARGET.width, workArea.width);
  const height = Math.min(WINDOW_TARGET.height, workArea.height);
  return {
    width,
    height,
    minWidth: Math.min(WINDOW_MIN.width, width),
    minHeight: Math.min(WINDOW_MIN.height, height),
  };
}

function createMainWindow(): void {
  const bounds = clampWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    // 原生带框标题栏：不使用 overlay/titleBarStyle，安全区交给系统
    title: 'SubCal',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: createWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const win = mainWindow;
  win.once('ready-to-show', () => win.show());

  // 禁止新窗口与任意导航：官方链接一律走 bridge.openExternal 校验
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.on('close', (event) => {
    if (isQuitting || !prefs.closeToTray) return;
    event.preventDefault();
    if (!prefs.closeToTrayExplained) {
      dialog.showMessageBoxSync(win, {
        type: 'info',
        title: 'SubCal',
        message: 'SubCal 已最小化到系统托盘',
        detail:
          '已启用的连接会继续按允许频率查询。可通过托盘暂停采集或完全退出；完全退出后不再查询或发送本地提醒。',
        buttons: ['知道了'],
        defaultId: 0,
        noLink: true,
      });
      prefs = { ...prefs, closeToTrayExplained: true };
      void saveShellPrefs(prefsFile, prefs);
    }
    win.hide();
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  win.on('show',()=>{service.scheduler.foreground=true;});
  win.on('hide',()=>{service.scheduler.foreground=false;});

  if (app.isPackaged) {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    void win.loadURL(devServerUrl);
  }
}

function showMainWindow(): void {
  const win = mainWindow;
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function sendRendererAction(action: TrayRendererAction): void {
  if(action!=='settings') {
    void service.handle({version:1,requestId:randomUUID(),idempotencyKey:randomUUID(),method:action==='refresh'?'collections.refresh':'connections.pause',params:{}});
    return;
  }
  showMainWindow();
  const wc = mainWindow?.webContents;
  if (!wc) return;
  if (wc.isLoading()) {
    wc.once('did-finish-load', () => wc.send(ACTION_CHANNEL, action));
  } else {
    wc.send(ACTION_CHANNEL, action);
  }
}

function quitPreview(): void {
  isQuitting = true;
  app.quit();
}

/* —— IPC：仅接受来自主窗口的调用，逐参数校验 —— */

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
  const win = mainWindow;
  if (!win || win.isDestroyed() || event.sender !== win.webContents) {
    throw new Error('拒绝：调用来源不是主窗口');
  }
  if(event.senderFrame!==win.webContents.mainFrame)throw new Error('拒绝：不允许子框架调用');
  const frameUrl = event.senderFrame?.url ?? '';
  if (frameUrl && !isAllowedNavigation(frameUrl)) {
    throw new Error('拒绝：页面来源不受信任');
  }
}

function registerIpc(): void {
  ipcMain.handle('subcal:invoke',(event,request:unknown)=>{assertMainWindowSender(event);return service.handle(request);});
  ipcMain.handle('subcal:open-external', async (event, rawUrl: unknown) => {
    assertMainWindowSender(event);
    const url = assertOfficialHttpsUrl(rawUrl);
    await shell.openExternal(url);
  });

  ipcMain.handle('subcal:save-file', async (event, rawName: unknown, rawContents: unknown) => {
    assertMainWindowSender(event);
    if (typeof rawContents !== 'string') {
      throw new Error('导出内容必须是字符串');
    }
    if (Buffer.byteLength(rawContents, 'utf8') > SAVE_FILE_MAX_BYTES) {
      throw new Error('导出内容超过大小限制');
    }
    const win = mainWindow;
    if (!win) throw new Error('主窗口不可用');
    const result = await dialog.showSaveDialog(win, {
      title: '导出资料备份',
      defaultPath: path.join(app.getPath('documents'), sanitizeExportFileName(rawName)),
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, rawContents, 'utf8');
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle('subcal:open-file', async (event) => {
    assertMainWindowSender(event);
    const win = mainWindow;
    if (!win) throw new Error('主窗口不可用');
    const result = await dialog.showOpenDialog(win, {
      title: '导入资料备份',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const stat = await fs.stat(filePath);
    if (stat.size > OPEN_FILE_MAX_BYTES) {
      throw new Error('文件超过 2MB 大小限制，未读取');
    }
    const contents = await fs.readFile(filePath, 'utf8');
    selectedImport = { id: randomUUID(), path: filePath };
    return { name: path.basename(filePath), contents, selectionId: selectedImport.id };
  });

  ipcMain.handle('subcal:read-selected-file', async (event, id: unknown) => {
    assertMainWindowSender(event);
    if (typeof id !== 'string' || !selectedImport || id !== selectedImport.id) throw new Error('文件选择已失效，请重新选择');
    if ((await fs.stat(selectedImport.path)).size > OPEN_FILE_MAX_BYTES) throw new Error('文件超过 2MB，原预览已失效');
    return fs.readFile(selectedImport.path, 'utf8');
  });

  ipcMain.handle('subcal:update-tray', (event, rawSummary: unknown) => {
    assertMainWindowSender(event);
    const summary = sanitizeTraySummary(rawSummary);
    trayHandle?.update(summary);
    if (summary.closeToTray !== prefs.closeToTray) {
      prefs = { ...prefs, closeToTray: summary.closeToTray };
      void saveShellPrefs(prefsFile, prefs);
    }
  });

  ipcMain.handle('subcal:quit', (event) => {
    assertMainWindowSender(event);
    quitPreview();
  });
}

/* —— 应用生命周期 —— */

void app.whenReady().then(async () => {
  const rawDevUrl = process.env.SUBCAL_DEV_URL;
  if (rawDevUrl) {
    const normalized = normalizeLoopbackDevUrl(rawDevUrl);
    if (normalized) {
      devServerUrl = normalized;
    } else {
      console.warn('[SubCal] SUBCAL_DEV_URL 不是本机 http(s) 地址，已回退默认:', rawDevUrl);
    }
  }

  prefsFile = path.join(app.getPath('userData'), 'preview-shell.json');
  prefs = await loadShellPrefs(prefsFile);
  const db=new SubCalDatabase(app.getPath('userData'));
  service=new SubCalService(db,new CredentialVault(app.getPath('userData'),safeStorage),new Collector(url=>session.defaultSession.resolveProxy(url)),manifests,Date.now,new AccountAccess({fetch:net.fetch.bind(net) as typeof fetch}));
  prefs.closeToTray=db.getPreferences().closeToTray;
  notifications=new NotificationService(db,{available:()=>Notification.isSupported(),show:(title,body)=>{new Notification({title,body}).show();}});
  service.subscribe(()=>{mainWindow?.webContents.send('subcal:state-changed');prefs.closeToTray=db.getPreferences().closeToTray;});
  if(!db.getStorageError()){service.scheduler.start();service.startAccountUpdates();notifications.start();}
  powerMonitor.on('suspend',()=>service.scheduler.suspend());
  powerMonitor.on('resume',()=>{service.scheduler.resume();void service.reconcileCredentials();notifications.tick();});
  const networkTimer=setInterval(()=>service.scheduler.setOnline(net.isOnline()),5000);networkTimer.unref();

  // 预览不需要任何系统权限（通知、摄像头等），全部拒绝
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerIpc();
  createMainWindow();
  trayHandle = createPreviewTray({
    icon: createTrayIcon(),
    onOpen: showMainWindow,
    onAction: sendRendererAction,
    onQuit: quitPreview,
  });

  app.on('activate', () => {
    if (mainWindow) showMainWindow();
    else createMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  notifications?.close();service?.close();
  trayHandle?.destroy();
  trayHandle = null;
});

// closeToTray 开启时窗口只会被隐藏，不会触发本事件；
// 用户选择“关闭即退出”时窗口销毁，在这里结束整个预览进程。
app.on('window-all-closed', () => {
  quitPreview();
});
