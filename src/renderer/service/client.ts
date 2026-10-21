import type { AppClient, PreviewController } from '../../shared/types';
import { ClientError, IpcSubCalClient, type IpcInvoker } from './IpcSubCalClient';

export { ClientError, IpcSubCalClient };
export type { AppClient };

function isDevEnvironment(): boolean {
  try {
    const metaEnv = (
      import.meta as unknown as { env?: { DEV?: boolean; MODE?: string; VITE_SUBCAL_MODE?: string } }
    )?.env;
    if (metaEnv?.DEV === true || metaEnv?.MODE === 'development') return true;
  } catch {
    /* ignore */
  }
  try {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function isPreviewMode(): boolean {
  if (typeof window !== 'undefined' && window.subcal?.mode === 'preview') {
    return true;
  }
  try {
    const metaEnv = (
      import.meta as unknown as { env?: Record<string, string | boolean | undefined> }
    )?.env;
    if (metaEnv?.VITE_SUBCAL_MODE === 'preview') return true;
  } catch {
    /* ignore */
  }
  try {
    if (typeof process !== 'undefined' && process.env?.SUBCAL_MODE === 'preview') {
      return true;
    }
  } catch {
    /* ignore */
  }
  // URL ?mode=preview is strictly restricted to explicit DEV environment, never packaged production.
  if (isDevEnvironment() && typeof window !== 'undefined') {
    try {
      if (new URLSearchParams(window.location.search).get('mode') === 'preview') {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

let cachedPreviewClient: Promise<AppClient> | null = null;

function loadPreviewClient(): Promise<AppClient> {
  if (!cachedPreviewClient) {
    cachedPreviewClient = import('./MockSubCalClient').then((mod) => mod.client);
  }
  return cachedPreviewClient;
}

function createLazyPreviewClient(): AppClient {
  const preview: PreviewController = {
    scenarios: async () => (await loadPreviewClient()).preview!.scenarios(),
    switchScenario: async (id) => (await loadPreviewClient()).preview!.switchScenario(id),
    resetScenario: async () => (await loadPreviewClient()).preview!.resetScenario(),
    advance: async (minutes) => (await loadPreviewClient()).preview!.advance(minutes),
    recoverOffline: async () => (await loadPreviewClient()).preview!.recoverOffline(),
    recoverStorage: async () => (await loadPreviewClient()).preview!.recoverStorage(),
  };

  return {
    snapshot: async () => (await loadPreviewClient()).snapshot(),
    subscribe: (listener) => {
      let unsub: (() => void) | null = null;
      let active = true;
      void loadPreviewClient().then((c) => {
        if (active) unsub = c.subscribe(listener);
      });
      return () => {
        active = false;
        unsub?.();
      };
    },
    create: async (input, key) => (await loadPreviewClient()).create(input, key),
    update: async (id, revision, patch) => (await loadPreviewClient()).update(id, revision, patch),
    archive: async (id, archived, removeFuture) =>
      (await loadPreviewClient()).archive(id, archived, removeFuture),
    remove: async (id, removeFuture) => (await loadPreviewClient()).remove(id, removeFuture),
    undo: async (token) => (await loadPreviewClient()).undo(token),
    reorder: async (ids) => (await loadPreviewClient()).reorder(ids),
    setPreferences: async (patch) => (await loadPreviewClient()).setPreferences(patch),
    resolveField: async (id, field, accept) =>
      (await loadPreviewClient()).resolveField(id, field, accept),
    refresh: async (id) => (await loadPreviewClient()).refresh(id),
    pause: async (id) => (await loadPreviewClient()).pause(id),
    disconnect: async (id, removeCredential) =>
      (await loadPreviewClient()).disconnect(id, removeCredential),
    probe: async (id, profile) => (await loadPreviewClient()).probe(id, profile),
    bind: async (probe) => (await loadPreviewClient()).bind(probe),
    diagnose: async (id) => (await loadPreviewClient()).diagnose(id),
    events: async (includeReset) => (await loadPreviewClient()).events(includeReset),
    previewSync: async (backend) => (await loadPreviewClient()).previewSync(backend),
    sync: async (previewId, failAfterWrite) =>
      (await loadPreviewClient()).sync(previewId, failAfterWrite),
    targetState: async (backend, state) => (await loadPreviewClient()).targetState(backend, state),
    resolveConflict: async (backend, eventId, choice) =>
      (await loadPreviewClient()).resolveConflict(backend, eventId, choice),
    simulateExternal: async (backend, eventId, kind) =>
      (await loadPreviewClient()).simulateExternal(backend, eventId, kind),
    exportData: async () => (await loadPreviewClient()).exportData(),
    exportRawStorage: async () => {
      const c = await loadPreviewClient();
      return c.exportRawStorage ? c.exportRawStorage() : '';
    },
    importPreview: async (text) => (await loadPreviewClient()).importPreview(text),
    importCommit: async (id, text) => (await loadPreviewClient()).importCommit(id, text),
    preview,
  };
}

export function createClient(
  mode: 'ipc' | 'preview' = isPreviewMode() ? 'preview' : 'ipc',
  customInvoker?: IpcInvoker,
): AppClient {
  if (mode === 'preview') {
    return createLazyPreviewClient();
  }
  return new IpcSubCalClient(customInvoker);
}

export const client: AppClient = createClient();
export const ipcClient = new IpcSubCalClient();
