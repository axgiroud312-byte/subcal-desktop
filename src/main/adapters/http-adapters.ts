import { createHash } from 'node:crypto';
import { maskSecret } from '../credentials';
import {
  AdapterError,
  defaultDescribeRecovery,
  type AdapterManifest,
  type CollectInput,
  type CollectOutput,
  type NormalizedMetricObservation,
  type ProviderAdapter,
} from './types';

export type HttpFetchFn = (
  url: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export const defaultHttpFetch: HttpFetchFn = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    signal: init.signal,
    redirect: 'error',
  });
  return {
    status: res.status,
    headers: {
      get: (name: string) => res.headers.get(name),
    },
    text: async () => {
      const reader = res.body?.getReader();
      if (!reader) return '';
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '供应商响应超过大小限制');
          chunks.push(value);
        }
        return Buffer.concat(chunks).toString('utf8');
      } finally { await reader.cancel().catch(() => {}); }
    },
  };
};

export function assertAllowedAdapterGetUrl(manifest: AdapterManifest, rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AdapterError('UNSUPPORTED', '适配器请求 URL 无效');
  }
  if (parsed.protocol !== 'https:') {
    throw new AdapterError('UNSUPPORTED', '仅允许 HTTPS 官方接口请求');
  }
  if (parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new AdapterError('UNSUPPORTED', '禁止使用非标准端口或内嵌凭据 URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (!manifest.allowedHosts.includes(host)) {
    throw new AdapterError(
      'UNSUPPORTED',
      `目标主机 ${host} 不在适配器 ${manifest.id} 的允许清单中`,
    );
  }
  return parsed.toString();
}

export function parseRetryAfterMs(headerValue: string | null | undefined, nowMs = Date.now()): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    return Number.isSafeInteger(secs) ? Math.max(1000, secs * 1000) : undefined;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs) && dateMs > nowMs) {
    return Math.max(1000, dateMs - nowMs);
  }
  return undefined;
}

export function formatDecimalString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const text = String(value);
    if (!/e/i.test(text)) return text;
    const [coefficient, exponentText] = text.toLowerCase().split('e');
    const negative = coefficient.startsWith('-');
    const unsigned = negative ? coefficient.slice(1) : coefficient;
    const [whole, fraction = ''] = unsigned.split('.');
    const digits = whole + fraction, point = whole.length + Number(exponentText);
    const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
    return `${negative ? '-' : ''}${expanded}`;
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const trimmed = value.trim();
    return trimmed;
  }
  return null;
}

function keyFingerprint(secret: string): string {
  return createHash('sha256').update(secret.trim()).digest('hex').slice(0, 12);
}

export function hashKeySubject(providerId: string, secret: string): string {
  const prefix = ({ 'deepseek-balance': 'deepseek', 'kimi-platform-cn': 'kimi-cn', 'openrouter-key': 'openrouter', 'openrouter-credits': 'openrouter' } as Record<string, string>)[providerId];
  if (!prefix) throw new AdapterError('UNSUPPORTED', '不支持的 API Key 服务');
  return `${prefix}:${keyFingerprint(secret)}`;
}

export async function executeOfficialGet(
  manifest: AdapterManifest,
  endpointUrl: string,
  input: CollectInput,
  fetchFn: HttpFetchFn,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const secret = input.secret?.trim();
  if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
  if (!secret) {
    throw new AdapterError('AUTH_REQUIRED', `请先提供 ${manifest.product} 的 API Key`);
  }
  const safeUrl = assertAllowedAdapterGetUrl(manifest, endpointUrl);
  const timeoutMs = input.timeoutMs ?? manifest.timeoutMs;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);

  try {
    const response = await fetchFn(safeUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
        'User-Agent': 'SubCal-Desktop/0.1.0',
        ...headers,
      },
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new AdapterError(
        'AUTH_REQUIRED',
        `${manifest.product} 登录已失效，请重新登录或更新 Key`,
        { httpStatus: 401 },
      );
    }
    if (response.status === 403) {
      throw new AdapterError(
        'PERMISSION_DENIED',
        `${manifest.product} 暂不允许读取这些权益，请核对账号权限`,
        { httpStatus: 403 },
      );
    }
    if (response.status === 429) {
      const retryAfterMs =
        parseRetryAfterMs(response.headers.get('retry-after')) ??
        manifest.minIntervalSeconds * 1000;
      throw new AdapterError(
        'RATE_LIMITED',
        `${manifest.product} 返回 429：请求过于频繁，已按供应商限流窗口退避`,
        { httpStatus: 429, retryAfterMs },
      );
    }
    if (response.status >= 500) {
      throw new AdapterError(
        'UPSTREAM_UNAVAILABLE',
        `${manifest.product} 服务端暂时不可用（HTTP ${response.status}）`,
        { httpStatus: response.status },
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError(
        'UPSTREAM_UNAVAILABLE',
        `${manifest.product} 请求未成功（HTTP ${response.status}）`,
        { httpStatus: response.status },
      );
    }

    const bodyText = await response.text();
    if (bodyText.length > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '供应商响应超过大小限制');
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new AdapterError(
        'SCHEMA_CHANGED',
        `${manifest.product} 响应不是有效 JSON，已保留旧值`,
      );
    }
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    if (input.signal?.aborted) {
      throw new AdapterError('CANCELLED', `${manifest.product} 采集已取消`);
    }
    if (controller.signal.aborted) {
      throw new AdapterError('TIMEOUT', `${manifest.product} 请求超时（>${timeoutMs}ms）`);
    }
    const msg = (err as Error)?.message || '';
    if (/ENOTFOUND|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|fetch failed/i.test(msg)) {
      throw new AdapterError('NETWORK_OFFLINE', `无法连接 ${manifest.allowedHosts[0]}，请检查网络`);
    }
    throw new AdapterError('UPSTREAM_UNAVAILABLE', `${manifest.product} 网络请求失败`);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

/* ============================================================================
 * 1. DeepSeek Balance Adapter (GET https://api.deepseek.com/user/balance)
 * ========================================================================== */

export const DEEPSEEK_MANIFEST: AdapterManifest = {
  id: 'deepseek-balance',
  version: '1.0.0',
  brand: 'DeepSeek',
  product: 'DeepSeek API',
  region: 'api.deepseek.com',
  supportedFields: ['可用总余额', '充值余额', '赠送余额', '币种'],
  unsupportedFields: ['消费者会员账期'],
  authMode: 'api_key',
  officialSourceUrl: 'https://api-docs.deepseek.com/api/get-user-balance/',
  termsCheckedAt: '2026-10-20',
  allowedHosts: ['api.deepseek.com'],
  minIntervalSeconds: 300,
  defaultForegroundSeconds: 1800,
  defaultBackgroundSeconds: 1800,
  timeoutMs: 15000,
  supportTier: 'official_auto',
  permissions:
    '仅向 https://api.deepseek.com/user/balance 发起只读 GET 请求读取账户余额。平台 API Key 本身可能具备模型调用权限，SubCal 绝不发起对话或消费请求。',
  credentialLocation: '使用系统安全存储（Electron safeStorage）加密保存在本机，数据库仅保存引用标识。',
};

export class DeepSeekBalanceAdapter implements ProviderAdapter {
  public readonly manifest = DEEPSEEK_MANIFEST;

  constructor(private readonly fetchFn: HttpFetchFn = defaultHttpFetch) {}

  public async probe(input: CollectInput): Promise<CollectOutput> {
    return this.collect(input);
  }

  public async collect(input: CollectInput): Promise<CollectOutput> {
    const raw = await executeOfficialGet(
      this.manifest,
      'https://api.deepseek.com/user/balance',
      input,
      this.fetchFn,
    );
    const observedAt = new Date().toISOString();
    const mask = input.secret ? maskSecret(input.secret) : 'DeepSeek Key';
    const subject = input.secret ? hashKeySubject(this.manifest.id, input.secret) : 'deepseek:default';
    const out = this.normalize(raw, observedAt, { mask });
    out.account.subject = subject;
    out.poolId = `pool-deepseek-${subject.slice(-8)}`;
    return out;
  }

  public normalize(
    raw: unknown,
    observedAt: string,
    context?: { mask?: string },
  ): CollectOutput {
    if (typeof raw !== 'object' || raw === null) {
      throw new AdapterError('SCHEMA_CHANGED', 'DeepSeek 余额响应不是对象');
    }
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.balance_infos) || obj.balance_infos.length === 0) {
      throw new AdapterError('SCHEMA_CHANGED', 'DeepSeek 响应缺少 balance_infos 数组');
    }

    const metrics: NormalizedMetricObservation[] = [];
    const partialFailures: { field: string; reason: string }[] = [];
    const samples: string[] = [];

    for (const item of obj.balance_infos) {
      if (typeof item !== 'object' || item === null) continue;
      const info = item as Record<string, unknown>;
      const currency =
        typeof info.currency === 'string' && /^[A-Z]{3}$/.test(info.currency)
          ? info.currency
          : null;
      if (!currency) {
        throw new AdapterError('SCHEMA_CHANGED', 'DeepSeek balance_infos 缺少有效三位币种');
      }

      const suffix = obj.balance_infos.length > 1 ? ` (${currency})` : '';
      const idSuffix = `_${currency.toLowerCase()}`;

      const totalVal = formatDecimalString(info.total_balance);
      const cashVal = formatDecimalString(info.topped_up_balance);
      const giftVal = formatDecimalString(info.granted_balance);

      if (totalVal === null && cashVal === null && giftVal === null) {
        throw new AdapterError('SCHEMA_CHANGED', 'DeepSeek 余额字段全部缺失或格式异常');
      }

      if (totalVal !== null) {
        metrics.push({
          id: `total${idSuffix}`,
          label: `可用总余额${suffix}`,
          unit: currency,
          remaining: totalVal,
          total: null,
          resetAt: null,
          observedAt,
          availability: 'known',
          source: '官方 API · GET /user/balance',
          dataOrigin: 'official_api',
          staleAfterMinutes: 120,
        });
        samples.push(`可用总余额${suffix}：${totalVal} ${currency}`);
      } else {
        partialFailures.push({ field: `total_balance(${currency})`, reason: '未返回 total_balance' });
      }

      if (cashVal !== null) {
        metrics.push({
          id: `cash${idSuffix}`,
          label: `充值余额${suffix}`,
          unit: currency,
          remaining: cashVal,
          total: null,
          resetAt: null,
          observedAt,
          availability: 'known',
          source: '官方 API · GET /user/balance',
          dataOrigin: 'official_api',
          staleAfterMinutes: 120,
        });
        samples.push(`充值余额${suffix}：${cashVal} ${currency}`);
      } else {
        partialFailures.push({ field: `topped_up_balance(${currency})`, reason: '未返回 topped_up_balance' });
      }

      if (giftVal !== null) {
        metrics.push({
          id: `gift${idSuffix}`,
          label: `赠送余额${suffix}`,
          unit: currency,
          remaining: giftVal,
          total: null,
          resetAt: null,
          observedAt,
          availability: 'known',
          source: '官方 API · GET /user/balance',
          dataOrigin: 'official_api',
          staleAfterMinutes: 120,
        });
        samples.push(`赠送余额${suffix}：${giftVal} ${currency}`);
      } else {
        partialFailures.push({ field: `granted_balance(${currency})`, reason: '未返回 granted_balance' });
      }
    }

    if (metrics.length === 0) {
      throw new AdapterError('SCHEMA_CHANGED', 'DeepSeek 未能解析出任何有效余额字段');
    }

    if (typeof obj.is_available === 'boolean') {
      samples.push(`服务状态：${obj.is_available ? '可用' : '当前不可用'}`);
      if (!obj.is_available) partialFailures.push({ field: 'is_available', reason: '供应商返回当前服务不可用' });
    }

    const alias = context?.mask ? `DeepSeek (${context.mask})` : 'DeepSeek API 账户';
    return {
      account: {
        subject: alias,
        alias,
        organization: '个人',
        region: 'api.deepseek.com',
      },
      poolId: 'pool-deepseek',
      metrics,
      fields: [],
      partialFailures,
      samples,
      observedAt,
    };
  }

  public describeRecovery(error: AdapterError) {
    return defaultDescribeRecovery(this.manifest, error);
  }

  public async disconnect(): Promise<void> {}
}

/* ============================================================================
 * 2. Kimi Platform CN Adapter (GET https://api.moonshot.cn/v1/users/me/balance)
 * ========================================================================== */

export const KIMI_CN_MANIFEST: AdapterManifest = {
  id: 'kimi-platform-cn',
  version: '1.0.0',
  brand: 'Kimi',
  product: 'Kimi API',
  region: '中国大陆（api.moonshot.cn）',
  supportedFields: ['可用余额（available_balance）', '现金余额（cash_balance）', '代金券余额（voucher_balance）'],
  unsupportedFields: ['Kimi Code 会员额度', '国际站钱包', '会员续费日期'],
  authMode: 'api_key',
  officialSourceUrl: 'https://platform.kimi.com/docs/api/balance',
  termsCheckedAt: '2026-10-20',
  allowedHosts: ['api.moonshot.cn'],
  minIntervalSeconds: 300,
  defaultForegroundSeconds: 1800,
  defaultBackgroundSeconds: 1800,
  timeoutMs: 15000,
  supportTier: 'official_auto',
  permissions:
    '仅向 https://api.moonshot.cn/v1/users/me/balance 发起只读 GET 请求，不会向国际站转发凭据，也不会调用推理接口。',
  credentialLocation: '使用系统安全存储（Electron safeStorage）加密保存在本机，数据库仅保存引用标识。',
};

export class KimiPlatformCnAdapter implements ProviderAdapter {
  public readonly manifest = KIMI_CN_MANIFEST;

  constructor(private readonly fetchFn: HttpFetchFn = defaultHttpFetch) {}

  public async probe(input: CollectInput): Promise<CollectOutput> {
    return this.collect(input);
  }

  public async collect(input: CollectInput): Promise<CollectOutput> {
    const raw = await executeOfficialGet(
      this.manifest,
      'https://api.moonshot.cn/v1/users/me/balance',
      input,
      this.fetchFn,
    );
    const observedAt = new Date().toISOString();
    const mask = input.secret ? maskSecret(input.secret) : 'Kimi Key';
    const subject = input.secret ? hashKeySubject(this.manifest.id, input.secret) : 'kimi-cn:default';
    const out = this.normalize(raw, observedAt, { mask });
    out.account.subject = subject;
    out.poolId = `pool-kimi-${subject.slice(-8)}`;
    return out;
  }

  public normalize(
    raw: unknown,
    observedAt: string,
    context?: { mask?: string },
  ): CollectOutput {
    if (typeof raw !== 'object' || raw === null) {
      throw new AdapterError('SCHEMA_CHANGED', 'Kimi 开放平台响应不是有效对象');
    }
    const obj = raw as Record<string, unknown>;
    if (obj.code !== 0 || obj.status !== true) {
      throw new AdapterError(
        'UPSTREAM_UNAVAILABLE',
        'Kimi 开放平台未返回成功业务状态',
      );
    }
    const data = obj.data;
    if (typeof data !== 'object' || data === null) {
      throw new AdapterError('SCHEMA_CHANGED', 'Kimi 开放平台响应缺少 data 对象');
    }
    const d = data as Record<string, unknown>;

    const availableVal = formatDecimalString(d.available_balance);
    const cashVal = formatDecimalString(d.cash_balance);
    const voucherVal = formatDecimalString(d.voucher_balance);

    if (availableVal === null && cashVal === null && voucherVal === null) {
      throw new AdapterError('SCHEMA_CHANGED', 'Kimi 响应缺少有效余额字段');
    }

    const metrics: NormalizedMetricObservation[] = availableVal === null ? [] : [
      {
        id: 'available',
        label: '可用余额',
        unit: 'CNY',
        remaining: availableVal,
        total: null,
        resetAt: null,
        observedAt,
        availability: 'known',
        source: '官方 API · GET /v1/users/me/balance',
        dataOrigin: 'official_api',
        staleAfterMinutes: 120,
      },
    ];
    const samples: string[] = availableVal === null ? [] : [`可用余额：${availableVal} CNY`];
    const partialFailures: { field: string; reason: string }[] = availableVal === null ? [{ field: 'available_balance', reason: '未返回 available_balance' }] : [];

    if (cashVal !== null) {
      metrics.push({
        id: 'cash',
        label: '充值余额',
        unit: 'CNY',
        remaining: cashVal,
        total: null,
        resetAt: null,
        observedAt,
        availability: 'known',
        source: '官方 API · GET /v1/users/me/balance',
        dataOrigin: 'official_api',
        staleAfterMinutes: 120,
      });
      samples.push(`充值余额：${cashVal} CNY`);
    } else {
      partialFailures.push({ field: 'cash_balance', reason: '未返回 cash_balance' });
    }

    if (voucherVal !== null) {
      metrics.push({
        id: 'voucher',
        label: '赠送余额',
        unit: 'CNY',
        remaining: voucherVal,
        total: null,
        resetAt: null,
        observedAt,
        availability: 'known',
        source: '官方 API · GET /v1/users/me/balance',
        dataOrigin: 'official_api',
        staleAfterMinutes: 120,
      });
      samples.push(`赠送余额：${voucherVal} CNY`);
    } else {
      partialFailures.push({ field: 'voucher_balance', reason: '未返回 voucher_balance' });
    }

    const alias = context?.mask ? `Kimi 国内站 (${context.mask})` : 'Kimi 国内站 API 账户';
    return {
      account: {
        subject: alias,
        alias,
        organization: '个人',
        region: '中国大陆',
      },
      poolId: 'pool-kimi',
      metrics,
      fields: [],
      partialFailures,
      samples,
      observedAt,
    };
  }

  public describeRecovery(error: AdapterError) {
    return defaultDescribeRecovery(this.manifest, error);
  }

  public async disconnect(): Promise<void> {}
}

/* ============================================================================
 * 3. OpenRouter Key Adapter (GET https://openrouter.ai/api/v1/key)
 * ========================================================================== */

export const OPENROUTER_KEY_MANIFEST: AdapterManifest = {
  id: 'openrouter-key',
  version: '1.0.0',
  brand: 'OpenRouter',
  product: 'OpenRouter',
  region: 'openrouter.ai',
  supportedFields: ['Key 剩余预算（limit_remaining）', 'Key 限额（limit）', 'Key 已用额度（usage）', '重置规则（limit_reset）'],
  unsupportedFields: ['账户总资金池（需 Management Key）', '订阅扣费日'],
  authMode: 'api_key',
  officialSourceUrl: 'https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key',
  termsCheckedAt: '2026-10-20',
  allowedHosts: ['openrouter.ai'],
  minIntervalSeconds: 300,
  defaultForegroundSeconds: 1800,
  defaultBackgroundSeconds: 1800,
  timeoutMs: 15000,
  supportTier: 'official_auto',
  permissions:
    '仅向 https://openrouter.ai/api/v1/key 发起只读 GET 请求读取当前 Key 预算范围，不代表账户总现金池。',
  credentialLocation: '使用系统安全存储（Electron safeStorage）加密保存在本机，数据库仅保存引用标识。',
};

export class OpenRouterKeyAdapter implements ProviderAdapter {
  public readonly manifest = OPENROUTER_KEY_MANIFEST;

  constructor(private readonly fetchFn: HttpFetchFn = defaultHttpFetch) {}

  public async probe(input: CollectInput): Promise<CollectOutput> {
    return this.collect(input);
  }

  public async collect(input: CollectInput): Promise<CollectOutput> {
    const raw = await executeOfficialGet(
      this.manifest,
      'https://openrouter.ai/api/v1/key',
      input,
      this.fetchFn,
    );
    const observedAt = new Date().toISOString();
    const mask = input.secret ? maskSecret(input.secret) : 'OpenRouter Key';
    const subject = input.secret
      ? hashKeySubject(this.manifest.id, input.secret)
      : 'openrouter:default';
    const out = this.normalize(raw, observedAt, { mask });
    out.account.subject = subject;
    out.poolId = `pool-openrouter-${subject.slice(-8)}`;
    return out;
  }

  public normalize(
    raw: unknown,
    observedAt: string,
    context?: { mask?: string },
  ): CollectOutput {
    if (typeof raw !== 'object' || raw === null) {
      throw new AdapterError('SCHEMA_CHANGED', 'OpenRouter 响应不是有效对象');
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.data !== 'object' || obj.data === null) {
      throw new AdapterError('SCHEMA_CHANGED', 'OpenRouter 响应缺少 data 对象');
    }
    const d = obj.data as Record<string, unknown>;

    const hasRecognizedField =
      'limit_remaining' in d ||
      'limit' in d ||
      'usage' in d ||
      'is_free_tier' in d ||
      'label' in d;
    if (!hasRecognizedField) {
      throw new AdapterError('SCHEMA_CHANGED', 'OpenRouter data 缺少可识别的 Key 预算字段');
    }

    const limitVal = d.limit === null ? null : formatDecimalString(d.limit);
    const remVal = d.limit_remaining === null ? null : formatDecimalString(d.limit_remaining);
    const usageVal = formatDecimalString(d.usage);

    let resetAt: string | null = null;
    let resetNote = '';
    const rawReset = d.resets_at ?? d.limit_reset;
    if (typeof rawReset === 'string' && rawReset.trim().length > 0) {
      const parsedMs = Date.parse(rawReset);
      if (Number.isFinite(parsedMs) && /^\d{4}-\d{2}-\d{2}T/.test(rawReset)) {
        resetAt = new Date(parsedMs).toISOString();
      } else {
        resetNote = ` · 重置规则 ${rawReset}`;
      }
    }

    const metrics: NormalizedMetricObservation[] = [];
    const samples: string[] = [];
    const partialFailures: { field: string; reason: string }[] = [];

    if (remVal !== null) {
      metrics.push({
        id: 'budget',
        label: 'Key 剩余预算',
        unit: 'USD',
        remaining: remVal,
        used: usageVal,
        total: limitVal,
        resetAt,
        observedAt,
        availability: 'known',
        source: `官方 API · GET /api/v1/key（仅当前 Key 范围${resetNote}）`,
        dataOrigin: 'official_api',
        staleAfterMinutes: 120,
      });
      samples.push(
        `Key 剩余预算：${remVal} USD${limitVal ? ` / 限额 ${limitVal} USD` : ''}`,
      );
    } else if (d.limit === null && d.limit_remaining === null) {
      // Key has no cap (limit: null); never fabricate a fake total limit!
      metrics.push({
        id: 'budget',
        label: 'Key 预算上限',
        unit: 'USD',
        remaining: null,
        used: usageVal,
        total: null,
        resetAt,
        observedAt,
        availability: 'unlimited',
        source: `官方 API · GET /api/v1/key（当前 Key 未设限额${resetNote}）`,
        dataOrigin: 'official_api',
        staleAfterMinutes: 120,
      });
      samples.push('Key 预算上限：未设限额（无限额上限 · 非账户总资金）');
    } else {
      partialFailures.push({ field: 'limit_remaining', reason: '未返回 limit_remaining' });
    }

    if (usageVal !== null) {
      samples.push(`当前 Key 累计用量：${usageVal} USD`);
      metrics.push({ id: 'usage', label: 'Key 累计用量', unit: 'USD', remaining: usageVal, used: usageVal, total: null, resetAt: null, observedAt, availability: 'known', source: '官方 API · GET /api/v1/key', dataOrigin: 'official_api', staleAfterMinutes: 120 });
    }

    const effective = d.effective_budget;
    if (effective && typeof effective === 'object' && !Array.isArray(effective)) {
      const b = effective as Record<string, unknown>;
      const remaining = formatDecimalString(b.remaining_usd);
      if (remaining !== null) {
        const reset = typeof b.resets_at === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(b.resets_at) && Number.isFinite(Date.parse(b.resets_at)) ? new Date(b.resets_at).toISOString() : null;
        const scopeNames: Record<string, string> = { member: '成员', api_key: 'Key', workspace: '工作区', key_limit: 'Key', workspace_default_member: '工作区成员', workspace_default_key: '工作区 Key' };
        const scope = typeof b.scope === 'string' ? scopeNames[b.scope] || b.scope.slice(0, 80) : '当前 Key';
        metrics.unshift({ id: 'effective-budget', label: `生效预算 · ${scope}`, unit: 'USD', remaining, used: formatDecimalString(b.spend_usd), total: formatDecimalString(b.limit_usd), resetAt: reset, observedAt, availability: 'known', source: '官方 API · effective_budget（非账户资金）', dataOrigin: 'official_api', staleAfterMinutes: 120 });
        samples.unshift(`生效预算（${scope}）：${remaining} USD`);
      } else partialFailures.push({ field: 'effective_budget', reason: '未返回有效生效预算' });
    } else if (effective === null) {
      metrics.push({ id: 'effective-budget', label: '生效预算', unit: 'USD', remaining: null, total: null, resetAt: null, observedAt, availability: 'na', source: '官方 API · effective_budget 未设预算', dataOrigin: 'official_api', staleAfterMinutes: 120 });
    }

    if (!metrics.length) throw new AdapterError('SCHEMA_CHANGED', 'OpenRouter 未返回可用预算或用量字段');

    const rawLabel =
      typeof d.label === 'string' && d.label.trim()
        ? maskSecret(d.label.trim())
        : context?.mask || '当前 Key';
    const alias = `OpenRouter (${rawLabel})`;

    return {
      account: {
        subject: alias,
        alias,
        organization: 'Key 范围',
        region: 'openrouter.ai',
      },
      poolId: 'pool-router',
      metrics,
      fields: typeof d.is_free_tier !== 'boolean' ? [] : [
        {
          field: 'plan',
          value: d.is_free_tier === true ? 'Key 预算 · Free Tier' : 'Key 预算 · 非账户总资金',
          availability: 'known',
          source: '官方 API · GET /api/v1/key',
          observedAt,
          dataOrigin: 'official_api',
        },
      ],
      partialFailures,
      samples,
      observedAt,
    };
  }

  public describeRecovery(error: AdapterError) {
    return defaultDescribeRecovery(this.manifest, error);
  }

  public async disconnect(): Promise<void> {}
}
