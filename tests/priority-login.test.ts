import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPriorityLogin } from '../src/main/login/priority-login';

const jwt = (data: object) => `header.${Buffer.from(JSON.stringify(data)).toString('base64url')}.signature`;
const response = (data: object, status = 200) => new Response(JSON.stringify(data), { status });

test('Cursor binds browser challenge to private poll verifier and returns static adapter credential', async () => {
  let count = 0;
  const token = jwt({ sub: 'cursor-user', exp: 2000000000 });
  const flow = await createPriorityLogin('cursor', { now: () => 1000, fetch: async (input, init) => {
    const u = new URL(String(input));
    assert.equal(u.origin, 'https://api2.cursor.sh'); assert.equal(u.pathname, '/auth/poll');
    assert.equal(u.searchParams.get('uuid'), new URL(flow.url).searchParams.get('uuid'));
    assert.equal(createHash('sha256').update(u.searchParams.get('verifier')!).digest('base64url'), new URL(flow.url).searchParams.get('challenge'));
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    return ++count === 1 ? response({}, 404) : response({ accessToken: token, refreshToken: 'unused-refresh' });
  } });
  assert.equal(new URL(flow.url).searchParams.has('verifier'), false);
  assert.equal(await flow.poll(), null);
  const account = await flow.poll(); assert.ok(account);
  const secret = JSON.parse(account.secret);
  assert.equal(secret.accessToken, token); assert.equal(secret.source, 'cursor'); assert.equal(secret.management, 'static');
  assert.equal(secret.expiresAt, 2000000000000); assert.equal(secret.refreshToken, undefined);
  assert.equal(JSON.stringify(flow).includes(token), false);
  flow.cancel(); await assert.rejects(flow.poll(), { code: 'CANCELLED' });
});

test('Devin loopback validates state, has nonblocking pending polls, and exchanges bound PKCE', async () => {
  let calls = 0;
  const token = 'devin-session-token$' + jwt({ sub: 'devin-user', exp: 2000000000 });
  const flow = await createPriorityLogin('devin', { now: () => 1000, fetch: async (input, init) => {
    calls++; assert.equal(String(input), 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/ExchangeDevinCLIPKCECode');
    const body = JSON.parse(String(init?.body)); const url = new URL(flow.url);
    assert.equal(body.code, 'authorized-code'); assert.equal(body.redirect_uri, url.searchParams.get('redirect_uri'));
    assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), url.searchParams.get('code_challenge'));
    return response({ sessionToken: token });
  } });
  try {
    const url = new URL(flow.url), callback = new URL(url.searchParams.get('redirect_uri')!);
    assert.equal(callback.hostname, '127.0.0.1'); assert.equal(await flow.poll(), null);
    callback.search = new URLSearchParams({ state: 'wrong', code: 'stolen' }).toString();
    assert.equal((await fetch(callback)).status, 400); assert.equal(await flow.poll(), null); assert.equal(calls, 0);
    callback.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'authorized-code' }).toString();
    assert.equal((await fetch(callback)).status, 200);
    assert.equal((await fetch(callback)).status, 410);
    const account = await flow.poll(); assert.ok(account);
    assert.equal(JSON.parse(account.secret).accessToken, token); assert.equal(calls, 1);
  } finally { flow.cancel(); }
});

test('Factory device grant handles pending/slow_down then resolves organization for adapter', async () => {
  let poll = 0;
  const token = jwt({ sub: 'factory-user', org_id: 'workos-org', exp: 2000000000 });
  const flow = await createPriorityLogin('factory', { now: () => 1000, fetch: async (input, init) => {
    const url = String(input), body = new URLSearchParams(String(init?.body || ''));
    if (url.endsWith('/authorize/device')) {
      assert.equal(body.get('client_id'), 'client_01HNM792M5G5G1A2THWPXKFMXB');
      return response({ device_code: 'private-device', user_code: 'USER-CODE', verification_uri: 'https://auth.factory.ai/device', expires_in: 600, interval: 2 });
    }
    if (url.endsWith('/authenticate')) {
      assert.equal(body.get('device_code'), 'private-device'); assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
      poll++; return poll < 3 ? response({ error: poll === 1 ? 'authorization_pending' : 'slow_down' }, 400) : response({ access_token: token });
    }
    assert.equal(url, 'https://api.factory.ai/api/cli/whoami');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
    return response({ userId: 'factory-user', email: 'demo@example.com', orgId: 'factory-org', region: 'eu' });
  } });
  assert.equal(flow.userCode, 'USER-CODE'); assert.equal(flow.expiresAt, 601000);
  assert.equal(JSON.stringify(flow).includes('private-device'), false);
  assert.equal(await flow.poll(), null); assert.equal(await flow.poll(), null); assert.equal(flow.intervalSeconds, 3);
  const account = await flow.poll(); assert.ok(account);
  const secret = JSON.parse(account.secret);
  assert.equal(secret.organizationId, 'factory-org'); assert.equal(secret.region, 'eu'); assert.equal(secret.management, 'static');
  flow.cancel();
});

test('expiry and abort prevent requests; unsupported protocols are explicit', async () => {
  let now = 0, calls = 0;
  const flow = await createPriorityLogin('cursor', { now: () => now, fetch: async () => { calls++; return response({}); } });
  now = flow.expiresAt;
  await assert.rejects(flow.poll(), { code: 'EXPIRED' }); assert.equal(calls, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createPriorityLogin('devin', { now: () => 0, fetch, signal: controller.signal }), { code: 'CANCELLED' });
  for (const provider of ['opencode-go', 'kimi-work', 'kimi-code', 'grok-build']) {
    await assert.rejects(createPriorityLogin(provider, { now: () => 0, fetch: async () => { throw Error('must not fetch'); } }), { code: 'UNSUPPORTED' });
  }
});

test('concurrent polls share one exchange and cancellation aborts an active request', async () => {
  let calls = 0;
  const flow = await createPriorityLogin('cursor', { now: () => 0, fetch: async (_input, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  } });
  const first = flow.poll(), second = flow.poll();
  assert.equal(first, second); assert.equal(calls, 1);
  flow.cancel();
  await assert.rejects(first, { code: 'CANCELLED' });
});
