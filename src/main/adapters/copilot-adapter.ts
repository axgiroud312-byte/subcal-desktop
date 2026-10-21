import { createHash } from 'node:crypto';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type NormalizedMetricObservation, type ProviderAdapter } from './types';
import { findRuntime } from './runtime';

export const COPILOT_MANIFEST: AdapterManifest = {
  id: 'copilot-local', version: '1.0.0', brand: 'GitHub', product: 'GitHub Copilot', region: '本机官方客户端',
  supportedFields: ['额度桶', '剩余百分比', '权益数与已用数', '重置时间（返回时）'], unsupportedFields: ['会员扣费日期'],
  authMode: 'local_client', officialSourceUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing',
  termsCheckedAt: '2026-10-21', allowedHosts: [], minIntervalSeconds: 300,
  defaultForegroundSeconds: 600, defaultBackgroundSeconds: 1800, timeoutMs: 30000,
  supportTier: 'official_auto', permissions: '通过官方 SDK 查询已登录账号的额度，不创建对话或发送提示词。',
  credentialLocation: '由本机官方客户端管理，不复制登录文件。',
};
type CopilotResponse = { auth: { isAuthenticated?: boolean; login?: string; host?: string }; quota: unknown; runtimeVersion?: string };
export type CopilotTransport = (input: CollectInput) => Promise<CopilotResponse>;

const officialTransport: CopilotTransport = async input => {
  if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
  const runtime = await findRuntime('copilot');
  if (!runtime) throw new AdapterError('RUNTIME_MISSING', '未找到官方 Copilot CLI，请安装并登录后重试');
  const { CopilotClient, RuntimeConnection } = await import('@github/copilot-sdk');
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  // Prefer the explicitly selected, logged-in official runtime over unrelated
  // tokens inherited from a development terminal.
  for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'COPILOT_GITHUB_TOKEN']) delete env[key];
  const client = new CopilotClient({
    connection: RuntimeConnection.forStdio({ path: runtime.path }),
    useLoggedInUser: true, logLevel: 'none', env, enableRemoteSessions: false,
    clientInfo: { applicationName: 'subcal-desktop', applicationVersion: '0.1.0' },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([
      (async () => {
        await client.start();
        const auth = await client.getAuthStatus();
        if (!auth.isAuthenticated) throw new AdapterError('AUTH_REQUIRED', '请先在官方 Copilot 客户端登录');
        // No session is created: these are server-scoped read methods only.
        const quota = await client.rpc.account.getQuota({});
        const after = await client.getAuthStatus();
        if (auth.login !== after.login || auth.host !== after.host) throw new AdapterError('ACCOUNT_MISMATCH', '查询期间账号发生变化，请重新连接');
        return { auth, quota, runtimeVersion: runtime.version };
      })(),
      new Promise<never>((_, reject) => {
        cancel = () => reject(new AdapterError('CANCELLED', '查询已取消'));
        input.signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => reject(new AdapterError('TIMEOUT', 'Copilot 查询超时')), input.timeoutMs ?? 30000);
      }),
    ]);
  } catch (e) {
    if (e instanceof AdapterError) throw e;
    const message = (e as Error).message || '';
    if (/unauth|login|401/i.test(message)) throw new AdapterError('AUTH_REQUIRED', 'Copilot 登录已失效，请在官方客户端重新登录');
    if (/403|forbidden/i.test(message)) throw new AdapterError('PERMISSION_DENIED', '当前 Copilot 账号无权查询额度');
    if (/429|rate.?limit/i.test(message)) throw new AdapterError('RATE_LIMITED', 'Copilot 查询被限流', { retryAfterMs: 300000 });
    if (/method.*not|unsupported|protocol|schema/i.test(message)) throw new AdapterError('SCHEMA_CHANGED', '当前 Copilot SDK 与运行时不兼容，请更新官方客户端');
    throw new AdapterError('UPSTREAM_UNAVAILABLE', 'Copilot 查询失败，请检查官方客户端与网络');
  } finally {
    clearTimeout(timer); if (cancel) input.signal?.removeEventListener('abort', cancel);
    await client.forceStop().catch(() => {});
  }
};

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export class CopilotLocalAdapter implements ProviderAdapter {
  readonly manifest = COPILOT_MANIFEST;
  constructor(private transport: CopilotTransport = officialTransport) {}
  async checkRuntime() { const r = await findRuntime('copilot'); return { available: !!r, version: r?.version, message: r ? `Copilot ${r.version}` : '请安装官方 Copilot CLI' }; }
  probe(input: CollectInput) { return this.collect(input); }
  async collect(input: CollectInput) {
    const out = this.normalize(await this.transport(input), new Date().toISOString());
    if (input.expectedSubject && input.reason !== 'probe' && input.expectedSubject !== out.account.subject) throw new AdapterError('ACCOUNT_MISMATCH', 'Copilot 账号已改变，请重新连接');
    return out;
  }
  normalize(raw: unknown, observedAt: string): CollectOutput {
    const response = record(raw), auth = record(response?.auth), quota = record(response?.quota), snapshots = record(quota?.quotaSnapshots);
    if (!auth?.isAuthenticated || typeof auth.login !== 'string' || !auth.login) throw new AdapterError('AUTH_REQUIRED', '无法确认 Copilot 登录身份');
    if (!snapshots) throw new AdapterError('SCHEMA_CHANGED', 'Copilot 未返回 quotaSnapshots');
    const subject = `copilot:${createHash('sha256').update(`${auth.host || 'github.com'}:${auth.login}`).digest('hex')}`;
    const metrics: NormalizedMetricObservation[] = [], partialFailures: CollectOutput['partialFailures'] = [];
    for (const [key, value] of Object.entries(snapshots)) {
      const q = record(value);
      if (!q) { partialFailures.push({ field: key, reason: '额度字段结构异常' }); continue; }
      const unlimited = q.entitlementRequests === -1 || q.isUnlimitedEntitlement === true;
      let resetAt: string | null = null;
      // A date without an offset is not an exact instant. Do not invent a countdown.
      if (typeof q.resetDate === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(q.resetDate) && Number.isFinite(Date.parse(q.resetDate))) resetAt = new Date(q.resetDate).toISOString();
      const base = { id: key, label: key, unit: '%', total: unlimited ? null : '100', resetAt, observedAt, source: '官方 Copilot SDK · account.getQuota', dataOrigin: 'local_client' as const, staleAfterMinutes: 30 };
      if (unlimited) metrics.push({ ...base, remaining: null, availability: 'unlimited', total: null });
      else if (finite(q.remainingPercentage)) metrics.push({ ...base, remaining: String(q.remainingPercentage), availability: 'known' });
      else partialFailures.push({ field: `${key}.remainingPercentage`, reason: '未返回有效剩余百分比' });
      // Keep actual entitlement/used quantities as a separate meter, including
      // zero. No old premium-only key or invented entitlement is hard-coded.
      if (finite(q.usedRequests) && finite(q.entitlementRequests) && q.entitlementRequests >= 0) {
        metrics.push({ ...base, id: `${key}:requests`, label: `${key} 剩余次数`, unit: '次', remaining: String(q.entitlementRequests - q.usedRequests), used: String(q.usedRequests), total: String(q.entitlementRequests), availability: 'known' });
      }
    }
    if (!metrics.length) throw new AdapterError('SCHEMA_CHANGED', 'Copilot 未返回可用额度字段');
    return { account: { subject, alias: `${auth.login.slice(0, 2)}***`, organization: '', region: String(auth.host || 'github.com') }, poolId: `pool-${subject}`, metrics, fields: [], partialFailures, observedAt,
      samples: metrics.map(m => `${m.label}：${m.availability === 'unlimited' ? '无限量' : `${m.remaining} ${m.unit}`}`), runtimeVersion: typeof response?.runtimeVersion === 'string' ? response.runtimeVersion : undefined };
  }
  describeRecovery(error: AdapterError) { return defaultDescribeRecovery(this.manifest, error); }
  async disconnect() {}
}
