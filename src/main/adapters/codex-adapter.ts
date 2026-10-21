import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import readline from 'node:readline';
import { findRuntime, terminateProcessTree, type LocalRuntime } from './runtime';
import {
  AdapterError,
  defaultDescribeRecovery,
  type AdapterManifest,
  type CollectInput,
  type CollectOutput,
  type NormalizedFieldObservation,
  type NormalizedMetricObservation,
  type ProviderAdapter,
} from './types';


const ALLOWED_CODEX_RPC_METHODS = new Set([
  'initialize',
  'initialized',
  'account/read',
  'account/rateLimits/read',
]);

export interface CodexRpcSessionResult {
  runtimeVersion?: string;
  accountRead: unknown;
  rateLimitsRead: unknown;
}

export type CodexRpcTransport = (options: {
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<CodexRpcSessionResult>;

export const CODEX_MANIFEST: AdapterManifest = {
  id: 'codex-local',
  version: '1.0.0',
  brand: 'OpenAI',
  product: 'Codex',
  region: '本机官方客户端',
  supportedFields: ['额度桶（动态识别）', '剩余/已用百分比', '窗口时长（分钟）', '重置时间', '套餐类型（返回时）'],
  unsupportedFields: ['消费者聊天总额度', '会员真实扣费日期'],
  authMode: 'local_client',
  officialSourceUrl: 'https://learn.chatgpt.com/docs/app-server#rate-limits-chatgpt',
  termsCheckedAt: '2026-10-20',
  allowedHosts: [],
  minIntervalSeconds: 60,
  defaultForegroundSeconds: 300,
  defaultBackgroundSeconds: 900,
  timeoutMs: 30000,
  supportTier: 'official_auto',
  permissions:
    '仅调用本机官方 Codex App Server 的 initialize、account/read 与 account/rateLimits/read 只读方法；禁止创建会话、发送提示词或消耗重置积分。',
  credentialLocation:
    '登录状态由本机官方 Codex 客户端维护；SubCal 不读取私有数据库，也不复制或导出认证文件。',
};

function maskAccountEmail(raw: string): string {
  const trimmed = raw.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0) return trimmed.slice(0, 3) + '***';
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const safeLocal =
    local.length <= 2 ? `${local[0] ?? '*'}*` : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

function formatWindowDurationLabel(
  mins: number | null | undefined,
  bucketLabel: string,
  slot: string,
  multiBucket: boolean,
): string {
  const prefix = multiBucket && bucketLabel ? `${bucketLabel} · ` : '';
  if (typeof mins === 'number' && Number.isFinite(mins) && mins > 0) {
    if (mins === 300) return `${prefix}5 小时额度`;
    if (mins === 10080) return `${prefix}每周额度`;
    if (mins === 1440) return `${prefix}每日额度`;
    if (mins % 1440 === 0) return `${prefix}${mins / 1440} 天额度`;
    if (mins % 60 === 0) return `${prefix}${mins / 60} 小时额度`;
    return `${prefix}${mins} 分钟额度`;
  }
  return `${prefix}${slot === 'primary' ? '主窗口额度' : slot === 'secondary' ? '次窗口额度' : `${slot} 额度`}`;
}

export async function detectCodexRuntimeVersion(): Promise<{
  available: boolean;
  version?: string;
  binary?: string;
  runtime?: LocalRuntime;
  message: string;
}> {
  const runtime = await findRuntime('codex');
  if (runtime) return { available: true, version: runtime.version, binary: runtime.path, runtime, message: `Codex ${runtime.version}` };
  return {
    available: false,
    message: '未在本机 PATH 中检测到官方 codex 客户端可执行文件',
  };
}

export const defaultCodexTransport: CodexRpcTransport = async ({ timeoutMs, signal }) => {
  if (signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
  const runtime = await detectCodexRuntimeVersion();
  if (signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
  if (!runtime.available || !runtime.runtime) {
    throw new AdapterError(
      'RUNTIME_MISSING',
      '未检测到本机官方 Codex 客户端（codex），请先安装官方客户端并完成登录',
    );
  }

  return new Promise<CodexRpcSessionResult>((resolve, reject) => {
    const child = spawn(runtime.runtime!.command, [...runtime.runtime!.args, 'app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });

    let settled = false;
    const cleanup = () => {
      try {
        if (!child.killed) {
          terminateProcessTree(child);
        }
      } catch {
        /* ignore */
      }
    };

    const finishReject = (err: AdapterError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      rl.close();
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      finishReject(
        new AdapterError('TIMEOUT', `Codex App Server 响应超时（>${timeoutMs}ms），已回收子进程`),
      );
    }, timeoutMs);

    const onAbort = () => {
      finishReject(new AdapterError('CANCELLED', 'Codex 采集已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const sendRpc = (msg: { method: string; id?: number; params?: Record<string, unknown> }) => {
      if (settled) return;
      if (!ALLOWED_CODEX_RPC_METHODS.has(msg.method)) {
        throw new AdapterError('UNSUPPORTED', `禁止调用非只读 Codex 方法: ${msg.method}`);
      }
      child.stdin.write(`${JSON.stringify(msg)}\n`, error => { if (error) finishReject(new AdapterError('UPSTREAM_UNAVAILABLE', 'Codex 连接已关闭')); });
    };

    let accountRead: unknown = null;
    let rateLimitsRead: unknown = null;

    const rl = readline.createInterface({ input: child.stdout });
    child.stderr.resume();
    child.stdin.on('error', () => finishReject(new AdapterError('UPSTREAM_UNAVAILABLE', 'Codex 连接已关闭')));
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg.id === 1) {
        if (msg.error) {
          finishReject(new AdapterError('UPSTREAM_UNAVAILABLE', 'Codex App Server 初始化失败'));
          return;
        }
        sendRpc({ method: 'initialized', params: {} });
        sendRpc({ method: 'account/read', id: 2, params: { refreshToken: false } });
      } else if (msg.id === 2) {
        if (msg.error) {
          finishReject(new AdapterError('AUTH_REQUIRED', 'Codex 账户状态读取失败，请重新登录'));
          return;
        }
        accountRead = msg.result;
        sendRpc({ method: 'account/rateLimits/read', id: 3, params: {} });
      } else if (msg.id === 3) {
        if (msg.error) {
          const errObj = msg.error as { message?: string; code?: number };
          const errText = String(errObj?.message || '');
          if (/auth|login|unauth/i.test(errText)) {
            finishReject(
              new AdapterError('AUTH_REQUIRED', 'Codex 需要登录 ChatGPT 账号以读取额度窗口'),
            );
          } else {
            finishReject(
              new AdapterError('UPSTREAM_UNAVAILABLE', 'Codex 额度读取失败，请检查官方客户端与网络'),
            );
          }
          return;
        }
        rateLimitsRead = msg.result;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          rl.close();
          cleanup();
          resolve({
            runtimeVersion: runtime.version,
            accountRead,
            rateLimitsRead,
          });
        }
      }
    });

    child.on('error', () => {
      finishReject(
        new AdapterError('RUNTIME_MISSING', '无法启动本机 Codex App Server，请检查官方客户端安装'),
      );
    });

    child.on('exit', (code) => {
      if (!settled) {
        finishReject(
          new AdapterError(
            'UPSTREAM_UNAVAILABLE',
            `Codex App Server 提前退出（code=${code ?? 'null'}）`,
          ),
        );
      }
    });

    try {
      sendRpc({
        method: 'initialize',
        id: 1,
        params: {
          clientInfo: {
            name: 'subcal_desktop',
            title: 'SubCal Desktop',
            version: '0.1.0',
          },
        },
      });
    } catch (err) {
      finishReject(
        err instanceof AdapterError
          ? err
          : new AdapterError('UPSTREAM_UNAVAILABLE', 'Codex 初始化请求发送失败'),
      );
    }
  });
};

export class CodexLocalAdapter implements ProviderAdapter {
  public readonly manifest = CODEX_MANIFEST;

  constructor(private readonly transport: CodexRpcTransport = defaultCodexTransport) {}

  public async checkRuntime() {
    return detectCodexRuntimeVersion();
  }

  public async probe(input: CollectInput): Promise<CollectOutput> {
    return this.collect(input);
  }

  public async collect(input: CollectInput): Promise<CollectOutput> {
    const rpcResult = await this.transport({
      timeoutMs: input.timeoutMs ?? this.manifest.timeoutMs,
      signal: input.signal,
    });
    const observedAt = new Date().toISOString();
    const out = this.normalize(rpcResult, observedAt);

    if (
      input.expectedSubject &&
      input.reason !== 'probe' &&
      out.account.subject !== input.expectedSubject
    ) {
      throw new AdapterError(
        'ACCOUNT_MISMATCH',
        `本机 Codex 账号已切换为 ${out.account.alias}，请重新连接`,
      );
    }
    return out;
  }

  public normalize(raw: unknown, observedAt: string): CollectOutput {
    if (typeof raw !== 'object' || raw === null) {
      throw new AdapterError('SCHEMA_CHANGED', 'Codex 返回结果不是有效对象');
    }
    const payload = raw as {
      runtimeVersion?: string;
      accountRead?: Record<string, unknown>;
      rateLimitsRead?: Record<string, unknown>;
    };

    const accWrap = payload.accountRead ?? {};
    const account = accWrap.account as Record<string, unknown> | null | undefined;
    if (!account || typeof account !== 'object') {
      throw new AdapterError(
        'AUTH_REQUIRED',
        '本机官方 Codex 客户端尚未登录账号，请先运行 codex login 完成官方登录',
      );
    }

    const accType = String(account.type || 'chatgpt');
    const rawEmail = typeof account.email === 'string' ? account.email : '';
    const planType = typeof account.planType === 'string' ? account.planType : null;

    if (accType !== 'chatgpt' || !rawEmail) throw new AdapterError('UNSUPPORTED', '此连接需要已登录 ChatGPT 的官方 Codex 客户端');
    const accountId = typeof account.id === 'string' ? account.id : typeof account.accountId === 'string' ? account.accountId : '';
    const subjectSeed = `${rawEmail}:${accountId || planType || 'unknown'}`;
    const subjectHash = createHash('sha256').update(subjectSeed).digest('hex').slice(0, 12);
    const subject = `codex:${subjectHash}`;
    const alias = rawEmail
      ? `Codex (${maskAccountEmail(rawEmail)})`
      : `Codex (${accType}${planType ? ` · ${planType}` : ''})`;

    const rlRoot = payload.rateLimitsRead;
    if (!rlRoot || typeof rlRoot !== 'object') {
      throw new AdapterError('SCHEMA_CHANGED', 'Codex 未返回 rateLimitsRead 结构');
    }

    const byId = rlRoot.rateLimitsByLimitId as Record<string, unknown> | null | undefined;
    const single = rlRoot.rateLimits as Record<string, unknown> | null | undefined;

    const buckets: { key: string; bucket: Record<string, unknown> }[] = [];
    if (byId && typeof byId === 'object' && Object.keys(byId).length > 0) {
      for (const [key, val] of Object.entries(byId)) {
        if (val && typeof val === 'object') {
          buckets.push({ key, bucket: val as Record<string, unknown> });
        }
      }
    } else if (single && typeof single === 'object') {
      buckets.push({
        key: typeof single.limitId === 'string' ? single.limitId : 'codex',
        bucket: single,
      });
    } else {
      throw new AdapterError('SCHEMA_CHANGED', 'Codex 响应缺少 rateLimitsByLimitId 与 rateLimits');
    }

    const metrics: NormalizedMetricObservation[] = [];
    const samples: string[] = [];
    const partialFailures: { field: string; reason: string }[] = [];
    const fields: NormalizedFieldObservation[] = [];

    let detectedPlan = planType;
    const multiBucket = buckets.length > 1;

    for (const { key, bucket } of buckets) {
      const bucketName =
        typeof bucket.limitName === 'string' && bucket.limitName.trim()
          ? bucket.limitName.trim()
          : key;
      if (!detectedPlan && typeof bucket.planType === 'string') {
        detectedPlan = bucket.planType;
      }

      // Extract primary, secondary, and any extra window entries dynamically
      const windowSlots: [string, unknown][] = [];
      for (const [slotKey, slotVal] of Object.entries(bucket)) {
        if (
          slotKey === 'primary' ||
          slotKey === 'secondary' ||
          (slotVal &&
            typeof slotVal === 'object' &&
            'usedPercent' in (slotVal as Record<string, unknown>))
        ) {
          windowSlots.push([slotKey, slotVal]);
        }
      }

      for (const [slotKey, rawWin] of windowSlots) {
        if (rawWin === null || rawWin === undefined) continue;
        if (typeof rawWin !== 'object') {
          partialFailures.push({
            field: `${key}.${slotKey}`,
            reason: '窗口结构不是对象',
          });
          continue;
        }
        const win = rawWin as Record<string, unknown>;
        const usedPercent = win.usedPercent;
        if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) {
          partialFailures.push({
            field: `${key}.${slotKey}.usedPercent`,
            reason: '缺少有效 usedPercent',
          });
          continue;
        }

        const remainingNum = Number((100 - usedPercent).toFixed(6));
        const remainingStr = String(remainingNum);
        const usedStr = String(usedPercent);
        const durationMins =
          typeof win.windowDurationMins === 'number' ? win.windowDurationMins : null;

        let resetAt: string | null = null;
        if (typeof win.resetsAt === 'number' && Number.isFinite(win.resetsAt) && win.resetsAt > 0) {
          // Official Codex App Server returns resetsAt in Unix seconds
          const ms = win.resetsAt * 1000;
          if (Number.isFinite(new Date(ms).getTime())) resetAt = new Date(ms).toISOString();
        } else if (typeof win.resetsAt === 'string' && Number.isFinite(Date.parse(win.resetsAt))) {
          resetAt = new Date(Date.parse(win.resetsAt)).toISOString();
        }

        const label = formatWindowDurationLabel(durationMins, bucketName, slotKey, multiBucket);
        const metricId = `${key}_${slotKey}`;

        const abnormalNote =
          remainingNum < 0 || remainingNum > 100 ? '（数据异常区间，保留原值）' : '';

        metrics.push({
          id: metricId,
          label,
          unit: '%',
          remaining: remainingStr,
          used: usedStr,
          total: '100',
          resetAt,
          observedAt,
          availability: 'known',
          source: `官方 Codex App Server · account/rateLimits/read${abnormalNote}`,
          dataOrigin: 'local_client',
          staleAfterMinutes: 30,
        });
        samples.push(`${label}：剩余 ${remainingStr}%（已用 ${usedStr}%）`);
      }
      if (bucket.credits && typeof bucket.credits === 'object' && !Array.isArray(bucket.credits)) {
        const credits = bucket.credits as Record<string, unknown>;
        const balance = typeof credits.balance === 'string' && /^-?\d+(\.\d+)?$/.test(credits.balance) ? credits.balance : typeof credits.balance === 'number' && Number.isFinite(credits.balance) ? String(credits.balance) : null;
        if (credits.unlimited === true || balance !== null) {
          metrics.push({ id: `${key}_credits`, label: `${bucketName} 积分`, unit: '积分', remaining: credits.unlimited === true ? null : balance, total: null, resetAt: null, observedAt, availability: credits.unlimited === true ? 'unlimited' : 'known', source: '官方 Codex App Server · credits', dataOrigin: 'local_client', staleAfterMinutes: 30 });
        }
      }
    }

    const resetCredits = rlRoot.rateLimitResetCredits as Record<string, unknown> | null | undefined;
    if (resetCredits && typeof resetCredits.availableCount === 'number' && Number.isInteger(resetCredits.availableCount) && resetCredits.availableCount >= 0) {
      metrics.push({ id: 'reset-credits', label: '可用重置次数', unit: '次', remaining: String(resetCredits.availableCount), total: null, resetAt: null, observedAt, availability: 'known', source: '官方 Codex App Server · rateLimitResetCredits', dataOrigin: 'local_client', staleAfterMinutes: 30 });
    }

    if (metrics.length === 0) {
      throw new AdapterError('SCHEMA_CHANGED', 'Codex 未返回任何有效额度窗口');
    }

    if (detectedPlan) {
      const normalizedPlan =
        detectedPlan.toLowerCase() === 'plus'
          ? 'ChatGPT Plus 权益'
          : detectedPlan.toLowerCase() === 'pro'
            ? 'ChatGPT Pro 权益'
            : `ChatGPT ${detectedPlan}`;
      fields.push({
        field: 'plan',
        value: normalizedPlan,
        availability: 'known',
        source: '官方 Codex App Server · account/read',
        observedAt,
        dataOrigin: 'local_client',
      });
    }

    return {
      account: {
        subject,
        alias,
        organization: '个人',
        region: '本机官方客户端',
      },
      poolId: `pool-${subject}`,
      metrics,
      fields,
      partialFailures,
      samples,
      observedAt,
      runtimeVersion: payload.runtimeVersion,
    };
  }

  public describeRecovery(error: AdapterError) {
    return defaultDescribeRecovery(this.manifest, error);
  }

  public async disconnect(): Promise<void> {}
}
