import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createBuiltinLogin as createLogin } from '../src/main/login/builtin-login';
import { createControlAdapters } from '../src/main/adapters/control-adapters';
import type { LoginFlow, LoginWindow } from '../src/main/login/types';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const createBuiltinLogin: typeof createLogin = (id, options) => createLogin(id, { ...options, googleOAuth: { clientId: 'fixture-client', clientSecret: 'fixture-secret' } });
test('Google without deployment OAuth configuration fails before network', async () => {
  await assert.rejects(createLogin('gemini-cli', { now: Date.now, fetch: async () => { throw new Error('must not request'); }, googleOAuth: { clientId: '', clientSecret: '' } }), /尚未配置/);
});
const jwt = (value: object) => `head.${Buffer.from(JSON.stringify(value)).toString('base64url')}.sig`;
const decode = (s: string) => s.replace(/&amp;/g, '&');
async function authorize(flow: LoginFlow) {
  const html = await (await fetch(flow.url)).text();
  const link = html.match(/href="(https:\/\/accounts.google.com[^\"]+)"/);
  assert.ok(link); return new URL(decode(link[1]));
}
async function callback(auth: URL, state = auth.searchParams.get('state')!) {
  const u = new URL(auth.searchParams.get('redirect_uri')!);
  // Antigravity's registered redirect hostname is localhost; listener is IPv4.
  u.hostname = '127.0.0.1';
  u.search = new URLSearchParams({ state, code: 'fixture-code' }).toString();
  return fetch(u, { redirect: 'manual' });
}

for (const provider of ['gemini-cli', 'antigravity']) test(`${provider}: PKCE/state OAuth, read-only project and actual adapter contract`, async () => {
  let auth: URL, calls = 0;
  const flow = await createBuiltinLogin(provider, { now: () => 1000, fetch: async (input, init) => {
    calls++; const url = String(input);
    assert.equal(init?.redirect, 'error');
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get('grant_type'), 'authorization_code'); assert.equal(form.get('code'), 'fixture-code');
      assert.equal(form.get('redirect_uri'), auth.searchParams.get('redirect_uri'));
      assert.equal(form.get('client_id'), auth.searchParams.get('client_id'));
      assert.equal(form.get('client_secret'), 'fixture-secret');
      assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'), auth.searchParams.get('code_challenge'));
      return response({ access_token: 'private-access', refresh_token: 'unused-refresh', expires_in: 3600 });
    }
    if (url.includes('/userinfo?')) return response({ id: 'google-account', email: 'fixture@example.test' });
    assert.equal(url, 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-access');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.metadata.ideType, provider === 'antigravity' ? 'ANTIGRAVITY' : 'IDE_UNSPECIFIED');
    return response({ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: { id: 'existing-project' } });
  } });
  try {
    auth = await authorize(flow);
    assert.equal((await callback(auth, 'incorrect')).status, 403); assert.equal(await flow.poll(), null); assert.equal(calls, 0);
    assert.equal((await callback(auth)).status, 303); assert.equal((await callback(auth)).status, 409);
    assert.equal(await flow.poll(), null); assert.equal(await flow.poll(), null);
    const account = await flow.poll(); assert.ok(account);
    const secret = JSON.parse(account.secret); assert.equal(secret.project, 'existing-project'); assert.equal(secret.management, 'static'); assert.equal(secret.expiresAt, 3601000); assert.equal(secret.refreshToken, undefined);
    assert.equal(JSON.stringify(flow).includes('private-access'), false);
    const adapter = createControlAdapters({ fetchFn: async (url, init) => {
      assert.equal(url, provider === 'gemini-cli' ? 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota' : 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary');
      assert.equal(JSON.parse(String(init.body)).project, 'existing-project');
      assert.equal(init.headers.Authorization, 'Bearer private-access');
      return { status: 200, headers: new Headers(), text: async () => JSON.stringify(provider === 'gemini-cli' ? { buckets: [{ modelId: 'fixture-model', remainingFraction: 0.5 }] } : { groups: [{ displayName: 'fixture-group', buckets: [{ bucketId: 'fixture-bucket', remainingFraction: 0.5 }] }] }) };
    } }).find(a => a.manifest.id === provider)!;
    const out = await adapter.collect({ connectionId: 'fixture', generation: 1, reason: 'probe', expectedSubject: account.subject, secret: account.secret });
    assert.equal(out.account.subject, account.subject); assert.equal(out.metrics[0].remaining, '50');
  } finally { flow.cancel(); }
});

test('Google missing project stays pending; nonce/origin protected form accepts only existing project, never onboards', async () => {
  let loads = 0;
  const flow = await createBuiltinLogin('gemini-cli', { now: () => 1000, fetch: async (input, init) => {
    const url = String(input);
    if (url.endsWith('/token')) return response({ access_token: 'token', expires_in: 3600 });
    if (url.includes('/userinfo?')) return response({ id: 'user', email: 'user@example.test' });
    assert.equal(url, 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'); loads++;
    if (loads === 1) return response({ allowedTiers: [{ id: 'free-tier' }] });
    assert.equal(JSON.parse(String(init?.body)).cloudaicompanionProject, 'existing-project');
    return response({ currentTier: { id: 'standard-tier' } });
  } });
  try {
    await callback(await authorize(flow));
    await flow.poll(); await flow.poll(); assert.equal(await flow.poll(), null); assert.equal(await flow.poll(), null); assert.equal(loads, 1);
    const page = await (await fetch(flow.url)).text(); assert.match(page, /不会自动开通/); assert.ok(!page.includes('access_token'));
    const submit = new URL(flow.url); submit.pathname = '/project';
    const init = { method: 'POST', headers: { Origin: submit.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'project=existing-project' };
    assert.equal((await fetch(submit, { ...init, headers: { ...init.headers, Origin: 'https://attacker.test' } })).status, 403);
    const wrong = new URL(submit); wrong.searchParams.set('session', 'wrong'); assert.equal((await fetch(wrong, init)).status, 403);
    assert.equal((await fetch(submit, init)).status, 200);
    const c = await flow.poll(); assert.ok(c); assert.equal(JSON.parse(c.secret).project, 'existing-project');
  } finally { flow.cancel(); }
});

for (const site of ['com', 'ai']) test(`StepFun ${site}: isolated window runs fixed same-origin renewal and credential matches adapter`, async () => {
  const access = jwt({ activated: true, oasis_id: 'account-1', exp: 2000000000 });
  const refresh = jwt({ device_id: 'bound-device', exp: 2000000900 });
  let closed = false, opened = 0, renewals = 0, browserOrigin = 'https://unrelated.test';
  const win: LoginWindow = {
    closed: () => closed, close: () => { closed = true; },
    evaluate: async <T>(script: string): Promise<T | null> => runInNewContext(script, {
      location: { origin: browserOrigin }, localStorage: { getItem: () => 'untrusted-web-id' }, AbortSignal,
      atob: (s: string) => Buffer.from(s, 'base64').toString(),
      fetch: async (url: string, init: RequestInit) => {
        renewals++; assert.equal(url, '/passport/proto.api.passport.v1.PassportService/RefreshToken');
        assert.equal(init.credentials, 'include'); assert.equal(new Headers(init.headers).get('oasis-appid'), site === 'ai' ? '20700' : '10300');
        return response({ accessToken: { raw: access }, refreshToken: { raw: refresh } });
      },
    }) as Promise<T>,
  };
  const flow = await createBuiltinLogin(`stepfun-plan-${site}`, { now: () => 1000, openWindow: async (url, opts) => {
    opened++; assert.equal(url, `https://platform.stepfun.${site}/step-plan`); assert.deepEqual(opts.allowedOrigins, [`https://platform.stepfun.${site}`]); return win;
  }, fetch: async (input, init) => {
    assert.equal(String(input), `https://platform.stepfun.${site}/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit`);
    assert.equal(new Headers(init?.headers).get('Oasis-Webid'), 'bound-device'); assert.equal(new Headers(init?.headers).get('Cookie'), `Oasis-Token=${access}...${refresh}`);
    return response({});
  } });
  assert.equal(flow.url, `https://platform.stepfun.${site}/step-plan`); assert.equal(await flow.poll(), null);
  await Promise.all([flow.open!(), flow.open!()]); assert.equal(opened, 1);
  assert.equal(await flow.poll(), null); assert.equal(renewals, 0);
  browserOrigin = `https://platform.stepfun.${site}`;
  const c = await flow.poll(); assert.ok(c); assert.equal(renewals, 1); assert.equal(closed, true);
  const secret = JSON.parse(c.secret); assert.equal(secret.webId, 'bound-device'); assert.equal(secret.management, 'static'); assert.equal(secret.expiresAt, 2000000000000);
  assert.equal(JSON.stringify(flow).includes(access), false);
  const adapter = createControlAdapters({ fetchFn: async (url, init) => {
    assert.equal(init.headers.Cookie, `Oasis-Token=${access}...${refresh}`); assert.equal(init.headers['Oasis-Webid'], 'bound-device');
    return { status: 200, headers: new Headers(), text: async () => JSON.stringify(url.endsWith('/GetStepPlanStatus') ? { subscription: { name: 'Step Plan' } } : {}) };
  } }).find(a => a.manifest.id === `stepfun-plan-${site}`)!;
  const out = await adapter.collect({ connectionId: 'fixture', generation: 1, reason: 'probe', expectedSubject: c.subject, secret: c.secret });
  assert.equal(out.account.subject, c.subject); assert.equal(out.fields[0].value, 'Step Plan'); flow.cancel();
});

test('StepFun rejects unsupported environment and closes late windows after cancel', async () => {
  await assert.rejects(createBuiltinLogin('stepfun-plan-ai', { now: () => 0, fetch }), { code: 'UNSUPPORTED' });
  let resolveWindow!: (w: LoginWindow) => void, closed = false;
  const flow = await createBuiltinLogin('stepfun-plan-ai', { now: () => 0, fetch, openWindow: () => new Promise(resolve => { resolveWindow = resolve; }) });
  const opening = flow.open!(); flow.cancel();
  resolveWindow({ evaluate: async () => null, closed: () => closed, close: () => { closed = true; } });
  await assert.rejects(opening, { code: 'CANCELLED' }); assert.equal(closed, true); await assert.rejects(flow.poll(), { code: 'CANCELLED' });
});

test('cancel and expiry stop builtin flows without provider requests', async () => {
  let now = 0;
  const flow = await createBuiltinLogin('gemini-cli', { now: () => now, fetch: async () => { throw Error('must not fetch'); } });
  now = flow.expiresAt; await assert.rejects(flow.poll(), { code: 'EXPIRED' });
  const signal = new AbortController(); signal.abort();
  await assert.rejects(createBuiltinLogin('antigravity', { now: () => 0, fetch, signal: signal.signal }), { code: 'CANCELLED' });
});
