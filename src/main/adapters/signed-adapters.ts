/** Read-only adaptations of Magpie ba319a7587923fc7a4ea3859658244d591261a59
 * (MIT, Copyright (c) 2026 yetone) and magpie-community/plugins
 * aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6 (MIT, community contributors).
 * Exact source mapping, limitations and notices: docs/evidence/full-service/signed.md.
 * Never imports/runs the plugins, refreshes credentials, claims grants or calls models. */
import { createHash, createHmac } from 'node:crypto';
import type { Balance, EntitlementDate, Field } from '../../shared/types';
import { formatDecimalString, parseRetryAfterMs, type HttpFetchFn } from './http-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type ProviderAdapter } from './types';

export type SignedFetchFn = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal }) => ReturnType<HttpFetchFn>;
const defaultSignedFetch: SignedFetchFn = async (url, init) => {
  const res = await fetch(url, { ...init, redirect: 'error' });
  return { status: res.status, headers: res.headers, async text() {
    const reader = res.body?.getReader(); if (!reader) return '';
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '响应超过大小限制'); chunks.push(value);
    } return Buffer.concat(chunks).toString('utf8'); } finally { await reader.cancel().catch(() => {}); }
  } };
};
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const decimal = formatDecimalString;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const mac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest();
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function signedCanonicalQuery(url: URL): string {
  return [...url.searchParams].sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0).map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
}
/** Exact decimal subtraction: balances must not acquire binary floating point noise. */
function subtract(a: string, b: string): string {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (s: string) => { const negative = s.startsWith('-'), [w, f = ''] = (negative ? s.slice(1) : s).split('.'); return BigInt(w + f.padEnd(scale, '0')) * (negative ? -1n : 1n); };
  const n = integer(a) - integer(b), s = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  return (n < 0n ? '-' : '') + (scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : s);
}
function date(v: unknown, vendorZone = false): EntitlementDate | null {
  const s = text(v);
  if (/^\d{4}-\d\d-\d\d$/.test(s)) { const ms = Date.parse(s + 'T00:00:00Z'); return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? { precision: 'day', value: s } : null; }
  if (/^\d{4}-\d\d-\d\d/.test(s) && !date(s.slice(0, 10))) return null;
  let iso = s;
  if (vendorZone && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(s)) iso = s.replace(' ', 'T') + '+08:00';
  const n = decimal(v), ms = /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(iso) ? Date.parse(iso) : n !== null && Number(n) > 0 ? Number(n) * (Number(n) < 1e11 ? 1000 : 1) : NaN;
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? { precision: 'instant', value: new Date(ms).toISOString() } : null;
}
function observation<T>(value: T, out: CollectOutput, source: string, evidence: 'reported' | 'derived' = 'reported'): Field<T> {
  return { value, source, evidence, observedAt: out.observedAt, dataOrigin: 'official_api', availability: 'known' };
}
function output(m: AdapterManifest, at: string): CollectOutput {
  return { account: { subject: m.id, alias: m.product, organization: '', region: m.region }, poolId: m.id, metrics: [], fields: [], balances: [], samples: [], partialFailures: [], observedAt: at };
}
function plan(out: CollectOutput, value: string, source: string) {
  if (value) out.fields.push({ field: 'plan', value, source, observedAt: out.observedAt, evidence: 'reported', dataOrigin: 'official_api', availability: 'known' });
}
function metric(out: CollectOutput, id: string, label: string, unit: string, used: string | null, total: string | null, remaining: string | null, reset: EntitlementDate | null, source: string) {
  out.metrics.push({ id, label, unit, used, total, remaining, resetAt: reset?.value ?? null, resetObservation: reset ? observation(reset, out, source) : undefined, source, observedAt: out.observedAt, evidence: 'derived', dataOrigin: 'official_api', availability: remaining === null ? 'unfetched' : 'known', staleAfterMinutes: 30, scope: 'account' });
}
function balance(out: CollectOutput, id: string, amount: string, source: string, kind: Balance['kind'], expiry: EntitlementDate | null = null, evidence: 'reported' | 'derived' = 'reported') {
  out.balances!.push({ id, label: id, scope: 'account', kind, currency: 'credits', amount: observation(amount, out, source, evidence), ...(expiry ? { expiresAt: observation(expiry, out, source) } : {}) });
}
function finish(out: CollectOutput) {
  if (!out.metrics.length && !out.fields.length && !out.balances?.length) throw new AdapterError('SCHEMA_CHANGED', '未返回可识别权益，保留旧观察');
  return out;
}
function manifest(id: string, product: string, region: string, hosts: string[]): AdapterManifest {
  return { id, version: '1.0.0', brand: product, product, region, supportedFields: ['套餐', '实际额度窗口', '余额及积分批次'], unsupportedFields: ['实际付款', '未返回的会员/续费信息', '凭据自动刷新'], authMode: 'local_client', officialSourceUrl: `https://${hosts[0]}/`, termsCheckedAt: '2026-10-21', allowedHosts: hosts, minIntervalSeconds: 300, defaultForegroundSeconds: 1800, defaultBackgroundSeconds: 3600, timeoutMs: 15000, supportTier: 'official_auto', permissions: '仅固定白名单只读查询；不签到、不领取、不调用模型、不刷新或改写来源凭据；真实账号待验证', credentialLocation: '主进程加密凭据 JSON；保留原客户端 access/metadata 及地区上下文' };
}

/** A local envelope only: provider is source-bound by the main-process importer.
 * access may be JSON text as stored by OpenCode; metadata is never discarded. */
export interface SignedCredential {
  provider: string; region: string; accessKeyId: string; secretAccessKey: string;
  securityToken?: string; expiresAt?: unknown; accountId?: string; teamId?: string; alias?: string; subject?:string;
}
function credential(input: CollectInput, m: AdapterManifest, aliases: string[]): SignedCredential {
  let root: Obj;
  try { root = obj(JSON.parse(input.secret ?? '')); } catch { throw new AdapterError('AUTH_REQUIRED', '需要带来源和地区的签名凭据 JSON'); }
  const storedAccess = root.accessToken ?? root.access;
  let access = obj(storedAccess);
  if (typeof storedAccess === 'string') { try { access = obj(JSON.parse(storedAccess)); } catch { /* not a credential JSON */ } }
  const r = { ...obj(root.metadata), ...access, ...root };
  if (![m.id, ...aliases].includes(text(r.provider ?? r.source))) throw new AdapterError('AUTH_REQUIRED', '签名凭据来源不匹配');
  const c: SignedCredential = { provider: m.id, region: text(r.region), accessKeyId: text(r.accessKeyId ?? r.accessKeyID ?? r.access_key_id ?? r.AccessKeyID ?? r.SecretId ?? r.secretId), secretAccessKey: text(r.secretAccessKey ?? r.secret_access_key ?? r.SecretAccessKey ?? r.SecretKey ?? r.secretKey), securityToken: text(r.securityToken ?? r.security_token ?? r.Token ?? r.sessionToken), expiresAt: r.expiresAt ?? r.expires_at ?? r.expiration ?? r.expires, accountId: text(r.accountId ?? r.account_id ?? r.user_id), teamId: text(r.teamId ?? r.TeamId), alias: text(r.alias) };
  c.region = c.region || text(r.Region) || (m.id === 'codearts' ? m.region : '');
   c.subject = text(r.subject) || undefined;
  if (c.region !== m.region || !c.accessKeyId || !c.secretAccessKey || Object.values(c).some(v => typeof v === 'string' && /[\r\n]/.test(v))) throw new AdapterError('AUTH_REQUIRED', '签名凭据缺失或地区不匹配，未发送请求');
  return c;
}

export function signHuawei(ak: string, sk: string, token: string, method: 'GET' | 'POST', urlString: string, body: string, now: Date): Record<string, string> {
  const url = new URL(urlString), payloadHash = hash(body), sdkDate = stamp(now);
  const headers: Record<string, string> = { host: url.host, 'x-sdk-date': sdkDate, 'x-sdk-content-sha256': payloadHash, 'x-security-token': token };
  if (method !== 'GET') headers['content-type'] = 'application/json';
  const keys = Object.keys(headers).sort(), signed = keys.join(';');
  const uri = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
  const canonical = [method, uri, signedCanonicalQuery(url), keys.map(k => `${k}:${headers[k]}`).join('\n'), '', signed, payloadHash].join('\n');
  headers.Authorization = `SDK-HMAC-SHA256 Access=${ak},SignedHeaders=${signed},Signature=${mac(sk, `SDK-HMAC-SHA256\n${sdkDate}\n${hash(canonical)}`).toString('hex')}`;
  return headers;
}
export function signVolcengine(ak: string, sk: string, region: string, action: string, body: string, now: Date, token = ''): Record<string, string> {
  const xDate = stamp(now), day = xDate.slice(0, 8), payloadHash = hash(body), url = new URL('https://open.volcengineapi.com/');
  url.searchParams.set('Action', action); url.searchParams.set('Version', '2024-01-01');
  const headers: Record<string, string> = { 'content-type': 'application/json', host: url.host, 'x-content-sha256': payloadHash, 'x-date': xDate };
  if (token) headers['x-security-token'] = token;
  const keys = Object.keys(headers).sort(), signed = keys.join(';'), scope = `${day}/${region}/ark/request`;
  const canonical = ['POST', '/', signedCanonicalQuery(url), keys.map(k => `${k}:${headers[k]}\n`).join(''), signed, payloadHash].join('\n');
  let key = mac(sk, day); for (const s of [region, 'ark', 'request']) key = mac(key, s);
  headers.Authorization = `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed}, Signature=${mac(key, `HMAC-SHA256\n${xDate}\n${scope}\n${hash(canonical)}`).toString('hex')}`;
  return headers;
}
export function signTencent(id: string, secret: string, service: string, host: string, action: string, body: string, now: Date): string {
  const day = now.toISOString().slice(0, 10), scope = `${day}/${service}/tc3_request`, signed = 'content-type;host;x-tc-action';
  const canonical = ['POST', '/', '', `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`, signed, hash(body)].join('\n');
  const key = mac(mac(mac(`TC3${secret}`, day), service), 'tc3_request');
  return `TC3-HMAC-SHA256 Credential=${id}/${scope}, SignedHeaders=${signed}, Signature=${mac(key, `TC3-HMAC-SHA256\n${Math.floor(now.getTime() / 1000)}\n${scope}\n${hash(canonical)}`).toString('hex')}`;
}

abstract class SignedAdapter implements ProviderAdapter {
  abstract readonly manifest: AdapterManifest;
  protected abstract readonly aliases: string[];
  private readonly requests = new Map<string, symbol>();
  constructor(protected readonly fetchFn: SignedFetchFn = defaultSignedFetch, protected readonly now: () => Date = () => new Date()) {}
  probe(input: CollectInput) { return this.collect(input); }
  protected abstract query(c: SignedCredential, input: CollectInput): Promise<unknown>;
  abstract normalize(raw: unknown, at: string): CollectOutput;
  protected async request(urlString: string, method: 'GET' | 'POST', headers: Record<string, string>, body: string, input: CollectInput): Promise<unknown> {
    const url = new URL(urlString);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !this.manifest.allowedHosts.includes(url.hostname)) throw new AdapterError('UNSUPPORTED', '拒绝向非白名单主机发送签名凭据');
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const controller = new AbortController(), onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? this.manifest.timeoutMs);
    try {
      // Race also rejects an injected transport that ignores AbortSignal; late replies are never accepted.
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new AdapterError(input.signal?.aborted ? 'CANCELLED' : 'TIMEOUT', '只读查询已取消或超时')), { once: true }));
      return await Promise.race([aborted, (async () => {
        const res = await this.fetchFn(url.toString(), { method, headers: { Accept: 'application/json', ...headers }, ...(method === 'POST' ? { body } : {}), signal: controller.signal });
        const code = res.status;
        if (code === 401) throw new AdapterError('AUTH_REQUIRED', '签名凭据已失效');
        if (code === 403) throw new AdapterError('PERMISSION_DENIED', '没有只读查询权限');
        if (code === 429) throw new AdapterError('RATE_LIMITED', '供应商限流', { retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after')) });
        if (code < 200 || code >= 300) throw new AdapterError('UPSTREAM_UNAVAILABLE', `只读接口 HTTP ${code}`);
        const raw = await res.text(); if (Buffer.byteLength(raw) > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '响应超过大小限制');
        try { return JSON.parse(raw) as unknown; } catch { throw new AdapterError('SCHEMA_CHANGED', '响应不是 JSON'); }
      })()]);
    } catch (e) { if (e instanceof AdapterError) throw e; throw new AdapterError('NETWORK_OFFLINE', '只读查询网络失败'); }
    finally { clearTimeout(timeout); input.signal?.removeEventListener('abort', onAbort); }
  }
  async collect(original: CollectInput): Promise<CollectOutput> {
    const input = { ...original }, c = credential(input, this.manifest, this.aliases);
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const expires = date(c.expiresAt, this.manifest.id === 'codearts');
    if (c.expiresAt !== undefined && (!expires || expires.precision !== 'instant')) throw new AdapterError('AUTH_REQUIRED', '临时签名凭据有效期无效，请从原客户端重新读取完整 auth 包');
    if (expires && Date.parse(expires.value) <= this.now().getTime()) throw new AdapterError('AUTH_REQUIRED', '临时签名凭据已过期，请从原客户端重新读取');
    const subject = c.subject ?? `${this.manifest.id}:${hash(JSON.stringify([c.region, c.accountId || c.accessKeyId, c.teamId || ''])).slice(0, 24)}`;
    if (input.expectedSubject && input.expectedSubject !== subject) throw new AdapterError('ACCOUNT_MISMATCH', '账号、团队或地区已变化');
    const ticket = Symbol(); this.requests.set(input.connectionId, ticket);
    const at = this.now().toISOString();
    try {
      const raw = await this.query(c, input);
      if (input.signal?.aborted || this.requests.get(input.connectionId) !== ticket) throw new AdapterError('CANCELLED', '旧账号或旧代次响应已丢弃');
      const out = this.normalize(raw, at);
      out.account.subject = subject; out.account.region = c.region; out.account.alias = c.alias || out.account.alias; out.poolId = `pool-${subject}`;
      if (c.teamId) out.account.organization = c.teamId;
      if (expires) out.credentialExpiresAt = observation(expires, out, '原客户端签名凭据有效期');
      out.metrics.forEach(m => { m.poolId = `${out.poolId}:${m.poolId ?? m.id}`; });
      out.balances?.forEach(b => { b.poolId = `${out.poolId}:${b.id}`; });
      return out;
    } finally { if (this.requests.get(input.connectionId) === ticket) this.requests.delete(input.connectionId); }
  }
  describeRecovery(error: AdapterError) { return defaultDescribeRecovery(this.manifest, error); }
  async disconnect() { this.requests.clear(); }
}
function businessError(code: unknown) {
  const s = text(code);
  throw new AdapterError(/denied|unauthorized|forbidden/i.test(s) ? 'PERMISSION_DENIED' : /auth|signature|accesskey|credential|securitytoken|APIG\.0(?:301|307|602)/i.test(s) ? 'AUTH_REQUIRED' : /limit|throttl/i.test(s) ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE', '供应商只读接口拒绝查询（未保留响应正文）');
}
function failure(out: CollectOutput, field: string) { out.partialFailures.push({ field, reason: '子查询或字段失败，保留上次成功观察' }); }
function fatalReadError(e: unknown): boolean {
  return e instanceof AdapterError && ['AUTH_REQUIRED', 'PERMISSION_DENIED', 'ACCOUNT_MISMATCH', 'CANCELLED'].includes(e.code);
}

export class VolcenginePlanAdapter extends SignedAdapter {
  readonly manifest: AdapterManifest;
  protected readonly aliases = ['volcengine'];
  constructor(private readonly kind: 'coding' | 'agent' = 'coding', region = 'cn-beijing', fetchFn?: SignedFetchFn, now?: () => Date) {
    super(fetchFn, now); if (!/^[a-z]+-[a-z0-9-]+$/.test(region)) throw new AdapterError('UNSUPPORTED', '火山地区无效');
    this.manifest = manifest(`volcengine-${kind}-${region}`, `火山 Ark ${kind === 'coding' ? 'Coding' : 'Agent'} Plan`, region, ['open.volcengineapi.com']);
  }
  protected async query(c: SignedCredential, input: CollectInput) {
    const action = this.kind === 'coding' ? 'GetCodingPlanUsage' : 'GetAFPUsage', body = '{}';
    const raw = obj(await this.request(`https://open.volcengineapi.com/?Action=${action}&Version=2024-01-01`, 'POST', signVolcengine(c.accessKeyId, c.secretAccessKey, c.region, action, body, this.now(), c.securityToken), body, input));
    const e = obj(obj(raw.ResponseMetadata).Error); if (Object.keys(e).length) businessError(e.Code); return raw;
  }
  normalize(raw: unknown, at: string) {
    const r = obj(obj(raw).Result), out = output(this.manifest, at), source = `Volcengine ${this.kind === 'coding' ? 'GetCodingPlanUsage' : 'GetAFPUsage'}`;
    const buckets: Obj[] = this.kind === 'coding' ? list(r.QuotaUsage).map(obj) : [['session', r.AFPFiveHour], ['weekly', r.AFPWeekly], ['monthly', r.AFPMonthly]].filter(([, v]) => v !== undefined).map(([level, v]) => ({ ...obj(v), Level: level }));
    for (const b of buckets) {
      const level = text(b.Level).toLowerCase(); if (!['session', 'weekly', 'monthly'].includes(level)) continue;
      const percent = decimal(b.Percent), used = decimal(b.Used), total = decimal(b.Quota ?? b.Total);
      if (percent === null && (used === null || total === null || Number(total) <= 0)) { failure(out, level); continue; }
      // AFP does not document an absolute unit. Never label its raw quota as tokens/credits.
      const p = percent ?? decimal(Number(used) / Number(total) * 100);
      if (p === null || !Number.isFinite(Number(p))) { failure(out, level); continue; }
      metric(out, level, level, '%', p, '100', subtract('100', p), date(b.ResetTime ?? b.ResetTimestamp), source);
      if (level === 'session') out.metrics.at(-1)!.windowMinutes = 300;
      if (level === 'weekly') out.metrics.at(-1)!.windowMinutes = 10080;
      // A calendar month is not a fixed 30-day window.
    }
    if (out.metrics.length) plan(out, `${this.kind === 'coding' ? 'Coding Plan' : 'Agent Plan'}${text(r.Tier) ? ` ${text(r.Tier)}` : ''}`, source);
    return finish(out);
  }
}

export class TencentTokenPlanAdapter extends SignedAdapter {
  readonly manifest: AdapterManifest;
  protected readonly aliases = ['tencent-cloud', 'tencent'];
  constructor(region: 'ap-guangzhou' | 'ap-singapore' = 'ap-guangzhou', fetchFn?: SignedFetchFn, now?: () => Date) {
    super(fetchFn, now); this.manifest = manifest(`tencent-token-plan-${region}`, '腾讯 Token Plan 企业版', region, ['tokenhub.tencentcloudapi.com']);
  }
  private async call(action: 'DescribeTokenPlanList' | 'DescribeTokenPlan', params: Obj, c: SignedCredential, input: CollectInput): Promise<Obj> {
    const body = JSON.stringify(params), now = this.now(), host = this.manifest.allowedHosts[0];
    const raw = obj(await this.request(`https://${host}/`, 'POST', { 'Content-Type': 'application/json; charset=utf-8', Host: host, 'X-TC-Action': action, 'X-TC-Version': '2026-03-22', 'X-TC-Region': c.region, 'X-TC-Timestamp': String(Math.floor(now.getTime() / 1000)), ...(c.securityToken ? { 'X-TC-Token': c.securityToken } : {}), Authorization: signTencent(c.accessKeyId, c.secretAccessKey, 'tokenhub', host, action, body, now) }, body, input));
    if (!raw.Response || typeof raw.Response !== 'object') throw new AdapterError('SCHEMA_CHANGED', '腾讯缺少 Response');
    const r = obj(raw.Response); if (r.Error) businessError(obj(r.Error).Code); return r;
  }
  protected async query(c: SignedCredential, input: CollectInput) {
    const plans = new Map<string, Obj>(), failures: string[] = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      let r: Obj;
      try { r = await this.call('DescribeTokenPlanList', { Offset: offset, Limit: 100 }, c, input); if (!Array.isArray(r.TokenPlanSet)) throw new AdapterError('SCHEMA_CHANGED', '腾讯缺少 TokenPlanSet'); }
      catch (e) { if (!plans.size || fatalReadError(e)) throw e; failures.push(`list:${offset}`); break; }
      const items = list(r.TokenPlanSet).map(obj), before = plans.size;
      let invalid = false;
      for (const p of items) {
        const id = text(p.TeamId); if (!id || plans.has(id)) { invalid = true; continue; }
        plans.set(id, p);
      }
      if (invalid) { failures.push(`list:${offset}:duplicate-or-missing-team`); break; }
      const total = decimal(r.TotalCount ?? r.Total);
      if (total !== null && (!Number.isSafeInteger(Number(total)) || Number(total) < 0)) throw new AdapterError('SCHEMA_CHANGED', '腾讯列表总数无效');
      if (total !== null ? offset + items.length >= Number(total) : items.length < 100) break;
      if (plans.size === before) { failures.push('list:pagination-stalled'); break; }
      if (offset === 9900) failures.push('list:pagination-limit');
    }
    if (c.teamId && !plans.has(c.teamId)) throw new AdapterError(failures.length ? 'PARTIAL' : 'ACCOUNT_MISMATCH', '指定团队未出现在当前地区完整可见列表');
    const selected = [...plans].filter(([id]) => !c.teamId || c.teamId === id);
    for (const [id, p] of selected) {
      try {
        const d = await this.call('DescribeTokenPlan', { TeamId: id }, c, input);
        if (d.TeamId !== undefined && text(d.TeamId) !== id) throw new AdapterError('ACCOUNT_MISMATCH', '腾讯详情团队不匹配');
        plans.set(id, { ...p, ...d, TeamId: id, PackageInfo: { ...obj(p.PackageInfo), ...obj(d.PackageInfo) }, TokenSummary: { ...obj(p.TokenSummary), ...obj(d.TokenSummary) } });
      } catch (e) { if (fatalReadError(e)) throw e; failures.push(`team:${id}`); }
    }
    return { plans: selected.map(([id]) => plans.get(id)), failures };
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = output(this.manifest, at), source = 'Tencent DescribeTokenPlan/List';
    const organizations = new Map<string, { id: string; name: string }>();
    for (const value of list(r.plans)) {
      const p = obj(value), id = text(p.TeamId), pk = obj(p.PackageInfo), summary = obj(p.TokenSummary), type = text(p.ProductType).toLowerCase();
      if (!id) continue;
      if (!organizations.has(id)) organizations.set(id, { id, name: text(p.Name) || id });
      const unit = type === 'enterprise' ? 'credits' : type === 'enterprise-auto' ? 'tokens' : null;
      let total = decimal(pk.CycleQuota); if (total === null || Number(total) <= 0) total = decimal(pk.TotalQuota);
      const used = decimal(pk.TotalUsed), end = date(summary.CycleEndTime), start = date(summary.CycleStartTime), expiry = date(pk.ExpireTime);
      if (unit && total !== null && Number(total) > 0 && used !== null) {
        metric(out, `team:${id}:cycle`, `${text(p.Name) || id} · ${type}`, unit, used, total, subtract(total, used), end, source);
        const m = out.metrics.at(-1)!; m.scope = 'organization'; m.poolId = `team:${id}`;
        if (start) m.windowStart = observation(start, out, source); if (end) m.windowEnd = observation(end, out, source);
      } else failure(out, `team:${id}:quota-or-unit`);
      // Shared entitlements cannot represent several teams. Only an unambiguous single-team result gets dates.
      if (list(r.plans).length === 1) {
        if (expiry) (out.entitlements ??= {}).membershipExpiresAt = observation(expiry, out, source);
        if (end) (out.entitlements ??= {}).billingPeriodEnd = observation(end, out, source);
        out.account.organization = id;
      } else if (expiry) failure(out, `team:${id}:membership-date-requires-team-connection`);
    }
    out.discoveredOrganizations = [...organizations.values()];
    if (list(r.plans).length) plan(out, 'Token Plan Enterprise', source);
    for (const f of list(r.failures)) failure(out, text(f));
    return finish(out);
  }
}

const SNAP = 'https://snap-access.cn-north-4.myhuaweicloud.com';
export class CodeArtsAdapter extends SignedAdapter {
  readonly manifest = manifest('codearts', 'CodeArts 码道', 'cn-north-4', ['snap-access.cn-north-4.myhuaweicloud.com', 'opengw.developer.huaweicloud.com']);
  protected readonly aliases: string[] = [];
  private async call(path: string, c: SignedCredential, input: CollectInput, payload?: Obj, benefit = false): Promise<unknown> {
    if (!c.securityToken) throw new AdapterError('AUTH_REQUIRED', 'CodeArts 需要临时 AK/SK/security_token');
    const method = payload ? 'POST' : 'GET', body = payload ? JSON.stringify(payload) : '', url = `${benefit ? 'https://opengw.developer.huaweicloud.com' : SNAP}${path}`;
    const r = obj(await this.request(url, method, { ...signHuawei(c.accessKeyId, c.secretAccessKey, c.securityToken, method, url, body, this.now()), ...(!benefit ? { 'Agent-Type': 'PromptCenter', 'X-Language': 'zh-cn' } : {}) }, body, input));
    if (r.error_code || r.code !== undefined && ![0, '0', '0000'].includes(r.code as number | string)) businessError(r.error_code ?? r.code);
    return r.data ?? r.result ?? r;
  }
  protected async query(c: SignedCredential, input: CollectInput) {
    if (!c.securityToken) throw new AdapterError('AUTH_REQUIRED', 'CodeArts 缺少临时 security_token');
    const raw: Obj = { packages: [], grants: [], failures: [] }, failures = raw.failures as string[];
    let firstError: unknown, reached = false;
    const read = async (name: string, fn: () => Promise<unknown>) => { try { raw[name] = await fn(); reached = true; } catch (e) { firstError ??= e; failures.push(name); if (fatalReadError(e)) throw e; } };
    await Promise.all([
      read('statistics', () => this.call('/snap-manager/v1/statistics/plugin', c, input)),
      read('benefit', () => this.call('/api/v1/user/tokens/balance', c, input, undefined, true)),
    ]);
    const pages = async (name: string, path: string, arrayKey: string, target: unknown[], payload?: Obj) => {
      const seenPages = new Set<string>(); let received = 0;
      for (let page = 1; page <= 100; page++) {
        try {
          const r = obj(await this.call(payload ? path : `${path}${path.includes('?') ? '&' : '?'}pageNum=${page}&pageSize=100`, c, input, payload ? { ...payload, pageNum: page, pageSize: 100 } : undefined));
          if (!Array.isArray(r[arrayKey])) throw new AdapterError('SCHEMA_CHANGED', '缺少分页列表');
          reached = true;
          const items = list(r[arrayKey]), pageHash = hash(JSON.stringify(items));
          if (items.length && seenPages.has(pageHash)) { failures.push(`${name}:pagination-repeated`); break; }
          seenPages.add(pageHash); target.push(...items); received += items.length;
          const total = decimal(r.total ?? r.totalCount);
          if (total !== null && (!Number.isSafeInteger(Number(total)) || Number(total) < 0)) throw new AdapterError('SCHEMA_CHANGED', 'CodeArts 分页总数无效');
          if (total !== null ? received >= Number(total) : items.length < 100) break;
          if (!items.length || page === 100) { failures.push(`${name}:pagination-limit`); break; }
        } catch (e) { if (fatalReadError(e)) throw e; firstError ??= e; failures.push(`${name}:page`); break; }
      }
    };
    await Promise.all([
      pages('packages:paid', '/snap-manager/v1/package/credit/page', 'list', raw.packages as unknown[], { sortField: 'created_time', sortOrder: 'desc', packageTypes: ['basic', 'ondemand'] }),
      pages('packages:bonus', '/snap-manager/v1/package/credit/page', 'list', raw.packages as unknown[], { packageTypes: ['bonus'] }),
    ]);
    await read('overview', () => this.call('/v1/ops/credit/overview', c, input));
    const campaigns = obj(raw.overview).items;
    if (raw.overview !== undefined && !Array.isArray(campaigns)) failures.push('overview:items');
    for (const v of list(campaigns)) {
      const campaign = obj(v), id = campaign.campaignId;
      if (typeof id !== 'string' && typeof id !== 'number') continue;
      const grants: unknown[] = [];
      await pages(`campaign:${id}`, `/v1/ops/credit/campaign/${encode(String(id))}`, 'benefits', grants);
      (raw.grants as unknown[]).push(...grants.map(v => ({ ...obj(v), campaignId: String(id) })));
    }
    if (!reached && firstError) throw firstError;
    return raw;
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = output(this.manifest, at), stats = obj(r.statistics), pkg = obj(stats.package), source = 'CodeArts statistics/plugin';
    plan(out, text(pkg.package_name_cn ?? pkg.package_name_en ?? pkg.spec_code), source);
    const reset = date(stats.end_date, true);
    for (const v of list(stats.metrics)) {
      const b = obj(v), id = text(b.name);
      if (!['usageTotalPackageCredit', 'usageBasicPackageCredit', 'usageOnDemandPackageCredit', 'usageBonusPackageCredit'].includes(id)) continue;
      const total = decimal(b.package_credit_amount), left = decimal(b.package_credit_remain);
      if (left === null) { failure(out, id); continue; }
      metric(out, id, id, 'credits', total !== null ? subtract(total, left) : null, total, left, id === 'usageBasicPackageCredit' ? reset : null, source);
      out.metrics.at(-1)!.evidence = 'reported';
      balance(out, id, left, source, id === 'usageTotalPackageCredit' ? 'total' : id === 'usageBonusPackageCredit' ? 'grant' : 'credit');
    }
    const seen = new Set<string>();
    for (const [type, values] of [['package', r.packages], ['grant', r.grants]] as const) for (const v of list(values)) {
      const b = obj(v), isGrant = type === 'grant', amount = decimal(isGrant ? b.claimedAmount : b.creditAmount), used = decimal(isGrant ? b.consumedAmount : b.creditUsed), expired = isGrant ? decimal(b.expiredAmount) : '0';
      if (amount === null || used === null || expired === null) { failure(out, `${type}:amount`); continue; }
      if ([amount, used, expired].some(n => Number(n) < 0)) { failure(out, `${type}:negative-amount`); continue; }
      const left = subtract(subtract(amount, used), expired), expiry = date(isGrant ? b.expireAt : b.expiredTime, true);
      if (Number(left) <= 0) continue;
      if (expiry && (expiry.precision === 'instant' ? Date.parse(expiry.value) <= Date.parse(at) : expiry.value < new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 10))) continue;
      const id = `${type}:${text(b.campaignId)}:${text(b.id ?? b.packageId ?? b.benefitId) || hash(JSON.stringify([b.packageType, b.createdTime ?? b.created_time, b.expiredTime ?? b.expireAt, amount])).slice(0, 24)}`;
      if (seen.has(id)) continue; seen.add(id);
      balance(out, id, left, `CodeArts ${isGrant ? 'ops/credit/campaign' : 'package/credit/page'}`, isGrant || b.packageType === 'bonus' ? 'grant' : 'credit', expiry, 'derived');
    }
    const benefit = obj(r.benefit), total = decimal(benefit.daily_token_limit), used = decimal(benefit.daily_tokens_used);
    if (total !== null && used !== null) {
      const beijingDay = new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 10), next = new Date(Date.parse(`${beijingDay}T00:00:00+08:00`) + 86400000).toISOString();
      metric(out, 'benefit:daily-tokens', '免费每日 token 池', 'tokens', used, total, subtract(total, used), null, 'CodeArts user/tokens/balance');
      const m = out.metrics.at(-1)!; m.resetAt = next; m.resetObservation = observation<EntitlementDate>({ precision: 'instant', value: next }, out, 'CodeArts 每日池：按北京时间零点规则计算，非接口返回时间', 'derived'); m.windowMinutes = 1440;
    }
    for (const f of list(r.failures)) failure(out, text(f));
    return finish(out);
  }
}

export function createSignedAdapters(fetchFn: SignedFetchFn = defaultSignedFetch, now?: () => Date): ProviderAdapter[] {
  return [new CodeArtsAdapter(fetchFn, now), new VolcenginePlanAdapter('coding', 'cn-beijing', fetchFn, now), new VolcenginePlanAdapter('agent', 'cn-beijing', fetchFn, now), new TencentTokenPlanAdapter('ap-guangzhou', fetchFn, now), new TencentTokenPlanAdapter('ap-singapore', fetchFn, now)];
}
export const signedAdapters: ProviderAdapter[] = createSignedAdapters();
