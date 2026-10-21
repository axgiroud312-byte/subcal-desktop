/** Read-only mappings from magpie-community/plugins@aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6
 * packages/zcode/index.mjs and its team/gift/usage tests.
 * Copyright (c) 2026 magpie-community contributors, MIT; full notice and mapping
 * in docs/evidence/full-service/zcode.md. No key discovery/creation, grant,
 * reset consumption, token exchange, browser login, model requests or file IO. */
import { createHash } from 'node:crypto';
import type { EntitlementDate, Field } from '../../shared/types';
import { defaultHttpFetch, executeOfficialGet, formatDecimalString, OPENROUTER_KEY_MANIFEST, type HttpFetchFn } from './http-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type ProviderAdapter } from './types';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const dec = formatDecimalString;
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
function minus(a: string, b: string): string {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (v: string) => { const [w, f = ''] = v.split('.'); return BigInt(w + f.padEnd(scale, '0')); };
  const n = integer(a) - integer(b), digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  return (n < 0n ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits);
}
/** Epoch units are endpoint-specific. Date-only stays a civil date. */
function when(v: unknown, unit: 'seconds' | 'milliseconds' | 'either', beijing = false): EntitlementDate | null {
  let s = str(v);
  if (/^\d{4}-\d\d-\d\d/.test(s)) {
    const day = s.slice(0, 10), ms = Date.parse(day + 'T00:00:00Z');
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return null;
    if (s === day) return { precision: 'day', value: day };
  }
  if (beijing && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(s)) s = s.replace(' ', 'T') + '+08:00';
  let ms = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(s) ? Date.parse(s) : NaN;
  const n = dec(v);
  if (!Number.isFinite(ms) && n !== null && Number(n) > 0) ms = Number(n) * (unit === 'seconds' || unit === 'either' && Number(n) < 1e12 ? 1000 : 1);
  return Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()) ? { precision: 'instant', value: new Date(ms).toISOString() } : null;
}
function field<T>(value: T, at: string, source: string, evidence: 'reported' | 'derived' = 'reported'): Field<T> {
  return { value, observedAt: at, availability: 'known', source, dataOrigin: 'official_api', evidence };
}
const endpoints = {
  quota: '/api/monitor/usage/quota/limit?type=2',
  subscription: '/api/biz/team/subscribe/product/querySubscribeDetail',
  resets: '/api/biz/customer-package-reset/list?targetType=TEAM',
  balance: '/api/v1/zcode-plan/billing/balance?app_version=3.14.3',
  preview: '/api/v1/zcode-plan/billing/preview?app_version=3.14.3',
};
export interface ZCodeCredential {
  site: 'bigmodel' | 'zai'; base?: string; key?: string; token?: string; org?: string; project?: string;
  jwt?: string; device?: string; accountId?: string; subject?: string; alias?: string; identitySubject?: string;
}
/** Accepts the original OpenCode OAuth refresh JSON, never consumes it as a
 * refresh token. Main-process envelope may add source/accessToken/subject/alias. */
export function parseZCodeCredential(secret: string | null | undefined, id: string): ZCodeCredential {
  let r: Obj, saved: Obj = {};
  try { r = obj(JSON.parse(secret ?? '')); if (r.refresh !== undefined) saved = obj(JSON.parse(str(r.refresh))); } catch { throw new AdapterError('AUTH_REQUIRED', '需要有效 ZCode 原登录 JSON（refresh 为状态 JSON）'); }
  if (![id, 'zcode'].includes(str(r.source ?? r.provider))) throw new AdapterError('AUTH_REQUIRED', 'ZCode 凭据来源不匹配');
  if (r.provider !== undefined && r.provider !== id) throw new AdapterError('AUTH_REQUIRED', 'ZCode 凭据目标不匹配');
  const s = { ...saved, ...r };
  const c = { ...s, key: str(s.key) || (s.jwt || s.token ? '' : str(r.accessToken ?? r.access)), accountId: str(r.accountId), subject: str(r.subject), alias: str(r.alias) } as unknown as ZCodeCredential;
  if (!['bigmodel', 'zai'].includes(c.site)) throw new AdapterError('AUTH_REQUIRED', 'ZCode 缺少明确 site，不猜地区');
  const isTeam = id !== 'zcode-gift', expectedSite = id === 'zcode-team-cn' ? 'bigmodel' : 'zai';
  if (isTeam && c.site !== expectedSite) throw new AdapterError('AUTH_REQUIRED', '团队地区与凭据 site 不匹配');
  if (isTeam && r.region !== undefined && ![expectedSite, expectedSite === 'bigmodel' ? 'cn' : 'global', expectedSite === 'bigmodel' ? 'bigmodel.cn' : 'api.z.ai'].includes(str(r.region))) throw new AdapterError('AUTH_REQUIRED', '团队 region 与 site 不匹配');
  if (c.base) {
    let u: URL; try { u = new URL(c.base); } catch { throw new AdapterError('AUTH_REQUIRED', 'ZCode base 无效'); }
    const allowed = c.site === 'bigmodel' ? ['open.bigmodel.cn', 'bigmodel.cn'] : ['api.z.ai'];
    if (!isTeam) allowed.push('zcode.z.ai');
    if (u.protocol !== 'https:' || !allowed.includes(u.hostname) || u.username || u.password || u.port && u.port !== '443') throw new AdapterError('AUTH_REQUIRED', 'ZCode base 与地区不匹配');
  }
  for (const k of ['key', 'token', 'org', 'project', 'jwt', 'device', 'accountId', 'subject', 'alias', 'identitySubject'] as const) if (c[k] !== undefined && (typeof c[k] !== 'string' || /[\r\n]/.test(c[k]!))) throw new AdapterError('AUTH_REQUIRED', 'ZCode 凭据字段无效');
  if (isTeam && (!str(c.org) || !str(c.project) || !str(c.key) && !str(c.token))) throw new AdapterError('AUTH_REQUIRED', '团队查询需要 org/project 及已存在的席位 key 或业务 token');
  if (!isTeam && (!str(c.jwt) || !str(c.device))) throw new AdapterError('AUTH_REQUIRED', '赠送查询需要原状态 jwt/device，不能把 Coding Key 当 JWT');
  if (!isTeam) {
    let exp: unknown;
    try { exp = obj(JSON.parse(Buffer.from(c.jwt!.split('.')[1], 'base64url').toString('utf8'))).exp; } catch { /* opaque token expiry remains unknown */ }
    if (typeof exp === 'number' && Number.isFinite(exp) && exp <= Date.now() / 1000) throw new AdapterError('AUTH_REQUIRED', 'ZCode JWT 已过期，请在原客户端重新登录');
  }
  return c;
}
/** Shared by direct login and collection. Keep the identity seed separate from
 * the final site/project-bound subject so repeated collection is idempotent. */
export function zcodeAccountSubject(c: ZCodeCredential, id: string): string {
  return `${id}:${hash(JSON.stringify([c.site, c.identitySubject || c.subject || c.accountId || c.key || c.jwt || c.token, c.org ?? '', c.project ?? '']))}`;
}
function manifest(id: string, host: string): AdapterManifest {
  return { ...OPENROUTER_KEY_MANIFEST, id, brand: 'ZCode', product: id === 'zcode-gift' ? 'ZCode 赠送权益' : 'ZCode 团队席位', region: host, authMode: 'local_client', allowedHosts: [host], officialSourceUrl: `https://${host}${id === 'zcode-gift' ? endpoints.balance : endpoints.quota}`, supportedFields: id === 'zcode-gift' ? ['赠送分桶与失效日期', '待领取预览（非已拥有额度）'] : ['团队额度与订阅（席位）', '可用重置券及失效日期'], unsupportedFields: ['新浏览器登录', '自动创建或发现 Key', '刷新凭据', '自动领取或消费重置券'], permissions: '只读固定 quota/subscription/reset-list/balance/preview GET，不调用其他路径。', termsCheckedAt: '2026-10-21' };
}
abstract class ZCodeAdapter implements ProviderAdapter {
  abstract readonly manifest: AdapterManifest;
  constructor(protected readonly fetchFn: HttpFetchFn = defaultHttpFetch) {}
  probe(input: CollectInput) { return this.collect(input); }
  protected abstract requests(c: ZCodeCredential): { name: string; path: string; auth: string; headers: Record<string, string> }[];
  abstract normalize(raw: unknown, at: string): CollectOutput;
  async collect(input: CollectInput) {
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const c = parseZCodeCredential(input.secret, this.manifest.id);
    // Include org/project even when the main process supplies a shared account subject.
    const subject = zcodeAccountSubject(c, this.manifest.id);
    if (input.expectedSubject && input.reason !== 'probe' && subject !== input.expectedSubject) throw new AdapterError('ACCOUNT_MISMATCH', 'ZCode 账号、组织或项目已改变');
    const requests = this.requests(c);
    const results = await Promise.allSettled(requests.map(async r => {
      const raw = await executeOfficialGet(this.manifest, `https://${this.manifest.allowedHosts[0]}${r.path}`, { ...input, secret: r.auth }, this.fetchFn, { Authorization: r.auth, 'Content-Type': 'application/json', 'User-Agent': 'ZCode/3.14.3', ...r.headers });
      const e = obj(raw);
      if (e.success === false || e.code !== undefined && ![0, 200, '0', '200'].includes(e.code as number)) throw new AdapterError('UPSTREAM_UNAVAILABLE', 'ZCode 业务查询失败');
      if (!('data' in e)) throw new AdapterError('SCHEMA_CHANGED', 'ZCode 响应缺少 data');
      if (r.name === 'resets') {
        const d = obj(e.data);
        if (d.targetType !== undefined && d.targetType !== 'TEAM' || d.organizationId != null && String(d.organizationId) !== c.org || d.projectId != null && String(d.projectId) !== c.project) throw new AdapterError('ACCOUNT_MISMATCH', '重置券返回的组织/项目或目标范围不匹配');
      }
      return raw;
    }));
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    if (results.every(r => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    const raw: Obj = {}, failures: { field: string; reason: string }[] = [];
    results.forEach((r, i) => { if (r.status === 'fulfilled') raw[requests[i].name] = r.value; else failures.push({ field: requests[i].name, reason: r.reason instanceof AdapterError ? r.reason.code : 'UPSTREAM_UNAVAILABLE' }); });
    const out = this.normalize(raw, new Date().toISOString());
    out.partialFailures.push(...failures);
    if (this.manifest.id !== 'zcode-gift') for (const [k, v] of [['quota', c.key], ['subscription', c.token], ['resets', c.token]]) if (!v) out.partialFailures.push({ field: k!, reason: '来源缺少该查询所需凭据，未发请求' });
    out.account.subject = subject; out.account.alias = c.alias || this.manifest.product; out.account.organization = c.org ? `${c.org}/${c.project}` : c.site;
    out.poolId = `pool-${subject}`;
    out.metrics.forEach(m => { m.poolId = `${out.poolId}:${m.poolId ?? m.id}`; });
    out.balances?.forEach(b => { b.poolId = `${out.poolId}:${b.poolId ?? b.id}`; });
    return out;
  }
  describeRecovery(error: AdapterError) { return { ...defaultDescribeRecovery(this.manifest, error), ...(error.code === 'AUTH_REQUIRED' ? { action: '在原 ZCode 客户端重新登录，由主进程重新读取状态；不会创建 Key 或刷新外部登录' } : {}) }; }
  async disconnect() {}
  protected output(at: string): CollectOutput { return { account: { subject: this.manifest.id, alias: this.manifest.product, organization: '', region: this.manifest.region }, poolId: `pool-${this.manifest.id}`, metrics: [], fields: [], partialFailures: [], samples: [], observedAt: at }; }
  protected data(raw: Obj, name: string, out: CollectOutput): Obj | null {
    if (!(name in raw)) return null;
    const e = obj(raw[name]);
    if (e.success === false || e.code !== undefined && ![0, 200, '0', '200'].includes(e.code as number) || !e.data || typeof e.data !== 'object' || Array.isArray(e.data)) { out.partialFailures.push({ field: name, reason: '响应结构或业务状态异常' }); return null; }
    const d = obj(e.data);
    const shape = name === 'quota' ? Array.isArray(d.limits) : name === 'subscription' ? 'status' in d || 'hasSubscription' in d || 'memberGrantStatus' in d : name === 'resets' ? Array.isArray(d.fiveHourResets) || Array.isArray(d.weekResets) : name === 'balance' ? Array.isArray(d.plans) && Array.isArray(d.balances) : Array.isArray(d.plans);
    if (!shape) { out.partialFailures.push({ field: name, reason: '缺少端点约定的权益字段' }); return null; }
    return d;
  }
}

export class ZCodeTeamAdapter extends ZCodeAdapter {
  readonly manifest: AdapterManifest;
  constructor(region: 'cn' | 'global' = 'global', fetchFn?: HttpFetchFn) { super(fetchFn); this.manifest = manifest(`zcode-team-${region}`, region === 'cn' ? 'bigmodel.cn' : 'api.z.ai'); }
  protected requests(c: ZCodeCredential) {
    const headers = { 'Bigmodel-Organization': c.org!, 'Bigmodel-Project': c.project!, 'Set-Language': c.site === 'bigmodel' ? 'zh' : 'en', 'Accept-Language': 'en-US,en' };
    return [...(c.key ? [{ name: 'quota', path: endpoints.quota, auth: c.key, headers }] : []), ...(c.token ? ['subscription', 'resets'].map(name => ({ name, path: endpoints[name as 'subscription' | 'resets'], auth: c.token!, headers })) : [])];
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = this.output(at), q = this.data(r, 'quota', out), s = this.data(r, 'subscription', out), resets = this.data(r, 'resets', out);
    if (!q && !s && !resets) throw new AdapterError('SCHEMA_CHANGED', '没有可识别的团队权益响应');
    for (const [i, value] of arr(q?.limits).entries()) {
      const b = obj(value), total = dec(b.usage), used = dec(b.currentValue), left = dec(b.remaining), p = dec(b.percentage), tools = str(b.type).toUpperCase() === 'TIME_LIMIT';
      const reset = when(b.nextResetTime, 'milliseconds'), id = `${tools ? 'mcp' : 'coding'}-${hash(JSON.stringify([b.type, b.unit, b.number, i]))}`;
      const noCap = total !== null && Number(total) === 0;
      const quantities = !noCap && total !== null && (left !== null || used !== null);
      const remaining = quantities ? left ?? minus(total!, used!) : p !== null && !noCap ? minus('100', p) : null;
      if (!noCap && remaining === null) { out.partialFailures.push({ field: id, reason: '未返回数量或百分比，未补零' }); continue; }
      const unit = quantities || noCap ? tools ? '次' : 'credits' : '%';
      const unitMinutes = ({ 1: 1, 3: 60, 4: 1440, 6: 10080 } as Record<string, number>)[String(b.unit)], count = dec(b.number);
      out.metrics.push({ id, label: tools ? '团队 MCP' : '团队 Coding', unit, remaining, total: noCap ? null : quantities ? total : '100', used: quantities ? used ?? minus(total!, left!) : p, resetAt: reset?.value ?? null, resetObservation: reset ? field(reset, at, endpoints.quota) : undefined, observedAt: at, availability: noCap ? 'unlimited' : 'known', source: endpoints.quota, dataOrigin: 'official_api', staleAfterMinutes: 30, scope: 'seat', evidence: quantities && left !== null ? 'reported' : 'derived', windowMinutes: unitMinutes && count !== null && Number(count) > 0 ? unitMinutes * Number(count) : undefined });
    }
    if (s && (s.hasSubscription == null || s.hasSubscription === true) && str(s.status).toUpperCase() === 'EFFECTIVE' && str(s.memberGrantStatus).toUpperCase() === 'VALID') {
      if (str(s.productName)) out.fields.push({ field: 'plan', value: str(s.productName), observedAt: at, availability: 'known', source: endpoints.subscription, dataOrigin: 'official_api', evidence: 'reported' });
      const end = when(s.subscribeEndTime, 'either', true);
      if (end) out.entitlements = { membershipExpiresAt: field(end, at, endpoints.subscription) };
      // A team seat does not reveal the organization's actual auto-renew setting.
    } else if (s) out.partialFailures.push({ field: 'subscription', reason: '未确认 EFFECTIVE/VALID 团队席位；没有伪造 Free 或清空旧套餐' });
    for (const [key, label] of [['fiveHourResets', '五小时'], ['weekResets', '每周']] as const) {
      if (!Array.isArray(resets?.[key])) continue;
      const rows = arr(resets[key]), available = rows.map(obj).filter(x => x.available === true);
      if (rows.some(x => typeof obj(x).available !== 'boolean')) { out.partialFailures.push({ field: key, reason: '重置券 available 状态不完整，未计算总数' }); continue; }
      out.metrics.push({ id: `reset-coupons:${key}`, label: `团队${label}可用重置券`, unit: '次', remaining: String(available.length), total: null, resetAt: null, observedAt: at, availability: 'known', source: endpoints.resets, dataOrigin: 'official_api', staleAfterMinutes: 30, scope: 'seat', evidence: 'derived' });
      const occurrence = new Map<string, number>();
      for (const coupon of available) {
        const end = when(coupon.expireTime, 'either', true), signature = hash(JSON.stringify([coupon.recordId ?? coupon.id ?? coupon.resetId ?? '', coupon.expireTime ?? null]));
        const n = occurrence.get(signature) ?? 0; occurrence.set(signature, n + 1);
        (out.balances ??= []).push({ id: `reset-coupon:${key}:${signature}:${n}`, label: `${label}重置券（失效而非重置）`, kind: 'grant', scope: 'account', currency: '次', amount: field('1', at, endpoints.resets), expiresAt: end ? field(end, at, endpoints.resets) : undefined });
      }
    }
    return out;
  }
}

export class ZCodeGiftAdapter extends ZCodeAdapter {
  readonly manifest = manifest('zcode-gift', 'zcode.z.ai');
  protected requests(c: ZCodeCredential) {
    const headers = { 'X-Device-Mid': c.device! }, auth = `Bearer ${c.jwt}`;
    return [{ name: 'balance', path: endpoints.balance, auth, headers }, { name: 'preview', path: `${endpoints.preview}&platform=${encodeURIComponent(`${process.platform}-${process.arch}`)}`, auth, headers }];
  }
  normalize(raw: unknown, at: string) {
    const r = obj(raw), out = this.output(at), b = this.data(r, 'balance', out), preview = this.data(r, 'preview', out);
    if (!b && !preview) throw new AdapterError('SCHEMA_CHANGED', '没有可识别的赠送权益响应');
    const reportedNow = dec(b?.server_time), now = reportedNow !== null && Number(reportedNow) > 0 ? Number(reportedNow) * 1000 : Date.parse(at);
    const future = (end: EntitlementDate | null) => !end || (end.precision === 'instant' ? Date.parse(end.value) : Date.parse(end.value + 'T23:59:59.999Z')) > now;
    const plans = arr(b?.plans).map(obj).filter(p => str(p.status).toLowerCase() === 'active' && future(when(p.ends_at, 'seconds')));
    const earliest = plans.map(p => ({ p, end: when(p.ends_at, 'seconds') })).sort((a, z) => (a.end ? Date.parse(a.end.value) : Infinity) - (z.end ? Date.parse(z.end.value) : Infinity))[0];
    if (earliest) {
      if (str(earliest.p.name)) out.fields.push({ field: 'plan', value: str(earliest.p.name), observedAt: at, availability: 'known', source: endpoints.balance, dataOrigin: 'official_api', evidence: 'reported' });
      if (earliest.end) out.entitlements = { membershipExpiresAt: field(earliest.end, at, `${endpoints.balance} · 最早活跃赠送计划`), autoRenew: field(false, at, '赠送计划非自动续费', 'derived') };
    }
    const duplicate = new Map<string, number>();
    for (const value of arr(b?.balances)) {
      const x = obj(value), owner = plans.find(p => str(x.user_plan_id) && str(p.user_plan_id) ? x.user_plan_id === p.user_plan_id : str(x.plan_id) && x.plan_id === p.plan_id);
      if (!owner) continue;
      const end = when(x.expires_at, 'seconds'); if (!future(end)) continue;
      const total = dec(x.total_units), used = dec(x.used_units), reportedLeft = dec(x.remaining_units), left = reportedLeft ?? (total !== null && used !== null ? minus(total, used) : null);
      const signature = hash(JSON.stringify([x.user_plan_id, x.plan_id, x.entitlement_id, x.id ?? x.balance_id, x.show_name, x.capabilities, x.expires_at]));
      const n = duplicate.get(signature) ?? 0; duplicate.set(signature, n + 1); const id = `gift:${signature}:${n}`;
      if (left === null && used === null && total === null) { out.partialFailures.push({ field: id, reason: '赠送桶没有有效数量，未补零' }); continue; }
      const models = arr(x.capabilities).filter(v => typeof v === 'string').map(v => str(v)).filter(v => v.startsWith('model:') || !v.includes(':')).map(v => v.replace(/^model:/, '').trim()).filter(Boolean);
      const label = str(x.show_name) || models.join(', ') || '赠送额度';
      const entitlement = arr(owner.entitlements).map(obj).find(e => str(e.entitlement_id) && e.entitlement_id === x.entitlement_id);
      const unit = str(x.unit_type) || str(x.unit) || str(entitlement?.unit_type) || 'units';
      const poolKey = `${str(owner.user_plan_id)}:${str(owner.plan_id)}:${id}`;
      const start = when(x.period_start, 'seconds'), periodEnd = when(x.period_end, 'seconds');
      out.metrics.push({ id, label, unit, remaining: left, used, total, resetAt: null, observedAt: at, availability: left === null ? 'unfetched' : 'known', source: endpoints.balance, dataOrigin: 'official_api', staleAfterMinutes: 30, models, scope: models.length ? 'model' : 'account', poolId: poolKey, evidence: reportedLeft === null ? 'derived' : 'reported', windowStart: start ? field(start, at, endpoints.balance) : undefined, windowEnd: periodEnd ? field(periodEnd, at, endpoints.balance) : undefined });
      if (unit === 'units') out.partialFailures.push({ field: `${id}:unit`, reason: '服务端未声明单位，保留原始 units；不猜 credits 或 tokens' });
      if (left !== null) (out.balances ??= []).push({ id, label, scope: 'account', kind: 'grant', currency: unit, amount: field(left, at, endpoints.balance, reportedLeft === null ? 'derived' : 'reported'), expiresAt: end ? field(end, at, endpoints.balance) : undefined, poolId: poolKey });
    }
    if (preview && Array.isArray(preview.plans)) {
      const pending = arr(preview.plans).map(obj).filter(p => str(p.plan_id));
      if (pending.length) out.samples.push(`ZCode 有 ${pending.length} 个待领取计划（未计入权益）：${pending.map(p => str(p.name)).filter(Boolean).join('、')}`);
    }
    if (b && !plans.length) out.partialFailures.push({ field: 'active-gifts', reason: '本次未返回活跃赠送计划；待领取预览不是已拥有权益' });
    return out;
  }
}
export function createZCodeAdapters(fetchFn: HttpFetchFn = defaultHttpFetch): ProviderAdapter[] { return [new ZCodeTeamAdapter('cn', fetchFn), new ZCodeTeamAdapter('global', fetchFn), new ZCodeGiftAdapter(fetchFn)]; }
export const zcodeAdapters: ProviderAdapter[] = createZCodeAdapters();
