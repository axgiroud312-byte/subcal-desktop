import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { LoginOptions } from './types';

/** Ephemeral provider-only window: no preload, application IPC or shared cookies. */
export const openLoginWindow: NonNullable<LoginOptions['openWindow']> = async (url, options) => {
  const origins = options.allowedOrigins.map(value => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.origin !== value) throw new Error('登录窗口来源无效');
    return value;
  });
  const allowed = (value: string) => { try { return origins.includes(new URL(value).origin); } catch { return false; } };
  if (!allowed(url)) throw new Error('登录窗口地址无效');
  const isolated = session.fromPartition(`subcal-login-${randomUUID()}`);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const win = new BrowserWindow({ width: 960, height: 760, title: options.title, autoHideMenuBar: true,
    webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => { if (!allowed(target)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, target) => { if (!allowed(target)) event.preventDefault(); });
  isolated.on('will-download', event => event.preventDefault());
  win.on('closed', () => { void isolated.clearStorageData().catch(() => {}); void isolated.clearCache().catch(() => {}); });
  try { await win.loadURL(url); } catch { if (!win.isDestroyed()) win.destroy(); throw new Error('登录页面未能加载，请重试'); }
  return {
    closed: () => win.isDestroyed(),
    close: () => { if (!win.isDestroyed()) win.destroy(); },
    async evaluate<T>(script: string): Promise<T | null> {
      if (win.isDestroyed() || !allowed(win.webContents.getURL())) return null;
      // Recheck inside the executing document as navigation can race this call.
      return win.webContents.executeJavaScript(`(() => { if (!${JSON.stringify(origins)}.includes(location.origin)) return null; return (${script}); })()`) as Promise<T | null>;
    },
  };
};
