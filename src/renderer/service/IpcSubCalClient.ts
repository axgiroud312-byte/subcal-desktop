import type {
  AuthSession,
  Backend,
  CalendarEvent,
  CalendarTarget,
  ImportPreview,
  Preferences,
  Probe,
  Snapshot,
  SubCalClient,
  SubscriptionInput,
  SyncPreview,
} from '../../shared/types';
import {
  IPC_PROTOCOL_VERSION,
  type IpcMethod,
  type IpcRequestEnvelope,
  type IpcResponseEnvelope,
} from '../../shared/bridge';

export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

export type IpcInvoker = <T = unknown>(
  request: IpcRequestEnvelope,
) => Promise<IpcResponseEnvelope<T>>;

function makeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class IpcSubCalClient implements SubCalClient {
  private listeners = new Set<() => void>();
  private unbindBridge: (() => void) | null = null;

  constructor(
    private customInvoker?: IpcInvoker,
    private customSubscribe?: (cb: () => void) => () => void,
  ) {}

  private ensureSubscribed(): void {
    if (this.unbindBridge) return;
    const sub =
      this.customSubscribe ??
      (typeof window !== 'undefined' && window.subcal?.onStateChanged
        ? (cb: () => void) => window.subcal.onStateChanged!(cb)
        : null);
    if (sub) {
      this.unbindBridge = sub(() => this.emit());
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async call<T>(
    method: IpcMethod,
    params: unknown = {},
    options?: { expectedRevision?: number; idempotencyKey?: string; mutate?: boolean },
  ): Promise<T> {
    const invoker: IpcInvoker | undefined =
      this.customInvoker ??
      (typeof window !== 'undefined' && typeof window.subcal?.invoke === 'function'
        ? (req) => window.subcal.invoke!(req)
        : undefined);

    if (!invoker) {
      throw new ClientError(
        'IPC_UNAVAILABLE',
        '本地服务不可用，请重新打开桌面应用',
      );
    }

    const requestId = makeRequestId();
    const request: IpcRequestEnvelope = {
      version: IPC_PROTOCOL_VERSION,
      requestId,
      method,
      params,
      ...(options?.expectedRevision !== undefined
        ? { expectedRevision: options.expectedRevision }
        : {}),
      idempotencyKey: options?.idempotencyKey ?? requestId,
    };

    const response = await invoker<T>(request);
    if (!response || response.version !== IPC_PROTOCOL_VERSION) {
      throw new ClientError('PROTOCOL_MISMATCH', '本地服务协议版本不匹配');
    }
    if (response.requestId !== requestId) {
      throw new ClientError('REQUEST_ID_MISMATCH', '本地服务响应 requestId 不匹配');
    }
    if (!response.ok) {
      throw new ClientError(
        response.error.code || 'IPC_ERROR',
        response.error.message || '本地服务调用失败',
        response.error.details,
      );
    }
    if (options?.mutate) {
      this.emit();
    }
    return response.result;
  }

  snapshot(): Promise<Snapshot> {
    return this.call<Snapshot>('subscriptions.snapshot', {});
  }

  subscribe(listener: () => void): () => void {
    this.ensureSubscribed();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  create(input: SubscriptionInput, key: string): Promise<string> {
    return this.call<string>(
      'subscriptions.create',
      { input },
      { idempotencyKey: key, mutate: true },
    );
  }

  update(id: string, revision: number, patch: Partial<SubscriptionInput>): Promise<void> {
    return this.call<void>(
      'subscriptions.update',
      { id, patch },
      { expectedRevision: revision, mutate: true },
    );
  }

  archive(id: string, archived: boolean, removeFuture: boolean): Promise<void> {
    return this.call<void>(
      'subscriptions.archive',
      { id, archived, removeFuture },
      { mutate: true },
    );
  }

  remove(id: string, removeFuture: boolean): Promise<string> {
    return this.call<string>(
      'subscriptions.remove',
      { id, removeFuture },
      { mutate: true },
    );
  }

  undo(token: string): Promise<void> {
    return this.call<void>('subscriptions.undo', { token }, { mutate: true });
  }

  reorder(ids: string[]): Promise<void> {
    return this.call<void>('subscriptions.reorder', { ids }, { mutate: true });
  }

  setPreferences(patch: Partial<Preferences>): Promise<void> {
    return this.call<void>('preferences.set', { patch }, { mutate: true });
  }

  resolveField(
    id: string,
    field: 'renewalDate' | 'price' | 'plan',
    accept: boolean,
  ): Promise<void> {
    return this.call<void>(
      'subscriptions.resolveField',
      { id, field, accept },
      { mutate: true },
    );
  }

  refresh(id?: string): Promise<string> {
    return this.call<string>('collections.refresh', { id }, { mutate: true });
  }

  pause(id?: string): Promise<void> {
    return this.call<void>('connections.pause', { id }, { mutate: true });
  }

  disconnect(id: string, removeCredential = false): Promise<void> {
    return this.call<void>(
      'connections.disconnect',
      { id, removeCredential },
      { mutate: true },
    );
  }

  discoverAccounts(): Promise<{ accounts: { id: string; providerId: string; alias: string; source: string; organization?: string }[]; warnings: string[] }> {
    return this.call('accounts.discover');
  }

  addAccount(input: { candidateId?: string; providerId?: string; secret?: string }): Promise<{ subscriptionId: string; connectionId: string }> {
    return this.call('accounts.add', input, { mutate: true });
  }

  startAccountLogin(providerId: string): Promise<{ id: string; userCode: string; verificationUri: string; intervalSeconds: number; expiresAt: number; instructions?:string; requiresCode?:boolean }> {
    return this.call('accounts.loginStart', { providerId });
  }
  cancelAccountLogin(id:string):Promise<void> { return this.call('accounts.loginCancel',{id}); }
  submitAccountLogin(id:string,code:string):Promise<void> { return this.call('accounts.loginSubmit',{id,code}); }

  async pollAccountLogin(id: string): Promise<{ status: 'pending' | 'complete' | 'expired'; subscriptionId?: string; connectionId?: string }> {
    const result = await this.call<{ status: 'pending' | 'complete' | 'expired'; subscriptionId?: string; connectionId?: string }>('accounts.loginPoll', { id });
    if (result.status === 'complete') this.emit();
    return result;
  }

  beginAuth(provider: string, subscriptionId?: string): Promise<AuthSession> {
    return this.call<AuthSession>(
      'connections.beginAuth',
      { provider, subscriptionId },
      { mutate: true },
    );
  }

  saveCredential(connectionId: string, secret: string): Promise<{ mask: string }> {
    return this.call<{ mask: string }>(
      'connections.saveCredential',
      { connectionId, secret },
      { mutate: true },
    );
  }

  deleteCredential(connectionId: string): Promise<void> {
    return this.call<void>(
      'connections.deleteCredential',
      { connectionId },
      { mutate: true },
    );
  }

  probe(id: string, profile = ''): Promise<Probe> {
    return this.call<Probe>('connections.probe', { id, profile });
  }

  bind(probe: Probe): Promise<void> {
    return this.call<void>('connections.bind', { probe }, { mutate: true });
  }

  diagnose(id?: string): Promise<string> {
    return this.call<string>('collections.diagnose', { id });
  }

  events(includeReset = false): Promise<CalendarEvent[]> {
    return this.call<CalendarEvent[]>('calendars.events', { includeReset });
  }

  previewSync(backend: Backend): Promise<SyncPreview> {
    return this.call<SyncPreview>('calendars.previewSync', { backend });
  }

  sync(previewId: string, failAfterWrite = false): Promise<void> {
    return this.call<void>(
      'calendars.sync',
      { previewId, failAfterWrite },
      { mutate: true },
    );
  }

  targetState(backend: Backend, state: CalendarTarget['state']): Promise<void> {
    return this.call<void>(
      'calendars.targetState',
      { backend, state },
      { mutate: true },
    );
  }

  resolveConflict(
    backend: Backend,
    eventId: string,
    choice: 'local' | 'remote' | 'unlink',
  ): Promise<void> {
    return this.call<void>(
      'calendars.resolveConflict',
      { backend, eventId, choice },
      { mutate: true },
    );
  }

  simulateExternal(
    backend: Backend,
    eventId: string,
    kind: 'move' | 'delete',
  ): Promise<void> {
    return this.call<void>(
      'calendars.simulateExternal',
      { backend, eventId, kind },
      { mutate: true },
    );
  }

  exportData(): Promise<string> {
    return this.call<string>('data.export', {});
  }

  importPreview(text: string): Promise<ImportPreview> {
    return this.call<ImportPreview>('data.importPreview', { text });
  }

  importCommit(id: string, text: string): Promise<void> {
    return this.call<void>('data.importCommit', { id, text }, { mutate: true });
  }
}
