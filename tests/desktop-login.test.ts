import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createDesktopLogin, DESKTOP_LOGIN_PROVIDERS } from '../src/main/login/desktop-login';

const now = () => 1800000000000;
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
function mock(fn: (u: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input, init) => fn(new URL(String(input)), init || {})) as typeof fetch;
}

test('MiniMax standard device PKCE, pending, slowdown, static credentials and cancellation', async () => {
  let challenge = '', count = 0;
  const flow = await createDesktopLogin('minimax-code', { now, fetch: mock((u, init) => {
    const p = new URLSearchParams(String(init.body));
    assert.equal(init.redirect, 'error');
    if (u.pathname.endsWith('/device/code')) { challenge = p.get('code_challenge')!; return json({ user_code: 'ABCD', device_code: 'device', verification_uri: 'https://account.minimax.cn/activate', expires_in: 600, interval: 3 }); }
    assert.equal(createHash('sha256').update(p.get('code_verifier')!).digest('base64url'), challenge);
    assert.equal(p.get('device_code'), 'device');
    if (++count === 1) return json({ error: 'authorization_pending' }, 400);
    if (count === 2) return json({ error: 'slow_down' }, 400);
    return json({ access_token: 'secret', refresh_token: 'refresh', expires_in: 3600 });
  }) });
  assert.equal(flow.userCode, 'ABCD'); assert.equal(await flow.poll(), null); assert.equal(await flow.poll(), null);
  assert.equal(flow.intervalSeconds, 8);
  const result = await flow.poll(); const secret = JSON.parse(result!.secret);
  assert.equal(secret.management, 'static'); assert.equal(secret.accessToken, 'secret'); assert.equal(secret.region, 'cn');
  flow.cancel(); assert.throws(() => flow.poll(), /取消/);
});

test('MiniMax user-code variant and explicit denial', async () => {
  const flow = await createDesktopLogin('minimax-code-global', { now, fetch: mock((u, init) => {
    if (u.pathname.endsWith('/device/code')) return json({ user_code: 'USER', expired_in: now() + 60000, interval: 2000, verification_url: 'https://account.minimax.io/activate' });
    assert.equal(new URLSearchParams(String(init.body)).get('user_code'), 'USER'); return json({ status: 'denied' });
  }) });
  assert.equal(flow.expiresAt, now() + 60000); assert.equal(flow.intervalSeconds, 2);
  await assert.rejects(flow.poll(), /拒绝/); flow.cancel();
});

test('Qoder regions use PKCE device tokens directly, never model job tokens', async () => {
  for (const id of ['qoder', 'qoder-cn']) {
    let calls = 0;
    const flow = await createDesktopLogin(id, { now, fetch: mock((u) => {
      assert.equal(u.pathname, '/api/v1/deviceToken/poll'); assert.equal(u.searchParams.get('challenge_method'), 'S256');
      return ++calls === 1 ? new Response(null, { status: 204 }) : json({ token: 'device-secret', user_id: 'user' });
    }) });
    const u = new URL(flow.url); assert.equal(u.searchParams.has('redirect_uri'), false);
    assert.equal(await flow.poll(), null);
    const secret = JSON.parse((await flow.poll())!.secret); assert.equal(secret.deviceToken, 'device-secret'); assert.match(secret.region, /^openapi\./); flow.cancel();
  }
});

test('WorkBuddy retains token while account confirmation is pending', async () => {
  let tokenCalls = 0, accountCalls = 0;
  const flow = await createDesktopLogin('workbuddy', { now, fetch: mock((u) => {
    if (u.pathname.endsWith('/state')) return json({ code: 0, data: { state: 'server-state', authUrl: 'https://copilot.tencent.com/login' } });
    assert.equal(u.searchParams.get('state'), 'server-state');
    if (u.pathname.endsWith('/token')) { tokenCalls++; return json({ code: 0, data: { accessToken: 'token', expiresIn: 3600 } }); }
    return ++accountCalls === 1 ? json({ code: 12151 }) : json({ code: 0, data: { uid: 'user', enterpriseId: 'team' } });
  }) });
  assert.equal(await flow.poll(), null); const a = await flow.poll();
  assert.equal(tokenCalls, 1); assert.equal(a!.organization, 'team'); assert.equal(JSON.parse(a!.secret).uid, 'user'); flow.cancel();
});

test('Trae loopback rejects missing state and accepts matching callback; cancel closes socket', async () => {
  const flow = await createDesktopLogin('trae-cn', { now, fetch: mock(() => { throw new Error('must not request models'); }) });
  const callback = new URL(new URL(flow.url).searchParams.get('auth_callback_url')!);
  const wrong = new URL(callback); wrong.search = ''; assert.equal((await fetch(wrong)).status, 403); assert.equal(await flow.poll(), null);
  callback.searchParams.set('userJwt', JSON.stringify({ Token: 'secret', RefreshToken: 'refresh' }));
  callback.searchParams.set('userInfo', JSON.stringify({ UserID: 'uid' }));
  await fetch(callback); const a = await flow.poll(); assert.equal(JSON.parse(a!.secret).uid, 'uid');
  flow.cancel(); await assert.rejects(fetch(callback));
});

test('Kiro verifies state before exchange and binds profile region', async () => {
  let calls = 0;
  const flow = await createDesktopLogin('kiro-us-east-1', { now, fetch: mock((u, init) => {
    calls++; assert.equal(u.pathname, '/oauth/token'); assert.ok(JSON.parse(String(init.body)).code_verifier);
    return json({ accessToken: 'token', profileArn: 'arn:aws:codewhisperer:us-east-1:123:profile/test', expiresIn: 3600 });
  }) });
  const login = new URL(flow.url), callback = new URL(login.searchParams.get('redirect_uri')! + '/signin/callback');
  callback.hostname = '127.0.0.1'; callback.search = new URLSearchParams({ state: 'wrong', login_option: 'google', code: 'code' }).toString();
  assert.equal((await fetch(callback)).status, 403); assert.equal(calls, 0);
  callback.searchParams.set('state', login.searchParams.get('state')!); await fetch(callback);
  assert.equal(JSON.parse((await flow.poll())!.secret).region, 'us-east-1'); flow.cancel();
});

test('CodeArts accepts documented code-only callback using PKCE and valid DPoP, rejecting explicit wrong state', async () => {
  let verifier = '';
  const flow = await createDesktopLogin('codearts', { now, fetch: mock((u, init) => {
    const proof = new Headers(init.headers).get('DPoP')!, [h, p, signature] = proof.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()); const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    assert.equal(payload.htu, u.toString()); assert.equal(payload.htm, 'POST');
    assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: header.jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
    verifier = new URLSearchParams(String(init.body)).get('code_verifier')!;
    return json({ credentials: { access_key_id: 'ak', secret_access_key: 'sk', security_token: 'sts', expiration: '2030-01-01T00:00:00Z' } });
  }) });
  const login = new URL(flow.url), callback = new URL(`http://127.0.0.1:${login.searchParams.get('port')}/oauth/callback?code=code`);
  callback.searchParams.set('ticket_id','wrong');assert.equal((await fetch(callback)).status,403);
  callback.searchParams.delete('ticket_id');await fetch(callback);
  assert.ok(verifier);assert.notEqual(verifier,login.searchParams.get('code_challenge'));
  assert.equal(JSON.parse((await flow.poll())!.secret).security_token, 'sts'); flow.cancel();
});

test('unsupported, pre-aborted, and expired flows do not perform authorization', async () => {
  assert.equal(DESKTOP_LOGIN_PROVIDERS.length, 12);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createDesktopLogin('qoder', { now, signal: controller.signal, fetch: mock(() => { throw new Error('unexpected'); }) }), /取消/);
  await assert.rejects(createDesktopLogin('unknown', { now, fetch }), /不支持/);
  let at = now(); const flow = await createDesktopLogin('qoder', { now: () => at, fetch }); at += 600001;
  assert.throws(() => flow.poll(), /过期/);
});
