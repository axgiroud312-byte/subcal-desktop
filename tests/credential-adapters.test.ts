import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexHttpAdapter, ClaudeOAuthAdapter, CopilotHttpAdapter, OpenRouterCreditsAdapter, OpenRouterCompositeAdapter, copilotUsageHeaders, parseHttpCredential } from '../src/main/adapters/credential-adapters';
import { getAdapter, manifests } from '../src/main/adapters';
import { AdapterError } from '../src/main/adapters/types';
import { hashKeySubject, OpenRouterKeyAdapter, type HttpFetchFn } from '../src/main/adapters/http-adapters';

const at = '2026-10-21T03:00:00.000Z';
const schema = (e: unknown) => e instanceof AdapterError && e.code === 'SCHEMA_CHANGED';
test('wham: windows/credits stay distinct; missing usage is not zero', () => {
  const adapter = new CodexHttpAdapter();
  const out = adapter.normalize({ rate_limit: { primary_window: { used_percent: 25, reset_at: 1792551600 }, secondary_window: { used_percent: null } }, credits: { balance: '0' } }, at);
  assert.equal(out.metrics[0].id, 'codex_primary'); assert.equal(out.metrics[0].remaining, '75');
  assert.equal(out.metrics[0].resetAt, new Date(1792551600000).toISOString());
  assert.equal(out.metrics[1].remaining, '0'); assert.equal(out.partialFailures.length, 1);
  assert.throws(() => adapter.normalize({ rate_limit: { primary_window: {} } }, at), schema);
  const optional=adapter.normalize({plan_type:'pro',rate_limit:{primary_window:null,secondary_window:{used_percent:27,limit_window_seconds:604800}}},at);
  assert.equal(optional.partialFailures.length,0);assert.equal(optional.metrics.length,1);
});
test('Claude: dynamic windows and scoped model overrides preserve 0; no renewal invention', () => {
  const out = new ClaudeOAuthAdapter().normalize({ five_hour: { utilization: 0 }, seven_day_opus: { utilization: 10 }, future_window: { utilization: 110 }, limits: [
    { kind: 'weekly_scoped', group: 'weekly', scope: { model: { display_name: 'Opus' } }, percent: 30, resets_at: at },
    { kind: 'weekly_scoped', group: 'weekly', scope: { model: { display_name: 'Opus' }, surface: 'chat' }, percent: 80 },
  ] }, at);
  assert.equal(out.metrics.find(m => m.id === 'five_hour')?.remaining, '100');
  assert.equal(out.metrics.find(m => m.id === 'seven_day_opus')?.remaining, '70');
  assert.equal(out.metrics.find(m => m.id === 'future_window')?.remaining, '-10');
  assert.equal(out.fields.length, 0);
  assert.throws(() => new ClaudeOAuthAdapter().normalize({ five_hour: { utilization: null } }, at), schema);
});
test('Copilot wire numbers/unknown/unlimited pool exhaustion/reset date', () => {
  const out = new CopilotHttpAdapter().normalize({ quota_reset_date: '2026-11-01', quota_snapshots: {
    dynamic: { entitlement: '100', quota_remaining: '40' }, empty: {},
    chat: { unlimited: true, has_quota: false }, premium_interactions: { unlimited: true, has_quota: false },
  } }, at);
  assert.equal(out.metrics.find(m => m.id === 'dynamic:requests')?.remaining, '40');
  assert.equal(out.metrics.find(m => m.id === 'dynamic')?.remaining, '40');
  assert.equal(out.metrics.find(m => m.id === 'chat')?.availability, 'unlimited');
  assert.equal(out.metrics.find(m => m.id === 'premium_interactions')?.remaining, '0');
  assert.equal(out.metrics.every(m => m.resetAt === '2026-11-01'), true);
  assert.equal(out.metrics.some(m => m.id === 'empty'), false);
});

test('subscription manifests, readable windows and plan-only response', () => {
  for (const id of ['codex-local', 'claude-local', 'copilot-local']) assert.equal(getAdapter(id).manifest.authMode, 'local_client');
  assert.equal(getAdapter('claude-local').manifest.product, 'Claude Code');
  assert.equal(manifests.some(m => m.id === 'openrouter-credits'), false);
  assert.ok(getAdapter('openrouter-key') instanceof OpenRouterCompositeAdapter);
  const adapter = new CodexHttpAdapter();
  assert.equal(adapter.normalize({ plan_type: 'plus' }, at).fields[0].value, 'plus');
  assert.throws(() => adapter.normalize({ plan_type: '' }, at), schema);
  const out = adapter.normalize({ rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18000 } }, code_review_rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 604800 } } }, at);
  assert.equal(out.metrics[0].label, '5小时额度'); assert.equal(out.metrics[1].label, '代码审查 · 7天额度');
});
test('Claude extra usage cents convert precisely; partial amounts stay unknown', () => {
  const adapter = new ClaudeOAuthAdapter();
  const out = adapter.normalize({ extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1234.5, currency: 'USD' } }, at);
  const m = out.metrics.find(m => m.id === 'extra_usage:amount')!;
  assert.equal(m.total, '50'); assert.equal(m.used, '12.345'); assert.equal(m.remaining, '37.655'); assert.equal(m.unit, 'USD');
  const partial = adapter.normalize({ extra_usage: { is_enabled: true, used_credits: 0 } }, at).metrics[0];
  assert.equal(partial.remaining, null); assert.equal(partial.used, '0'); assert.equal(partial.total, null);
});
test('Copilot ISO reset preferred; invalid calendar date remains unknown', () => {
  const adapter = new CopilotHttpAdapter();
  const body = { quota_reset_date: '2026-02-31', quota_snapshots: { premium_interactions: { percent_remaining: 50 } } };
  assert.equal(adapter.normalize(body, at).metrics[0].resetAt, null);
  const m = adapter.normalize({ ...body, quota_reset_date_utc: at }, at).metrics[0];
  assert.equal(m.resetAt, at); assert.equal(m.label, '高级请求');
});
test('OpenRouter composite starts both requests and merges one identity', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetchFn: HttpFetchFn = async url => {
    if (++calls === 2) release();
    await gate;
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: url.endsWith('/credits') ? { total_credits: 100, total_usage: 40 } : { limit: 10, limit_remaining: 5 } }) };
  };
  const out = await new OpenRouterCompositeAdapter(fetchFn).collect({ connectionId: 'x', generation: 1, reason: 'probe', secret: 'fake' });
  assert.equal(calls, 2); assert.equal(out.account.subject, hashKeySubject('openrouter-key', 'fake'));
  assert.deepEqual(out.metrics.map(m => [m.id, m.remaining]), [['account-credits', '60'], ['budget', '5']]);
});
test('OpenRouter composite retains either endpoint on permission failure; both failures throw', async () => {
  for (const denied of ['credits', 'key', 'both']) {
    const fetchFn: HttpFetchFn = async url => ({ status: denied === 'both' || url.endsWith(`/${denied}`) ? 403 : 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: url.endsWith('/credits') ? { total_credits: 10, total_usage: 0 } : { limit_remaining: 3 } }) });
    const pending = new OpenRouterCompositeAdapter(fetchFn).collect({ connectionId: 'x', generation: 1, reason: 'probe', secret: 'fake' });
    if (denied === 'both') await assert.rejects(pending, e => e instanceof AdapterError && e.code === 'PERMISSION_DENIED');
    else {
      const out = await pending;
      assert.equal(out.metrics[0].id, denied === 'credits' ? 'budget' : 'account-credits');
      assert.equal(out.partialFailures.length, 1); assert.match(out.partialFailures[0].reason, /不允许读取/);
      assert.equal(out.account.subject, hashKeySubject('openrouter-key', 'fake'));
    }
  }
});
test('OpenRouter credits are exact account amounts, never key cap fallback', () => {
  const adapter = new OpenRouterCreditsAdapter();
  assert.equal(adapter.normalize({ data: { total_credits: '0.3', total_usage: '0.2', limit_remaining: 999 } }, at).metrics[0].remaining, '0.1');
  assert.equal(adapter.normalize({ data: { total_credits: '0', total_usage: '2.000000000001' } }, at).metrics[0].remaining, '-2.000000000001');
  assert.equal(adapter.normalize({ data: { total_credits: 1e-25, total_usage: 0 } }, at).metrics[0].remaining, '0.0000000000000000000000001');
  for (const data of [{ total_credits: 10 }, { total_credits: 10, total_usage: null }, { limit_remaining: 50 }]) assert.throws(() => adapter.normalize({ data }, at), schema);
  assert.equal(new OpenRouterKeyAdapter().normalize({ data: { limit_remaining: 5, limit: 10 } }, at).metrics[0].id, 'budget');
});
test('direct credential envelope controls subject and headers without local runtime', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn: HttpFetchFn = async (url, init) => {
    assert.equal(init.method, 'GET'); seen.push({ url, headers: init.headers });
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ rate_limit: { primary_window: { used_percent: 0 } } }) };
  };
  const input = { connectionId: 'test', generation: 1, reason: 'manual' as const, expectedSubject: 'stable', secret: JSON.stringify({ accessToken: 'fake', accountId: 'workspace', subject: 'stable', alias: 'Alias', source: 'codex', management: 'external' }) };
  const out = await new CodexHttpAdapter(fetchFn).collect(input);
  assert.equal(out.account.subject, 'stable'); assert.equal(out.account.alias, 'Alias');
  assert.equal(seen[0].url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(seen[0].headers['ChatGPT-Account-Id'], 'workspace'); assert.equal(seen[0].headers.Authorization, 'Bearer fake');
  await assert.rejects(new CodexHttpAdapter(fetchFn).collect({ ...input, expectedSubject: 'other' }), e => e instanceof AdapterError && e.code === 'ACCOUNT_MISMATCH');
  for (const source of ['copilot-cli', 'copilot-editor', 'copilot-device']) {
    const h = copilotUsageHeaders(parseHttpCredential(JSON.stringify({ accessToken: 'fake', source })));
    assert.equal(h.Authorization, 'token fake');
    assert.equal(h['Copilot-Integration-Id'], source === 'copilot-cli' ? 'copilot-developer-cli' : 'vscode-chat');
  }
  assert.equal(hashKeySubject('openrouter-key', ' fake '), hashKeySubject('openrouter-credits', 'fake'));
});
test('OAuth beta header and HTTP error redaction', async () => {
  const fetchFn: HttpFetchFn = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(init.headers['anthropic-beta'], 'oauth-2025-04-20');
    return { status: 401, headers: { get: () => null }, text: async () => 'secret must not leak' };
  };
  await assert.rejects(new ClaudeOAuthAdapter(fetchFn).collect({ connectionId: 'x', generation: 1, reason: 'probe', secret: 'fake' }), e => {
    assert.ok(e instanceof AdapterError && e.code === 'AUTH_REQUIRED'); assert.doesNotMatch(e.message, /must not leak/); return true;
  });
});
