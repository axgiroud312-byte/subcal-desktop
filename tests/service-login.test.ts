import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, createPublicKey, generateKeyPairSync, publicEncrypt } from 'node:crypto';
import { createServiceLogin, SERVICE_LOGIN_PROVIDERS } from '../src/main/login/service-login';
import { parseZCodeCredential, ZCodeTeamAdapter } from '../src/main/adapters/zcode-adapter';
import { MimoTokenPlanAdapter } from '../src/main/adapters/regional-adapters';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function mock(steps: ((url: string, init: RequestInit) => Response | Promise<Response>)[]) {
  const calls: string[] = [];
  const fetch = (async (url, init) => { calls.push(String(url)); const step = steps.shift(); assert.ok(step, 'unexpected outbound request'); return step(String(url), init || {}); }) as typeof globalThis.fetch;
  return { fetch, calls, remaining: () => steps.length };
}
const secret = (c: { secret: string } | null) => { assert.ok(c); return JSON.parse(c.secret); };

test('Cline: bounded pending/slow_down, WorkOS registration, private static envelope', async () => {
  let now = 1_000;
  const m = mock([
    (url, init) => { assert.equal(url, 'https://api.workos.com/user_management/authorize/device'); assert.match(String(init.body), /client_01K3A541/); return json({ device_code: 'private-device', user_code: 'ABCD', verification_uri: 'https://authkit.app/device', interval: 1 }); },
    () => json({ error: 'authorization_pending' }, 400),
    () => json({ error: 'slow_down' }, 400),
    () => json({ access_token: 'workos-private', refresh_token: 'refresh-private' }),
    (url, init) => { assert.equal(url, 'https://api.cline.bot/api/v1/auth/register'); assert.equal(JSON.parse(String(init.body)).accessToken, 'workos-private'); return json({ success: true, data: { accessToken: 'cline-private', userInfo: { clineUserId: 'user-one' } } }); },
  ]);
  const flow = await createServiceLogin('cline', { fetch: m.fetch, now: () => now });
  try {
    assert.equal(flow.userCode, 'ABCD'); assert.doesNotMatch(JSON.stringify(flow), /private/);
    assert.equal(await flow.poll(), null); assert.equal(await flow.poll(), null); assert.equal(m.calls.length, 2);
    now += 1000; assert.equal(await flow.poll(), null); assert.equal(flow.intervalSeconds, 2);
    now += 2000; const c = await flow.poll(); const e = secret(c);
    assert.equal(e.accessToken, 'workos:cline-private'); assert.equal(e.management, 'static'); assert.equal(e.userId, 'user-one');
    assert.doesNotMatch(c!.secret, /refresh-private|workos-private/); assert.equal(m.remaining(), 0);
    assert.equal(await flow.poll(), c); assert.doesNotMatch(JSON.stringify(flow), /private/);
  } finally { flow.cancel(); }
});

test('OpenDesign preserves control key, not runtime key; denial is terminal', async () => {
  let now = 10;
  const m = mock([() => json({ deviceId: 'device', deviceSecret: 'private', activationUrl: 'https://open-design.ai/activate' }), () => json({ status: 'pending' }), () => json({ controlKey: 'vela_ctrl_private', runtimeKey: 'runtime-private', user: { id: 'u' } })]);
  const flow = await createServiceLogin('opendesign', { fetch: m.fetch, now: () => now });
  try { assert.equal(await flow.poll(), null); now += 2000; const c = await flow.poll(); assert.equal(secret(c).controlKey, 'vela_ctrl_private'); assert.doesNotMatch(c!.secret, /runtime-private/); } finally { flow.cancel(); }
  const denied = mock([() => json({ deviceId: 'd', deviceSecret: 's', activationUrl: 'https://open-design.ai/activate' }), () => json({ status: 'denied', message: 'SECRET' })]);
  const f = await createServiceLogin('opendesign', { fetch: denied.fetch, now: Date.now });
  await assert.rejects(f.poll(), e => !String(e).includes('SECRET')); await assert.rejects(f.poll(), /取消|过期/);
});

test('CommandCode accepts only matching state, rejects replay, closes callback on completion', async () => {
  const m = mock([]); let now = Date.now();
  const f = await createServiceLogin('commandcode', { fetch: m.fetch, now: () => now });
  const auth = new URL(f.url), callback = auth.searchParams.get('callback')!, state = auth.searchParams.get('state')!;
  const send = (data: unknown) => globalThis.fetch(callback, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://commandcode.ai' }, body: JSON.stringify(data) });
  try {
    assert.equal(new URL(callback).hostname, '127.0.0.1'); assert.equal(await f.poll(), null);
    assert.equal((await send({ state: 'bad', apiKey: 'private' })).status, 403);
    assert.equal((await send({ state, apiKey: 'private', userId: 'u' })).status, 200);
    assert.equal((await send({ state, apiKey: 'attacker' })).status, 409);
    now += 2000; assert.equal(secret(await f.poll()).accessToken, 'private');
    await assert.rejects(globalThis.fetch(callback)); assert.equal(m.calls.length, 0);
  } finally { f.cancel(); }
});

test('Raccoon rejects missing/duplicate state; exchange runs in poll and never exposes tokens in callback', async () => {
  const m = mock([(url, init) => { assert.match(url, /login_with_authorization_code$/); assert.deepEqual(JSON.parse(String(init.body)), { authorization_code: 'code' }); return json({ data: { access_token: 'private-access', refresh_token: 'private-refresh' } }); }]);
  const f = await createServiceLogin('raccoon', { fetch: m.fetch, now: Date.now });
  const auth = new URL(f.url), callback = auth.searchParams.get('redirect')!, state = auth.searchParams.get('state')!;
  try {
    assert.match(state, /^[0-9a-f]{64}$/);
    assert.equal((await fetch(callback + '?code=code')).status, 403);
    assert.equal((await fetch(callback + '?code=code&state=' + state + '&state=' + state)).status, 403);
    const r = await fetch(callback + '?' + new URLSearchParams({ state, code: 'code' })); assert.equal(r.status, 200); assert.doesNotMatch(await r.text(), /private/);
    assert.equal(m.calls.length, 0); const c = await f.poll(); assert.equal(secret(c).accessToken, 'private-access'); assert.doesNotMatch(c!.secret, /private-refresh/);
  } finally { f.cancel(); }
});

test('Cancellation/abort/expiry close loopback listeners and reject further polls', async () => {
  for (const action of ['cancel', 'abort', 'expire']) {
    let now = Date.now(); const ac = new AbortController();
    const f = await createServiceLogin('raccoon', { fetch: mock([]).fetch, now: () => now, signal: ac.signal });
    const callback = new URL(f.url).searchParams.get('redirect')!;
    if (action === 'cancel') f.cancel(); else if (action === 'abort') ac.abort(); else now = f.expiresAt;
    await assert.rejects(f.poll(), /取消|过期/); await assert.rejects(fetch(callback));
  }
});

test('ZCode gift has its own JWT/device and does not mint keys, claim rewards or load models', async () => {
  const m = mock([
    (url, init) => { assert.match(url, /oauth\/cli\/init$/); assert.equal(JSON.parse(String(init.body)).provider, 'zai'); return json({ code: 0, data: { flow_id: 'f', authorize_url: 'https://z.ai/authorize' } }); },
    (url, init) => { assert.match(url, /oauth\/cli\/poll\/f$/); assert.ok(new Headers(init.headers).get('X-Device-Mid')); return json({ code: 0, data: { status: 'ready', token: 'gift-private', user: { user_id: 'u' } } }); },
  ]);
  const f = await createServiceLogin('zcode-gift', { fetch: m.fetch, now: Date.now });
  try { const e = secret(await f.poll()); assert.equal(e.jwt, 'gift-private'); assert.equal(e.site, 'zai'); assert.ok(e.device); assert.equal(e.management, 'static'); assert.equal(m.calls.length, 2); } finally { f.cancel(); }
});

test('ZCode team keeps business token and project context without creating API keys', async () => {
  let now = Date.now();
  const m = mock([
    () => json({ code: 0, data: { flow_id: 'f', authorize_url: 'https://bigmodel.cn/authorize' } }),
    () => json({ code: 0, data: { status: 'ready', bigmodel: { accessToken: 'business-private' }, user: { user_id: 'u' } } }),
    (url, init) => { assert.equal(url, 'https://bigmodel.cn/api/biz/customer/getCustomerInfo'); assert.equal(new Headers(init.headers).get('Authorization'), 'business-private'); return json({ code: 0, data: { organizations: [{ organizationId: 'org', projects: [{ projectType: 2, projectId: 'project' }] }] } }); },
    (url, init) => { assert.match(url, /querySubscribeDetail$/); assert.equal(new Headers(init.headers).get('Bigmodel-Project'), 'project'); return json({ code: 0, data: { status: 'EFFECTIVE', memberGrantStatus: 'VALID' } }); },
  ]);
  const f = await createServiceLogin('zcode-team-cn', { fetch: m.fetch, now: () => now });
  try {
    assert.equal(await f.poll(), null); now += 2000; const c = await f.poll(), e = secret(c); assert.equal(e.org, 'org'); assert.equal(e.project, 'project'); assert.equal(e.token, 'business-private'); assert.equal(e.key, undefined);
    assert.equal(parseZCodeCredential(c!.secret, 'zcode-team-cn').key, '');
    const paths: string[] = [];
    const adapter = new ZCodeTeamAdapter('cn', async (url, init) => {
      paths.push(new URL(url).pathname); assert.equal(init.headers.Authorization, 'business-private');
      return json({ code: 0, data: url.includes('querySubscribeDetail') ? { hasSubscription: true, status: 'EFFECTIVE', memberGrantStatus: 'VALID', productName: 'Team' } : { fiveHourResets: [], weekResets: [] } });
    });
    const input = { connectionId: 'test', generation: 1, reason: 'manual' as const, secret: c!.secret, expectedSubject: c!.subject };
    assert.equal((await adapter.collect(input)).account.subject, c!.subject);
    assert.equal((await adapter.collect(input)).account.subject, c!.subject);
    assert.ok(paths.every(p => !p.includes('/quota/')));
    await assert.rejects(adapter.collect({ ...input, secret: JSON.stringify({ ...e, project: 'other-project' }) }), /账号、组织或项目已改变/);
  } finally { f.cancel(); }
});

test('MiMo browser ticket and isolated cookies: each redirect advances one poll', async () => {
  let now = 1000;
  const m = mock([
    () => new Response(null, { status: 302, headers: { location: 'https://account.xiaomi.com/pass/serviceLogin?sid=mimosgp&callback=https%3A%2F%2Fmimo-server-sgp.xiaomimimo.com%2Fapi%2Fsts' } }),
    () => new Response('&&&START&&&' + JSON.stringify({ code: 0, loginUrl: 'https://account.xiaomi.com/login/ticket', lp: 'https://account.xiaomi.com/longPolling/ticket' })),
    () => json({ passToken: 'xiaomi-private', userId: 'user' }),
    (url, init) => { assert.doesNotMatch(new Headers(init.headers).get('Cookie') || '', /xiaomi-private/); return new Response(null, { status: 302, headers: { location: 'https://account.xiaomi.com/pass/serviceLogin' } }); },
    (url, init) => { assert.match(new Headers(init.headers).get('Cookie') || '', /passToken=xiaomi-private/); return new Response(null, { status: 302, headers: { location: 'https://mimo-server-sgp.xiaomimimo.com/api/sts' } }); },
    (url, init) => { assert.doesNotMatch(new Headers(init.headers).get('Cookie') || '', /xiaomi-private/); return new Response(null, { status: 302, headers: { location: '/api/user/xiaomi/me', 'Set-Cookie': 'serviceToken=session-private; Path=/; Secure' } }); },
    (url, init) => { assert.equal(new Headers(init.headers).get('Cookie'), 'serviceToken=session-private'); return json({ code: 0, data: { userId: 'user', region: 'SGP' } }); },
  ]);
  const f = await createServiceLogin('mimo-app-sgp', { fetch: m.fetch, now: () => now });
  try {
    for (let i = 0; i < 4; i++) { assert.equal(await f.poll(), null); now += 2000; }
    const c = await f.poll(); assert.equal(secret(c).cookiesByPath['/api/user/usage'], 'serviceToken=session-private'); assert.equal(secret(c).region, 'mimo-server-sgp.xiaomimimo.com'); assert.doesNotMatch(c!.secret, /xiaomi-private/);
    assert.equal(m.remaining(), 0);
  } finally { f.cancel(); }
});

test('AutoClaw loopback captcha/Google state exchange uses registered port and signed endpoints', async () => {
  const m = mock([
    (url, init) => { assert.match(url, /oauth-captcha-config$/); assert.ok(new Headers(init.headers).get('X-Auth-Sign')); return json({ code: 0, data: { enabled: false } }); },
    (url, init) => { assert.match(url, /google-oauth-url$/); assert.match(JSON.parse(String(init.body)).navigate_uri, /^http:\/\/localhost:(18432|19654|19723|53699)\/auth\/callback-google$/); return json({ code: 0, data: { oauth_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=upstream-state' } }); },
    (url, init) => { assert.match(url, /google-oauth-login$/); assert.equal(JSON.parse(String(init.body)).state, 'upstream-state'); return json({ code: 0, data: { access_token: 'autoclaw-private', user_id: 'u' } }); },
  ]);
  const f = await createServiceLogin('autoclaw', { fetch: m.fetch, now: Date.now });
  const guide = new URL(f.url), local = guide.origin;
  const ask = (path: string) => fetch(local + path + guide.search, { method: 'POST', headers: { Origin: local, 'Content-Type': 'application/json' }, body: '{}' });
  try {
    assert.equal((await fetch(f.url)).status, 200);
    assert.equal((await fetch(local + '/captcha-config', { method: 'POST' })).status, 403);
    assert.equal((await ask('/captcha-config')).status, 200);
    assert.equal((await ask('/open-auth')).status, 200);
    assert.equal((await fetch(local + '/auth/callback-google?code=code&state=wrong')).status, 403);
    assert.equal((await fetch(local + '/auth/callback-google?code=code&state=upstream-state')).status, 200);
    assert.equal(secret(await f.poll()).accessToken, 'autoclaw-private'); await assert.rejects(fetch(f.url));
  } finally { f.cancel(); }
});

test('Unproven flows are not advertised or simulated', async () => {
  for (const id of ['stepfun-plan-com', 'stepfun-plan-ai', 'gemini-cli', 'antigravity']) {
    assert.ok(!SERVICE_LOGIN_PROVIDERS.includes(id));
    await assert.rejects(createServiceLogin(id, { fetch: mock([]).fetch, now: Date.now }), /尚无/);
  }
});

test('Concurrent device polls share one request; transient network errors remain pending', async () => {
  let now = 1000; let resolve: ((r: Response) => void) | undefined;
  const m = mock([
    () => json({ deviceId: 'd', deviceSecret: 's', activationUrl: 'https://open-design.ai/activate' }),
    () => new Promise<Response>(r => { resolve = r; }),
    () => { throw new Error('private-network-detail'); },
    () => json({ controlKey: 'vela_ctrl_key', runtimeKey: 'runtime', user: { id: 'u' } }),
  ]);
  const f = await createServiceLogin('opendesign', { fetch: m.fetch, now: () => now });
  try {
    const a = f.poll(), b = f.poll(); assert.equal(a, b); assert.equal(m.calls.length, 2);
    resolve!(json({ status: 'pending' })); assert.equal(await a, null);
    now += 2000; assert.equal(await f.poll(), null);
    now += 2000; assert.equal(secret(await f.poll()).management, 'static');
  } finally { f.cancel(); }
});

test('Abort during token request prevents late credential commit', async () => {
  const ac = new AbortController(); let resolve: ((r: Response) => void) | undefined;
  const m = mock([() => json({ deviceId: 'd', deviceSecret: 's', activationUrl: 'https://open-design.ai/activate' }),
    (_url, init) => { assert.ok(init.signal); return new Promise<Response>(r => { resolve = r; }); }]);
  const f = await createServiceLogin('opendesign', { fetch: m.fetch, now: Date.now, signal: ac.signal });
  const pending = f.poll(); ac.abort(); resolve!(json({ controlKey: 'vela_ctrl_private', runtimeKey: 'private' }));
  await assert.rejects(pending, /取消|过期/); assert.doesNotMatch(JSON.stringify(f), /private/);
});

test('MiMo refuses off-provider redirects without sending Xiaomi cookies', async () => {
  const m = mock([() => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/?private=secret' } })]);
  await assert.rejects(createServiceLogin('mimo-app-sgp', { fetch: m.fetch, now: Date.now }), e => !String(e).includes('secret'));
  assert.equal(m.calls.length, 1);
});

test('Zed native RSA callback rejects another flow key, accepts OAEP and legacy v1.5, verifies account', async () => {
  for (const padding of [constants.RSA_PKCS1_OAEP_PADDING, constants.RSA_PKCS1_PADDING]) {
    const m = mock([(url, init) => { assert.equal(url, 'https://cloud.zed.dev/client/users/me'); assert.equal(new Headers(init.headers).get('Authorization'), '42 zed-private'); assert.ok(new Headers(init.headers).get('x-zed-system-id')); return json({ user: { legacy_user_id: 42, github_login: 'user' } }); }]);
    const f = await createServiceLogin('zed', { fetch: m.fetch, now: Date.now });
    const auth = new URL(f.url), callback = 'http://127.0.0.1:' + auth.searchParams.get('native_app_port') + '/native-callback';
    const key = createPublicKey({ key: Buffer.from(auth.searchParams.get('native_app_public_key')!, 'base64url'), type: 'pkcs1', format: 'der' });
    const encrypt = (pub: typeof key) => publicEncrypt({ key: pub, padding, oaepHash: 'sha256' }, Buffer.from('zed-private')).toString('base64url');
    try {
      assert.equal(auth.searchParams.has('state'), false);
      const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
      assert.equal((await fetch(callback + '?' + new URLSearchParams({ user_id: '42', access_token: encrypt(wrong) }))).status, 400);
      assert.equal((await fetch(callback + '?' + new URLSearchParams({ user_id: '42', access_token: encrypt(key) }))).status, 200);
      assert.equal((await fetch(callback + '?' + new URLSearchParams({ user_id: '42', access_token: encrypt(key) }))).status, 409);
      const e = secret(await f.poll()); assert.equal(e.userId, '42'); assert.equal(e.accessToken, 'zed-private'); assert.equal(e.management, 'static');
      await assert.rejects(fetch(callback)); assert.equal(m.remaining(), 0);
    } finally { f.cancel(); }
  }
});

test('AutoClaw CN local SMS form validates origin/nonce, retries invalid code, never returns tokens', async () => {
  let now = Date.now();
  const m = mock([
    (url, init) => { assert.equal(url, 'https://autoglm-api.zhipuai.cn/userapi/v1/agent-send-code'); assert.equal(JSON.parse(String(init.body)).phone, '13800138000'); return json({ code: 0, data: {} }); },
    () => json({ code: 100, msg: 'private-rejected-code' }),
    (url, init) => { assert.match(url, /agent-login\/$/); assert.equal(JSON.parse(String(init.body)).code, '123456'); return json({ code: 0, data: { access_token: 'cn-private-token', refresh_token: 'cn-private-refresh', user_id: 'user-cn' } }); },
  ]);
  const f = await createServiceLogin('autoclaw-cn', { fetch: m.fetch, now: () => now }); const u = new URL(f.url);
  const send = (path: string, data: unknown, origin = u.origin) => fetch(u.origin + path + u.search, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    assert.match(await (await fetch(f.url)).text(), /短信验证码/);
    assert.equal(await f.poll(), null);
    assert.equal((await send('/send-code', { phone: '13800138000' }, 'https://attacker.invalid')).status, 403);
    assert.equal((await fetch(u.origin + '/send-code', { method: 'POST' })).status, 403);
    assert.equal((await send('/send-code', { phone: 'not-phone' })).status, 400);
    assert.equal((await send('/send-code', { phone: '13800138000' })).status, 200);
    assert.equal((await send('/send-code', { phone: '13800138000' })).status, 429);
    const bad = await send('/login', { code: '000000' }); assert.equal(bad.status, 400); assert.doesNotMatch(await bad.text(), /private/);
    const good = await send('/login', { code: '123456' }); assert.equal(good.status, 200); assert.doesNotMatch(await good.text(), /private|13800138000/);
    now += 2000; const c = await f.poll(); assert.equal(secret(c).accessToken, 'cn-private-token'); assert.doesNotMatch(c!.secret, /cn-private-refresh|13800138000|123456/);
    await assert.rejects(fetch(f.url));
  } finally { f.cancel(); }
});

test('MiMo platform persists Path=/api and endpoint-specific cookies through adapter collection', async () => {
  let now = 1000;
  const m = mock([
    () => new Response(null, { status: 302, headers: { location: 'https://account.xiaomi.com/pass/serviceLogin' } }),
    () => json({ code: 0, loginUrl: 'https://account.xiaomi.com/login', lp: 'https://account.xiaomi.com/longPolling/ticket' }),
    () => json({ passToken: 'xiaomi-private', userId: 'user' }),
    () => json({ loginUrl: 'https://account.xiaomi.com/pass/serviceLogin?sid=api-platform' }, 401),
    () => new Response(null, { status: 302, headers: { location: 'https://platform.xiaomimimo.com/sts' } }),
    () => { const headers = new Headers({ location: '/api/v1/tokenPlan/detail' }); headers.append('Set-Cookie', 'platformSession=api-private; Path=/api; Secure'); headers.append('Set-Cookie', 'detailOnly=detail-private; Path=/api/v1/tokenPlan/detail; Secure'); return new Response(null, { status: 302, headers }); },
    () => json({ code: 0, data: { planName: 'Pro', expired: false } }),
  ]);
  const f = await createServiceLogin('mimo-token-plan', { fetch: m.fetch, now: () => now });
  try {
    for (let i = 0; i < 4; i++) { assert.equal(await f.poll(), null); now += 2000; }
    const c = await f.poll(), e = secret(c);
    assert.match(e.cookiesByPath['/api/v1/tokenPlan/detail'], /detailOnly=detail-private/);
    assert.equal(e.cookiesByPath['/api/v1/tokenPlan/usage'], 'platformSession=api-private'); assert.equal(e.cookie, undefined);
    const seen: string[] = [];
    const adapter = new MimoTokenPlanAdapter(async (url, init) => {
      const path = new URL(url).pathname; seen.push(path); assert.equal(init.headers.Cookie, e.cookiesByPath[path]);
      return json({ code: 0, data: path.endsWith('detail') ? { planName: 'Pro', expired: false } : { monthUsage: { items: [{ name: 'month_total_token', used: 1, limit: 100 }] } } });
    });
    assert.equal((await adapter.collect({ connectionId: 'mimo-test', generation: 1, reason: 'manual', secret: c!.secret, expectedSubject: c!.subject })).account.subject, c!.subject);
    assert.equal(seen.length, 2);
  } finally { f.cancel(); }
});
