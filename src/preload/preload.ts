import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, TraySummary } from '../shared/bridge';
import { parseRequest } from '../shared/schema';

/**
 * Preload：在 contextIsolation + sandbox 下只暴露 src/shared/bridge.ts 定义的
 * DesktopBridge。不暴露 ipcRenderer 本体、不暴露 Node 能力。
 * 这里的校验是早期防线，主进程仍会权威校验所有参数。
 */

type TrayRendererAction = 'refresh' | 'toggle-pause' | 'settings';

const ACTION_CHANNEL = 'subcal:action';
const VALID_ACTIONS: readonly string[] = ['refresh', 'toggle-pause', 'settings'];

function needString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${name} 参数无效`);
  }
  return value;
}

function needTraySummary(value: unknown): TraySummary {
  if (typeof value !== 'object' || value === null) {
    throw new Error('托盘摘要必须是对象');
  }
  const s = value as Partial<TraySummary>;
  if (typeof s.nextRenewal !== 'string' || s.nextRenewal.length > 200) {
    throw new Error('托盘摘要 nextRenewal 无效');
  }
  if (
    !Array.isArray(s.pinned) ||
    s.pinned.length > 5 ||
    s.pinned.some((p) => typeof p !== 'string' || (p as string).length > 200)
  ) {
    throw new Error('托盘摘要 pinned 无效（最多五条短文本）');
  }
  if (
    typeof s.reconnectCount !== 'number' ||
    !Number.isInteger(s.reconnectCount) ||
    s.reconnectCount < 0 ||
    s.reconnectCount > 999
  ) {
    throw new Error('托盘摘要 reconnectCount 无效');
  }
  if (typeof s.paused !== 'boolean' || typeof s.closeToTray !== 'boolean') {
    throw new Error('托盘摘要 paused / closeToTray 必须是布尔值');
  }
  return {
    nextRenewal: s.nextRenewal,
    pinned: [...s.pinned],
    reconnectCount: s.reconnectCount,
    paused: s.paused,
    closeToTray: s.closeToTray,
  };
}

function detectPlatform(): string {
  try {
    return typeof process !== 'undefined' && typeof process.platform === 'string'
      ? process.platform
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

const bridge: DesktopBridge = {
  platform: detectPlatform(),
  mode: 'ipc',
  invoke(request) { return ipcRenderer.invoke('subcal:invoke', parseRequest(request)); },
  onStateChanged(callback) {
    if(typeof callback!=='function')throw new Error('callback 必须是函数');
    const listener=()=>callback();ipcRenderer.on('subcal:state-changed',listener);
    return ()=>{ipcRenderer.removeListener('subcal:state-changed',listener);};
  },
  openExternal(url: string) {
    needString(url, 'url', 2048);
    return ipcRenderer.invoke('subcal:open-external', url) as Promise<void>;
  },
  saveFile(name: string, contents: string) {
    needString(name, 'name', 200);
    if (typeof contents !== 'string') {
      throw new Error('contents 必须是字符串');
    }
    return ipcRenderer.invoke('subcal:save-file', name, contents) as Promise<{
      saved: boolean;
      path?: string;
    }>;
  },
  openFile() {
    return ipcRenderer.invoke('subcal:open-file') as Promise<{
      name: string;
      contents: string;
      selectionId: string;
    } | null>;
  },
  readSelectedFile(selectionId: string) {
    needString(selectionId, 'selectionId', 100);
    return ipcRenderer.invoke('subcal:read-selected-file', selectionId) as Promise<string>;
  },
  updateTray(summary: TraySummary) {
    return ipcRenderer.invoke('subcal:update-tray', needTraySummary(summary)) as Promise<void>;
  },
  onAction(callback: (action: TrayRendererAction) => void) {
    if (typeof callback !== 'function') {
      throw new Error('callback 必须是函数');
    }
    const listener = (_event: unknown, action: unknown) => {
      if (typeof action === 'string' && VALID_ACTIONS.includes(action)) {
        callback(action as TrayRendererAction);
      }
    };
    ipcRenderer.on(ACTION_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(ACTION_CHANNEL, listener);
    };
  },
  quit() {
    return ipcRenderer.invoke('subcal:quit') as Promise<void>;
  },
};

contextBridge.exposeInMainWorld('subcal', bridge);
