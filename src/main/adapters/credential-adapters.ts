/**
 * Protocol/field mappings adapted from MIT-licensed sources:
 * Magpie, Copyright (c) 2026 yetone
 * https://github.com/yetone/magpie/tree/ba319a7587923fc7a4ea3859658244d591261a59
 * internal/provider/{subscription_usage.go,balance.go,copilot_cli.go}
 * CC Switch, Copyright (c) 2025 Jason Young
 * https://github.com/farion1231/cc-switch/tree/c776fd0ebfe35d769b5909b86bdfa1ccdf089988
 * src-tauri/src/services/{subscription.rs,balance.rs}, src-tauri/src/proxy/providers/copilot_auth.rs
 * Only read-only entitlement endpoints; no token exchange or model requests.
 */
import { createHash } from 'node:crypto';
import { copilotHost } from '../../shared/copilot-host';
import { defaultHttpFetch, executeOfficialGet, formatDecimalString, hashKeySubject, OpenRouterKeyAdapter, OPENROUTER_KEY_MANIFEST, type HttpFetchFn } from './http-adapters';
import { AdapterError, defaultDescribeRecovery, type AdapterManifest, type CollectInput, type CollectOutput, type NormalizedMetricObservation, type ProviderAdapter } from './types';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown): number | null => { const d = formatDecimalString(v); return d !== null && Number.isFinite(Number(d)) ? Number(d) : null; };
const hash = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 24);
function instant(v: unknown): string | null {
  const ms = typeof v === 'number' && v > 0 ? v * 1000 : typeof v === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
  return Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString() : null;
}
function manifest(id: AdapterManifest['id'], product: string, host: string, path: string): AdapterManifest {
  return { ...OPENROUTER_KEY_MANIFEST, id, product, brand: product, region: host, allowedHosts: [host],
    supportedFields: ['权益窗口或余额（实际返回时）'], unsupportedFields: ['会员扣费日'],
    officialSourceUrl: `https://${host}${path}`, permissions: `仅 GET https://${host}${path} 查询权益；不调用模型。` };
}
export const CODEX_HTTP_MANIFEST: AdapterManifest = { ...manifest('codex-local', 'Codex', 'chatgpt.com', '/backend-api/wham/usage'), brand: 'OpenAI', authMode: 'local_client', minIntervalSeconds: 60, defaultForegroundSeconds: 300, defaultBackgroundSeconds: 900 };
export const CLAUDE_OAUTH_MANIFEST: AdapterManifest = { ...manifest('claude-local', 'Claude Code', 'api.anthropic.com', '/api/oauth/usage'), brand: 'Anthropic', authMode: 'local_client', minIntervalSeconds: 300, defaultForegroundSeconds: 600, defaultBackgroundSeconds: 1800 };
export const COPILOT_HTTP_MANIFEST: AdapterManifest = { ...manifest('copilot-local', 'GitHub Copilot', 'api.github.com', '/copilot_internal/user'), brand: 'GitHub', authMode: 'local_client', minIntervalSeconds: 300, defaultForegroundSeconds: 600, defaultBackgroundSeconds: 1800 };
export const OPENROUTER_CREDITS_MANIFEST = manifest('openrouter-credits', 'OpenRouter', 'openrouter.ai', '/api/v1/credits');

export interface HttpCredential { accessToken: string; accountId?: string; subject?: string; alias?: string; source?: string; host?: string; membershipExpiresAt?: string; tokenSource?: 'cli' | 'editor' }
/** secret accepts a raw token or JSON {accessToken, accountId?, tokenSource?}.
 * Codex auth.json {tokens:{access_token,account_id}} and Claude credentials
 * {claudeAiOauth:{accessToken}} can also be supplied explicitly by the caller. */
export function parseHttpCredential(secret: string | null | undefined): HttpCredential {
  const value = secret?.trim();
  if (!value) throw new AdapterError('AUTH_REQUIRED', '请提供访问凭据');
  if (!value.startsWith('{')) {
    if (/\s/.test(value)) throw new AdapterError('AUTH_REQUIRED', '访问凭据格式无效');
    return { accessToken: value };
  }
  let obj: Record<string, unknown>;
  try { obj = record(JSON.parse(value)); } catch { throw new AdapterError('AUTH_REQUIRED', '凭据 JSON 无效'); }
  const tokens = record(obj.tokens), claude = record(obj.claudeAiOauth);
  const accessToken = obj.accessToken ?? obj.access_token ?? tokens.access_token ?? claude.accessToken;
  const accountId = obj.accountId ?? obj.account_id ?? tokens.account_id;
  if (typeof accessToken !== 'string' || !accessToken.trim() || /\s/.test(accessToken)) throw new AdapterError('AUTH_REQUIRED', '凭据缺少有效 accessToken');
  if (accountId !== undefined && (typeof accountId !== 'string' || !accountId.trim() || /[\r\n]/.test(accountId))) throw new AdapterError('AUTH_REQUIRED', 'accountId 格式无效');
  if (obj.tokenSource !== undefined && obj.tokenSource !== 'cli' && obj.tokenSource !== 'editor') throw new AdapterError('AUTH_REQUIRED', 'tokenSource 必须为 cli 或 editor');
  return { accessToken, accountId: accountId as string | undefined, subject: typeof obj.subject === 'string' && obj.subject ? obj.subject : undefined,
    host: typeof obj.host === 'string' ? copilotHost(obj.host) : undefined,
    membershipExpiresAt: typeof obj.membershipExpiresAt === 'string' ? obj.membershipExpiresAt : codexMembershipClaim(tokens.id_token),
    alias: typeof obj.alias === 'string' ? obj.alias : undefined, source: typeof obj.source === 'string' ? obj.source : undefined,
    tokenSource: obj.source === 'copilot-cli' ? 'cli' : obj.source === 'copilot-editor' || obj.source === 'copilot-device' ? 'editor' : obj.tokenSource as HttpCredential['tokenSource'] };
}
function output(product: string, at: string): CollectOutput {
  return { account: { subject: product, alias: product, organization: '', region: '' }, poolId: `pool-${product}`, observedAt: at, metrics: [], fields: [], samples: [], partialFailures: [] };
}
function metric(out: CollectOutput, id: string, remaining: string | null, extra: Partial<NormalizedMetricObservation> = {}) {
  out.metrics.push({ id, label: id, unit: '%', remaining, total: '100', resetAt: null, observedAt: out.observedAt, availability: 'known', source: '供应商权益 HTTP 接口', dataOrigin: 'official_api', staleAfterMinutes: 30, ...extra });
}
function percent(out: CollectOutput, id: string, used: unknown, reset: unknown, label = id) {
  const n = number(used);
  if (n === null) out.partialFailures.push({ field: id, reason: '未返回有效用量' });
  else metric(out, id, String(Number((100 - n).toFixed(10))), { label, used: String(n), resetAt: instant(reset) });
}
function finish(out: CollectOutput): CollectOutput {
  if (!out.metrics.length && !out.fields.length) throw new AdapterError('SCHEMA_CHANGED', '未返回可识别的有效权益字段');
  out.samples = out.metrics.map(m => `${m.label}：${m.remaining ?? m.availability} ${m.unit}`);
  return out;
}
abstract class CredentialAdapter implements ProviderAdapter {
  abstract readonly manifest: AdapterManifest;
  constructor(protected readonly fetchFn: HttpFetchFn = defaultHttpFetch) {}
  protected headers(_credential: HttpCredential): Record<string, string> { return {}; }
  abstract normalize(raw: unknown, observedAt: string): CollectOutput;
  probe(input: CollectInput) { return this.collect(input); }
  async collect(input: CollectInput): Promise<CollectOutput> {
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const credential = parseHttpCredential(input.secret);
    const sources: Record<string, string[]> = { 'codex-local': ['codex'], 'claude-local': ['claude'], 'copilot-local': ['copilot-cli', 'copilot-editor', 'copilot-device'] };
    if (credential.source && !sources[this.manifest.id]?.includes(credential.source)) throw new AdapterError('AUTH_REQUIRED', '凭据来源与服务不匹配');
    const host = this.manifest.id === 'copilot-local' && credential.host && credential.host !== 'github.com' ? `api.${credential.host}` : null;
    const requestManifest = host ? { ...this.manifest, allowedHosts: [host], officialSourceUrl: `https://${host}/copilot_internal/user` } : this.manifest;
    const raw = await executeOfficialGet(requestManifest, requestManifest.officialSourceUrl, { ...input, secret: credential.accessToken }, this.fetchFn, this.headers(credential));
    const out = this.normalize(raw, new Date().toISOString());
    // A supplied account ID is stable across refreshes; otherwise bind to the token
    // fingerprint, requiring a new probe after replacement rather than guessing identity.
    out.account.subject = this.manifest.id === 'openrouter-credits' ? hashKeySubject(this.manifest.id, credential.accessToken) : credential.subject ?? `${this.manifest.id}:${hash(credential.accountId ?? credential.accessToken)}`;
    if (credential.alias) out.account.alias = credential.alias;
    out.account.region = credential.host ?? this.manifest.region;
    out.poolId = `pool-${out.account.subject}`;
    if (input.expectedSubject && input.reason !== 'probe' && input.expectedSubject !== out.account.subject) throw new AdapterError('ACCOUNT_MISMATCH', '登录账号已改变，请重新连接');
    return out;
  }
  describeRecovery(error: AdapterError) { const recovery = defaultDescribeRecovery(this.manifest, error); return error.code === 'AUTH_REQUIRED' ? { ...recovery, action: '更新有效访问凭据后重试' } : recovery; }
  async disconnect() {}
}

export class CodexHttpAdapter extends CredentialAdapter {
  readonly manifest = CODEX_HTTP_MANIFEST;
  protected headers(c: HttpCredential): Record<string, string> { return c.accountId ? { 'ChatGPT-Account-Id': c.accountId } : {}; }
  async collect(input: CollectInput): Promise<CollectOutput> {
    const out = await super.collect(input);
    const value = parseHttpCredential(input.secret).membershipExpiresAt;
    // A stale ID-token claim says nothing about the current membership. The
    // service retains the previous observation rather than replacing it by zero.
    const until = instant(value);
    if (until && Date.parse(until) > Date.parse(out.observedAt)) out.entitlements = {
      membershipExpiresAt: { value: { precision: 'instant', value: until }, availability: 'known', source: 'Codex ID token · chatgpt_subscription_active_until', observedAt: out.observedAt, dataOrigin: 'local_client', evidence: 'reported' },
    };
    return out;
  }
  normalize(raw: unknown, at: string): CollectOutput {
    const r = record(raw), out = output('Codex', at);
    const buckets: [string, Record<string, unknown>][] = [['codex', record(r.rate_limit)]];
    if (r.code_review_rate_limit) buckets.push(['code_review', record(r.code_review_rate_limit)]);
    if (Array.isArray(r.additional_rate_limits)) for (const value of r.additional_rate_limits) {
      const b = record(value); if (typeof b.limit_name === 'string') buckets.push([b.limit_name, record(b.rate_limit)]);
    }
    for (const [key, bucket] of buckets) for (const [slot, value] of Object.entries(bucket)) {
      if (!slot.endsWith('_window')) continue;
      // A null optional window means the provider did not expose that bucket.
      // Do not invent zero usage, or report the entire account as failed.
      if(value===null||value===undefined)continue;
      const w = record(value);
      const seconds = number(w.limit_window_seconds);
      const duration = seconds !== null && seconds > 0 ? seconds % 86400 === 0 ? `${seconds / 86400}天` : seconds % 3600 === 0 ? `${seconds / 3600}小时` : `${seconds / 60}分钟` : slot === 'primary_window' ? '主窗口' : slot === 'secondary_window' ? '次窗口' : slot.replace(/_window$/, '');
      const prefix = key === 'codex' ? '' : key === 'code_review' ? '代码审查 · ' : `${key} · `;
      percent(out, `${key}_${slot.replace(/_window$/, '')}`, w.used_percent, w.reset_at, `${prefix}${duration}额度`);
      const added = out.metrics.find(m => m.id === `${key}_${slot.replace(/_window$/, '')}`);
      if (added) { added.windowMinutes = seconds !== null && seconds > 0 ? seconds / 60 : undefined; added.poolId = key; added.scope = 'account'; added.evidence = 'reported'; }
    }
    const c = record(r.credits), balance = formatDecimalString(c.balance);
    if (c.unlimited === true || balance !== null) metric(out, 'codex_credits', c.unlimited === true ? null : balance, { label: 'Codex 积分', unit: '积分', total: null, availability: c.unlimited === true ? 'unlimited' : 'known' });
    const resets = number(record(r.rate_limit_reset_credits).available_count);
    if (resets !== null && Number.isInteger(resets) && resets >= 0) metric(out, 'reset-credits', String(resets), { label: '可用重置次数', unit: '次', total: null, evidence: 'reported' });
    if (typeof r.plan_type === 'string' && r.plan_type.trim()) out.fields.push({ field: 'plan', value: r.plan_type, availability: 'known', source: 'wham/usage', observedAt: at, dataOrigin: 'official_api' });
    return finish(out);
  }
}

function codexMembershipClaim(token: unknown): string | undefined {
  if (typeof token !== 'string') return undefined;
  try {
    const claims = record(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')));
    const value = record(claims['https://api.openai.com/auth']).chatgpt_subscription_active_until;
    return typeof value === 'string' ? value : undefined;
  } catch { return undefined; }
}

export class ClaudeOAuthAdapter extends CredentialAdapter {
  readonly manifest = CLAUDE_OAUTH_MANIFEST;
  protected headers() { return { 'anthropic-beta': 'oauth-2025-04-20' }; }
  async collect(input: CollectInput): Promise<CollectOutput> {
    const out = await super.collect(input);
    let credential: Record<string, unknown> = {};
    try { credential = record(JSON.parse(input.secret ?? '')); } catch { /* raw token has no reported plan */ }
    if (typeof credential.plan === 'string' && credential.plan.trim()) out.fields.push({ field: 'plan', value: credential.plan, availability: 'known', source: 'Claude Code OAuth · subscriptionType', observedAt: out.observedAt, dataOrigin: 'local_client', evidence: 'reported' });
    return out;
  }
  normalize(raw: unknown, at: string): CollectOutput {
    const r = record(raw), out = output('Claude', at);
    for (const [key, value] of Object.entries(r)) {
      if (key === 'extra_usage' || key === 'limits') continue;
      const w = record(value);
      const label = key === 'five_hour' ? '五小时额度' : key === 'seven_day' ? '每周额度' : key.startsWith('seven_day_') ? `${key.slice(10)} · 每周额度` : typeof w.display_name === 'string' ? w.display_name : key;
      if ('utilization' in w || /^(five_hour|seven_day)/.test(key)) percent(out, key, w.utilization, w.resets_at, label);
    }
    if (Array.isArray(r.limits)) for (const value of r.limits) {
      const w = record(value), scope = record(w.scope), model = record(scope.model);
      if (w.kind !== 'weekly_scoped' || w.group !== 'weekly' || scope.surface != null || typeof model.display_name !== 'string') continue;
      const id = `seven_day_${model.display_name.trim().toLowerCase()}`;
      if (number(w.percent) === null) { out.partialFailures.push({ field: id, reason: '无有效 percent' }); continue; }
      out.metrics = out.metrics.filter(m => m.id !== id);
      percent(out, id, w.percent, w.resets_at, `${model.display_name} · 每周额度`);
    }
    const e = record(r.extra_usage);
    if (e.is_enabled === true) {
      percent(out, 'extra_usage', e.utilization, null, '额外用量');
      // subscription.rs preserves raw amounts, without converting currency.
      // OAuth wire amounts are cents (including fractional cents), not dollars:
      // https://github.com/thiswillbeyourgithub/claude_usage (extra_usage contract).
      const total = centsToMajor(e.monthly_limit), used = centsToMajor(e.used_credits);
      const unit = typeof e.currency === 'string' && /^[A-Z]{3}$/.test(e.currency) ? e.currency : 'USD';
      if (total !== null || used !== null) metric(out, 'extra_usage:amount', total !== null && used !== null ? subtract(total, used) : null,
        { label: '额外用量月度预算', unit, total, used, availability: total !== null && used !== null ? 'known' : 'unfetched', source: 'OAuth extra_usage · 金额由分换算' });
      if (total === null || used === null) out.partialFailures.push({ field: 'extra_usage:amount', reason: '未返回完整月度限额与已用金额' });
    }
    return finish(out);
  }
}

export function copilotUsageHeaders(c: HttpCredential): Record<string, string> {
  if (!c.tokenSource) throw new AdapterError('AUTH_REQUIRED', 'Copilot 凭据需指定 tokenSource: cli 或 editor');
  return { Authorization: `token ${c.accessToken}`, ...(c.tokenSource === 'cli' ? {
    'Editor-Version': 'copilot/1.0.88', 'Copilot-Integration-Id': 'copilot-developer-cli', 'X-GitHub-Api-Version': '2026-07-01',
  } : { 'Editor-Version': 'vscode/1.110.1', 'Editor-Plugin-Version': 'copilot-chat/0.38.2', 'Copilot-Integration-Id': 'vscode-chat', 'User-Agent': 'GitHubCopilotChat/0.38.2', 'X-GitHub-Api-Version': '2025-10-01' }) };
}
export class CopilotHttpAdapter extends CredentialAdapter {
  readonly manifest = COPILOT_HTTP_MANIFEST;
  protected headers(c: HttpCredential) { return copilotUsageHeaders(c); }
  normalize(raw: unknown, at: string): CollectOutput {
    const r = record(raw), out = output('GitHub Copilot', at);
    for (const [key, value] of Object.entries(record(r.quota_snapshots))) {
      const q = record(value), remaining = formatDecimalString(q.quota_remaining ?? q.remaining), total = formatDecimalString(q.entitlement);
      const dayInstant = typeof r.quota_reset_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.quota_reset_date) ? instant(`${r.quota_reset_date}T00:00:00Z`) : null;
      const day = dayInstant?.slice(0, 10) === r.quota_reset_date ? r.quota_reset_date as string : null;
      // Preserve a date-only value as a date, rather than claiming an exact instant.
      const resetAt = instant(number(q.quota_reset_at)) ?? instant(r.quota_reset_date_utc) ?? day;
      const label = ({ chat: '聊天请求', completions: '代码补全', premium_interactions: '高级请求' } as Record<string, string>)[key] ?? (typeof q.display_name === 'string' ? q.display_name : key);
      if (q.unlimited === true) {
        const exhausted = key === 'premium_interactions' && q.has_quota === false;
        metric(out, key, exhausted ? '0' : null, { label, availability: exhausted ? 'known' : 'unlimited', total: exhausted ? '100' : null, resetAt });
        continue;
      }
       if (remaining !== null) metric(out, `${key}:requests`, remaining, { label: `${label}剩余额度`, unit: typeof q.unit === 'string' ? q.unit : '额度', total, resetAt });
      const p = number(q.percent_remaining);
      if (p !== null) metric(out, key, String(p), { label, resetAt });
      else if (remaining !== null && number(total) !== null && Number(total) > 0) metric(out, key, String(Number((Number(remaining) / Number(total) * 100).toFixed(10))), { label, resetAt });
      else out.partialFailures.push({ field: key, reason: '未返回有效剩余百分比' });
    }
    const detectedPlan=typeof r.copilot_plan==='string'?r.copilot_plan:typeof r.access_type_sku==='string'?r.access_type_sku:null;
    if (detectedPlan) out.fields.push({ field: 'plan', value: detectedPlan, availability: 'known', observedAt: at, source: 'copilot_internal/user', dataOrigin: 'official_api',evidence:'reported' });
    return finish(out);
  }
}

/** Exact decimal subtraction: credits and usage are dollars, never Key limits. */
function centsToMajor(value: unknown): string | null {
  const text = formatDecimalString(value);
  if (text === null) return null;
  const negative = text.startsWith('-'), [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const digits = whole.padStart(3, '0');
  return subtract(`${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}${fraction}`, '0');
}
function subtract(a: string, b: string): string {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (s: string) => { const [whole, fraction = ''] = s.split('.'); return BigInt(`${whole}${fraction.padEnd(scale, '0')}`); };
  const n = integer(a) - integer(b), digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
  return `${n < 0n ? '-' : ''}${text}`;
}
export class OpenRouterCreditsAdapter extends CredentialAdapter {
  readonly manifest = OPENROUTER_CREDITS_MANIFEST;
  normalize(raw: unknown, at: string): CollectOutput {
    const d = record(record(raw).data), out = output('OpenRouter 账户资金', at);
    const total = formatDecimalString(d.total_credits), used = formatDecimalString(d.total_usage);
    if (total === null || used === null) throw new AdapterError('SCHEMA_CHANGED', '账户 credits 缺少有效 total_credits 或 total_usage');
    metric(out, 'account-credits', subtract(total, used), { label: '账户余额', unit: 'USD', total, used, source: 'GET /api/v1/credits · 账户资金' });
    return finish(out);
  }
}

/** Both endpoints belong to one connection. A failed endpoint never erases its
 * previous metrics: the service merges these successful observations by ID. */
export class OpenRouterCompositeAdapter implements ProviderAdapter {
  readonly manifest: AdapterManifest = { ...OPENROUTER_KEY_MANIFEST,
    supportedFields: [...OPENROUTER_KEY_MANIFEST.supportedFields, '账户余额'], unsupportedFields: ['订阅扣费日'],
    permissions: '并行只读 GET /api/v1/credits 与 /api/v1/key，分别读取账户余额与 Key 预算。' };
  private readonly key: OpenRouterKeyAdapter;
  private readonly credits: OpenRouterCreditsAdapter;
  constructor(fetchFn: HttpFetchFn = defaultHttpFetch) { this.key = new OpenRouterKeyAdapter(fetchFn); this.credits = new OpenRouterCreditsAdapter(fetchFn); }
  probe(input: CollectInput) { return this.collect(input); }
  async collect(input: CollectInput): Promise<CollectOutput> {
    const results = await Promise.allSettled([this.credits.collect(input), this.key.collect(input)]);
    if (input.signal?.aborted) throw new AdapterError('CANCELLED', '查询已取消');
    const successes = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    if (!successes.length) {
      const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
      throw failed.reason instanceof AdapterError ? failed.reason : new AdapterError('UPSTREAM_UNAVAILABLE', 'OpenRouter 查询失败');
    }
    const out = this.merge(successes);
    results.forEach((r, index) => { if (r.status === 'rejected') out.partialFailures.push({ field: index === 0 ? 'account-credits' : 'key-budget', reason: `${index===0?'账户余额':'Key 预算'}：${r.reason instanceof AdapterError?r.reason.message:'暂时无法读取'}` }); });
    if (input.expectedSubject && input.reason !== 'probe' && input.expectedSubject !== out.account.subject) throw new AdapterError('ACCOUNT_MISMATCH', 'API Key 已改变，请重新连接');
    return out;
  }
  normalize(raw: unknown, at: string): CollectOutput {
    const r = record(raw);
    return this.merge([this.credits.normalize(r.credits, at), this.key.normalize(r.key, at)]);
  }
  private merge(outputs: CollectOutput[]): CollectOutput {
    const base = outputs.find(o => o.metrics.some(m => m.id !== 'account-credits')) ?? outputs[0];
    return { ...base, account: { ...base.account, organization: '账户资金与 Key 预算' }, poolId: `pool-openrouter-${base.account.subject.slice(-8)}`,
      metrics: outputs.flatMap(o => o.metrics), fields: outputs.flatMap(o => o.fields), samples: outputs.flatMap(o => o.samples), partialFailures: outputs.flatMap(o => o.partialFailures) };
  }
  describeRecovery(error: AdapterError) { return defaultDescribeRecovery(this.manifest, error); }
  async disconnect() {}
}
