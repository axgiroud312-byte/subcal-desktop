/** Read-only protocol mappings from MIT sources. Full attribution and pins:
 * docs/references/priority-adapters-sources.md. Never import plugin runtimes. */
import { createHash, randomBytes } from 'node:crypto';
import { parseHttpCredential, type HttpCredential } from './credential-adapters';
import { assertAllowedAdapterGetUrl, executeOfficialGet, formatDecimalString, parseRetryAfterMs, hashKeySubject } from './http-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type NormalizedMetricObservation, type ProviderAdapter } from './types';

export type PriorityFetchFn = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal; redirect: 'error' }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;
const defaultFetch: PriorityFetchFn = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, headers: r.headers, text: async () => {
    const reader = r.body?.getReader(); if (!reader) return '';
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const x = await reader.read(); if (x.done) break; size += x.value.length; if (size > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '响应过大'); chunks.push(x.value); } return Buffer.concat(chunks).toString('utf8'); }
    finally { await reader.cancel().catch(() => {}); }
  } };
};
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const num = (v: unknown): number | null => { const s = formatDecimalString(v); return s !== null && Number.isFinite(Number(s)) ? Number(s) : null; };
const iso = (v: unknown): string | null => typeof v === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const epoch = (v: unknown, scale: number): string | null => { const n = num(v); return n !== null && n > 0 && Number.isFinite(new Date(n * scale).getTime()) ? new Date(n * scale).toISOString() : null; };
let sessionClock = 0, sessionCounter = 0;
function newOpenCodeSession(): string {
  const now = Date.now(); if (now !== sessionClock) { sessionClock = now; sessionCounter = 0; }
  sessionCounter++;
  const stamp = ((~(BigInt(now) * 4096n + BigInt(sessionCounter))) & 0xffffffffffffn).toString(16).padStart(12, '0');
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return `ses_${stamp}${[...randomBytes(14)].map(b => alphabet[b % 62]).join('')}`;
}
function manifest(id: string, product: string, host: string, path: string): AdapterManifest {
  return { id: id as AdapterManifest['id'], version: '1.0.0', product, brand: product, region: host, authMode: 'local_client',
    supportedFields: ['供应商实际返回的套餐、窗口及余额'], unsupportedFields: ['未返回的会员扣费日'], officialSourceUrl: `https://${host}${path}`,
    termsCheckedAt: '2026-10-21', allowedHosts: [host], minIntervalSeconds: 300, defaultForegroundSeconds: 600, defaultBackgroundSeconds: 1800,
    timeoutMs: 15000, supportTier: 'official_auto', permissions: '仅查询权益；不调用模型、不创建会话、不刷新或更改外部登录。',
    credentialLocation: '外部客户端凭据由调用方显式提供；不扫描文件、不执行客户端或插件。' };
}
const DASH = 'https://api2.cursor.sh/aiserver.v1.DashboardService/';
export const CURSOR_MANIFEST: AdapterManifest = { ...manifest('cursor', 'Cursor', 'api2.cursor.sh', '/aiserver.v1.DashboardService/GetCurrentPeriodUsage'), allowedHosts: ['api2.cursor.sh', 'cursor.com'], supportedFields: ['套餐', 'Cursor Models / Other Models / Total', 'On-demand', 'Grok Bot 独立额度', '账期结束'] };
export const DEVIN_MANIFEST = manifest('devin', 'Devin', 'server.codeium.com', '/exa.seat_management_pb.SeatManagementService/GetUserStatus');
export const OPENCODE_GO_MANIFEST = manifest('opencode-go', 'OpenCode Go', 'opencode.ai', '/zen/go/v1/usage');
export const OPENCODE_ZEN_MANIFEST: AdapterManifest = { ...manifest('opencode-zen', 'OpenCode Zen', 'opencode.ai', '/zen'), allowedHosts: [], supportedFields: [], unsupportedFields: ['余额查询接口未公开', '套餐、额度、会员日期（无证据）'] };
export const OPENCODE_ZEN_FREE_MANIFEST: AdapterManifest = { ...OPENCODE_ZEN_MANIFEST, id: 'opencode-zen-free' as AdapterManifest['id'], product: 'OpenCode Zen Free', unsupportedFields: ['无登录不代表无限额度', '未公开免费额度与重置时间'] };

function output(product: string, at: string): CollectOutput { return { account: { subject: product, alias: product, organization: '', region: '' }, poolId: `pool-${product}`, observedAt: at, metrics: [], fields: [], samples: [], partialFailures: [] }; }
function metric(out: CollectOutput, id: string, label: string, extra: Partial<NormalizedMetricObservation>) {
  out.metrics.push({ id, label, unit: '%', total: '100', remaining: null, resetAt: null, availability: 'known', observedAt: out.observedAt, source: '供应商只读权益接口', dataOrigin: 'official_api', staleAfterMinutes: 30, evidence: 'reported', ...extra });
}
function percent(out: CollectOutput, id: string, label: string, used: unknown, resetAt: string | null, windowMinutes?: number) {
  const n = num(used); if (n === null) { out.partialFailures.push({ field: id, reason: '未返回有效百分比' }); return; }
  const bounded = Math.max(0, Math.min(100, n));
  metric(out, id, label, { used: String(bounded), remaining: String(Number((100 - bounded).toFixed(10))), resetAt, windowMinutes });
}
function plan(out: CollectOutput, v: unknown) { if (typeof v === 'string' && v.trim()) out.fields.push({ field: 'plan', value: v, availability: 'known', source: '供应商套餐状态', dataOrigin: 'official_api', observedAt: out.observedAt, evidence: 'reported' }); }
function finish(out: CollectOutput): CollectOutput { if (!out.metrics.length && !out.fields.length && !out.entitlements) throw new AdapterError('SCHEMA_CHANGED', '未返回可识别权益'); out.samples = out.metrics.map(m => `${m.label}：${m.remaining ?? m.availability} ${m.unit}`); return out; }
abstract class PriorityAdapter implements ProviderAdapter {
  abstract readonly manifest: AdapterManifest;
  constructor(protected readonly fetchFn: PriorityFetchFn = defaultFetch) {}
  protected credential(input: CollectInput, source: string): HttpCredential { const c = parseHttpCredential(input.secret); if (c.source && c.source !== source) throw new AdapterError('AUTH_REQUIRED', '凭据来源与产品不匹配'); return c; }
  protected bind(out: CollectOutput, c: HttpCredential, input: CollectInput) {
    out.account.subject = c.subject ?? (c.accountId ? `${this.manifest.id}:${createHash('sha256').update(c.accountId).digest('hex').slice(0, 24)}` : hashKeySubject(this.manifest.id, c.accessToken));
    out.account.alias = c.alias ?? this.manifest.product; out.account.region = this.manifest.region; out.poolId = `pool-${out.account.subject}`;
    for(const metric of out.metrics)if(metric.poolId)metric.poolId=`${out.poolId}:${metric.poolId}`;
    for(const balance of out.balances??[])balance.poolId=`${out.poolId}:${balance.poolId??balance.id}`;
    if (input.reason !== 'probe' && input.expectedSubject && input.expectedSubject !== out.account.subject) throw new AdapterError('ACCOUNT_MISMATCH', '登录账号已改变，请重新连接');
    return out;
  }
  protected async post(url: string, input: CollectInput, headers: Record<string, string>, body = '{}'): Promise<unknown> {
    const safe = assertAllowedAdapterGetUrl(this.manifest, url);
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const controller = new AbortController(), abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, input.timeoutMs ?? this.manifest.timeoutMs);
    try {
      const r = await this.fetchFn(safe, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers }, body, signal: controller.signal, redirect: 'error' });
      if (r.status === 401) throw new AdapterError('AUTH_REQUIRED', '登录已失效，请在外部客户端重新登录', { httpStatus: 401 });
      if (r.status === 403) throw new AdapterError('PERMISSION_DENIED', '无权读取权益', { httpStatus: 403 });
      if (r.status === 429) throw new AdapterError('RATE_LIMITED', '供应商限流', { httpStatus: 429, retryAfterMs: parseRetryAfterMs(r.headers.get('retry-after')) });
      if (r.status < 200 || r.status >= 300) throw new AdapterError('UPSTREAM_UNAVAILABLE', `权益查询失败（HTTP ${r.status}）`, { httpStatus: r.status });
      const text = await r.text(); if (text.length > 1024 * 1024) throw new AdapterError('SCHEMA_CHANGED', '响应过大');
      let raw: unknown; try { raw = JSON.parse(text); } catch { throw new AdapterError('SCHEMA_CHANGED', '响应不是有效 JSON'); }
      if (obj(raw).code === 'unauthenticated') throw new AdapterError('AUTH_REQUIRED', '外部客户端凭据已失效');
      return raw;
    } catch (e) { if (e instanceof AdapterError) throw e; if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消'); if (controller.signal.aborted) throw new AdapterError('TIMEOUT', '权益查询超时'); throw new AdapterError('NETWORK_OFFLINE', '无法连接权益接口'); }
    finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); }
  }
  probe(input: CollectInput) { return this.collect(input); }
  abstract collect(input: CollectInput): Promise<CollectOutput>;
  abstract normalize(raw: unknown, at: string): CollectOutput;
  describeRecovery(error: AdapterError) { return defaultDescribeRecovery(this.manifest, error); }
  async disconnect() {}
}

export class CursorAdapter extends PriorityAdapter {
  readonly manifest = CURSOR_MANIFEST;
  async collect(input: CollectInput): Promise<CollectOutput> {
    const c = this.credential(input, 'cursor');
    const headers = { Authorization: `Bearer ${c.accessToken}`, 'Connect-Protocol-Version': '1' };
    // These POSTs are read-only Connect RPCs, not inference endpoints.
    const jobs = ['GetCurrentPeriodUsage', 'GetPlanInfo', 'GetHardLimit'];
    let user: string | undefined;
    try { const sub = obj(JSON.parse(Buffer.from(c.accessToken.split('.')[1], 'base64url').toString())).sub; if (typeof sub === 'string') { const last = sub.split('|').filter(Boolean).at(-1); if (last && /^[a-zA-Z0-9._-]+$/.test(last)) user = last; } } catch {}
    const bot = user ? this.post('https://cursor.com/api/dashboard/get-sand-usage-status', input, { Origin: 'https://cursor.com', Cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${user}::${c.accessToken}`)}` }) : Promise.reject(new AdapterError('UNSUPPORTED', 'JWT 缺少 Bot 所需用户标识'));
    const results = await Promise.allSettled([...jobs.map(job => this.post(DASH + job, input, headers)), bot]);
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    if (results.every(r => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    const data = Object.fromEntries(results.map((r, i) => [[...jobs, 'bot'][i], r.status === 'fulfilled' ? r.value : undefined]));
    const out = this.normalize(data, new Date().toISOString());
    results.forEach((r, i) => { if (r.status === 'rejected') out.partialFailures.push({ field: [...jobs, 'grok-bot'][i], reason: r.reason instanceof AdapterError ? r.reason.message : '读取失败' }); });
    return this.bind(out, c, input);
  }
  normalize(raw: unknown, at: string): CollectOutput {
    const r = obj(raw), p = obj(r.GetCurrentPeriodUsage), out = output('Cursor', at), reset = epoch(p.billingCycleEnd, 1);
    plan(out, obj(obj(r.GetPlanInfo).planInfo).planName);
    const u = obj(p.planUsage);
    if (p.planUsage) for (const [key, label] of [['autoPercentUsed', 'Cursor Models'], ['apiPercentUsed', 'Other Models'], ['totalPercentUsed', 'Total']]) percent(out, `cursor-${key}`, label, u[key], reset);
    if (reset) out.entitlements = { billingPeriodEnd: { value: { precision: 'instant', value: reset }, availability: 'known', source: 'GetCurrentPeriodUsage.billingCycleEnd（非扣费日期）', observedAt: at, dataOrigin: 'official_api', evidence: 'reported' } };
    const spend = obj(p.spendLimitUsage), hard = obj(r.GetHardLimit), used = num(spend.individualUsed), own = num(spend.individualLimit);
    let total: number | null = null, actualUsed = used, unlimited = false, scope: NormalizedMetricObservation['scope'] = 'account';
    if (spend.limitType === 'team') {
      if (own !== null) total = own / 100;
      else if (!(r.GetHardLimit && (hard.noUsageBasedAllowed || !((num(hard.hardLimit) ?? 0) > 0)))) { const pooled = num(spend.pooledLimit); if (pooled !== null && pooled > 0) { total = pooled / 100; actualUsed = num(spend.pooledUsed); scope = 'organization'; } else unlimited = !!r.GetHardLimit; }
    } else if (r.GetHardLimit) { if (!hard.noUsageBasedAllowed) { const n = num(hard.hardLimit); if (n !== null && n >= 2147483647) unlimited = true; else total = n; } }
    else if (own !== null) total = own / 100;
    if ((total !== null && total > 0) || unlimited) metric(out, 'cursor-on-demand', 'On-demand 预算（非余额）', { unit: 'USD', total: total === null ? null : String(total), used: actualUsed === null ? null : String(actualUsed / 100), remaining: total !== null && actualUsed !== null ? String(Number((total - actualUsed / 100).toFixed(10))) : null, availability: unlimited ? 'unlimited' : actualUsed === null ? 'unfetched' : 'known', resetAt: reset, scope });
    const b = obj(r.bot), paid = typeof b.includedLimitZero === 'boolean' ? !b.includedLimitZero : b.hasNonZeroIncludedLimit === true;
    const expiry = iso(b.sandTrialExpiresAt), trial = !paid && expiry !== null && Date.parse(expiry) > Date.parse(at);
    if ((paid || trial) && num(b.usagePercent) !== null) {
      percent(out, 'grok-bot', trial ? 'Grok Bot（试用）' : 'Grok Bot', b.usagePercent, paid ? iso(b.nextResetTimestampUtc) : null, paid ? 10080 : undefined);
      const bot = out.metrics.at(-1)!; bot.poolId = 'grok-bot'; bot.scope = 'account';
      if (trial && expiry) bot.windowEnd = { value: { precision: 'instant', value: expiry }, availability: 'known', source: 'Grok Bot · sandTrialExpiresAt（试用结束，非重置）', observedAt: at, dataOrigin: 'official_api', evidence: 'reported' };
    }
    return finish(out);
  }
}

export class DevinAdapter extends PriorityAdapter {
  readonly manifest = DEVIN_MANIFEST;
  async collect(input: CollectInput) { const c = this.credential(input, 'devin'); const metadata = { ideName: 'devin-cli', ideVersion: '3000.11.3', extensionName: 'devin-cli', extensionVersion: '3000.11.3', apiKey: c.accessToken, locale: 'en', os: process.platform === 'win32' ? 'windows' : process.platform }; return this.bind(this.normalize(await this.post(this.manifest.officialSourceUrl, input, { 'Connect-Protocol-Version': '1' }, JSON.stringify({ metadata })), new Date().toISOString()), c, input); }
  normalize(raw: unknown, at: string): CollectOutput {
    const st = obj(obj(obj(raw).userStatus).planStatus), info = obj(st.planInfo), out = output('Devin', at); plan(out, info.planName);
    const end = iso(st.planEnd); if (end) out.entitlements = { membershipExpiresAt: { value: { precision: 'instant', value: end }, availability: 'known', source: 'GetUserStatus.planEnd', observedAt: at, dataOrigin: 'official_api', evidence: 'reported' } };
    for (const [key, label, minutes] of [['daily', '每日额度', 1440], ['weekly', '每周额度', 10080]] as const) {
      if (info[key === 'daily' ? 'hideDailyQuota' : 'hideWeeklyQuota']) continue;
      const reset = epoch(st[`${key}QuotaResetAtUnix`], 1000), left = num(st[`${key}QuotaRemainingPercent`]);
      if (left !== null || (info.billingStrategy === 'BILLING_STRATEGY_QUOTA' && reset && st[`${key}QuotaRemainingPercent`] == null)) percent(out, `devin-${key}`, label, 100 - (left ?? 0), reset, minutes);
    }
    const limit = num(st.acuLimit), consumed = num(st.acuConsumed);
    if (limit !== null && limit > 0) { const used = consumed ?? (st.acuConsumed == null ? 0 : null); metric(out, 'devin-acu', 'ACU 周期额度', { unit: 'ACU', total: String(limit), used: used === null ? null : String(used), remaining: used === null ? null : String(Number((limit - used).toFixed(10))), availability: used === null ? 'unfetched' : 'known', resetAt: null, windowEnd: end ? { value: { precision: 'instant', value: end }, availability: 'known', source: 'planEnd（周期结束，非重置）', observedAt: at, dataOrigin: 'official_api', evidence: 'reported' } : undefined }); }
    const micros = formatDecimalString(st.overageBalanceMicros);
    if (micros !== null && /^\d+$/.test(micros)) { const n = BigInt(micros), amount = `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, '0')}`; metric(out, 'devin-overage', '额外用量余额', { unit: 'USD', total: null, remaining: amount }); out.balances = [{ id: 'devin-overage', label: '额外用量余额', scope: 'account', kind: 'credit', currency: 'USD', amount: { value: amount, availability: 'known', source: 'overageBalanceMicros / 1e6', observedAt: at, dataOrigin: 'official_api', evidence: 'reported' } }]; }
    return finish(out);
  }
}

export class OpenCodeGoAdapter extends PriorityAdapter {
  readonly manifest = OPENCODE_GO_MANIFEST;
  async collect(input: CollectInput) {
    const c = this.credential(input, 'opencode-go'), session = newOpenCodeSession();
    try { const raw = await executeOfficialGet(this.manifest, this.manifest.officialSourceUrl, { ...input, secret: c.accessToken }, (url, init) => this.fetchFn(url, { ...init, redirect: 'error' }), { 'Accept-Language': 'en-US,en', 'x-opencode-session': session, 'x-opencode-session-id': session }); return this.bind(this.normalize(raw, new Date().toISOString()), c, input); }
    catch (e) { if (e instanceof AdapterError && e.code === 'PERMISSION_DENIED') throw new AdapterError('PERMISSION_DENIED', '此 Key 所属成员及工作区没有 OpenCode Go 订阅；请使用订阅成员在原工作区创建的 Key', { httpStatus: 403 }); throw e; }
  }
  normalize(raw: unknown, at: string) { const out = output('OpenCode Go', at), usage = obj(obj(raw).usage); for (const [key, label, minutes] of [['rolling', '5 小时额度', 300], ['weekly', '每周额度', 10080], ['monthly', '月度额度', undefined]] as const) { const w = obj(usage[key]), used = num(w.percent); if (used !== null) percent(out, `go-${key}`, label, used, used > 0 ? iso(w.resetsAt) : null, minutes); } return finish(out); }
}

/** Capability-only adapters: a successful return is NOT a credential verification.
 * Integration must not mark these accounts verified based on this output. */
export class OpenCodeZenAdapter extends PriorityAdapter {
  readonly manifest: AdapterManifest = OPENCODE_ZEN_MANIFEST;
  async collect(input: CollectInput) { if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消'); return this.normalize(null, new Date().toISOString()); }
  normalize(_raw: unknown, at: string) { const out = output(this.manifest.product, at); out.metrics.push({ id: 'zen-entitlements', label: '权益查询未支持（未验证登录）', unit: '', total: null, remaining: null, resetAt: null, availability: 'unsupported', observedAt: at, source: '固定源码未提供权益接口；未发起网络请求', dataOrigin: 'local_client', staleAfterMinutes: 0 }); out.samples = ['未联网验证；额度未知，不代表无限量']; return out; }
}
export class OpenCodeZenFreeAdapter extends OpenCodeZenAdapter { readonly manifest = OPENCODE_ZEN_FREE_MANIFEST; }
export const PRIORITY_ADAPTER_MANIFESTS = [CURSOR_MANIFEST, DEVIN_MANIFEST, OPENCODE_GO_MANIFEST, OPENCODE_ZEN_MANIFEST, OPENCODE_ZEN_FREE_MANIFEST] as const;
