/**
 * Read-only protocol mappings from magpie-community/plugins
 * aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6, packages/{kiro,zcode,qoder,
 * minimax,mimo,raccoon,workbuddy,trae}/index.mjs. Copyright (c) 2026
 * magpie-community contributors. MIT notice and exact mapping: docs/evidence/full-service/regional.md.
 * Also reviewed Magpie ba319a7587923fc7a4ea3859658244d591261a59
 * internal/provider/planquota.go:83-137,244-363 (MIT, Copyright (c) 2026 yetone).
 * No plugin import, refresh, credential write, model call, check-in or grant.
 */
import { createHash } from 'node:crypto';
import type { EntitlementDate, Field } from '../../shared/types';
import { defaultHttpFetch, executeOfficialGet, formatDecimalString, hashKeySubject, OPENROUTER_KEY_MANIFEST, type HttpFetchFn } from './http-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type NormalizedMetricObservation, type ProviderAdapter } from './types';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const decimal = formatDecimalString;
const num = (v: unknown): number | null => { const s = decimal(v); return s !== null && Number.isFinite(Number(s)) ? Number(s) : null; };
const fingerprint = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 24);
function subtract(a: string, b: string): string {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (s: string) => { const [w, f = ''] = s.split('.'); return BigInt(w + f.padEnd(scale, '0')); };
  const n = integer(a) - integer(b), digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  return (n < 0n ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits);
}
function date(v: unknown, epoch?: 'seconds' | 'milliseconds' | 'either', zone?: string): EntitlementDate | null {
  const s = text(v);
  if (/^\d{4}-\d\d-\d\d$/.test(s)) {
    const ms = Date.parse(s + 'T00:00:00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? { precision: 'day', value: s } : null;
  }
  let iso = s;
  if (/^\d{4}-\d\d-\d\d/.test(s) && !date(s.slice(0, 10))) return null;
  if (zone && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(s)) iso = s.replace(' ', 'T') + zone;
  let ms = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(iso) ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms) && epoch) { const n = num(v); if (n !== null && n > 0) ms = n * (epoch === 'seconds' || epoch === 'either' && n < 1e12 ? 1000 : 1); }
  return Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()) ? { precision: 'instant', value: new Date(ms).toISOString() } : null;
}
function field<T>(value: T, out: CollectOutput, evidence: 'reported' | 'derived' = 'reported'): Field<T> {
  return { value, availability: 'known', observedAt: out.observedAt, source: '供应商只读账户接口', dataOrigin: 'official_api', evidence };
}
function base(manifest: AdapterManifest, at: string): CollectOutput {
  return { account: { subject: manifest.id, alias: manifest.product, organization: '', region: manifest.region }, poolId: `pool-${manifest.id}`, observedAt: at, metrics: [], fields: [], samples: [], partialFailures: [] };
}
function plan(out: CollectOutput, value: unknown) {
  if (text(value)) out.fields.push({ field: 'plan', value: text(value), availability: 'known', source: '供应商只读账户接口', observedAt: out.observedAt, dataOrigin: 'official_api', evidence: 'reported' });
}
function expiry(out: CollectOutput, value: EntitlementDate | null, kind: 'membershipExpiresAt' | 'billingPeriodEnd' = 'membershipExpiresAt') {
  if (value) (out.entitlements ??= {})[kind] = field(value, out);
}
function metric(out: CollectOutput, id: string, label: string, unit: string, remaining: string | null, total: string | null, used: string | null, reset: EntitlementDate | null = null, extra: Partial<NormalizedMetricObservation> = {}) {
  out.metrics.push({ id, label, unit, remaining, used, total, resetAt: reset?.value ?? null, resetObservation: reset ? field(reset, out) : undefined, availability: remaining === null ? 'unfetched' : 'known', observedAt: out.observedAt, source: '供应商只读账户接口', dataOrigin: 'official_api', staleAfterMinutes: 30, evidence: 'reported', ...extra });
}
function balance(out: CollectOutput, id: string, amount: string, currency: string, end: EntitlementDate | null = null, evidence: 'reported' | 'derived' = 'reported') {
  (out.balances ??= []).push({ id, label: id, scope: 'account', kind: 'credit', currency, amount: field(amount, out, evidence), expiresAt: end ? field(end, out) : undefined });
}
function finish(out: CollectOutput) {
  if (!out.metrics.length && !out.fields.length && !out.balances?.length && !out.entitlements) throw new AdapterError('SCHEMA_CHANGED', '未返回可识别权益，保留旧观察');
  out.samples = out.metrics.map(m => `${m.label}：${m.remaining ?? '未知'} ${m.unit}`);
  return out;
}
function manifest(id: string, product: string, host: string, path: string): AdapterManifest {
  return { ...OPENROUTER_KEY_MANIFEST, id: id as AdapterManifest['id'], brand: product, product, authMode: 'local_client', region: host, allowedHosts: [host], officialSourceUrl: `https://${host}${path}`, supportedFields: ['接口实际返回的套餐、额度或余额'], unsupportedFields: ['实际付款', '未返回的日期', '自动登录与凭据刷新'], permissions: '仅固定白名单账户 GET；不刷新或改写外部凭据，不签到、领取、创建 Key 或调用模型。', termsCheckedAt: '2026-10-21' };
}

/** Main-process envelope, NOT a renderer-facing form. region and provider are
 * required to prevent importing an unbound credential into a different site.
 * accountId is a caller-verified identity; otherwise token replacement requires re-probe. */
export interface RegionalCredential {
  provider: string; region: string; accessToken?: string; cookie?: string;
  accountId?: string; profileArn?: string; tokenType?: 'API_KEY' | 'EXTERNAL_IDP';
  groupId?: string; tokenKind?: 'device' | 'job' | 'coding-key' | 'session';
  subject?: string; alias?: string; rawKey?: boolean;
}
function credential(input: CollectInput, m: AdapterManifest): RegionalCredential {
  const secret = input.secret?.trim() ?? '';
  if (secret && !secret.startsWith('{') && !/\s/.test(secret) && /^(glm-coding-|minimax-plan-)/.test(m.id)) return { provider: m.id, region: m.region, accessToken: secret, tokenKind: 'coding-key', rawKey: true };
  let r: Obj;
  try { r = obj(JSON.parse(secret)); } catch { throw new AdapterError('AUTH_REQUIRED', '需由主进程提供带服务来源的凭据'); }
  const aliases: Record<string, string[]> = {
    'kiro-us-east-1': ['kiro'], 'kiro-eu-central-1': ['kiro'],
    'glm-coding-cn': ['zhipu'], 'glm-coding-global': ['zai'],
    qoder: ['qoder'], 'qoder-cn': ['qoder-cn'],
    'minimax-plan-cn': ['minimax-cn', 'minimax-code'], 'minimax-plan-global': ['minimax', 'minimax-code-global'],
    'mimo-app-sgp': ['mimo-app'], 'mimo-app-ru': ['mimo-app'], 'mimo-app-in': ['mimo-app'],
    'mimo-token-plan': ['mimo-token-plan'], raccoon: ['raccoon'],
  };
  const source = text(r.provider ?? r.source);
  if (source !== m.id && !aliases[m.id]?.includes(source)) throw new AdapterError('AUTH_REQUIRED', '凭据来源与服务不匹配');
  let region = text(r.region);
  if (m.id.startsWith('kiro-')) { if (region === m.region.split('.')[1]) region = m.region; }
  if (m.id.startsWith('mimo-app-')) {
    let creds: Obj = {};
    try { creds = obj(JSON.parse(text(r.refresh))); } catch { /* never execute Xiaomi sign-on */ }
    const bound = text(creds.base) ? (() => { try { return new URL(text(creds.base)).hostname; } catch { return ''; } })() : text(creds.region) ? `mimo-server-${text(creds.region).toLowerCase()}.xiaomimimo.com` : '';
    if (!region) region = bound;
    if (['SGP', 'RU', 'IN'].includes(region)) region = `mimo-server-${region.toLowerCase()}.xiaomimimo.com`;
    if (!r.cookie && text(r.access)) {
      try { const cookies = obj(JSON.parse(text(r.access))); r.cookie = Object.entries(cookies).map(([k, v]) => { if (!/^[A-Za-z0-9_-]+$/.test(k) || typeof v !== 'string' || /[;\r\n]/.test(v)) throw new Error(); return `${k}=${v}`; }).join('; '); } catch { throw new AdapterError('AUTH_REQUIRED', 'MiMo 已保存会话 cookie 无效'); }
    }
  }
  // A source with one fixed site is sufficient binding; multi-region sources
  // (Kiro/MiMo App) require their original explicit region/base.
  if (!region && !m.id.startsWith('kiro-') && !m.id.startsWith('mimo-app-')) region = m.region;
  const c = { ...r, provider: m.id, region, accessToken: r.accessToken ?? r.access ?? r.key ?? r.token } as unknown as RegionalCredential;
  if (r.provider !== undefined && r.provider !== m.id || c.region !== m.region) throw new AdapterError('AUTH_REQUIRED', '凭据服务或地区不匹配，未发送请求');
  if (m.id.startsWith('glm-coding-') && !c.tokenKind) c.tokenKind = 'coding-key';
  if (m.id.startsWith('qoder')) {
    if (typeof r.deviceToken === 'string' && r.deviceToken) { c.accessToken = r.deviceToken; c.tokenKind = 'device'; }
    else if (r.patAuth === true && r.type === 'oauth' && typeof r.access === 'string') { c.accessToken = r.access; c.tokenKind = 'job'; }
    if (r.instance || r.vpc || r.openapi) throw new AdapterError('UNSUPPORTED', 'Qoder VPC 尚未配置精确主机授权，未发送公网请求');
  }
  if (m.id.startsWith('kiro-') && !c.tokenType) c.tokenType = r.method === 'apikey' || r.type === 'api' ? 'API_KEY' : r.method === 'external-idp' ? 'EXTERNAL_IDP' : undefined;
  if (!c.groupId && typeof r.opGroupId === 'string') c.groupId = r.opGroupId;
  for (const key of ['accessToken', 'cookie', 'accountId', 'profileArn', 'groupId', 'subject', 'alias'] as const) if (c[key] !== undefined && (typeof c[key] !== 'string' || !c[key]!.trim() || /[\r\n]/.test(c[key]!))) throw new AdapterError('AUTH_REQUIRED', '凭据字段无效');
  if (!c.accessToken && !c.cookie) throw new AdapterError('AUTH_REQUIRED', '缺少有效会话凭据');
  if (!m.id.startsWith('mimo-') && !c.accessToken) throw new AdapterError('AUTH_REQUIRED', '该服务需要访问 token，不接受 cookie');
  return c;
}
abstract class RegionalAdapter implements ProviderAdapter {
  abstract readonly manifest: AdapterManifest;
  constructor(protected readonly fetchFn: HttpFetchFn = defaultHttpFetch) {}
  probe(input: CollectInput) { return this.collect(input); }
  protected async get(path: string, c: RegionalCredential, input: CollectInput, headers: Record<string, string> = {}) {
    return executeOfficialGet(this.manifest, `https://${this.manifest.allowedHosts[0]}${path}`, { ...input, secret: c.accessToken ?? 'cookie-session' }, this.fetchFn, headers);
  }
  protected abstract query(c: RegionalCredential, input: CollectInput): Promise<unknown>;
  abstract normalize(raw: unknown, at: string): CollectOutput;
  async collect(input: CollectInput): Promise<CollectOutput> {
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const c = credential(input, this.manifest);
    const subject = c.subject ?? (c.rawKey ? hashKeySubject(this.manifest.id, c.accessToken!) : `${this.manifest.id}:${fingerprint(JSON.stringify([c.region, c.accountId ?? c.accessToken ?? c.cookie, c.profileArn ?? '', c.groupId ?? '']))}`);
    if (input.expectedSubject && input.reason !== 'probe' && input.expectedSubject !== subject) throw new AdapterError('ACCOUNT_MISMATCH', '账号、地区或凭据已改变，请重新连接');
    const out = this.normalize(await this.query(c, input), new Date().toISOString());
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    out.account.subject = subject; if (c.alias) out.account.alias = c.alias; out.poolId = `pool-${this.manifest.id}-${subject}`;
    out.metrics.forEach(m => { m.poolId = `${out.poolId}:${m.poolId ?? m.id}`; });
    out.balances?.forEach(b => { b.poolId = `${out.poolId}:${b.id}`; });
    return out;
  }
  describeRecovery(error: AdapterError) { return { ...defaultDescribeRecovery(this.manifest, error), ...(error.code === 'AUTH_REQUIRED' ? { action: '在原客户端重新登录，由主进程重新读取凭据；不会代为刷新外部登录' } : {}) }; }
  async disconnect() {}
}

export class KiroAdapter extends RegionalAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'us-east-1' | 'eu-central-1' = 'us-east-1', fetchFn?: HttpFetchFn) { super(fetchFn); this.manifest = manifest(`kiro-${region}`, 'Kiro', `management.${region}.kiro.dev`, '/Get-Usage-Limits'); }
  protected query(c: RegionalCredential, input: CollectInput) {
    if (!c.profileArn || c.profileArn.split(':')[3] && c.profileArn.split(':')[3] !== this.manifest.allowedHosts[0].split('.')[1]) throw new AdapterError('AUTH_REQUIRED', '需要该地区已验证的 Kiro profileArn（不自动发现或跨区回退）');
    if (c.tokenType !== undefined && !['API_KEY', 'EXTERNAL_IDP'].includes(c.tokenType)) throw new AdapterError('AUTH_REQUIRED', 'Kiro tokenType 无效');
    const q = new URLSearchParams({ origin: 'KIRO_CLI', profileArn: c.profileArn, resourceType: 'CREDIT', isEmailRequired: 'true' });
    return this.get(`/Get-Usage-Limits?${q}`, c, input, c.tokenType ? { tokentype: c.tokenType } : {});
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = base(this.manifest, at); plan(out, obj(r.subscriptionInfo).subscriptionTitle);
    list(r.usageBreakdownList).forEach((value, i) => {
      const b = obj(value), used = decimal(b.currentUsageWithPrecision), total = decimal(b.usageLimitWithPrecision);
      if (used !== null && total !== null) metric(out, `credits-${i}`, text(b.displayNamePlural) || text(b.displayName) || 'Credits', 'credits', subtract(total, used), total, used, date(b.nextDateReset ?? r.nextDateReset, 'seconds'), { evidence: 'derived' });
      else out.partialFailures.push({ field: `credits-${i}`, reason: 'precision 数量不完整，未补零' });
      const t = obj(b.freeTrialInfo), tu = decimal(t.currentUsageWithPrecision), tt = decimal(t.usageLimitWithPrecision);
      if (t.freeTrialStatus === 'ACTIVE' && tu !== null && tt !== null) {
        const id = `trial-${i}`; balance(out, id, subtract(tt, tu), 'credits', date(t.freeTrialExpiry, 'seconds'), 'derived');
        metric(out, id, '试用额度（到期失效）', 'credits', subtract(tt, tu), tt, tu, null, { evidence: 'derived' });
      }
    }); return finish(out);
  }
}

export class QoderAdapter extends RegionalAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'global' | 'cn' = 'global', fetchFn?: HttpFetchFn) { super(fetchFn); this.manifest = manifest(region === 'cn' ? 'qoder-cn' : 'qoder', 'Qoder', region === 'cn' ? 'openapi.qoder.com.cn' : 'openapi.qoder.sh', '/sash/api/v2/me/usage'); }
  protected query(c: RegionalCredential, input: CollectInput) {
    if (!['device', 'job'].includes(c.tokenKind ?? '')) throw new AdapterError('AUTH_REQUIRED', 'Qoder 需 device token 或已交换的 job token；不接受原始 PAT');
    return this.get('/sash/api/v2/me/usage', c, input, { 'Cosy-ClientType': '10', 'User-Agent': 'Qoder' });
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = base(this.manifest, at);
    if (r.displayMode === 'enterprise') { plan(out, 'Enterprise'); return out; }
    if (r.displayMode !== 'qoder' || !r.qoderUsage) throw new AdapterError('SCHEMA_CHANGED', 'Qoder 缺少有效 displayMode/qoderUsage');
    const u = obj(r.qoderUsage); plan(out, u.userType ?? u.user_type); expiry(out, date(u.expiresAt ?? u.expires_at, 'either'));
    const pools: [string, unknown][] = [['user', u.userQuota ?? u.user_quota], ['addon', u.addOnQuota ?? u.add_on_quota], ['organization', u.orgResourcePackage ?? u.org_resource_package], ...list(u.dedicatedResourcePackages ?? u.dedicated_resource_packages).map((b, i): [string, unknown] => [`dedicated-${i}`, b])];
    for (const [id, value] of pools) {
      if (value === undefined || value === null) continue;
      const b = obj(value), total = decimal(b.total ?? b.cap), used = decimal(b.used), left = decimal(b.remaining);
      if (left === null && (total === null || used === null)) { out.partialFailures.push({ field: id, reason: '额度字段不完整' }); continue; }
      metric(out, id, text(b.name) || id, text(b.unit) || 'credits', left ?? subtract(total!, used!), total, used, null, { scope: id === 'organization' ? 'organization' : 'account', evidence: left === null ? 'derived' : 'reported' });
    } return finish(out);
  }
}

/** GLM personal Coding key only; teams and ZCode gift sessions are separate protocols. */
export class GlmCodingAdapter extends RegionalAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'global' | 'cn' = 'global', fetchFn?: HttpFetchFn) { super(fetchFn); this.manifest = manifest(region === 'cn' ? 'glm-coding-cn' : 'glm-coding-global', 'GLM Coding', region === 'cn' ? 'open.bigmodel.cn' : 'api.z.ai', '/api/monitor/usage/quota/limit'); }
  protected async query(c: RegionalCredential, input: CollectInput) {
    if (c.tokenKind !== 'coding-key' || !c.accessToken) throw new AdapterError('AUTH_REQUIRED', '需要个人 GLM Coding key；团队和 ZCode gift 登录尚未接入');
    const paths = ['/api/monitor/usage/quota/limit', '/api/biz/subscription/list'];
    const results = await Promise.allSettled(paths.map(p => this.get(p, c, input, { Authorization: c.accessToken! })));
    const raw: Obj = {}, failures: string[] = [];
    results.forEach((r, i) => { if (r.status === 'fulfilled') raw[i ? 'subscriptions' : 'quota'] = r.value; else failures.push(i ? 'subscriptions' : 'quota'); });
    if (results.every(r => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    return { ...raw, failures };
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = base(this.manifest, at);
    const unwrap = (v: unknown) => { const e = obj(v); if (e.success === false || e.code !== undefined && ![0, 200, '0', '200'].includes(e.code as number)) throw new AdapterError('UPSTREAM_UNAVAILABLE', 'GLM 业务请求未成功'); return e.data ?? v; };
    let q: Obj = {};
    try { q = obj(unwrap(r.quota)); } catch { out.partialFailures.push({ field: 'quota', reason: '额度业务状态失败' }); }
    if (text(q.level)) plan(out, `GLM Coding ${text(q.level)}`);
    list(q.limits).forEach((v, i) => {
      const b = obj(v), p = decimal(b.percentage), used = decimal(b.currentValue), total = decimal(b.usage), left = decimal(b.remaining), tools = b.type === 'TIME_LIMIT';
      const id = `${tools ? 'mcp' : 'coding'}-${i}`, reset = date(b.nextResetTime, 'milliseconds');
      if (num(total) === 0) { metric(out, id, '未设上限', tools ? '次' : 'credits', null, null, used, reset, { availability: 'unlimited' }); return; }
      if (left !== null || total !== null && used !== null) metric(out, id, tools ? 'MCP 工具调用' : 'Coding credits', tools ? '次' : 'credits', left ?? subtract(total!, used!), total, used ?? (left !== null && total !== null ? subtract(total, left) : null), reset, { evidence: left === null ? 'derived' : 'reported' });
      else if (p !== null) metric(out, id, tools ? 'MCP 月额度' : 'Coding 额度', '%', subtract('100', p), '100', p, reset, { evidence: 'derived' });
      else out.partialFailures.push({ field: id, reason: '未返回数量或百分比' });
    });
    let subs: unknown[] = [];
    try { subs = list(unwrap(r.subscriptions)); } catch { out.partialFailures.push({ field: 'subscriptions', reason: '订阅业务状态失败' }); }
    const sub = subs.map(obj).find(s => s.status === 'VALID');
    if (sub) {
      if (!out.fields.length) plan(out, sub.productName);
      const auto = sub.autoRenew === true || sub.autoRenew === 1;
      if ([true, false, 0, 1].includes(sub.autoRenew as boolean)) (out.entitlements ??= {}).autoRenew = field(auto, out);
      const next = date(sub.nextRenewTime, undefined, '+08:00');
      if (next) expiry(out, next, auto ? 'billingPeriodEnd' : 'membershipExpiresAt');
      else if ((sub.autoRenew === false || sub.autoRenew === 0) && typeof sub.valid === 'string') { const dates = sub.valid.match(/\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d:\d\d)?/g); if (dates?.length) expiry(out, date(dates.at(-1), undefined, '+08:00')); }
    }
    for (const f of list(r.failures)) out.partialFailures.push({ field: text(f), reason: '子查询失败，保留该字段旧观察' });
    return finish(out);
  }
}

export class MiniMaxPlanAdapter extends RegionalAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'global' | 'cn' = 'global', fetchFn?: HttpFetchFn) { super(fetchFn); this.manifest = manifest(region === 'cn' ? 'minimax-plan-cn' : 'minimax-plan-global', 'MiniMax M Plan', region === 'cn' ? 'www.minimaxi.com' : 'platform.minimax.io', '/v1/api/openplatform/coding_plan/remains'); }
  protected query(c: RegionalCredential, input: CollectInput) { return this.get('/v1/api/openplatform/coding_plan/remains', c, input, c.groupId ? { 'X-Group-Id': c.groupId } : {}); }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = base(this.manifest, at), status = obj(r.base_resp).status_code;
    if (status !== undefined && status !== 0) throw new AdapterError('UPSTREAM_UNAVAILABLE', 'MiniMax 业务状态失败');
    for (const value of list(r.model_remains)) {
      const b = obj(value), model = text(b.model_name); if (!model) continue;
      for (const [slot, prefix, end] of [['interval', 'current_interval', 'end_time'], ['weekly', 'current_weekly', 'weekly_end_time']] as const) {
        const state = num(b[`${prefix}_status`]), remaining = decimal(b[`${prefix}_remaining_percent`]);
        if (state === 3) continue;
        if (remaining === null && state !== 2) { out.partialFailures.push({ field: `${model}:${slot}`, reason: '未返回有效剩余百分比' }); continue; }
        metric(out, `${model}:${slot}`, `${model} · ${slot}`, '%', state === 2 ? '0' : remaining, '100', state === 2 ? '100' : subtract('100', remaining!), date(b[end], 'either'), { models: [model], scope: model.toLowerCase() === 'general' ? 'account' : 'model' });
      }
    } return finish(out);
  }
}

export class MimoAppAdapter extends RegionalAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'SGP' | 'RU' | 'IN' = 'SGP', fetchFn?: HttpFetchFn) { super(fetchFn); this.manifest = manifest(`mimo-app-${region.toLowerCase()}`, 'MiMo App', `mimo-server-${region.toLowerCase()}.xiaomimimo.com`, '/api/user/xiaomi/subscription/self'); }
  protected async query(c: RegionalCredential, input: CollectInput) {
    if (!c.cookie) throw new AdapterError('AUTH_REQUIRED', 'MiMo App 需要该地区 session cookie，不接受平台 API Key 或小米 passToken');
    const results = await Promise.allSettled(['/api/user/xiaomi/subscription/self', '/api/user/usage'].map(p => this.get(p, c, input, { Authorization: '', Cookie: c.cookie!, 'X-Client-Version': '26.929.292248', 'User-Agent': 'miNative PC/Normal Windows_NT/10.0.26100 SDKV/1.0.0 DEVT/PC DEVS/Windows APP/miaccount_desktop APPV/0.1.0' })));
    if (results.every(r => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    return { self: results[0].status === 'fulfilled' ? results[0].value : undefined, usage: results[1].status === 'fulfilled' ? results[1].value : undefined, failures: results.flatMap((r, i) => r.status === 'rejected' ? [i ? 'usage' : 'self'] : []) };
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = base(this.manifest, at);
    const unwrap = (v: unknown) => { const e = obj(v); if (e.code !== undefined && e.code !== 0) throw new AdapterError('UPSTREAM_UNAVAILABLE', 'MiMo 业务状态失败'); return obj(e.data); };
    let self: Obj = {}, usage: Obj = {};
    try { self = unwrap(r.self); } catch { out.partialFailures.push({ field: 'self', reason: '会员业务请求失败' }); }
    try { usage = unwrap(r.usage); } catch { out.partialFailures.push({ field: 'usage', reason: '用量业务请求失败' }); }
    const c = obj(self.current);
    plan(out, c.title ?? ({ 1: 'Starter', 2: 'Plus', 3: 'Pro', 4: 'Ultra' } as Record<string, string>)[String(c.planTier)] ?? c.planCode);
    expiry(out, date(c.endTime, undefined, '+08:00'));
    if (['MONTHLY', 'YEARLY', 'ONE_TIME'].includes(text(c.renewalMode))) (out.entitlements ??= {}).autoRenew = field(c.renewalMode !== 'ONE_TIME', out);
    const p = decimal(usage.percent);
    if (p !== null) metric(out, 'app-week', 'App 每周额度', '%', p, '100', subtract('100', p), date(usage.resetDate, undefined, '+08:00'));
    for (const f of list(r.failures)) out.partialFailures.push({ field: text(f), reason: '子查询失败，保留旧观察' });
    return finish(out);
  }
}

/** Independent platform connection: never reuse App cookies or discover/create
 * a tp- key. The existing platform session must be supplied by the main process. */
export class MimoTokenPlanAdapter extends RegionalAdapter {
  readonly manifest = manifest('mimo-token-plan', 'MiMo Token Plan', 'platform.xiaomimimo.com', '/api/v1/tokenPlan/detail');
  protected async query(c: RegionalCredential, input: CollectInput) {
    if (!c.cookie) throw new AdapterError('AUTH_REQUIRED', 'MiMo Token Plan 需要平台 session cookie，不接受 App cookie 或 tp- Key');
    const results = await Promise.allSettled(['/api/v1/tokenPlan/detail', '/api/v1/tokenPlan/usage'].map(p => this.get(p, c, input, { Authorization: '', Cookie: c.cookie! })));
    if (results.every(r => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    return { detail: results[0].status === 'fulfilled' ? results[0].value : undefined, usage: results[1].status === 'fulfilled' ? results[1].value : undefined, failures: results.flatMap((r, i) => r.status === 'rejected' ? [i ? 'usage' : 'detail'] : []) };
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = base(this.manifest, at);
    const unwrap = (v: unknown) => { const e = obj(v); if (e.code !== 0) throw new AdapterError('UPSTREAM_UNAVAILABLE', 'MiMo 平台业务请求失败'); return obj(e.data); };
    let d: Obj = {}, u: Obj = {};
    try { d = unwrap(r.detail); } catch { out.partialFailures.push({ field: 'detail', reason: '套餐子查询失败' }); }
    try { u = unwrap(r.usage); } catch { out.partialFailures.push({ field: 'usage', reason: '用量子查询失败' }); }
    if (d.expired === false && text(d.planName)) {
      plan(out, `Token Plan ${text(d.planName)}`);
      expiry(out, date(d.currentPeriodEnd, undefined, 'Z'), 'billingPeriodEnd');
      const a = d.enableAutoRenew, b = d.hasAutoRenewSubscribed;
      if (a === true || b === true || a === false && b === false) (out.entitlements ??= {}).autoRenew = field(a === true || b === true, out);
    }
    const items = [...list(obj(u.monthUsage).items), ...list(obj(u.usage).items)].map(obj);
    const item = items.find(x => x.name === 'month_total_token') ?? items.find(x => x.name === 'plan_total_token');
    if (item) {
      const used = decimal(item.used), total = decimal(item.limit);
      if (used !== null && total !== null) metric(out, 'token-plan', 'Token Plan API 独立池', 'credits', subtract(total, used), total, used, null, { evidence: 'derived' });
    }
    for (const f of list(r.failures)) out.partialFailures.push({ field: text(f), reason: '子查询失败，保留旧观察' });
    return finish(out);
  }
}

export class RaccoonAdapter extends RegionalAdapter {
  readonly manifest = manifest('raccoon', '小浣熊', 'xiaohuanxiong.com', '/api/web/points/v1/balance');
  protected async query(c: RegionalCredential, input: CollectInput) {
    const results = await Promise.allSettled(['/api/web/points/v1/balance', '/api/web/auth/v1/entitlement_info'].map(p => this.get(p, c, input)));
    if (results.every(r => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    return { points: results[0].status === 'fulfilled' ? results[0].value : undefined, entitlement: results[1].status === 'fulfilled' ? results[1].value : undefined, failures: results.flatMap((r, i) => r.status === 'rejected' ? [i ? 'entitlement' : 'points'] : []) };
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = base(this.manifest, at);
    const unwrap = (v: unknown) => { const e = obj(v); if (e.code !== undefined && ![0, 200, '0', '200'].includes(e.code as number)) throw new AdapterError('UPSTREAM_UNAVAILABLE', '小浣熊业务状态失败'); return obj(e.data ?? v); };
    let points: Obj = {}, e: Obj = {};
    try { points = unwrap(r.points); } catch { out.partialFailures.push({ field: 'points', reason: '余额业务状态失败' }); }
    try { e = unwrap(r.entitlement); } catch { out.partialFailures.push({ field: 'entitlement', reason: '会员业务状态失败' }); }
    const amount = decimal(points.available_points); if (amount !== null) balance(out, 'available-points', amount, 'credits');
    const office = obj(e.office ?? e.code), active = obj(office.active_plan);
    if (typeof office.pro_enable === 'boolean') plan(out, office.pro_enable ? text(active.type ?? office.plan_type) || 'Pro' : 'Free');
    if (office.pro_enable === true) expiry(out, date(office.pro_expired_time ?? active.subscription_expired_at));
    for (const f of list(r.failures)) out.partialFailures.push({ field: text(f), reason: '子查询失败，保留旧观察' });
    return finish(out);
  }
}

/** Do not register these as working connections. Explicit stubs prevent a
 * generic bearer GET from pretending to implement device-bound POST auth. */
export class RegionalUnavailableAdapter implements ProviderAdapter {
  readonly manifest: AdapterManifest;
  constructor(id: string, product: string, host: string, private readonly why: string) { this.manifest = { ...manifest(id, product, host, '/'), supportedFields: [], unsupportedFields: [why] }; }
  async probe(_input: CollectInput): Promise<CollectOutput> { throw new AdapterError('UNSUPPORTED', this.why); }
  collect(input: CollectInput) { return this.probe(input); }
  normalize(_raw: unknown, _at: string): CollectOutput { throw new AdapterError('UNSUPPORTED', this.why); }
  describeRecovery(error: AdapterError) { return { ...defaultDescribeRecovery(this.manifest, error), action: this.why }; }
  async disconnect() {}
}
export function createRegionalAdapters(fetchFn: HttpFetchFn = defaultHttpFetch): ProviderAdapter[] {
  return [new KiroAdapter('us-east-1', fetchFn), new KiroAdapter('eu-central-1', fetchFn), new GlmCodingAdapter('cn', fetchFn), new GlmCodingAdapter('global', fetchFn), new QoderAdapter('cn', fetchFn), new QoderAdapter('global', fetchFn), new MiniMaxPlanAdapter('cn', fetchFn), new MiniMaxPlanAdapter('global', fetchFn), ...(['SGP', 'RU', 'IN'] as const).map(r => new MimoAppAdapter(r, fetchFn)), new MimoTokenPlanAdapter(fetchFn), new RaccoonAdapter(fetchFn)];
}
export const regionalAdapters: ProviderAdapter[] = createRegionalAdapters();
export const regionalUnavailableAdapters: ProviderAdapter[] = [
  new RegionalUnavailableAdapter('workbuddy', 'WorkBuddy 国内', 'copilot.tencent.com', '需接入 token/uid/domain/企业上下文及只读计费 POST；尚未实现'),
  new RegionalUnavailableAdapter('workbuddy-ai', 'WorkBuddy 国际', 'www.workbuddy.ai', '需接入国际登录上下文及只读计费 POST；尚未实现'),
  new RegionalUnavailableAdapter('trae-cn', 'Trae 国内', 'api.trae.cn', '需接入 IDE 设备绑定登录头及只读权益 POST；尚未实现'),
  new RegionalUnavailableAdapter('trae-global-sg', 'Trae 国际 SG', 'api-sg-central.trae.ai', '需接入 SG 设备绑定登录头及只读权益 POST；尚未实现'),
  new RegionalUnavailableAdapter('trae-global-us', 'Trae 国际 US', 'api-us-east.trae.ai', '需接入 US 设备绑定登录头及只读权益 POST；尚未实现'),
];
