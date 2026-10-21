/** Read-only mappings adapted from Magpie ba319a7587923fc7a4ea3859658244d591261a59,
 * internal/provider/{balance.go,sub2api_usage.go}, Copyright (c) 2026 yetone (MIT).
 * Full MIT notice and source mapping: docs/evidence/full-service/wallets.md.
 * No plugin runtime, inference, login, credential refresh or credential persistence. */
import { createHash } from 'node:crypto';
import type { Balance, Field, EntitlementDate } from '../../shared/types';
import { defaultHttpFetch, executeOfficialGet, OPENROUTER_KEY_MANIFEST, hashKeySubject, type HttpFetchFn } from './http-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type ProviderAdapter } from './types';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const hash = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 24);
function decimal(v: unknown): string | null {
  if (typeof v === 'number') {
    // Unsafe integers cannot be repaired after JSON.parse. Transport below preserves lexemes.
    if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER) return null;
    v = String(v);
  }
  if (typeof v !== 'string' || v.length > 1024 || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v.trim())) return null;
  const s = v.trim(), negative = s.startsWith('-'), [coefficient, exponent = '0'] = s.replace(/^-/, '').toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.'), point = whole.length + Number(exponent), digits = whole + fraction;
  if (Math.abs(Number(exponent)) > 1024) return null;
  const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return (negative ? '-' : '') + expanded;
}
function exact(a: string, b: string, operation: 'subtract' | 'quota'): string {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (s: string) => { const [w, f = ''] = s.split('.'); return BigInt(w + f.padEnd(scale, '0')); };
  // Dividing by 500000 is multiplying by 2 then shifting six decimal places.
  const n = operation === 'quota' ? integer(a) * 2n : integer(a) - integer(b), places = scale + (operation === 'quota' ? 6 : 0);
  const digits = (n < 0n ? -n : n).toString().padStart(places + 1, '0');
  return (n < 0n ? '-' : '') + (places ? `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/0+$/, '').replace(/\.$/, '') : digits);
}
const usdQuota = (v: unknown) => { const d = decimal(v); return d === null ? null : exact(d, '0', 'quota'); };
function instant(v: unknown): string | null {
  const s = text(v);
  return /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
}
function origin(raw: string): string {
  let u: URL; try { u = new URL(raw); } catch { throw new AdapterError('UNSUPPORTED', '需要已批准的精确 HTTPS 来源'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash || !u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.startsWith('[')) throw new AdapterError('UNSUPPORTED', '来源必须为标准 HTTPS 公网主机，不含路径、端口或凭据');
  return u.origin;
}

export type WalletTemplate = 'new-api-key' | 'new-api-account' | 'one-api-key' | 'sub2api-key' | 'sub2api-account' | 'credit-grants';
/** Trusted main-process configuration, NOT renderer-supplied host approval.
 * source identifies the reviewed/imported panel protocol; no host-based guessing. */
export interface ApprovedWalletOrigin { origin: string; template: WalletTemplate; source: string }
export interface WalletAdapterOptions { approvedOrigins?: readonly ApprovedWalletOrigin[]; fetchFn?: HttpFetchFn }
type Mode = 'kimi' | 'siliconflow' | 'aihubmix-key' | 'aihubmix-account' | WalletTemplate;
interface Config { id: string; product: string; origin: string; path: string; mode: Mode; currency: string; source: string; relay?: boolean }
const paths: Record<WalletTemplate, string> = {
  'new-api-key': '/api/usage/token', 'one-api-key': '/api/usage/token',
  'new-api-account': '/api/user/self',
  'sub2api-key': '/v1/usage', 'sub2api-account': '/api/v1/user/profile', 'credit-grants': '/dashboard/billing/credit_grants',
};
function field<T>(value: T, out: CollectOutput, source: string, evidence: 'reported' | 'derived' = 'reported'): Field<T> {
  return { value, availability: 'known', observedAt: out.observedAt, providerAt: out.providerAt, source, dataOrigin: 'official_api', evidence };
}
export class WalletAdapter implements ProviderAdapter {
  readonly manifest: AdapterManifest;
  constructor(private readonly config: Config, private readonly fetchFn: HttpFetchFn = defaultHttpFetch) {
    const host = new URL(config.origin).hostname;
    this.manifest = { ...OPENROUTER_KEY_MANIFEST, id: config.id, brand: config.product, product: config.product, region: host,
      authMode: config.mode.endsWith('account') ? 'local_client' : 'api_key', allowedHosts: [host], officialSourceUrl: config.origin + config.path,
      supportedFields: ['实际返回的账户余额或 Key 预算、独立币种与分项', 'Sub2API Key 实际额度窗口'],
      unsupportedFields: ['模型调用', '登录或刷新', '未返回的余额、会员及扣费日期'], termsCheckedAt: '2026-10-21',
      permissions: '仅固定模板 GET；主进程系统加密凭据按账号隔离传入，不调用模型、不跨区回退、不扫描或写入凭据。' };
  }
  probe(input: CollectInput) { return this.collect(input); }
  async collect(input: CollectInput): Promise<CollectOutput> {
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const secret = input.secret?.trim() ?? '';
    let c: Obj = {};
    if (secret.startsWith('{')) { try { c = obj(JSON.parse(secret)); } catch { throw new AdapterError('AUTH_REQUIRED', '凭据封装无效'); } }
    else c.accessToken = secret;
    const token = text(c.accessToken ?? c.apiKey ?? c.key ?? c.token);
    if (!token || /\s/.test(token)) throw new AdapterError('AUTH_REQUIRED', '需要有效 Key 或账号访问凭据');
    // source may describe the import channel (e.g. opencode); provider is the product binding.
    if (c.provider !== undefined && c.provider !== this.config.id && c.provider !== this.config.source) throw new AdapterError('AUTH_REQUIRED', '凭据服务不匹配');
    const locator = obj(c.locator), boundOrigin = text(c.origin ?? c.baseUrl ?? c.baseURL ?? locator.origin ?? locator.baseUrl ?? locator.baseURL);
    if (boundOrigin && origin(boundOrigin) !== this.config.origin) throw new AdapterError('AUTH_REQUIRED', '凭据主机或地区与服务不匹配');
    if (this.config.relay && (!boundOrigin || c.source !== this.config.source)) throw new AdapterError('UNSUPPORTED', '中转凭据必须绑定已批准主机及已识别模板来源');
    const subject = text(c.subject) || hashKeySubject(this.config.id,token);
    if (input.reason !== 'probe' && input.expectedSubject && input.expectedSubject !== subject) throw new AdapterError('ACCOUNT_MISMATCH', '账号或 Key 已改变，请重新连接');
    const headers: Record<string, string> = {};
    if (['new-api-account', 'aihubmix-account'].includes(this.config.mode)) {
      headers.Authorization = token; // Panel access token, not an inference key or JWT.
      const userId = text(c.userId ?? c.accountId);
      if (this.config.mode === 'new-api-account' && !/^\d+$/.test(userId)) throw new AdapterError('AUTH_REQUIRED', 'New API 账号需要已验证的用户 ID');
      if (userId) { if (!/^\d+$/.test(userId)) throw new AdapterError('AUTH_REQUIRED', '用户 ID 无效'); headers['New-Api-User'] = userId; }
    }
    const transport: { responseAt: string | null } = { responseAt: null };
    const raw = await executeOfficialGet(this.manifest, this.manifest.officialSourceUrl, { ...input, secret: token }, async (url, init) => {
      const response = await this.fetchFn(url, init);
      if (this.config.mode === 'siliconflow' && response.status === 410) throw new AdapterError('UNSUPPORTED', 'SiliconFlow 余额接口已退休，请到对应地区控制台查看余额及代金券', { httpStatus: 410 });
      const date = response.headers.get('date');
      if (date && Number.isFinite(Date.parse(date))) transport.responseAt = new Date(date).toISOString();
      return { ...response, text: async () => {
        const body = await response.text();
        if (body.length > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '供应商响应超过大小限制');
        // Preserve ALL numeric JSON lexemes before executeOfficialGet parses JSON.
        return body.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => token.startsWith('"') ? token : JSON.stringify(token));
      } };
    }, headers);
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const now = new Date().toISOString(), at = transport.responseAt && transport.responseAt < now ? transport.responseAt : now;
    const out = this.normalize(raw, at);
    out.account.subject = subject; out.account.alias = text(c.alias) || this.manifest.product;
    const keyScoped = !this.config.mode.endsWith('account') && !['kimi', 'siliconflow', 'credit-grants'].includes(this.config.mode);
    out.poolId = `pool-${this.config.id}-${hash(subject + (keyScoped ? ':' + token : ''))}`;
    out.balances?.forEach(b => { b.poolId = `${out.poolId}:${b.scope}:${b.id}:${b.currency}`; });
    out.metrics.forEach(m => { m.poolId = `${out.poolId}:${m.id}`; });
    return out;
  }
  normalize(raw: unknown, observedAt: string): CollectOutput {
    const r = obj(raw), d = obj(r.data), mode = this.config.mode;
    if (mode === 'siliconflow' && String(r.code) === '20092') throw new AdapterError('UNSUPPORTED', 'SiliconFlow 余额接口已退休，请到对应地区控制台查看余额及代金券');
    if (r.success === false || r.status === false || r.isValid === false || r.error) throw new AdapterError('PERMISSION_DENIED', '上游拒绝余额查询，保留旧观察');
    if (mode === 'kimi' && (String(r.code) !== '0' || r.status !== true) || mode === 'siliconflow' && String(r.code) !== '20000') throw new AdapterError('UPSTREAM_UNAVAILABLE', '供应商未返回成功业务状态');
    if(mode.endsWith('account')&&mode!=='sub2api-account'&&r.success!==true)throw new AdapterError('UPSTREAM_UNAVAILABLE','面板未返回成功业务状态');
    if(/^(new|one)-api-key$/.test(mode)&&(r.code===false||r.success===false||(r.code!==true&&r.success!==true)))throw new AdapterError('UPSTREAM_UNAVAILABLE','面板未返回成功业务状态');
    if (mode.startsWith('sub2api') && r.code !== undefined && !['0', '200'].includes(String(r.code))) throw new AdapterError('UPSTREAM_UNAVAILABLE', 'Sub2API 业务查询失败');
    const providerAt = instant(r.providerAt); // Explicit observation supplied by a trusted upstream collector, never a reset time.
    const at = providerAt && providerAt < observedAt ? providerAt : observedAt;
    const out: CollectOutput = { account: { subject: this.config.id, alias: this.config.product, organization: '', region: this.manifest.region }, poolId: `pool-${this.config.id}`, observedAt: at, providerAt, balances: [], metrics: [], fields: [], samples: [], partialFailures: [] };
    const source = `只读 GET ${this.config.origin}${this.config.path}`;
    const add = (id: string, label: string, value: string | null, scope: Balance['scope'], kind: Balance['kind'], evidence: 'reported' | 'derived' = 'reported') => {
      if (value === null) { out.partialFailures.push({ field: id, reason: '未提供有效金额，保留旧观察' }); return; }
      out.balances!.push({ id, label, scope, kind, currency: this.config.currency, amount: field(value, out, source, evidence) });
    };
    if (mode === 'kimi') {
      add('available', '账户可用总余额', decimal(d.available_balance), 'account', 'total');
      add('cash', '账户现金余额', decimal(d.cash_balance), 'account', 'cash');
      add('voucher', '账户代金券余额', decimal(d.voucher_balance), 'account', 'grant');
    } else if (mode === 'siliconflow') {
      // Only totalBalance has a verified semantic in the pinned mapping. Do not
      // guess whether old balance/chargeBalance are current cash or vouchers.
      add('total', '账户总余额（旧接口）', decimal(d.totalBalance), 'account', 'total');
    } else if (mode === 'aihubmix-key') {
      const remaining = decimal(r.total_usage);
      if (remaining !== null && remaining.startsWith('-') && /[1-9]/.test(remaining)) {
        out.metrics.push({ id: 'key-budget', label: 'Key 未设预算上限（账户资金未知）', scope: 'key', unit: 'USD', remaining: null, total: null, resetAt: null, observedAt: at, availability: 'unlimited', source, dataOrigin: 'official_api', evidence: 'reported', staleAfterMinutes: 120 });
      } else add('remaining', 'Key 剩余预算（非账户余额）', remaining, 'key', 'budget');
    } else if (['aihubmix-account', 'new-api-account'].includes(mode)) {
      add('quota', '账户剩余额度', usdQuota(d.quota), 'account', 'total', 'derived');
    } else if (mode === 'new-api-key' || mode === 'one-api-key') {
      if (d.unlimited_quota === true) out.metrics.push({ id: 'key-budget', label: 'Key 未设预算上限（账户资金未知）', scope: 'key', unit: 'USD', remaining: null, total: null, resetAt: null, observedAt: at, availability: 'unlimited', source, dataOrigin: 'official_api', evidence: 'reported', staleAfterMinutes: 120 });
      else add('remaining', 'Key 剩余预算', usdQuota(d.total_available), 'key', 'budget', 'derived');
    } else if (mode === 'sub2api-account') {
      add('balance', '账户余额', decimal(d.balance), 'account', 'total');
    } else if (mode === 'credit-grants') {
      add('available', '账户可用余额', decimal(r.total_available), 'account', 'total');
      add('used', '账户累计消费', decimal(r.total_used), 'account', 'usage');
    } else if (mode === 'sub2api-key') {
      // /v1/usage.remaining can be wallet/plan/key constrained: it is the
      // effective spendable budget of THIS KEY, not proof of account cash.
      if (r.remaining !== undefined) add('remaining', 'Key 当前可用预算', decimal(r.remaining), 'key', 'budget');
      for (const value of Array.isArray(r.rate_limits) ? r.rate_limits : []) {
        const w = obj(value), window = text(w.window), total = decimal(w.limit), used = decimal(w.used), remaining = decimal(w.remaining);
        const minutes = ({ '5h': 300, '1d': 1440, '7d': 10080 } as Record<string, number>)[window];
        if (!minutes || total === null || total.startsWith('-') || !/[1-9]/.test(total)) { out.partialFailures.push({ field: `window-${window}`, reason: '窗口或上限无效' }); continue; }
        const reset = instant(w.reset_at), start = instant(w.window_start), left = remaining ?? (used === null ? null : exact(total, used, 'subtract'));
        const dateField = (v: string) => field<EntitlementDate>({ precision: 'instant', value: v }, out, source);
        out.metrics.push({ id: `key-${window}`, label: `Key ${window} 预算`, scope: 'key', unit: 'USD', remaining: left, used, total, resetAt: reset, resetObservation: reset ? dateField(reset) : undefined, windowStart: start ? dateField(start) : undefined, windowMinutes: minutes, observedAt: at, availability: left === null ? 'unfetched' : 'known', source, dataOrigin: 'official_api', evidence: remaining === null && left !== null ? 'derived' : 'reported', staleAfterMinutes: 30 });
      }
    }
    if (!out.balances!.length && !out.metrics.length) throw new AdapterError('SCHEMA_CHANGED', '未返回可识别余额或预算，保留旧观察');
    out.samples = out.balances!.map(b => `${b.label}：${b.amount.value} ${b.currency}`);
    return out;
  }
  describeRecovery(error: AdapterError) { return defaultDescribeRecovery(this.manifest, error); }
  async disconnect() {}
}

export function createWalletAdapters(options: WalletAdapterOptions = {}): ProviderAdapter[] {
  const fixed: Config[] = [
    { id: 'kimi-platform-global', product: 'Kimi API 国际', origin: 'https://api.moonshot.ai', path: '/v1/users/me/balance', mode: 'kimi', currency: 'USD', source: 'kimi-global' },
    ...(['cn', 'com'] as const).map(region => ({ id: `siliconflow-${region === 'cn' ? 'cn' : 'global'}`, product: `SiliconFlow ${region === 'cn' ? '国内' : '国际'}`, origin: `https://api.siliconflow.${region}`, path: '/v1/user/info', mode: 'siliconflow' as const, currency: region === 'cn' ? 'CNY' : 'USD', source: `siliconflow-${region === 'cn' ? 'cn' : 'global'}` })),
    { id: 'aihubmix-key', product: 'AiHubMix Key', origin: 'https://aihubmix.com', path: '/dashboard/billing/remain', mode: 'aihubmix-key', currency: 'USD', source: 'aihubmix' },
    { id: 'aihubmix-account', product: 'AiHubMix 账号', origin: 'https://aihubmix.com', path: '/api/user/self', mode: 'aihubmix-account', currency: 'USD', source: 'aihubmix' },
  ];
  const seen = new Set<string>();
  for (const approved of options.approvedOrigins ?? []) {
    if (!Object.prototype.hasOwnProperty.call(paths, approved.template) || !text(approved.source) || /[\r\n]/.test(approved.source)) throw new AdapterError('UNSUPPORTED', '模板或可信来源无效');
    const site = origin(approved.origin), id = `${approved.template}-${hash(site + ':' + approved.source)}`;
    if (seen.has(id)) continue; seen.add(id);
    fixed.push({ id, product: approved.template, origin: site, path: paths[approved.template], mode: approved.template, currency: 'USD', source: approved.source, relay: true });
  }
  return fixed.map(config => new WalletAdapter(config, options.fetchFn));
}
export const walletAdapters: ProviderAdapter[] = createWalletAdapters();
