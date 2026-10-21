import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountAccess } from '../src/main/account-access';
import { CodexHttpAdapter } from '../src/main/adapters/credential-adapters';
import { readServiceSource, serviceSourceLocators } from '../src/main/service-account-sources';
import { CopilotHttpAdapter } from '../src/main/adapters/credential-adapters';
import { copilotHost } from '../src/shared/copilot-host';

const jwt = (value: unknown) => `e30.${Buffer.from(JSON.stringify(value)).toString('base64url')}.sig`;
const fakeFetch = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ plan_type: 'pro', rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1900000000 } }, rate_limit_reset_credits: { available_count: 2 } }) });
test('Codex membership claim stays separate from token expiry and dynamic reset', async () => {
  const adapter = new CodexHttpAdapter(fakeFetch);
  const out = await adapter.collect({ connectionId: 'a', generation: 1, reason: 'probe', secret: JSON.stringify({ accessToken: 'access', membershipExpiresAt: '2099-02-03T04:00:00+00:00', expiresAt: 1900000000000 }) });
  assert.equal(out.entitlements?.membershipExpiresAt?.value?.value, '2099-02-03T04:00:00.000Z');
  assert.equal(out.entitlements?.billingPeriodEnd, undefined);
  assert.equal(out.metrics[0].windowMinutes, 300);
  assert.equal(out.metrics.find(m => m.id === 'reset-credits')?.remaining, '2');
  for (const value of ['2020-02-03T04:00:00Z', '2099-02-03', 'bad', undefined]) {
    const result = await adapter.collect({ connectionId: 'a', generation: 1, reason: 'probe', secret: JSON.stringify({ accessToken: 'access', membershipExpiresAt: value, expiresAt: 4102444800000 }) });
    assert.equal(result.entitlements, undefined);
  }
});
test('Codex discovery carries the dedicated ID claim without exposing credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'subcal-claim-'));
  try {
    await mkdir(join(home, '.codex'));
    await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: jwt({ exp: 1900000000, sub: 'u', 'https://api.openai.com/auth': { chatgpt_account_id: 'a' } }), id_token: jwt({ 'https://api.openai.com/auth': { chatgpt_subscription_active_until: '2099-01-01T00:00:00Z' } }) } }));
    const access = new AccountAccess({ home, env: {}, platform: 'win32', readSystemSecret: async () => null });
    const found = await access.discover();
    assert.equal(found.accounts.length, 1);
    assert.equal(JSON.stringify(found).includes('2099'), false);
    assert.equal(JSON.parse((await access.resolve(found.accounts[0].id)).secret).membershipExpiresAt, '2099-01-01T00:00:00Z');
  } finally { await rm(home, { recursive: true, force: true }); }
});
test('Cursor and OpenCode source rotation follows only the same account, with no source writes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'subcal-sources-'));
  try {
    const locators = serviceSourceLocators(home, {}, 'linux');
    const cursor = locators.find(l => l.format === 'cursor')!;
    await mkdir(join(home, '.config', 'cursor'), { recursive: true });
    const write = async (sub: string, exp: number) => writeFile(cursor.path, JSON.stringify({ accessToken: jwt({ sub, exp }) }));
    await write('user-a', 1);
    const access = new AccountAccess({ home, env: {}, platform: 'linux', readSystemSecret: async () => null });
    const found = await access.discover();
    const c = await access.resolve(found.accounts.find(a => a.providerId === 'cursor')!.id);
    await write('user-a', 2);
    const rotated = await access.refreshExternal(c);
    assert.equal(rotated.subject, c.subject);
    assert.notEqual(rotated.secret, c.secret);
    await write('user-b', 3);
    await assert.rejects(access.refreshExternal(c), /账号已切换/);
    const devin = locators.find(l => l.format === 'devin')!;
    await mkdir(join(home, '.local', 'share', 'devin'), { recursive: true });
    await writeFile(devin.path, 'windsurf_api_key = "key-for-test"\napi_server_url = "https://private.example"');
    await assert.rejects(readServiceSource(devin), /私有服务器/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test('Copilot GHE is isolated by exact approved host, with no github.com fallback', async () => {
  assert.equal(copilotHost('https://acme.ghe.com/'), 'acme.ghe.com');
  for (const host of ['https://acme.ghe.com.evil.test', 'https://user@acme.ghe.com', 'https://acme.ghe.com/path', 'http://acme.ghe.com', 'x.y.ghe.com']) assert.throws(() => copilotHost(host));
  const urls: string[] = [];
  const adapter = new CopilotHttpAdapter(async (url) => { urls.push(url); return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ copilot_plan: 'business', quota_snapshots: { premium_interactions: { remaining: 12.5, entitlement: 300, unit: 'credits' } } }) }; });
  const out = await adapter.collect({ connectionId: 'ghe', generation: 1, reason: 'probe', secret: JSON.stringify({ accessToken: 't', subject: 'copilot:enterprise', host: 'acme.ghe.com', source: 'copilot-cli' }) });
  assert.deepEqual(urls, ['https://api.acme.ghe.com/copilot_internal/user']);
  assert.equal(out.account.region, 'acme.ghe.com');
  assert.equal(out.metrics[0].unit, 'credits');
  assert.equal(out.metrics[0].remaining, '12.5');
});
