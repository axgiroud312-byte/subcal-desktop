import { SERVICE_ACCESS, EXISTING_LOGIN_SERVICES } from './service-access';
export type Availability = 'known' | 'unfetched' | 'unsupported' | 'na' | 'denied' | 'unlimited';
export type DataOrigin =
  | 'demo'
  | 'manual'
  | 'official_api'
  | 'local_client'
  | 'calendar'
  | 'imported'
  | 'computed';
export type Field<T> = {
  value: T | null;
  availability: Availability;
  source: string;
  observedAt: string | null;
  dataOrigin: DataOrigin;
  locked?: boolean;
  proposed?: T;
  evidence?: EvidenceKind;
  providerAt?: string | null;
};
export type EvidenceKind = 'reported' | 'derived' | 'configured' | 'cached';
/** Civil dates carry no invented time or timezone; instants require an offset. */
export type EntitlementDate = { precision: 'day'; value: string } | { precision: 'instant'; value: string };
export type Entitlements = {
  membershipExpiresAt?: Field<EntitlementDate>;
  billingPeriodEnd?: Field<EntitlementDate>;
  nextBillingStart?: Field<EntitlementDate>;
  autoRenew?: Field<boolean>;
  listPrice?: Field<string>;
  listPriceCurrency?: string;
};
export type Balance = {
  id: string;
  label: string;
  scope: 'account' | 'key';
  kind: 'total' | 'cash' | 'grant' | 'credit' | 'budget' | 'usage';
  currency: string;
  amount: Field<string>;
  expiresAt?: Field<EntitlementDate>;
  poolId?: string;
};
export type Cycle = 'monthly' | 'yearly' | 'days' | 'once' | 'irregular' | 'none';
export type Lifecycle = 'active' | 'trial' | 'ending' | 'expired' | 'cancelled' | 'pending' | 'archived';
export type Metric = {
  id: string;
  label: string;
  unit: string;
  remaining: Field<string>;
  total: string | null;
  resetAt: string | null;
  staleAfterMinutes: number;
  used?: Field<string>;
  totalObservation?: Field<string>;
  resetObservation?: Field<EntitlementDate>;
  windowStart?: Field<EntitlementDate>;
  windowEnd?: Field<EntitlementDate>;
  windowMinutes?: number;
  scope?: 'account' | 'key' | 'organization' | 'model' | 'seat';
  models?: string[];
  poolId?: string;
  evidence?: EvidenceKind;
};
export type Subscription = {
  id: string;
  revision: number;
  product: string;
  brand: string;
  kind: 'window' | 'wallet' | 'manual';
  account: string;
  region: string;
  organization: string;
  plan: Field<string>;
  price: Field<string>;
  currency: string;
  cycle: Cycle;
  intervalDays: number;
  anchorDate: string | null;
  timezone: string;
  startDate: Field<string>;
  renewalDate: Field<string>;
  paidThrough: Field<string>;
  trialEnd: Field<string>;
  lifecycle: Lifecycle;
  autoRenew: 'on' | 'off' | 'unknown';
  billingGroupId: string | null;
  quotaPoolId: string | null;
  possibleSharedWallet: boolean;
  metrics: Metric[];
  entitlements?: Entitlements;
  balances?: Balance[];
  management?: 'automatic' | 'manual';
  /** Authentication lifetime only; never a membership/calendar event. */
  credentialExpiresAt?: Field<EntitlementDate>;
  connectionId: string | null;
  website: string;
  reminder: 'none' | 'local' | 'external';
  pinned: boolean;
  notes: string;
  scheduleOverrides?: Record<string, string>;
  archivedFrom?: Exclude<Lifecycle, 'archived'>;
  history: { at: string; text: string; dataOrigin: DataOrigin }[];
};
export type ConnectionState =
  | 'ready'
  | 'refreshing'
  | 'partial'
  | 'auth'
  | 'denied'
  | 'rate_limited'
  | 'offline'
  | 'runtime_missing'
  | 'schema_changed'
  | 'paused'
  | 'disconnected';
export type Connection = {
  id: string;
  provider: string;
  account: string;
  region: string;
  state: ConnectionState;
  generation: number;
  fields: string[];
  unsupported: string[];
  version: string;
  lastAttempt: string | null;
  lastSuccess: string | null;
  nextAllowed: string | null;
  error: { code: string; message: string; action: string } | null;
  runs: number;
  credentialMask?: string;
  verification?: 'pending' | 'verified';
  adapterId?: string;
};
export type AuthSession = {
  connectionId: string;
  fields: string[];
  unsupported: string[];
  permissions: string;
  credentialLocation: string;
  authMode: 'api_key' | 'local_client';
  runtimeStatus?: string;
  verification?: 'pending' | 'verified';
};
export type EventKind = 'renewal' | 'start' | 'expiry' | 'trial' | 'reset';
export type CalendarEvent = {
  id: string;
  subscriptionId: string;
  product: string;
  account: string;
  kind: EventKind;
  date: string;
  instant?: string;
  precision?: 'day' | 'instant';
  dateSemantic?: 'membership_expiry' | 'quota_reset' | 'billing_renewal' | 'start' | 'trial';
  timezone: string;
  expected: boolean;
  source: string;
  revision: number;
  dataOrigin: DataOrigin;
};
export type Backend = 'google' | 'eventkit' | 'icloud-caldav';
export type RemoteEvent = CalendarEvent & {
  managed: boolean;
  baselineDate: string;
  suppressed: boolean;
  deleted: boolean;
};
export type CalendarTarget = {
  id: Backend;
  name: string;
  account: string;
  location: string;
  state: 'ready' | 'paused' | 'readonly' | 'missing' | 'auth';
  stage: 'idle' | 'queued' | 'written' | 'verified' | 'failed';
  revision: number;
  remote: RemoteEvent[];
  message: string;
};
export type SyncChange = {
  action: 'add' | 'update' | 'remove' | 'conflict' | 'suppressed';
  event: CalendarEvent;
  remote?: RemoteEvent;
};
export type SyncPreview = {
  id: string;
  backend: Backend;
  revision: number;
  changes: SyncChange[];
};
export type Preferences = {
  theme: 'light' | 'dark' | 'system';
  density: 'comfortable' | 'compact';
  quotaView: 'remaining' | 'used';
  timezone: string;
  reducedMotion: boolean;
  closeToTray: boolean;
  reminder: 'none' | 'local' | 'external';
  dndStart?: string;
  dndEnd?: string;
  notificationsMuted?: boolean;
  walletThresholds: Record<string, string>;
  order: string[];
};
export const scenarioIds = [
  'empty_first_run',
  'normal_mixed',
  'multi_account_shared',
  'unknown_and_na',
  'zero_vs_unfetched',
  'stale_and_past_reset',
  'partial_success',
  'auth_and_locked_fields',
  'rate_limited',
  'offline_recovery',
  'date_boundaries',
  'calendar_conflicts',
] as const;
export type ScenarioId = (typeof scenarioIds)[number];
export type Space = {
  revision: number;
  now: string;
  subscriptions: Subscription[];
  connections: Connection[];
  targets: CalendarTarget[];
  offline: boolean;
};
export type Snapshot = Space & {
  scenario: ScenarioId;
  preferences: Preferences;
  storageError: string | null;
};
export type Store = {
  schemaVersion: 1;
  active: ScenarioId;
  spaces: Partial<Record<ScenarioId, Space>>;
  preferences: Preferences;
  counter: number;
};
export type SubscriptionInput = Omit<Subscription, 'id' | 'revision' | 'history'>;
export type ImportPreview = {
  id: string;
  count: number;
  currentCount: number;
  added: number;
  overwritten: number;
  removed: number;
  scenario: ScenarioId;
  text: string;
};
export type Probe = {
  id: string;
  connectionId: string;
  generation: number;
  account: string;
  fields: string[];
  samples: string[];
};
export type AdapterSupportTier = 'official_auto' | 'official_next' | 'experimental' | 'manual';
export type AdapterCatalogEntry = {
  adapterId: string;
  provider: string;
  brand: string;
  region: string;
  authMode: 'api_key' | 'local_client';
  supportTier: AdapterSupportTier;
  verification: 'pending' | 'verified';
  version: string;
  endpointSummary: string;
  minIntervalSeconds: number;
  defaultForegroundSeconds: number;
  defaultBackgroundSeconds: number;
  fields: string[];
  unsupported: string[];
  permissions: string;
  credentialLocation: string;
};
export interface SubCalClient {
  discoverAccounts?(): Promise<{accounts:{id:string;providerId:string;alias:string;source:string;organization?:string}[];warnings:string[]}>;
  addAccount?(input:{candidateId?:string;providerId?:string;secret?:string}):Promise<{subscriptionId:string;connectionId:string}>;
  startAccountLogin?(providerId:string):Promise<{id:string;userCode:string;verificationUri:string;intervalSeconds:number;expiresAt:number}>;
  pollAccountLogin?(id:string):Promise<{status:'pending'|'complete'|'expired';subscriptionId?:string;connectionId?:string}>;
  snapshot(): Promise<Snapshot>;
  subscribe(listener: () => void): () => void;
  create(input: SubscriptionInput, key: string): Promise<string>;
  update(id: string, revision: number, patch: Partial<SubscriptionInput>): Promise<void>;
  archive(id: string, archived: boolean, removeFuture: boolean): Promise<void>;
  remove(id: string, removeFuture: boolean): Promise<string>;
  undo(token: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
  setPreferences(patch: Partial<Preferences>): Promise<void>;
  resolveField(id: string, field: 'renewalDate' | 'price' | 'plan', accept: boolean): Promise<void>;
  refresh(id?: string): Promise<string>;
  pause(id?: string): Promise<void>;
  disconnect(id: string, removeCredential?: boolean): Promise<void>;
  beginAuth?(provider: string, subscriptionId?: string): Promise<AuthSession>;
  saveCredential?(connectionId: string, secret: string): Promise<{ mask: string }>;
  deleteCredential?(connectionId: string): Promise<void>;
  probe(id: string, profile: string): Promise<Probe>;
  bind(probe: Probe): Promise<void>;
  diagnose(id?: string): Promise<string>;
  events(includeReset?: boolean): Promise<CalendarEvent[]>;
  previewSync(backend: Backend): Promise<SyncPreview>;
  sync(previewId: string, failAfterWrite?: boolean): Promise<void>;
  targetState(backend: Backend, state: CalendarTarget['state']): Promise<void>;
  resolveConflict(backend: Backend, eventId: string, choice: 'local' | 'remote' | 'unlink'): Promise<void>;
  simulateExternal(backend: Backend, eventId: string, kind: 'move' | 'delete'): Promise<void>;
  exportData(): Promise<string>;
  importPreview(text: string): Promise<ImportPreview>;
  importCommit(id: string, text: string): Promise<void>;
}
export interface PreviewController {
  scenarios(): Promise<{ id: ScenarioId; name: string }[]>;
  switchScenario(id: ScenarioId): Promise<void>;
  resetScenario(): Promise<void>;
  advance(minutes: number): Promise<void>;
  recoverOffline(): Promise<void>;
  recoverStorage(): Promise<void>;
}
export type AppClient = SubCalClient & {
  preview?: PreviewController;
  exportRawStorage?: () => Promise<string>;
};

export const OFFICIAL_ADAPTER_CATALOG: readonly AdapterCatalogEntry[] = [
  ...[...SERVICE_ACCESS, ...EXISTING_LOGIN_SERVICES].map(service => ({
    adapterId: service.id, provider: service.name, brand: service.name, region: '按账号来源隔离',
    authMode: service.mode === 'api_key' ? 'api_key' as const : 'local_client' as const,
    supportTier: 'official_auto' as const, verification: 'pending' as const, version: '1.0.0',
    endpointSummary: '仅查询已核对的供应商权益接口，不执行模型或签到', minIntervalSeconds: 300,
    defaultForegroundSeconds: 600, defaultBackgroundSeconds: 1800,
    fields: ['供应商实际提供的套餐、额度窗口或余额'], unsupported: ['未返回的会员日期保持未知'],
    permissions: '只读取权益，不调用模型、签到、领取或购买。',
    credentialLocation: '系统加密保存；外部登录只读跟随，不接管原客户端刷新。',
  })),
  {
    adapterId: 'codex-local',
    provider: 'Codex',
    brand: 'OpenAI',
    region: '本机官方客户端',
    authMode: 'local_client',
    supportTier: 'official_auto',
    verification: 'pending',
    version: '1.0.0',
    endpointSummary: 'GET https://chatgpt.com/backend-api/wham/usage',
    minIntervalSeconds: 60,
    defaultForegroundSeconds: 300,
    defaultBackgroundSeconds: 900,
    fields: ['额度桶（动态识别）', '剩余/已用百分比', '窗口长度（分钟）', '重置时间'],
    unsupported: ['ChatGPT 全功能消费者聊天总额度', '会员真实扣费日期与账单历史'],
    permissions: '只查询套餐与额度，不创建对话。',
    credentialLocation: '跟随本机登录，或使用本应用授权；凭据由系统加密保护。',
  },
  {
    adapterId:'claude-local',provider:'Claude Code',brand:'Anthropic',region:'api.anthropic.com',authMode:'local_client',supportTier:'official_auto',verification:'pending',version:'2.0.0',
    endpointSummary:'GET https://api.anthropic.com/api/oauth/usage',minIntervalSeconds:300,defaultForegroundSeconds:600,defaultBackgroundSeconds:1800,
    fields:['额度窗口','重置时间','额外用量'],unsupported:['真实账单金额与续费日'],permissions:'只查询权益，不创建对话。',credentialLocation:'跟随 Claude Code 本机登录；凭据由系统加密保护。',
  },
  {
    adapterId: 'copilot-local',
    provider: 'GitHub Copilot',
    brand: 'GitHub',
    region: '本机官方运行时',
    authMode: 'local_client',
    supportTier: 'official_auto',
    verification: 'pending',
    version: '1.0.0',
    endpointSummary: 'GET https://api.github.com/copilot_internal/user',
    minIntervalSeconds: 300,
    defaultForegroundSeconds: 600,
    defaultBackgroundSeconds: 1800,
    fields: ['quotaSnapshots（全键遍历）', '剩余百分比/次数', '无限量标记', 'resetDate（返回时）'],
    unsupported: ['个人或组织会员真实扣费日期', '历史账单发票明细'],
    permissions: '只查询套餐与额度，不发起补全或聊天请求。',
    credentialLocation: '区分编辑器与 CLI 登录，或通过 GitHub 授权；凭据由系统加密保护。',
  },
  {
    adapterId: 'deepseek-balance',
    provider: 'DeepSeek API',
    brand: 'DeepSeek',
    region: 'api.deepseek.com',
    authMode: 'api_key',
    supportTier: 'official_auto',
    verification: 'pending',
    version: '1.0.0',
    endpointSummary: 'GET https://api.deepseek.com/user/balance',
    minIntervalSeconds: 300,
    defaultForegroundSeconds: 1800,
    defaultBackgroundSeconds: 1800,
    fields: ['可用总余额（total_balance）', '充值余额（topped_up_balance）', '赠送余额（granted_balance）', '币种（CNY/USD）'],
    unsupported: ['消费者会员周期与自动续费日期'],
    permissions: '仅向 api.deepseek.com 发起 GET /user/balance 只读请求（注意：平台 API Key 本身可能具备模型调用权限，SubCal 承诺仅用于余额查询）。',
    credentialLocation: '经系统凭据保护（Electron safeStorage / Windows DPAPI / macOS Keychain）加密后保存在本机，数据库仅存引用 ID，不回显明文。',
  },
  {
    adapterId: 'kimi-platform-cn',
    provider: 'Kimi API',
    brand: 'Kimi',
    region: '中国大陆（api.moonshot.cn）',
    authMode: 'api_key',
    supportTier: 'official_auto',
    verification: 'pending',
    version: '1.0.0',
    endpointSummary: 'GET https://api.moonshot.cn/v1/users/me/balance',
    minIntervalSeconds: 300,
    defaultForegroundSeconds: 1800,
    defaultBackgroundSeconds: 1800,
    fields: ['可用余额（available_balance）', '现金余额（cash_balance）', '代金券余额（voucher_balance）'],
    unsupported: ['Kimi Code 会员额度窗口', '国际站钱包（不跨区重试）', '会员续费日期'],
    permissions: '仅向 api.moonshot.cn 发起 GET /v1/users/me/balance 只读请求，不跨区发送凭据。',
    credentialLocation: '经系统凭据保护（Electron safeStorage）加密后保存在本机，数据库仅存引用 ID，不回显明文。',
  },
  {
    adapterId: 'openrouter-key',
    provider: 'OpenRouter',
    brand: 'OpenRouter',
    region: 'openrouter.ai',
    authMode: 'api_key',
    supportTier: 'official_auto',
    verification: 'pending',
    version: '1.0.0',
    endpointSummary: 'GET https://openrouter.ai/api/v1/credits 与 /api/v1/key',
    minIntervalSeconds: 300,
    defaultForegroundSeconds: 1800,
    defaultBackgroundSeconds: 1800,
    fields: ['当前 Key 剩余预算（limit_remaining）', 'Key 限额（limit）', '当前用量（usage）', '重置规则（limit_reset）'],
    unsupported: ['订阅扣费日期'],
    permissions: '分别查询账户余额和 Key 预算；无权读取的项目保留未知状态。',
    credentialLocation: '经系统凭据保护（Electron safeStorage）加密后保存在本机，数据库仅存引用 ID，不回显明文。',
  },
] as const;
