/** Read-only protocol adaptations. Source and MIT notices: docs/evidence/full-service/control.md. */
import { createHash } from 'node:crypto';
import type { Balance, Field } from '../../shared/types';
import { defaultHttpFetch, executeOfficialGet, formatDecimalString, hashKeySubject, type HttpFetchFn } from './http-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type NormalizedMetricObservation, type ProviderAdapter } from './types';

export type ControlFetchFn = (url: string, init: {
  method: 'GET' | 'POST'; headers: Record<string, string>; signal: AbortSignal; body?: string;
}) => ReturnType<HttpFetchFn>;

const defaultControlFetch: ControlFetchFn = async (url, init) => {
  if (init.method === 'GET') return defaultHttpFetch(url, { ...init, method: 'GET' });
  const response = await fetch(url, { ...init, redirect: 'error' });
  return {
    status: response.status, headers: response.headers,
    async text() {
      const reader = response.body?.getReader();
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

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const decimal = formatDecimalString;
const number = (v: unknown): number | null => { const d = decimal(v); return d === null || !Number.isFinite(Number(d)) ? null : Number(d); };
const fingerprint = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 20);
function instant(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(v)) return null;
  const ms = Date.parse(v); return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function epoch(v: unknown): string | null {
  const n = number(v); if (n === null || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  return Number.isFinite(ms) && ms < 8.64e15 ? new Date(ms).toISOString() : null;
}
function credential(input: CollectInput, hint: string): Obj {
  try { const c = obj(JSON.parse(input.secret ?? '')); if (Object.keys(c).length) return c; } catch { /* safe fixed hint */ }
  throw new AdapterError('AUTH_REQUIRED', hint);
}
function required(c: Obj, key: string, hint: string): string {
  const v = text(c[key]).trim();
  if (!v || /[\r\n]/.test(v)) throw new AdapterError('AUTH_REQUIRED', hint);
  return v;
}
function envelope(input: CollectInput): Obj {
  try { return obj(JSON.parse(input.secret ?? '')); } catch { return {}; }
}
function keyInput(input: CollectInput): CollectInput {
  const c = envelope(input);
  if (!Object.keys(c).length) return input;
  const key = text(c.accessToken) || text(c.key) || text(c.token) || text(c.access);
  if (!key.trim() || /[\r\n]/.test(key)) throw new AdapterError('AUTH_REQUIRED', '凭据 envelope 缺少有效 accessToken/key/token/access');
  return { ...input, secret: key };
}
function bind(m: AdapterManifest, out: CollectOutput, input: CollectInput, identityKey: string): CollectOutput {
  const c = envelope(input), subject = text(c.subject) || hashKeySubject(m.id, identityKey);
  out.account.subject = subject; out.account.alias = text(c.alias) || out.account.alias; out.poolId = subject;
  for (const b of out.balances ?? []) b.poolId = subject;
  for (const v of out.metrics) v.poolId = `${subject}:${v.poolId ?? v.id}`;
  return out;
}
function manifest(id: string, product: string, hosts: string[], source: string, fields: string[], hint: string): AdapterManifest {
  return {
    id: id as AdapterManifest['id'], version: '1.0.0', brand: product, product, region: hosts[0] ?? 'user-configured',
    supportedFields: fields, unsupportedFields: ['自动登录/刷新凭据', '价格推断', '模型调用', '签到/领取'], authMode: 'api_key',
    officialSourceUrl: source, termsCheckedAt: '2026-10-21', allowedHosts: hosts, minIntervalSeconds: 300,
    defaultForegroundSeconds: 1800, defaultBackgroundSeconds: 3600, timeoutMs: 15000, supportTier: 'official_auto',
    permissions: '仅查询现有账号；不开户、不消费、不签到、不领取；协议 fixture 已测，真实账号尚未验证', credentialLocation: hint,
  };
}
function output(m: AdapterManifest, at: string, subject = `${m.id}:unbound`): CollectOutput {
  return { account: { subject, alias: m.product, organization: '', region: m.region }, poolId: subject, metrics: [], fields: [], partialFailures: [], samples: [], observedAt: at };
}
function field<T>(value: T, at: string, source: string, cached = false): Field<T> {
  return { value, availability: 'known', observedAt: at, source, dataOrigin: 'official_api', evidence: cached ? 'cached' : 'reported' };
}
function metric(id: string, label: string, unit: string, remaining: string | null, total: string | null, reset: string | null, at: string, source: string): NormalizedMetricObservation {
  return { id, label, unit, remaining, total, resetAt: reset, observedAt: at, availability: remaining === null ? 'unfetched' : 'known', source, dataOrigin: 'official_api', staleAfterMinutes: 30, scope: 'account', evidence: 'reported' };
}
function balance(out: CollectOutput, id: string, label: string, amount: unknown, currency: string, kind: Balance['kind'] = 'total', scope: Balance['scope'] = 'account') {
  const value = decimal(amount);
  if (value === null) { out.partialFailures.push({ field: id, reason: '余额缺失或格式改变；不解释为零' }); return; }
  (out.balances ??= []).push({ id, label, kind, scope, currency, amount: field(value, out.observedAt, id), poolId: out.poolId });
}
function ensureRead(out: CollectOutput) {
  if (!out.metrics.length && !out.fields.length && !out.balances?.length && !Object.keys(out.entitlements ?? {}).length)
    throw new AdapterError('SCHEMA_CHANGED', '响应没有可识别的权益或余额，已保留旧值');
  return out;
}

/** POST is limited to caller-selected, fixed read RPCs. Reuse GET helper's URL,
 * cancellation, timeout, status/Retry-After and redacted error handling. */
async function read(m: AdapterManifest, url: string, input: CollectInput, fetcher: ControlFetchFn, rpc?: { body: Obj; headers?: Record<string, string> }) {
  const transport: HttpFetchFn = (safeUrl, init) => fetcher(safeUrl, rpc
    ? { ...init, method: 'POST', body: JSON.stringify(rpc.body), headers: { ...init.headers, 'Content-Type': 'application/json', ...rpc.headers } }
    : init);
  return executeOfficialGet(m, url, input, transport);
}
function adapter(m: AdapterManifest, normalize: ProviderAdapter['normalize'], collect: (input: CollectInput) => Promise<CollectOutput>): ProviderAdapter {
  const checked = async (input: CollectInput) => {
    const out = await collect(input);
    if (input.expectedSubject && out.account.subject !== input.expectedSubject) throw new AdapterError('ACCOUNT_MISMATCH', '凭据对应账号发生变化，已暂停更新');
    return out;
  };
  return { manifest: m, normalize, probe: checked, collect: checked, describeRecovery: e => defaultDescribeRecovery(m, e), async disconnect() {} };
}

function google(kind: 'gemini-cli' | 'antigravity', fetcher: ControlFetchFn): ProviderAdapter {
  const host = kind === 'gemini-cli' ? 'cloudcode-pa.googleapis.com' : 'daily-cloudcode-pa.googleapis.com';
  const hint = 'JSON 凭据 {"accessToken":"现有 OAuth access token","project":"已开通的 project id"}；不自动开户或刷新';
  const m = manifest(kind, kind === 'gemini-cli' ? 'Gemini CLI' : 'Antigravity', [host], 'https://github.com/google-gemini/gemini-cli', ['动态配额百分比', '配额重置时间'], hint);
  const normalize: ProviderAdapter['normalize'] = (raw, at) => {
    const r = obj(raw), out = output(m, at);
    const add = (b: Obj, group: string, index: number) => {
      if (b.disabled === true) return;
      // Proto JSON omits zero only for this confirmed Antigravity bucket
      // contract. Gemini missing fields remain unknown; invalid values do too.
      const fraction = kind === 'antigravity' && b.remainingFraction === undefined ? 0 : number(b.remainingFraction);
      if (fraction === null || fraction < 0 || fraction > 1) { out.partialFailures.push({ field: `quota:${index}`, reason: '剩余比例缺失或超出 0–1；不推断为零' }); return; }
      const name = text(b.modelId) || text(b.bucketId) || text(b.window);
      if (!name) { out.partialFailures.push({ field: `quota:${index}`, reason: '缺少稳定配额标识' }); return; }
      const id = `${kind}:${fingerprint(JSON.stringify([group, name, b.tokenType ?? '']))}`;
      const v = metric(id, `${group ? `${group} · ` : ''}${name}`, '%', decimal(fraction * 100), '100', instant(b.resetTime), at, host);
      if (kind === 'gemini-cli') { v.scope = 'model'; v.models = [text(b.modelId)]; }
      v.poolId = `${kind}:${group || name}`;
      if (b.window === '5h') v.windowMinutes = 300;
      if (b.window === 'weekly') v.windowMinutes = 10080;
      out.metrics.push(v);
      if (b.resetTime && !v.resetAt) out.partialFailures.push({ field: `${id}:reset`, reason: '无效重置时间；配额仍保留' });
    };
    if (kind === 'gemini-cli' && Array.isArray(r.buckets)) r.buckets.forEach((b, i) => add(obj(b), '', i));
    else if (kind === 'antigravity' && Array.isArray(r.groups)) r.groups.forEach((g, i) => {
      const group = obj(g); if (Array.isArray(group.buckets)) group.buckets.forEach((b, j) => add(obj(b), text(group.displayName) || `group-${i}`, j));
    });
    return ensureRead(out);
  };
  return adapter(m, normalize, async input => {
    const c = credential(input, hint), token = required({ accessToken: c.accessToken ?? c.access ?? c.token }, 'accessToken', hint), project = required(c, 'project', hint);
    const method = kind === 'gemini-cli' ? 'retrieveUserQuota' : 'retrieveUserQuotaSummary';
    const raw = await read(m, `https://${host}/v1internal:${method}`, { ...input, secret: token }, fetcher, { body: { project } });
    const out = normalize(raw, new Date().toISOString());
    return bind(m, out, input, token);
  });
}

function stepPlan(site: 'com' | 'ai', fetcher: ControlFetchFn): ProviderAdapter {
  const host = `platform.stepfun.${site}`, hint = `JSON 凭据 {"access":"现有 access JWT","refresh":"现有 refresh JWT","webId":"浏览器 web_id"}；仅 ${host} 会话，API Key 无效；不自动续签`;
  const m = manifest(`stepfun-plan-${site}`, `StepFun Plan ${site}`, [host], `https://${host}/step-plan`, ['5 小时/周/积分配额', '会员到期', '自动续费'], hint);
  const normalize: ProviderAdapter['normalize'] = (raw, at) => {
    const r = obj(raw), out = output(m, at), quota = obj(r.quota), credit = obj(quota.plan_credit_rate_limit);
    for (const [id, label, rate, reset, span, resetless] of [
      ['five-hour', '5 小时', quota.five_hour_usage_left_rate, quota.five_hour_usage_reset_time, 300, false],
      ['weekly', '7 天', quota.weekly_usage_left_rate, quota.weekly_usage_reset_time, 10080, false],
      ['credits', '订阅积分', credit.subscription_credit_left_rate, credit.subscription_credit_reset_time, 0, Array.isArray(credit.credit_buckets) && credit.credit_buckets.length > 0],
    ] as const) {
      const n = number(rate), atReset = epoch(reset);
      if (!atReset && !resetless) { if (reset !== undefined && number(reset) !== 0) out.partialFailures.push({ field: id, reason: '重置时间无效' }); continue; }
      if (n === null || n < 0 || n > 100) { out.partialFailures.push({ field: id, reason: '剩余比例无效' }); continue; }
      const v = metric(id, label, '%', decimal(n <= 1 ? n * 100 : n), '100', atReset, at, host);
      if (span) v.windowMinutes = span;
      out.metrics.push(v);
    }
    const subscription = obj(obj(r.status).subscription);
    if (text(subscription.name)) out.fields.push({ field: 'plan', value: text(subscription.name), availability: 'known', observedAt: at, source: host, dataOrigin: 'official_api', evidence: 'reported' });
    const expiry = epoch(subscription.expired_at);
    out.entitlements = {};
    if (expiry) out.entitlements.membershipExpiresAt = field({ precision: 'instant', value: expiry }, at, host);
    else if (subscription.expired_at !== undefined && number(subscription.expired_at) !== 0) out.partialFailures.push({ field: 'membershipExpiresAt', reason: '会员到期时间无效' });
    const renew = subscription.auto_renew;
    if (typeof renew === 'boolean' || renew === 'true' || renew === 'false') out.entitlements.autoRenew = field(renew === true || renew === 'true', at, host);
    if (Array.isArray(r.failures)) out.partialFailures.push(...r.failures.map(v => ({ field: text(v), reason: '该只读接口未成功；其他权益仍保留' })));
    return ensureRead(out);
  };
  return adapter(m, normalize, async input => {
    const c = credential(input, hint);
    // OpenCode may preserve the session JSON inside auth.access/accessToken.
    let nested: Obj = {}; try { nested = obj(JSON.parse(text(c.accessToken) || text(c.access))); } catch { /* plain access JWT */ }
    const session = Object.keys(nested).length ? nested : c;
    const access = required({ access: session.access ?? session.accessToken }, 'access', hint), refresh = required(session, 'refresh', hint), webId = required(session, 'webId', hint);
    const headers = { Authorization: '', Cookie: `Oasis-Token=${access}...${refresh}`, 'Connect-Protocol-Version': '1', 'Oasis-Appid': site === 'ai' ? '20700' : '10300', 'Oasis-Platform': 'web', 'Oasis-Webid': webId };
    const names = ['QueryStepPlanRateLimit', 'GetStepPlanStatus'];
    const results = await Promise.allSettled(names.map(name => read(m, `https://${host}/api/step.openapi.devcenter.Dashboard/${name}`, { ...input, secret: access }, fetcher, { body: {}, headers })));
    // Authentication/cancellation must never be hidden behind a successful sibling.
    for (const result of results) if (result.status === 'rejected' && result.reason instanceof AdapterError && ['AUTH_REQUIRED', 'PERMISSION_DENIED', 'CANCELLED'].includes(result.reason.code)) throw result.reason;
    if (results.every(r => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    const raw = { quota: results[0].status === 'fulfilled' ? results[0].value : null, status: results[1].status === 'fulfilled' ? results[1].value : null, failures: names.filter((_, i) => results[i].status === 'rejected') };
    return bind(m, normalize(raw, new Date().toISOString()), input, access);
  });
}

function ollama(fetcher: ControlFetchFn): ProviderAdapter {
  const m = manifest('ollama-cloud', 'Ollama Cloud', ['ollama.com'], 'https://ollama.com/settings', ['套餐额度 USD', '已购余额 USD', '旧版会话/周配额'], 'Ollama Cloud API Key（不是本机 Ollama 地址）');
  const normalize: ProviderAdapter['normalize'] = (raw, at) => {
    const r = obj(raw), inc = obj(r.included), period = obj(inc.period), out = output(m, at);
    if (decimal(inc.balance_usd) !== null) {
      const v = metric('included', '套餐可用额度', 'USD', decimal(inc.balance_usd), decimal(inc.allowance_usd), instant(period.until), at, 'ollama.com/api/balance');
      const start = instant(period.from); if (start) v.windowStart = field({ precision: 'instant', value: start }, at, v.source);
      out.metrics.push(v);
      // Period end is not an assertion about membership expiry or next charge.
      if (v.resetAt) out.entitlements = { billingPeriodEnd: field({ precision: 'instant', value: v.resetAt }, at, v.source) };
    } else if (inc.balance_usd !== undefined) out.partialFailures.push({ field: 'included', reason: '套餐余额无效' });
    for (const key of ['session', 'weekly']) {
      const legacy = obj(inc[key]), left = number(legacy.remaining_percent);
      if (left !== null && left >= 0 && left <= 100) {
        const v = metric(key, key, '%', decimal(left), '100', instant(legacy.resets_at), at, 'ollama.com/api/balance');
        if (key === 'weekly') v.windowMinutes = 10080;
        out.metrics.push(v);
      } else if (inc[key] !== undefined) out.partialFailures.push({ field: key, reason: '旧版配额无效' });
    }
    if (r.purchased !== undefined) balance(out, 'purchased', '已购余额', obj(r.purchased).balance_usd, 'USD', 'cash');
    return ensureRead(out);
  };
  return adapter(m, normalize, async input => {
    const auth = keyInput(input);
    return bind(m, normalize(await read(m, 'https://ollama.com/api/balance', auth, fetcher), new Date().toISOString()), input, auth.secret!);
  });
}

function stepBalance(site: 'com' | 'ai', fetcher: ControlFetchFn): ProviderAdapter {
  const host = `api.stepfun.${site}`, m = manifest(`stepfun-balance-${site}`, `StepFun API ${site}`, [host], `https://platform.stepfun.${site}`, ['API 账户余额'], 'StepFun API Key（与 Step Plan 网页会话不同）');
  const normalize: ProviderAdapter['normalize'] = (raw, at) => {
    const r = obj(raw), out = output(m, at);
    balance(out, 'account', '账户余额', r.balance, site === 'com' ? 'CNY' : 'USD');
    return ensureRead(out);
  };
  return adapter(m, normalize, async input => {
    const auth = keyInput(input);
    return bind(m, normalize(await read(m, `https://${host}/v1/accounts`, auth, fetcher), new Date().toISOString()), input, auth.secret!);
  });
}

/** Remote origins are trusted application configuration, never taken from secrets.
 * Only HTTPS/default port is supported by the shared transport security policy. */
function remote(fetcher: ControlFetchFn, origins: string[]): ProviderAdapter {
  const approved = origins.map(value => {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || u.pathname !== '/' || u.search || u.hash) throw new Error('Remote Magpie 仅接受预先批准的 HTTPS origin');
    return u.origin;
  });
  const hint = 'JSON 凭据 {"origin":"预先批准的 https://host","apiKey":"远端启用的 gateway key"}；HTTP/LAN 非标准端口尚不支持';
  const m = manifest('remote-magpie', 'Remote Magpie', approved.map(v => new URL(v).hostname), 'https://github.com/yetone/magpie', ['远端缓存配额', '缓存观测时间'], hint);
  const normalize: ProviderAdapter['normalize'] = (raw, at) => {
    const out = output(m, at), rows = obj(raw).data;
    if (!Array.isArray(rows)) return ensureRead(out);
    for (const entry of rows) {
      const card = obj(entry), provider = text(card.provider), user = text(card.user), kind = text(card.kind) || 'subscription';
      if (!provider || card.from) continue; // Never recurse another remote's cards.
      const cardId = `${provider}:${fingerprint(user)}:${kind}`;
      if (card.error) { out.partialFailures.push({ field: cardId, reason: '远端该卡片读取失败；不展示错误正文' }); continue; }
      const readAt = instant(card.asOf) || instant(card.readAt);
      if (!readAt) out.partialFailures.push({ field: `${cardId}:readAt`, reason: '远端缓存读取时间未知；本次抓取时间不代表供应商新观测' });
      if (!Array.isArray(card.windows)) continue;
      card.windows.forEach((item, i) => {
        const w = obj(item), used = number(w.used), limit = number(w.limit), amount = w.amount === undefined && used === 0 ? 0 : number(w.amount);
        const id = `${cardId}:${text(w.pool)}:${text(w.name) || i}`;
        let v: NormalizedMetricObservation;
        if (w.unlimited === true) { v = metric(id, `${provider} · ${text(w.name)}`, '%', null, null, instant(w.resetsAt), readAt ?? at, 'remote-magpie cache'); v.availability = 'unlimited'; }
        else if (limit !== null && limit > 0 && amount !== null && text(w.unit)) {
          v = metric(id, `${provider} · ${text(w.name)}`, text(w.unit), decimal(limit - amount), decimal(limit), instant(w.resetsAt), readAt ?? at, 'remote-magpie cache'); v.used = decimal(amount);
        } else if (used !== null && used >= 0 && used <= 100) {
          v = metric(id, `${provider} · ${text(w.name)}`, '%', decimal(100 - used), '100', instant(w.resetsAt), readAt ?? at, 'remote-magpie cache'); v.used = decimal(used);
        } else { out.partialFailures.push({ field: id, reason: '远端窗口单位或数值不完整' }); return; }
        v.evidence = 'cached';
        if (!readAt) { v.remaining = null; v.used = null; v.total = null; v.resetAt = null; v.availability = 'unfetched'; }
        v.poolId = `remote:${cardId}:${text(w.pool) || text(w.name)}`;
        const start = instant(w.startsAt); if (start) v.windowStart = field({ precision: 'instant', value: start }, readAt ?? at, v.source, true);
        out.metrics.push(v);
      });
    }
    return ensureRead(out);
  };
  return adapter(m, normalize, async input => {
    const c = credential(input, hint), origin = required(c, 'origin', hint), token = required({ apiKey: c.apiKey ?? c.accessToken ?? c.key ?? c.token }, 'apiKey', hint);
    if (!approved.includes(origin)) throw new AdapterError('UNSUPPORTED', '远端 origin 未在应用配置中批准；不会发送凭据');
    const out = normalize(await read(m, `${origin}/v1/magpie/quotas/cards`, { ...input, secret: token }, fetcher), new Date().toISOString());
    const scope = fingerprint(origin);
    for (const v of out.metrics) v.id = `${scope}:${v.id}`;
    return bind(m, out, input, origin + '\0' + token);
  });
}

export interface RelayReadConfig { origin: string; protocol: 'new-api-key' | 'sub2api-key' | 'credit-grants' }

/** Exact new-api quota / 500000, without rounding monetary strings through Number. */
function quotaDollars(v: unknown): string | null {
  const d = decimal(v); if (d === null) return null;
  const negative = d.startsWith('-'), [whole, fraction = ''] = d.replace(/^-/, '').split('.');
  const scale = fraction.length + 6, digits = (BigInt(whole + fraction) * 2n).toString().padStart(scale + 1, '0');
  const value = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '');
  return `${negative && value !== '0' ? '-' : ''}${value}`;
}

function relay(config: RelayReadConfig, fetcher: ControlFetchFn): ProviderAdapter {
  const u = new URL(config.origin);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || u.pathname !== '/' || u.search || u.hash) throw new Error('Relay 仅接受预先批准的 HTTPS origin');
  const paths = { 'new-api-key': '/api/usage/token', 'sub2api-key': '/v1/usage', 'credit-grants': '/dashboard/billing/credit_grants' };
  const path = paths[config.protocol];
  const m = manifest(`relay-${config.protocol}-${fingerprint(u.origin)}`, `Relay ${config.protocol}`, [u.hostname], u.origin, ['Key 剩余额度 USD'], '此应用配置中批准的 Relay API Key；不支持在凭据中指定 URL/JSONPath');
  const normalize: ProviderAdapter['normalize'] = (raw, at) => {
    const r = obj(raw), out = output(m, at);
    if (config.protocol === 'new-api-key' && ((r.code !== true && r.success !== true) || r.code === false || r.success === false)) throw new AdapterError('SCHEMA_CHANGED', 'Relay 未确认查询成功');
    if(config.protocol==='sub2api-key'&&r.mode==='quota_limited'){
      for(const item of Array.isArray(r.rate_limits)?r.rate_limits:[]){
        const w=obj(item),total=decimal(w.limit),left=decimal(w.remaining),used=decimal(w.used),window=text(w.window);
        if(!window||total===null||left===null){out.partialFailures.push({field:window||'rate-limit',reason:'预算窗口字段不完整'});continue;}
        const v=metric(`key-${window}`,`${window} Key 预算`,'USD',left,total,instant(w.reset_at),at,'Sub2API Key rate_limits');
        v.used=used;v.scope='key';v.windowMinutes=({'5h':300,'1d':1440,'7d':10080} as Record<string,number>)[window];out.metrics.push(v);
      }
      return ensureRead(out);
    }
    const amount = config.protocol === 'new-api-key' ? quotaDollars(obj(r.data).total_available) : config.protocol === 'sub2api-key' ? r.remaining : r.total_available;
    balance(out, 'key-remaining', 'Key 剩余额度', amount, 'USD', 'budget', 'key');
    return ensureRead(out);
  };
  return adapter(m, normalize, async input => {
    const auth = keyInput(input);
    return bind(m, normalize(await read(m, `${u.origin}${path}`, auth, fetcher), new Date().toISOString()), input, auth.secret!);
  });
}

export function createControlAdapters(options: { fetchFn?: ControlFetchFn; remoteOrigins?: string[]; relays?: RelayReadConfig[] } = {}): ProviderAdapter[] {
  const fetcher = options.fetchFn ?? defaultControlFetch;
  return [google('gemini-cli', fetcher), google('antigravity', fetcher), stepPlan('com', fetcher), stepPlan('ai', fetcher), stepBalance('com', fetcher), stepBalance('ai', fetcher), ollama(fetcher), remote(fetcher, options.remoteOrigins ?? []), ...(options.relays ?? []).map(config => relay(config, fetcher))];
}
export const controlAdapters: ProviderAdapter[] = createControlAdapters();
