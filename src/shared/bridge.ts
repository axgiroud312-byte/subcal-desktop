export interface TraySummary {
  nextRenewal: string;
  pinned: string[];
  reconnectCount: number;
  paused: boolean;
  closeToTray: boolean;
}

export const IPC_PROTOCOL_VERSION = 1 as const;

export const ALLOWED_IPC_METHODS = [
  'subscriptions.snapshot',
  'subscriptions.create',
  'subscriptions.update',
  'subscriptions.archive',
  'subscriptions.remove',
  'subscriptions.undo',
  'subscriptions.reorder',
  'subscriptions.resolveField',
  'preferences.set',
  'connections.beginAuth',
  'connections.saveCredential',
  'connections.deleteCredential',
  'connections.probe',
  'connections.bind',
  'connections.pause',
  'connections.disconnect',
  'collections.refresh',
  'collections.diagnose',
  'calendars.events',
  'calendars.previewSync',
  'calendars.sync',
  'calendars.targetState',
  'calendars.resolveConflict',
  'calendars.simulateExternal',
  'data.export',
  'data.importPreview',
  'data.importCommit',
] as const;

export type IpcMethod = (typeof ALLOWED_IPC_METHODS)[number];

export interface IpcRequestEnvelope<M extends IpcMethod = IpcMethod> {
  version: typeof IPC_PROTOCOL_VERSION;
  requestId: string;
  method: M;
  params: unknown;
  expectedRevision?: number;
  idempotencyKey?: string;
}

export interface IpcErrorPayload {
  code: string;
  message: string;
  details?: Record<string, string>;
}

export type IpcResponseEnvelope<T = unknown> =
  | { version: typeof IPC_PROTOCOL_VERSION; requestId: string; ok: true; result: T }
  | { version: typeof IPC_PROTOCOL_VERSION; requestId: string; ok: false; error: IpcErrorPayload };

export interface DesktopBridge {
  platform: string;
  mode?: 'ipc' | 'preview';
  openExternal(url: string): Promise<void>;
  saveFile(name: string, contents: string): Promise<{ saved: boolean; path?: string }>;
  openFile(): Promise<{ name: string; contents: string; selectionId: string } | null>;
  readSelectedFile(selectionId: string): Promise<string>;
  updateTray(summary: TraySummary): Promise<void>;
  onAction(callback: (action: 'refresh' | 'toggle-pause' | 'settings') => void): () => void;
  onStateChanged?(callback: () => void): () => void;
  invoke?<T = unknown>(request: IpcRequestEnvelope): Promise<IpcResponseEnvelope<T>>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    subcal: DesktopBridge;
  }
}
