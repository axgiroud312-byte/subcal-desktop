/**
 * Read-only protocol ports. Source map and full MIT notices:
 * docs/evidence/full-service/extended.md
 * Copyright (c) 2026 magpie-community contributors
 * Copyright (c) 2026 yetone
 * No upstream plugin is loaded; no model/sign-in/refresh/claim endpoint is called.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Field, EntitlementDate } from '../../shared/types';
import { defaultHttpFetch, executeOfficialGet, formatDecimalString, type HttpFetchFn } from './http-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type ProviderAdapter } from './types';

export type ExtendedAdapterId = 'grok-build' | 'kimi-code' | 'kimi-code-cn' | 'kimi-work' | 'factory' | 'cline' | 'commandcode' | 'zed' | 'opendesign' | 'autoclaw' | 'autoclaw-cn';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const rows = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const number = (v: unknown): number | null => { const s = formatDecimalString(v); return s !== null && Number.isFinite(Number(s)) ? Number(s) : null; };
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
function instant(v: unknown, epoch: 'none' | 'ms' | 'auto' = 'none'): string | null {
  let n: number;
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(v)) n = Date.parse(v);
  else { const value = number(v); if (epoch === 'none' || value === null || value <= 0) return null; n = epoch === 'auto' && value < 1e12 ? value * 1000 : value; }
  return Number.isFinite(n) && Math.abs(n) <= 8.64e15 ? new Date(n).toISOString() : null;
}

/** Main-process only. Resolver rereads external sign-ins each time; never receives refresh tokens. */
export interface ExtendedCredential {
  accessToken: string;
  subject?: string;
  alias?: string;
  source?: string;
  management?: string;
  locator?: string;
  userId?: string;
  organizationId?: string;
  systemId?: string;
  region?: 'us' | 'eu';
  controlKey?: string;
}
export type ExtendedCredentialResolver = (id: ExtendedAdapterId, input: CollectInput) => Promise<ExtendedCredential>;
export interface ExtendedAdapterOptions {
  fetchFn?: HttpFetchFn;
  /** Only used for the single constant Kimi Work read RPC, body always {}. */
  postFetchFn?: ExtendedPostFetchFn;
  resolveCredential?: ExtendedCredentialResolver;
}
export type ExtendedPostFetchFn = (url: string, init: { method: 'POST'; body: '{}'; headers: Record<string, string>; signal: AbortSignal; redirect: 'error' }) => ReturnType<HttpFetchFn>;

function readJson(file: string): Obj {
  try { if (statSync(file).size > 8 * 1024 * 1024) throw new Error(); return obj(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))); }
  catch { throw new AdapterError('AUTH_REQUIRED', '未找到可读取的本机登录，请先在官方客户端登录'); }
}
export const resolveExtendedCredential: ExtendedCredentialResolver = async (id, input) => {
  const secret = input.secret?.trim();
  if (secret) {
    if (!secret.startsWith('{')) return { accessToken: secret };
    let c: Obj;
    try { c = obj(JSON.parse(secret)); } catch { throw new AdapterError('AUTH_REQUIRED', '登录凭据格式无效'); }
    return { accessToken: text(c.accessToken) || text(c.controlKey), subject: text(c.subject) || undefined, alias: text(c.alias) || undefined, source: text(c.source) || undefined, management: text(c.management) || undefined, locator: text(c.locator) || undefined, userId: text(c.userId) || undefined, organizationId: text(c.organizationId) || undefined, systemId: text(c.systemId) || undefined, region: c.region === 'eu' ? 'eu' : 'us', controlKey: text(c.controlKey) || undefined };
  }
  if (id === 'grok-build') {
    const auth = readJson(path.join(process.env.GROK_HOME || path.join(os.homedir(), '.grok'), 'auth.json'));
    for (const k of Object.keys(auth).sort()) {
      const c = obj(auth[k]);
      if (text(c.key)) {
        const expires = instant(c.expires_at);
        if (expires && Date.parse(expires) <= Date.now()) throw new AdapterError('AUTH_REQUIRED', '请在 Grok Build CLI 重新登录；不会运行 models 刷新外部凭据');
        return { accessToken: text(c.key), subject: text(c.user_id) ? `grok-build:${text(c.user_id)}` : undefined };
      }
    }
  }
  if (id === 'kimi-work') {
    const parent = process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config');
    const credentials = obj(readJson(path.join(parent, 'kimi-desktop', 'daimon-share', 'daimon', 'config.json')).credentials);
    const work = obj(credentials.kimiCode), web = obj(credentials.kimiWeb);
    if (text(work.baseUrl).replace(/\/$/, '') === 'https://agent-gw.kimi.com/coding/v1' && text(work.apiKey) && text(web.accessToken) && text(web.userId)) return { accessToken: text(web.accessToken), subject: `kimi-work:${hash(text(web.userId))}` };
  }
  throw new AdapterError('AUTH_REQUIRED', '请提供该产品的有效凭据或由主进程授权模块选择已登录账号；不自动刷新外部登录');
};

const definitions: Record<ExtendedAdapterId, [string, string[]]> = {
  'grok-build': ['Grok Build', ['cli-chat-proxy.grok.com']],
  'kimi-code': ['Kimi Code 国际', ['api.kimi.ai']],
  'kimi-code-cn': ['Kimi Code 国内', ['api.kimi.com']],
  'kimi-work': ['Kimi Work', ['www.kimi.com']],
  factory: ['Factory', ['api.factory.ai', 'api.eu.factory.ai']],
  cline: ['Cline', ['api.cline.bot']],
  commandcode: ['Command Code', ['api.commandcode.ai']],
  zed: ['Zed', ['cloud.zed.dev']],
  opendesign: ['Open Design', ['amr-api.open-design.ai']],
  autoclaw: ['AutoClaw 国际', ['autoglm-api.autoglm.ai']],
  'autoclaw-cn': ['AutoClaw 国内', ['autoglm-api.zhipuai.cn']],
};
function manifest(id: ExtendedAdapterId): AdapterManifest {
  const [product, allowedHosts] = definitions[id];
  return {
    // Shared manifest union is extended by the integrating agent; no retired ID is used.
    id: id as AdapterManifest['id'], version: '1.0.0', brand: product, product, region: allowedHosts[0],
    supportedFields: ['供应商报告的套餐、余额或用量'], unsupportedFields: ['真实支付金额', '未报告的日期及额度'],
    authMode: 'api_key', officialSourceUrl: `https://${allowedHosts[0]}`, termsCheckedAt: '2026-10-21', allowedHosts,
    minIntervalSeconds: 300, defaultForegroundSeconds: 1800, defaultBackgroundSeconds: 1800, timeoutMs: 15000, supportTier: 'official_auto',
    permissions: '仅固定官方只读权益接口；不刷新外部凭据，不调用模型、签到、领取、购买或创建 Key。真实账号验证待完成。',
    credentialLocation: '主进程安全存储或只读官方客户端登录；凭据不进入渲染器。',
  };
}

export class ExtendedProviderAdapter implements ProviderAdapter {
  readonly manifest: AdapterManifest;
  private readonly fetchFn: HttpFetchFn;
  constructor(readonly id: ExtendedAdapterId, private readonly options: ExtendedAdapterOptions = {}) { this.manifest = manifest(id); this.fetchFn = options.fetchFn || defaultHttpFetch; }
  probe(input: CollectInput) { return this.collect(input); }
  describeRecovery(error: AdapterError) { return defaultDescribeRecovery(this.manifest, error); }
  async disconnect(): Promise<void> {}

  async collect(input: CollectInput): Promise<CollectOutput> {
    const cred = await (this.options.resolveCredential || resolveExtendedCredential)(this.id, input);
    const token = this.id === 'opendesign' ? cred.controlKey || (cred.accessToken.startsWith('vela_ctrl_') ? cred.accessToken : '') : cred.accessToken;
    if (!token || /[\r\n]/.test(token)) throw new AdapterError('AUTH_REQUIRED', this.id === 'opendesign' ? '需要账户 control key；runtime API key 不能读取 Design Plan' : '缺少有效账户凭据');
    const sourceInput = { ...input, secret: token };
    const errors: CollectOutput['partialFailures'] = [];
    const caughtErrors: AdapterError[] = [];
    const get = (host: string, route: string, headers: Record<string, string> = {}) => executeOfficialGet(this.manifest, `https://${host}${route}`, sourceInput, this.fetchFn, headers);
    const optional = async (field: string, run: () => Promise<unknown>, noPlan404 = false) => {
      try { return await run(); } catch (e) {
        if (e instanceof AdapterError && (e.code === 'CANCELLED' || e.code === 'ACCOUNT_MISMATCH')) throw e;
        if (noPlan404 && e instanceof AdapterError && e.options?.httpStatus === 404) return { limits: [] };
        if (e instanceof AdapterError) caughtErrors.push(e);
        errors.push({ field, reason: e instanceof AdapterError ? e.code : 'UPSTREAM_UNAVAILABLE' }); return undefined;
      }
    };
    let raw: unknown;
    const host = this.manifest.allowedHosts[0];
    switch (this.id) {
      case 'grok-build': raw = await get(host, '/v1/billing?format=credits'); break;
      case 'kimi-code': case 'kimi-code-cn': raw = await get(host, '/coding/v1/usages'); break;
      case 'kimi-work': raw = await this.readWork(sourceInput); break;
      case 'factory': raw = await get(cred.region === 'eu' ? 'api.eu.factory.ai' : host, '/api/billing/limits', { 'X-Factory-Client': 'cli', ...(cred.organizationId ? { 'X-Factory-Org-Id': cred.organizationId } : {}) }); break;
      case 'cline': {
        const [me, limits] = await Promise.all([optional('account', () => get(host, '/api/v1/users/me')), optional('limits', () => get(host, '/api/v1/users/me/plan/usage-limits'), true)]);
        const m = obj(me), ids = [...new Set([m.clineUserId, m.subject, m.id, cred.userId].map(text).filter(Boolean))];
        let balance: unknown;
        for (const id of ids) { balance = await optional('balance', () => get(host, `/api/v1/users/${encodeURIComponent(id)}/balance`)); if (balance !== undefined) break; }
        if (!ids.length) errors.push({ field: 'balance', reason: '未返回可核验用户 ID' });
        raw = { me, limits, balance }; break;
      }
      case 'commandcode': {
        const [subscription, credits] = await Promise.all([optional('subscription', () => get(host, '/alpha/billing/subscriptions')), optional('credits', () => get(host, '/alpha/billing/credits'))]); raw = { subscription, credits }; break;
      }
      case 'zed':
        if (!cred.userId || /[\r\n\s]/.test(cred.userId)) throw new AdapterError('AUTH_REQUIRED', 'Zed 需要 userId 与账户 access token，而非模型 Bearer token');
        raw = { me: await get(host, '/client/users/me', { Authorization: `${cred.userId} ${token}`, ...(cred.systemId ? { 'x-zed-system-id': cred.systemId } : {}) }), selectedOrg: cred.organizationId }; break;
      case 'opendesign': {
        const workspace = obj(await get(host, '/api/v1/workspaces/current'));
        const id = text(workspace.activeWorkspaceId) || text(workspace.workspaceId);
        if (!id) throw new AdapterError('SCHEMA_CHANGED', 'Open Design 未返回 active workspace');
        const [preflight, summary] = await Promise.all([optional('preflight', () => get(host, `/api/v1/workspaces/${encodeURIComponent(id)}/billing/preflight`)), optional('summary', () => get(host, '/api/v1/billing/summary'))]); raw = { preflight, summary, workspaceId: id }; break;
      }
      case 'autoclaw': case 'autoclaw-cn': raw = await get(host, '/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw', this.autoHeaders(token)); break;
    }
    let out: CollectOutput;
    try { out = this.normalize(raw, new Date().toISOString()); }
    catch (e) { if (caughtErrors.length && e instanceof AdapterError && e.code === 'SCHEMA_CHANGED') throw caughtErrors[0]; throw e; }
    // Match service.hashKeySubject's new-provider fallback for raw keys. An
    // authorized JSON envelope's subject is already canonical: never prefix it.
    out.account.subject = cred.subject || `${this.id}:${createHash('sha256').update(token.trim()).digest('hex').slice(0, 12)}`;
    if (cred.alias) out.account.alias = cred.alias;
    out.account.organization = text(obj(raw).workspaceId) || out.account.organization || cred.organizationId || '个人';
    out.account.region = this.id === 'factory' && cred.region === 'eu' ? 'api.eu.factory.ai' : host;
    out.poolId = `${this.id}:${hash(`${out.account.subject}:${out.account.organization}:${out.account.region}`)}`;
    for (const m of out.metrics) m.poolId = this.id === 'factory' ? `${out.poolId}:${m.id.startsWith('core-') ? 'core' : 'standard'}` : out.poolId;
    for (const b of out.balances || []) b.poolId = out.poolId;
    if (input.expectedSubject && input.expectedSubject !== out.account.subject) throw new AdapterError('ACCOUNT_MISMATCH', '账号已改变，未更新旧快照');
    out.partialFailures.push(...errors);
    return out;
  }

  private autoHeaders(token: string): Record<string, string> {
    const ts = String(Math.floor(Date.now() / 1000));
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: '*/*', 'User-Agent': `AutoClaw/1.18.1 (${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'}-${process.arch})`, 'X-Version': '1.18.1', 'X-Tm': process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux', 'X-Product': 'autoclaw', 'X-Auth-Appid': '100003', 'X-Auth-TimeStamp': ts, 'X-Auth-Sign': createHash('md5').update(`100003&${ts}&38d2391985e2369a5fb8227d8e6cd5e5`).digest('hex'), 'X-Trace-Id': randomBytes(8).toString('hex'), 'X-Lang': 'zh-CN', 'X-Channel': 'AutoClaw4', Origin: 'http://localhost:18432', Referer: 'http://localhost:18432/' };
  }
  private async readWork(input: CollectInput): Promise<unknown> {
    // Reuse the GET executor's bounded decoding/status/abort/backoff logic, but
    // its transport can only target this one allowlisted read-only RPC.
    const endpoint = 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats';
    const post = this.options.postFetchFn || (async (url, init) => {
      const response = await fetch(url, init);
      return { status: response.status, headers: response.headers, text: async () => {
        const reader = response.body?.getReader(); if (!reader) return '';
        const chunks: Uint8Array[] = []; let size = 0;
        try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', 'Kimi Work 响应过大'); chunks.push(part.value); } return Buffer.concat(chunks).toString('utf8'); }
        finally { await reader.cancel().catch(() => {}); }
      } };
    });
    return executeOfficialGet(this.manifest, endpoint, input, async (url, init) => {
      if (url !== endpoint) throw new AdapterError('UNSUPPORTED', '禁止非权益 RPC');
      return post(url, { ...init, method: 'POST', body: '{}', redirect: 'error', headers: { ...init.headers, 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' } });
    });
  }

  normalize(raw: unknown, observedAt: string): CollectOutput {
    const r = obj(raw);
    const source = `官方账户只读接口 · ${this.manifest.product}`;
    const out: CollectOutput = { account: { subject: this.id, alias: this.manifest.product, organization: '', region: this.manifest.region }, poolId: this.id, metrics: [], fields: [], partialFailures: [], samples: [], observedAt, entitlements: {}, balances: [] };
    const field = <T>(value: T, evidence: 'reported' | 'derived' = 'reported'): Field<T> => ({ value, availability: 'known', source, observedAt, dataOrigin: 'official_api', evidence });
    const plan = (v: unknown) => { if (text(v)) out.fields.push({ field: 'plan', value: text(v), availability: 'known', source, observedAt, dataOrigin: 'official_api', evidence: 'reported' }); };
    const period = (v: unknown, epoch: 'none' | 'ms' | 'auto' = 'none') => { const at = instant(v, epoch); if (at) out.entitlements!.billingPeriodEnd = field<EntitlementDate>({ precision: 'instant', value: at }); };
    const renew = (cancel: unknown, status?: unknown) => { if (typeof cancel === 'boolean' && (status === undefined || text(status))) out.entitlements!.autoRenew = field(!cancel, 'derived'); };
    const fail = (id: string) => out.partialFailures.push({ field: id, reason: '缺失或无效字段，保留上次观察值' });
    const balance = (id: string, label: string, v: unknown, currency: string, divisor = 1, kind: 'total' | 'credit' = 'credit') => {
      const n = number(v); if (n === null) { fail(id); return; }
      out.balances!.push({ id, label, kind, scope: 'account', currency, amount: field(formatDecimalString(n / divisor)!), poolId: this.id });
    };
    const metric = (id: string, label: string, usedValue: unknown, totalValue: unknown, unit: string, end?: unknown, minutes?: number, epoch: 'none' | 'ms' | 'auto' = 'none') => {
      const used = number(usedValue), total = number(totalValue);
      if (used === null || total === null || used < 0 || total <= 0) { fail(id); return; }
      const resetAt = instant(end, epoch);
      out.metrics.push({ id, label, unit, used: formatDecimalString(used), total: formatDecimalString(total), remaining: formatDecimalString(Math.max(0, total - used)), resetAt, observedAt, availability: 'known', source, dataOrigin: 'official_api', staleAfterMinutes: 120, evidence: 'reported', windowMinutes: minutes, poolId: `${this.id}:${id}`, ...(resetAt ? { resetObservation: field<EntitlementDate>({ precision: 'instant', value: resetAt }) } : {}) });
    };
    switch (this.id) {
      case 'grok-build': {
        const cfg = obj(r.config), current = obj(cfg.currentPeriod), end = cfg.currentPeriod ? current.end : cfg.billingPeriodEnd;
        const spans: Record<string, number> = { DAILY: 1440, WEEKLY: 10080, MONTHLY: 43200 };
        metric('allowance', 'Grok Build 额度', cfg.creditUsagePercent, 100, '%', end, spans[text(current.type).replace(/^USAGE_PERIOD_TYPE_/, '')]);
        const cap = number(obj(cfg.onDemandCap).val), used = number(obj(cfg.onDemandUsed).val);
        if (cap !== null && cap > 0 && used !== null) metric('on-demand', 'On-demand（百分比）', used / cap * 100, 100, '%', end);
        else if (cap !== null && cap > 0) fail('on-demand');
        break;
      }
      case 'kimi-code': case 'kimi-code-cn': {
        const add = (d: Obj, id: string, label: string, minutes?: number) => {
          const total = number(d.limit), used = number(d.used), remaining = number(d.remaining);
          // Only relative share has a verified unit; never label these as tokens.
          if (total === null || total <= 0 || (used === null && remaining === null)) { fail(id); return; }
          metric(id, label, (used ?? total - remaining!) / total * 100, 100, '%', d.resetTime ?? d.resetAt ?? d.reset_at ?? d.reset_time, minutes);
        };
        rows(r.limits).forEach((item, i) => { const l = obj(item), w = obj(l.window), n = number(w.duration); const factor = /MINUTE/.test(text(w.timeUnit)) ? 1 : /HOUR/.test(text(w.timeUnit)) ? 60 : /DAY/.test(text(w.timeUnit)) ? 1440 : undefined; add(obj(l.detail ?? l.window), `short-${i}`, '短窗口额度', n !== null && factor ? n * factor : undefined); });
        add(obj(r.usage), 'weekly', '周额度', 10080); break;
      }
      case 'kimi-work': {
        const ratio = number(obj(r.subscriptionBalance).amountUsedRatio);
        if (ratio !== null && ratio >= 0 && ratio <= 1) { plan('Kimi Work · 会员共享额度'); metric('membership-shared', '会员共享额度', ratio * 100, 100, '%'); } else fail('membership-shared'); break;
      }
      case 'factory': {
        const limits = obj(r.limits);
        if (!Object.keys(obj(limits.standard)).length) fail('standard');
        for (const group of ['standard', 'core']) {
          const p = obj(limits[group]);
          for (const [key, minutes] of [['fiveHour', 300], ['weekly', 10080], ['monthly', 43200]] as const) {
            if (p[key] === undefined) continue; const w = obj(p[key]); metric(`${group}-${key}`, `${group === 'core' ? 'Droid Core' : 'Standard'} · ${{fiveHour:'5 小时',weekly:'每周',monthly:'月度'}[key]}`, w.usedPercent, 100, '%', w.windowEnd, minutes, 'ms');
          }
        }
        if (r.extraUsageBalanceCents !== undefined) balance('extra-usage', '额外用量余额', r.extraUsageBalanceCents, 'USD', 100);
        break;
      }
      case 'cline': {
        const me = obj(r.me), limits = obj(r.limits), b = obj(r.balance);
        plan(me.plan ?? me.planType ?? me.planName ?? me.membership ?? me.tier);
        for (const item of rows(limits.limits)) { const l = obj(item); const minutes = ({ five_hour: 300, weekly: 10080, monthly: 43200 } as Record<string, number>)[text(l.type)]; if (minutes) metric(`pass-${text(l.type)}`, `ClinePass · ${text(l.type)}`, l.percentUsed, 100, '%', l.resetsAt, minutes, 'auto'); }
        if (b.balance !== undefined) balance('wallet-usd', '账户余额', b.balance, 'USD', 1e6);
        else if (r.balance !== undefined) {
          const total = b.total ?? b.totalCredits ?? b.limit, used = b.used ?? b.usedCredits, left = b.remaining ?? b.remainingCredits ?? b.credits;
          if (number(total) !== null && (number(used) !== null || number(left) !== null)) metric('credits', 'Credits', number(used) ?? number(total)! - number(left)!, total, 'credits', b.resetAt ?? b.nextResetAt, undefined, 'auto');
          else if (left !== undefined) balance('credits', 'Credits 余额', left, 'credits'); else fail('balance');
        }
        break;
      }
      case 'commandcode': {
        const subResponse = obj(r.subscription), sub = obj(subResponse.data), c = obj(r.credits), credits = obj(c.credits);
        if (subResponse.success === false) fail('subscription');
        else if (r.subscription !== undefined) {
          if (text(sub.planId) && sub.status !== 'canceled' && sub.status !== 'incomplete_expired') { plan(sub.planId); period(sub.currentPeriodEnd, 'auto'); renew(sub.cancelAtPeriodEnd); }
          else if (subResponse.data === null || sub.status === 'canceled' || sub.status === 'incomplete_expired') plan('No plan'); else fail('subscription');
        }
        if (c.success === false) fail('credits'); else {
          for (const key of ['fiveHour', 'weekly']) { const w = obj(obj(c.windowLimits)[key]); if (obj(c.windowLimits)[key] !== undefined) metric(key, key, w.used, w.cap, 'credits', w.resetAt, key === 'weekly' ? 10080 : 300, 'auto'); }
          for (const [key, label] of [['monthlyCredits', '月度余额'], ['purchasedCredits', '购买余额'], ['freeCredits', '赠送余额']]) if (credits[key] !== undefined) balance(key, label, credits[key], 'USD');
        }
        // No static planMonthly estimate is promoted to a reported total.
        break;
      }
      case 'zed': {
        const me = obj(r.me ?? raw), organizations = rows(me.organizations).map(obj), plans = obj(me.plans_by_organization), configs = obj(me.configuration_by_organization);
        const saved = text(r.selectedOrg), def = text(me.default_organization_id);
        const usable = (o: Obj | undefined) => !!o && !!text(plans[text(o.id)]) && plans[text(o.id)] !== 'zed_free' && obj(configs[text(o.id)]).is_zed_model_provider_enabled !== false;
        const keep = organizations.find(o => o.id === saved), defaultOrg = organizations.find(o => o.id === def);
        const selected = [keep, defaultOrg].find(usable) || organizations.find(o => o.is_personal && usable(o)) || organizations.find(usable) || keep || defaultOrg || organizations[0];
        const selectedId = text(selected?.id), p = obj(me.plan);
        const id = selectedId && me.plans_by_organization !== undefined ? text(plans[selectedId]) : text(p.plan_v3);
        if (!('plan' in me) && !('plans_by_organization' in me)) break;
        plan(id === '' || id === 'zed_free' ? 'No plan' : id.replace(/^zed_/, ''));
        out.account.organization = selectedId;
        // Account period is not attributed to an unrelated organization.
        if (!organizations.length || selectedId === def) period(obj(p.subscription_period).ended_at);
        if (p.has_overdue_invoices === true) out.partialFailures.push({ field: 'billing', reason: '存在逾期账单，模型服务可能暂停；不等于登录失效' }); break;
      }
      case 'opendesign': {
        const pre = obj(r.preflight), summary = obj(r.summary), coding = obj(pre.codingPlan);
        if (text(summary.membershipTier)) plan(`Design Plan ${text(summary.membershipTier)}`);
        if (r.summary !== undefined) { period(summary.subscriptionCurrentPeriodEnd, 'auto'); if (text(summary.subscriptionStatus)) renew(summary.subscriptionCancelAtPeriodEnd, summary.subscriptionStatus); }
        const usd = pre.balanceUsd ?? summary.balanceUsd; if (usd !== undefined) balance('wallet', '钱包余额', usd, 'USD');
        rows(coding.windows).forEach((item, i) => { const w = obj(item); metric(`coding-${i}`, 'Design Plan 额度', w.usedCredits, w.limitCredits, 'credits', w.resetsAt, number(w.durationSeconds) === null ? undefined : number(w.durationSeconds)! / 60, 'auto'); });
        if (coding.eligible === false) out.partialFailures.push({ field: 'codingPlan', reason: '当前不符合套餐额度条件，请求将使用钱包；钱包不等于零' }); break;
      }
      case 'autoclaw': case 'autoclaw-cn': {
        if (r.code !== 0 || !r.data) throw new AdapterError('UPSTREAM_UNAVAILABLE', 'AutoClaw 钱包业务状态未成功');
        const d = obj(r.data); balance('total', '积分总余额', d.total_balance, 'credits', 1, 'total');
        rows(d.wallets).map(obj).filter(w => w.display !== false && number(w.balance) !== null && number(w.balance)! > 0 && number(w.balance) !== number(d.total_balance)).slice(0, 3).forEach((w, i) => balance(`wallet-${i}`, text(w.display_name) || text(w.public_wallet_type) || '子钱包', w.balance, 'credits'));
        break;
      }
    }
    if (!out.metrics.length && !out.fields.length && !out.balances!.length && !Object.keys(out.entitlements!).length) throw new AdapterError('SCHEMA_CHANGED', `${this.manifest.product} 未返回任何可识别权益，保留原快照`);
    return out;
  }
}

export class GrokBuildAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('grok-build', options); } }
export class KimiCodeAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('kimi-code', options); } }
export class KimiCodeCnAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('kimi-code-cn', options); } }
export class KimiWorkAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('kimi-work', options); } }
export class FactoryAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('factory', options); } }
export class ClineAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('cline', options); } }
export class CommandCodeAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('commandcode', options); } }
export class ZedAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('zed', options); } }
export class OpenDesignAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('opendesign', options); } }
export class AutoClawAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('autoclaw', options); } }
export class AutoClawCnAdapter extends ExtendedProviderAdapter { constructor(options?: ExtendedAdapterOptions) { super('autoclaw-cn', options); } }
export const extendedAdapters: ProviderAdapter[] = Object.keys(definitions).map(id => new ExtendedProviderAdapter(id as ExtendedAdapterId));
