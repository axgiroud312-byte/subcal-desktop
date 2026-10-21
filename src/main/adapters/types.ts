import type { Availability, ConnectionState } from '../../shared/types';

export type AdapterErrorCode =
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'NETWORK_OFFLINE'
  | 'TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'SCHEMA_CHANGED'
  | 'UNSUPPORTED'
  | 'RUNTIME_MISSING'
  | 'ACCOUNT_MISMATCH'
  | 'CANCELLED'
  | 'PARTIAL';

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    public readonly options?: {
      retryAfterMs?: number;
      httpStatus?: number;
    },
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export interface AdapterManifest {
  id: 'codex-local' | 'copilot-local' | 'claude-local' | 'deepseek-balance' | 'kimi-platform-cn' | 'openrouter-key' | 'openrouter-credits';
  version: string;
  brand: string;
  product: string;
  region: string;
  supportedFields: string[];
  unsupportedFields: string[];
  authMode: 'api_key' | 'local_client';
  officialSourceUrl: string;
  termsCheckedAt: string;
  allowedHosts: string[];
  minIntervalSeconds: number;
  defaultForegroundSeconds: number;
  defaultBackgroundSeconds: number;
  timeoutMs: number;
  supportTier: 'official_auto';
  permissions: string;
  credentialLocation: string;
}

export interface NormalizedMetricObservation {
  id: string;
  label: string;
  unit: string;
  remaining: string | null;
  used?: string | null;
  total: string | null;
  resetAt: string | null;
  observedAt: string;
  availability: Availability;
  source: string;
  dataOrigin: 'official_api' | 'local_client';
  staleAfterMinutes: number;
}

export interface NormalizedFieldObservation {
  field: 'plan' | 'price' | 'renewalDate';
  value: string | null;
  availability: Availability;
  source: string;
  observedAt: string;
  dataOrigin: 'official_api' | 'local_client';
}

export interface CollectInput {
  connectionId: string;
  generation: number;
  reason: 'probe' | 'manual' | 'scheduled' | 'resume' | 'near_reset';
  secret?: string | null;
  expectedSubject?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CollectOutput {
  account: {
    subject: string;
    alias: string;
    organization: string;
    region: string;
  };
  poolId: string;
  metrics: NormalizedMetricObservation[];
  fields: NormalizedFieldObservation[];
  partialFailures: { field: string; reason: string }[];
  samples: string[];
  observedAt: string;
  providerAt?: string | null;
  suggestedNextAt?: string | null;
  runtimeVersion?: string;
}

export interface RecoveryDescriptor {
  state: ConnectionState;
  code: AdapterErrorCode;
  message: string;
  action: string;
  retryAfterMs?: number;
}

export interface ProviderAdapter {
  readonly manifest: AdapterManifest;
  checkRuntime?(): Promise<{ available: boolean; version?: string; message: string }>;
  probe(input: CollectInput): Promise<CollectOutput>;
  collect(input: CollectInput): Promise<CollectOutput>;
  normalize(raw: unknown, observedAt: string, context?: { mask?: string }): CollectOutput;
  describeRecovery(error: AdapterError): RecoveryDescriptor;
  disconnect(): Promise<void>;
}

export function defaultDescribeRecovery(
  manifest: AdapterManifest,
  error: AdapterError,
): RecoveryDescriptor {
  switch (error.code) {
    case 'AUTH_REQUIRED':
      return {
        state: 'auth',
        code: 'AUTH_REQUIRED',
        message: error.message || '认证凭据已失效或未授权，旧额度快照已保留',
        action: manifest.authMode === 'api_key' ? '填写有效 API Key' : manifest.id==='claude-local'?'在 Claude Code 中重新登录':'重新登录或选择本机已登录账号',
      };
    case 'PERMISSION_DENIED':
      return {
        state: 'denied',
        code: 'PERMISSION_DENIED',
        message: error.message || '当前凭据或账号无读取权限',
        action: '检查账号权限或更换凭据',
      };
    case 'RATE_LIMITED':
      return {
        state: 'rate_limited',
        code: 'RATE_LIMITED',
        message: error.message || '请求触发供应商限流，已按退避时间暂停重试',
        action: '等待退避窗口结束后重试',
        retryAfterMs: error.options?.retryAfterMs ?? manifest.minIntervalSeconds * 1000,
      };
    case 'NETWORK_OFFLINE':
      return {
        state: 'offline',
        code: 'NETWORK_OFFLINE',
        message: error.message || '网络连接不可用，已保留最后已知观察值',
        action: '恢复联网后自动合并补查一次',
      };
    case 'RUNTIME_MISSING':
      return {
        state: 'runtime_missing',
        code: 'RUNTIME_MISSING',
        message: error.message || `未检测到本机 ${manifest.product} 官方运行时`,
        action: '安装官方客户端并完成登录后重试',
      };
    case 'SCHEMA_CHANGED':
      return {
        state: 'schema_changed',
        code: 'SCHEMA_CHANGED',
        message: error.message || '上游返回数据结构已变化，已保留历史观察值',
        action: '等待适配器更新或临时手动记录',
      };
    case 'ACCOUNT_MISMATCH':
      return {
        state: 'auth',
        code: 'ACCOUNT_MISMATCH',
        message: error.message || '登录账号已改变，已暂停更新以防串号',
        action: '重新连接并确认账号',
      };
    case 'TIMEOUT':
    case 'UPSTREAM_UNAVAILABLE':
      return {
        state: 'ready',
        code: error.code,
        message: error.message || '上游服务暂时超时或不可用，将按退避策略重试',
        action: '稍后重试',
      };
    case 'CANCELLED':
      return {
        state: 'ready',
        code: 'CANCELLED',
        message: error.message || '采集请求已取消，保留原快照',
        action: '按需重新刷新',
      };
    default:
      return {
        state: 'ready',
        code: error.code,
        message: error.message || '采集出现异常，旧值已保留',
        action: '查看脱敏诊断或重试',
      };
  }
}
