/**
 * Read-only extraction from magpie-community/plugins (MIT), Copyright (c) 2026
 * magpie-community contributors, aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6.
 * packages/{workbuddy,trae,minimax}/index.mjs; exact mapping and MIT notice:
 * docs/evidence/full-service/desktop-services.md. No plugin execution, login,
 * refresh, credential writes, check-in, claim or model requests.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { EntitlementDate, Field } from '../../shared/types';
import { formatDecimalString, OPENROUTER_KEY_MANIFEST, parseRetryAfterMs } from './http-adapters';
import { MiniMaxPlanAdapter } from './regional-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type ProviderAdapter } from './types';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const decimal = formatDecimalString;
const hash = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 24);
function arithmetic(a: string, b: string, subtract = false): string {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (s: string) => { const [w, f = ''] = s.split('.'); return BigInt(w + f.padEnd(scale, '0')); };
  const n = integer(a) + (subtract ? -integer(b) : integer(b));
  const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  return (n < 0n ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits);
}
function date(v: unknown, beijing = false): EntitlementDate | null {
  const s = text(v);
  if (/^\d{4}-\d\d-\d\d/.test(s)) {
    const day = s.slice(0, 10), ms = Date.parse(day + 'T00:00:00Z');
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return null;
    if (s === day) return { precision: 'day', value: day };
  }
  const local = beijing && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? s.replace(' ', 'T') + '+08:00' : s;
  const n = decimal(v);
  const ms = n !== null && Number(n) > 0 ? Number(n) * (Number(n) < 1e12 ? 1000 : 1)
    : /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(local) ? Date.parse(local) : NaN;
  return Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()) ? { precision: 'instant', value: new Date(ms).toISOString() } : null;
}
function field<T>(value: T, out: CollectOutput, evidence: 'reported' | 'derived' = 'reported'): Field<T> {
  return { value, availability: 'known', observedAt: out.observedAt, source: '供应商只读权益接口', dataOrigin: 'official_api', evidence };
}
function base(m: AdapterManifest, at: string): CollectOutput {
  return { account: { subject: m.id, alias: m.product, organization: '', region: m.region }, poolId: `pool-${m.id}`, metrics: [], fields: [], partialFailures: [], samples: [], observedAt: at };
}
function plan(out: CollectOutput, value: unknown, evidence: 'reported' | 'derived' = 'reported') {
  if (text(value)) out.fields.push({ field: 'plan', value: text(value), availability: 'known', observedAt: out.observedAt, source: '供应商只读权益接口', dataOrigin: 'official_api', evidence });
}
function metric(out: CollectOutput, id: string, label: string, unit: string, total: string | null, used: string | null, scope: 'account' | 'organization' = 'account', reset: EntitlementDate | null = null) {
  out.metrics.push({ id, label, unit, total, used, remaining: total !== null && used !== null ? arithmetic(total, used, true) : null,
    resetAt: reset?.value ?? null, resetObservation: reset ? field(reset, out) : undefined, availability: total !== null && used !== null ? 'known' : 'unfetched',
    observedAt: out.observedAt, source: '供应商只读权益接口', dataOrigin: 'official_api', staleAfterMinutes: 30, evidence: 'derived', scope, poolId: id });
}
function finish(out: CollectOutput) {
  if (!out.metrics.length && !out.fields.length && !out.balances?.length && !out.entitlements) throw new AdapterError('SCHEMA_CHANGED', '权益响应缺少可识别字段，保留旧观察');
  out.samples = out.metrics.map(m => `${m.label}：${m.remaining ?? '未知'} ${m.unit}`);
  return out;
}
function manifest(id: string, product: string, region: string, hosts: string[]): AdapterManifest {
  return { ...OPENROUTER_KEY_MANIFEST, id, brand: product, product, region, allowedHosts: hosts, authMode: 'local_client', officialSourceUrl: `https://${hosts[0]}`,
    supportedFields: ['来源实际返回的套餐、额度、积分余额及有效期'], unsupportedFields: ['实际付款', '未返回的续费日期', '自动刷新外部登录'],
    permissions: '固定白名单 GET/只读 POST RPC；不刷新外部 token，不签到、领取、购买或调用模型。',
    credentialLocation: '主进程已发现账号 envelope；定位信息不出主进程', termsCheckedAt: '2026-10-21' };
}

export type DesktopFetchFn = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{
  status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
}>;
const defaultFetch: DesktopFetchFn = async (url, init) => {
  const r = await fetch(url, { ...init, redirect: 'error' });
  return { status: r.status, headers: r.headers, text: async () => {
    const reader = r.body?.getReader(); if (!reader) return '';
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '响应超过大小限制'); chunks.push(p.value); } }
    finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks).toString('utf8');
  } };
};

interface Credential extends Obj { accessToken: string; source: string; uid: string; subject: string; alias: string; region: string; }
function credential(input: CollectInput, m: AdapterManifest): Credential {
  let r: Obj;
  try { r = obj(JSON.parse(input.secret ?? '')); } catch { throw new AdapterError('AUTH_REQUIRED', '需要主进程发现的已登录账号'); }
  // Preserve original auth fields; never dereference locator or spend refresh.
  const source = text(r.source), provider = text(r.provider);
  const pluginSource = m.id.startsWith('trae-global-') ? 'trae-global' : m.id;
  if (provider ? provider !== m.id : source !== m.id && source !== pluginSource) throw new AdapterError('AUTH_REQUIRED', '账号来源与服务地区不一致');
  const token = text(r.accessToken ?? r.access ?? r.token);
  if (!token || /[\r\n]/.test(token)) throw new AdapterError('AUTH_REQUIRED', '访问凭据不可读或已加密，请在原客户端重新登录');
  for (const k of ['uid', 'domain', 'enterpriseId', 'deviceId', 'machineId', 'subject', 'alias', 'region', 'realUserID']) {
    if (r[k] !== undefined && (typeof r[k] !== 'string' || /[\r\n]/.test(String(r[k])))) throw new AdapterError('AUTH_REQUIRED', '账号上下文字段无效');
  }
  if (r.region && !m.id.startsWith('trae-global') && ![m.region.toLowerCase(), m.allowedHosts[0], m.id === 'minimax-code-global' ? 'en' : ''].includes(text(r.region).toLowerCase())) throw new AdapterError('AUTH_REQUIRED', '账号地区不一致');
  if (m.id.startsWith('trae-global') && !text(r.region)) throw new AdapterError('AUTH_REQUIRED', 'Trae 国际来源缺少明确地区，未猜测部署');
  const expires = Number(r.expires ?? r.expiresAt);
  if (Number.isFinite(expires) && expires > 0 && expires <= Date.now()) throw new AdapterError('AUTH_REQUIRED', '外部登录已过期，请在原客户端重新登录');
  const uid = text(r.uid ?? r.userId ?? r.realUserID);
  if ((m.id.startsWith('workbuddy') || m.id.startsWith('trae')) && !uid) throw new AdapterError('AUTH_REQUIRED', '缺少原账号 uid，未发送请求');
  if (m.id.startsWith('trae') && !text(r.deviceId)) throw new AdapterError('AUTH_REQUIRED', '缺少原登录设备上下文，未生成或替换设备');
  return { ...r, accessToken: token, uid, source: m.id, region: text(r.region) || m.region,
    subject: text(r.subject) || `${m.id}:${hash(JSON.stringify([r.region ?? m.region, uid || token, r.enterpriseId ?? '', r.account ?? {}]))}`,
    alias: text(r.alias ?? r.accountId ?? r.name) };
}

abstract class DesktopAdapter implements ProviderAdapter {
  abstract readonly manifest: AdapterManifest;
  constructor(protected readonly fetchFn: DesktopFetchFn = defaultFetch) {}
  probe(input: CollectInput) { return this.collect(input); }
  protected abstract query(c: Credential, input: CollectInput): Promise<unknown>;
  abstract normalize(raw: unknown, at: string): CollectOutput;
  protected async request(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body: unknown, input: CollectInput, allowedPaths: string[]) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || !this.manifest.allowedHosts.includes(u.hostname) || !allowedPaths.includes(u.pathname)) throw new AdapterError('UNSUPPORTED', '禁止非白名单权益请求');
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const controller = new AbortController(), onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? this.manifest.timeoutMs);
    try {
      const r = await this.fetchFn(u.toString(), { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }), signal: controller.signal });
      if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
      if (controller.signal.aborted) throw new AdapterError('TIMEOUT', '权益查询超时');
      if (r.status === 401) throw new AdapterError('AUTH_REQUIRED', '外部登录已失效，请在原客户端重新登录', { httpStatus: 401 });
      if (r.status === 403) throw new AdapterError('PERMISSION_DENIED', '账号无权益读取权限', { httpStatus: 403 });
      if (r.status === 429) throw new AdapterError('RATE_LIMITED', '权益查询限流', { httpStatus: 429, retryAfterMs: parseRetryAfterMs(r.headers.get('retry-after')) ?? 60000 });
      if (r.status < 200 || r.status >= 300) throw new AdapterError('UPSTREAM_UNAVAILABLE', `权益查询失败（HTTP ${r.status}）`, { httpStatus: r.status });
      const raw = await r.text();
      if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
      if (controller.signal.aborted) throw new AdapterError('TIMEOUT', '权益查询超时');
      if (raw.length > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '响应超过大小限制');
      let v: unknown;
      try { v = JSON.parse(raw); } catch { throw new AdapterError('SCHEMA_CHANGED', '权益响应不是有效 JSON'); }
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AdapterError('SCHEMA_CHANGED', '权益响应结构无效');
      const e = obj(v), err = obj(e.error), meta = obj(obj(e.ResponseMetadata).Error);
      const code = meta.Code ?? err.code ?? e.code ?? obj(e.statusInfo).code ?? obj(e.base_resp).status_code;
      if (code !== undefined && ![0, '0', ''].includes(code as number)) {
        if ([1001, 20101, 401, 1000048].includes(Number(code))) throw new AdapterError('AUTH_REQUIRED', '供应商拒绝当前登录，请在原客户端重新登录');
        throw new AdapterError('UPSTREAM_UNAVAILABLE', '供应商权益查询业务状态失败');
      }
      return e;
    } catch (e) {
      if (e instanceof AdapterError) throw e;
      if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
      if (controller.signal.aborted) throw new AdapterError('TIMEOUT', '权益查询超时');
      throw new AdapterError('NETWORK_OFFLINE', '权益接口网络不可用');
    } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort); }
  }
  async collect(input: CollectInput): Promise<CollectOutput> {
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const c = credential(input, this.manifest);
    if (input.expectedSubject && input.reason !== 'probe' && input.expectedSubject !== c.subject) throw new AdapterError('ACCOUNT_MISMATCH', '账号已改变，请重新加入');
    const out = this.normalize(await this.query(c, input), new Date().toISOString());
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    out.account = { subject: c.subject, alias: c.alias || this.manifest.product, region: c.region,
      organization: text(c.enterpriseId) || text(obj(c.account).tenantId ?? obj(c.account).TenantID ?? obj(c.account).enterpriseId) };
    // Even a caller supplied subject must not collapse tenant/region pools.
    out.poolId = `pool-${this.manifest.id}-${hash(JSON.stringify([c.subject, c.region, c.enterpriseId ?? '', c.account ?? {}]))}`;
    out.metrics.forEach(m => { m.poolId = `${out.poolId}:${m.poolId ?? m.id}`; });
    out.balances?.forEach(b => { b.poolId = `${out.poolId}:${b.poolId ?? b.id}`; });
    const expires = date(c.expires ?? c.expiresAt);
    if (expires) out.credentialExpiresAt = field(expires, out);
    return out;
  }
  describeRecovery(error: AdapterError) { return { ...defaultDescribeRecovery(this.manifest, error), ...(error.code === 'AUTH_REQUIRED' ? { action: '在原客户端重新登录并重新读取账号；本应用不消费外部 refresh token' } : {}) }; }
  async disconnect() {}
}

const SUMMARY = '/billing/meter/get-user-resource-summary';
const ENTERPRISE = '/billing/meter/get-enterprise-user-usage';
const PAID = '/billing/meter/get-user-resource-paid-packages';
const FREE = '/billing/meter/get-user-resource-free-packages';
const code = (n: string, s: string) => `TCACA_code_${n}_${s}`;
const PAID_CODES = [['002','AkiJS3ZHF5'],['005','maRGyrHhw1'],['003','FAnt7lcmRT'],['023','4xbGhMrE6q'],['026','BaESVICNoi'],['027','0FCGVA6vSa'],['009','0XmEQc2xOf'],['038','OhvqZtiPKr'],['036','lupO5WgNdG']].map(([n,s]) => code(n,s));
const FREE_CODES = [['001','PqouKr6QWV'],['008','cfWoLwvjU4'],['035','ArVxJcGDsm'],['006','DbXS0lrypC'],['039','KRcQj7wUat'],['040','mi9rCYg46x'],['007','nzdH5h4Nl0'],['028','NtpWi0jzXs'],['037','WxOD3MpI2o'],['029','6wCGEWquYy'],['030','BjSt89qTvr']].map(([n,s]) => code(n,s));

export class WorkBuddyAdapter extends DesktopAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'cn' | 'global' = 'cn', fetchFn?: DesktopFetchFn) { super(fetchFn); this.manifest = manifest(region === 'cn' ? 'workbuddy' : 'workbuddy-ai', 'WorkBuddy', region, [region === 'cn' ? 'copilot.tencent.com' : 'www.workbuddy.ai']); }
  protected async query(c: Credential, input: CollectInput) {
    const host = this.manifest.allowedHosts[0];
    // domain is an attribution header only, never a network destination.
    const headers = { Authorization: `Bearer ${c.accessToken}`, 'X-User-Id': c.uid, 'X-Domain': text(c.domain) || host, 'X-Product': 'SaaS', 'X-IDE-Type': 'WorkBuddy', 'User-Agent': 'WorkBuddy/5.5.6',
      ...(text(c.enterpriseId) ? { 'X-Enterprise-Id': text(c.enterpriseId), 'X-Tenant-Id': text(c.enterpriseId) } : {}) };
    const ask = async (path: string, body: unknown = {}) => obj((await this.request(`https://${host}${path}`, 'POST', headers, body, input, [SUMMARY, ENTERPRISE, PAID, FREE])).data);
    const sum = await ask(SUMMARY), raw: Obj = { sum, plan: c.plan, enterprise: !!text(c.enterpriseId), failures: [] };
    const failures = raw.failures as string[];
    if (!list(sum.Packages).length && text(c.enterpriseId)) {
      try { raw.enterpriseUsage = await ask(ENTERPRISE); } catch (e) { if (e instanceof AdapterError && ['AUTH_REQUIRED', 'CANCELLED'].includes(e.code)) throw e; failures.push('enterprise'); }
    }
    const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    for (const [key, path, extra] of [ ['paid', PAID, { PackageCodes: PAID_CODES, NeedRenewInfo: true }], ['free', FREE, { PackageCodes: FREE_CODES, SlicePeriodStartTime: `${day} 00:00:00`, SlicePeriodEndTime: `${day} 23:59:59` }] ] as const) {
      const all: unknown[] = []; raw[key] = all;
      try {
        for (let page = 1; page <= 10; page++) {
          const d = await ask(path, { PageNumber: page, PageSize: 200, Status: [0, 3], ...extra });
          if (!Array.isArray(d.Accounts)) throw new AdapterError('SCHEMA_CHANGED', '缺少积分批次列表');
          const got = d.Accounts; all.push(...got);
          if (got.length < 200 || decimal(d.TotalCount) !== null && all.length >= Number(d.TotalCount)) break;
          if (page === 10) failures.push(`${key}-pagination`);
        }
      } catch (e) { if (e instanceof AdapterError && ['AUTH_REQUIRED', 'CANCELLED'].includes(e.code)) throw e; failures.push(key); }
    }
    return raw;
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), s = obj(r.sum), out = base(this.manifest, at), e = obj(r.enterpriseUsage);
    plan(out, r.plan || (r.enterprise && e.limitNum !== undefined ? 'Enterprise' : typeof s.IsPaidUser === 'boolean' ? s.IsPaidUser ? 'Pro' : 'Free' : ''), text(r.plan) ? 'reported' : 'derived');
    list(s.Packages).forEach((v, i) => { const p = obj(v), id = text(p.PackageCode) || `package-${i}`; metric(out, id, 'Credits', 'credits', decimal(p.CycleTotalCapacity), decimal(p.CycleUsedCapacity), r.enterprise ? 'organization' : 'account'); });
    if (e.limitNum !== undefined) {
      metric(out, 'enterprise', '企业 Credits', 'credits', decimal(e.limitNum), decimal(e.credit), 'organization', date(e.cycleResetTime, true));
      const start = date(e.cycleStartTime, true), last = out.metrics.at(-1)!;
      if (start) last.windowStart = field(start, out);
      if (last.resetObservation) last.windowEnd = last.resetObservation;
    }
    const seen = new Set<string>();
    for (const kind of ['paid', 'free']) list(r[kind]).forEach((v, i) => {
      const p = obj(v), amount = decimal(p.CycleCapacityRemainPrecise ?? p.CycleCapacityRemain);
      const id = text(p.AccountId ?? p.AccountID ?? p.Id) || hash(JSON.stringify([p.PackageCode, p.DeductionEndTime, p.ExpiredTime, p.CycleEndTime, p.CapacityType, i]));
      if (amount === null || seen.has(id)) return; seen.add(id);
      const end = date(p.DeductionEndTime) ?? date(p.ExpiredTime, true) ?? date(p.CycleEndTime, true);
      (out.balances ??= []).push({ id: `batch-${id}`, label: kind === 'paid' ? '付费积分批次' : '赠送积分批次', scope: 'account', kind: kind === 'free' ? 'grant' : 'credit', currency: 'credits', amount: field(amount, out), expiresAt: end ? field(end, out) : undefined, poolId: text(p.PackageCode) || id });
    });
    list(r.failures).forEach(f => out.partialFailures.push({ field: text(f), reason: '对应只读查询失败，保留旧观察' }));
    return finish(out);
  }
}

export class TraeAdapter extends DesktopAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'cn' | 'global' | 'sg' | 'us' = 'cn', fetchFn?: DesktopFetchFn) { super(fetchFn); this.manifest = manifest(region === 'cn' ? 'trae-cn' : `trae-global-${region === 'us' ? 'us' : 'sg'}`, 'Trae', region === 'cn' ? 'cn' : region === 'us' ? 'US' : 'SG', region === 'cn' ? ['api.trae.cn'] : [region === 'us' ? 'api-us-east.trae.ai' : 'api-sg-central.trae.ai']); }
  protected query(c: Credential, input: CollectInput) {
    const cn = this.manifest.id === 'trae-cn', region = text(c.region).toUpperCase();
    if (!cn && !['SG', 'SGP', 'SINGAPORE', 'US', 'USA'].includes(region) && !/^(US|SG)[-_ ]/.test(region)) throw new AdapterError('AUTH_REQUIRED', 'Trae 国际账号地区无法确认，未跨区回退');
    const us = /^US(?:[-_ ]|$)/.test(region) || region === 'USA' || /api-us|coreva/i.test(text(c.api));
    if (!cn && (us !== (this.manifest.id === 'trae-global-us') || /^SG(?:[-_ ]|$)/.test(region) && /api-us|coreva/i.test(text(c.api)))) throw new AdapterError('AUTH_REQUIRED', 'Trae 地区与计费部署不一致，未发送请求');
    const host = cn ? 'api.trae.cn' : us ? 'api-us-east.trae.ai' : 'api-sg-central.trae.ai';
    const path = cn ? '/trae/api/v2/pay/ide_user_ent_usage' : '/trae/api/v1/pay/user_current_entitlement_list';
    return this.request(`https://${host}${path}`, 'POST', {
      Authorization: `Cloud-IDE-JWT ${c.accessToken}`, 'X-Cloudide-Token': c.accessToken, 'x-ide-token': c.accessToken, 'x-uid': c.uid,
      'x-app-id': '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8', 'x-device-id': text(c.deviceId), 'x-machine-id': text(c.machineId), 'x-request-id': randomUUID(),
      'x-app-version': '0.1.69', 'x-app-version-code': '20260917', 'x-ide-version': '0.1.69', 'x-ide-version-code': '20260917', 'x-ide-version-type': 'stable',
      'x-device-cpu': 'AMD', 'x-device-brand': 'ASUS TUF Gaming A15 FA507RM_FA507RM', 'x-device-type': 'windows', 'x-os-version': 'Windows 10', 'x-system-type': 'Windows',
    }, cn ? { require_usage: true, req_source: 0 } : {}, input, [path]);
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = base(this.manifest, at), cn = this.manifest.id === 'trae-cn';
    if (!Array.isArray(r.user_entitlement_pack_list)) throw new AdapterError('SCHEMA_CHANGED', 'Trae 缺少权益包列表');
    if (cn && typeof r.is_credits_billing === 'boolean') plan(out, r.is_credits_billing ? 'Credits' : 'Free', 'derived');
    list(r.user_entitlement_pack_list).forEach((v, i) => {
      const p = obj(v), bi = obj(p.entitlement_base_info), q = obj(bi.quota), usage = obj(p.usage);
      const id = text(p.entitlement_pack_id ?? p.pack_id ?? bi.entitlement_id) || hash(JSON.stringify([bi, p.display_desc, i]));
      if (!cn && text(p.display_desc) && !out.fields.length) plan(out, p.display_desc);
      const end = date(bi.end_time ?? bi.expire_time ?? p.end_time);
      // Pack end is validity, not a confirmed quota reset or membership renewal.
      const add = (suffix: string, total: string | null, used: string | null) => {
        if (total === null && used === null) return;
        const key = `${id}-${suffix}`; metric(out, key, text(p.display_desc) || suffix, cn ? 'credits' : 'USD', total === '-1' ? null : total, used);
        const m = out.metrics.at(-1)!;
        if (total === '-1') { m.availability = 'unlimited'; m.remaining = null; }
        if (end) m.windowEnd = field(end, out);
        if (total !== null && total !== '-1' && used !== null && end) (out.balances ??= []).push({ id: `${key}-validity`, label: '额度包剩余（到期失效）', scope: 'account', kind: 'credit', currency: cn ? 'credits' : 'USD', amount: field(arithmetic(total, used, true), out, 'derived'), expiresAt: field(end, out), poolId: key });
      };
      if (cn) add('credits', decimal(q.credits_limit), decimal(usage.credits_amount));
      else { add('basic', decimal(q.basic_usage_limit), decimal(usage.basic_usage_amount)); add('bonus', decimal(q.bonus_usage_limit), decimal(usage.bonus_usage_amount)); }
    });
    return finish(out);
  }
}

const MM_INFO = '/v1/api/user/info', MM_WORKSPACE = '/matrix/api/v1/user/get_user_extra_info', MM_MEMBERSHIP = '/matrix/api/v1/commerce/get_membership_info', MM_PLAN = '/v1/api/openplatform/coding_plan/remains';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
/** Protocol-only deterministic signing helper; it cannot issue arbitrary requests. */
export function signMiniMaxRead(origin: string, path: string, access: string, userID: string, lang: string, body?: Obj, now = Date.now(), tz = new Date().getTimezoneOffset() * -60, platform = process.platform) {
  const url = new URL(path, origin);
  url.search = new URLSearchParams({ device_platform: 'mcode', biz_id: '3', app_id: '3001', version_code: '22201', unix: String(now), timezone_offset: String(tz), sys_language: lang, lang,
    device_id: '0', os_name: platform, browser_name: 'mcode', user_id: userID.trim() || '0', client: 'mcode' }).toString();
  const json = body === undefined ? undefined : JSON.stringify(body), ts = Math.floor(now / 1000);
  return { url: url.toString(), body: json, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'MiniMaxCode', Authorization: `Bearer ${access}`,
    yy: md5(`${encodeURIComponent(url.pathname + url.search)}_${json ?? '{}'}${md5(String(now))}ooui`), 'x-timestamp': String(ts), 'x-signature': md5(`${ts}I*7Cf%WZ#S&%1RlZJ&C2${json ?? ''}`) } };
}
function membership(v: unknown): Obj {
  const e = obj(v), d = obj(e.data), pick = (k: string) => e[k] ?? d[k], sum = obj(e.op_credit_summary ?? d.op_credit_summary);
  return { hasTokenPlan: pick('has_token_plan'), tier: pick('token_plan_tier'), expiresAt: pick('token_plan_expires_at'), balance: sum.total_remaining_amount ?? pick('opcredit_balance'), opGroupId: pick('op_group_id') };
}
export class MiniMaxCodeAdapter extends DesktopAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'cn' | 'global' = 'cn', fetchFn?: DesktopFetchFn) { super(fetchFn); this.manifest = manifest(region === 'cn' ? 'minimax-code' : 'minimax-code-global', 'MiniMax Code', region, region === 'cn' ? ['agent.minimaxi.com', 'www.minimaxi.com'] : ['agent.minimax.io', 'platform.minimax.io']); }
  protected async query(c: Credential, input: CollectInput) {
    const cn = this.manifest.id === 'minimax-code';
    const ask = (path: string, user: string, body?: Obj) => {
      const signed = signMiniMaxRead(`https://${this.manifest.allowedHosts[0]}`, path, c.accessToken, user, cn ? 'zh' : 'en', body);
      return this.request(signed.url, body === undefined ? 'GET' : 'POST', signed.headers, signed.body, input, [MM_INFO, MM_WORKSPACE, MM_MEMBERSHIP]);
    };
    let uid = text(c.realUserID);
    if (!uid) { const e = await ask(MM_INFO, ''), d = obj(e.data), u = obj(d.userInfo ?? d.user_info ?? e.userInfo ?? e.user_info); uid = text(u.realUserID ?? u.real_user_id); }
    if (!uid) throw new AdapterError('SCHEMA_CHANGED', 'MiniMax Code 未返回真实用户 ID');
    const raw: Obj = { failures: [] }, failures = raw.failures as string[];
    let workspace: Obj | undefined, workspaceId: unknown, workspaceListed = false;
    try {
      const e = await ask(MM_WORKSPACE, uid, {});
      const entries = e.workspaces ?? obj(e.data).workspaces;
      if (!Array.isArray(entries)) throw new AdapterError('SCHEMA_CHANGED', '缺少 workspace 列表');
      workspaceListed = true;
      workspace = entries.map(obj).find(w => decimal(w.workspace_type) === '0' && (text(w.workspace_id) || typeof w.workspace_id === 'number' && w.workspace_id >= 0));
      workspaceId = workspace?.workspace_id;
      if (workspace) raw.membership = membership(workspace);
    } catch (e) { if (e instanceof AdapterError && ['AUTH_REQUIRED', 'CANCELLED'].includes(e.code)) throw e; failures.push('workspace'); }
    // A successful list with no personal workspace is NOT permission to read
    // whichever enterprise workspace happens to be the server's default.
    if (workspaceListed && !workspace) throw new AdapterError('SCHEMA_CHANGED', 'MiniMax Code 未返回个人 workspace，未回退到其他组织');
    try {
      const m = membership(await ask(MM_MEMBERSHIP, uid, workspaceId === undefined ? {} : { workspace_id: workspaceId }));
      const ws = obj(raw.membership), merged = { ...ws };
      for (const [k, v] of Object.entries(m)) if (v !== undefined) merged[k] = v;
      if (ws.hasTokenPlan === true || m.hasTokenPlan === true) merged.hasTokenPlan = true;
      if (ws.opGroupId) merged.opGroupId = ws.opGroupId;
      raw.membership = merged;
    } catch (e) { if (e instanceof AdapterError && ['AUTH_REQUIRED', 'CANCELLED'].includes(e.code)) throw e; failures.push('membership'); }
    const m = obj(raw.membership);
    if (m.hasTokenPlan === true && text(m.opGroupId)) {
      try { raw.quota = await this.request(`https://${this.manifest.allowedHosts[1]}${MM_PLAN}`, 'GET', { Authorization: `Bearer ${c.accessToken}`, 'X-Group-Id': text(m.opGroupId) }, undefined, input, [MM_PLAN]); }
      catch (e) { if (e instanceof AdapterError && ['AUTH_REQUIRED', 'CANCELLED'].includes(e.code)) throw e; failures.push('quota'); }
    }
    return raw;
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), m = obj(r.membership), out = base(this.manifest, at);
    if (m.hasTokenPlan === true) plan(out, text(m.tier) ? `M Plan ${text(m.tier)}` : 'M Plan');
    else if (m.hasTokenPlan === false) plan(out, 'Free', 'derived');
    const end = date(m.expiresAt);
    if (end && m.hasTokenPlan === true) out.entitlements = { membershipExpiresAt: field(end, out) };
    const amount = decimal(m.balance);
    if (amount !== null) out.balances = [{ id: 'credits', label: 'MiniMax Code credits', scope: 'account', kind: 'credit', currency: 'credits', amount: field(amount, out) }];
    if (r.quota) {
      try { out.metrics = new MiniMaxPlanAdapter(this.manifest.id === 'minimax-code' ? 'cn' : 'global').normalize(r.quota, at).metrics; }
      catch { out.partialFailures.push({ field: 'quota', reason: 'M Plan 窗口结构无法识别，保留旧窗口' }); }
    }
    list(r.failures).forEach(f => out.partialFailures.push({ field: text(f), reason: '对应只读查询失败，保留旧观察' }));
    return finish(out);
  }
}

export function createDesktopServiceAdapters(fetchFn?: DesktopFetchFn): ProviderAdapter[] {
  return [new WorkBuddyAdapter('cn', fetchFn), new WorkBuddyAdapter('global', fetchFn), new TraeAdapter('cn', fetchFn), new TraeAdapter('sg', fetchFn), new TraeAdapter('us', fetchFn), new MiniMaxCodeAdapter('cn', fetchFn), new MiniMaxCodeAdapter('global', fetchFn)];
}
export const desktopServiceAdapters = createDesktopServiceAdapters();
