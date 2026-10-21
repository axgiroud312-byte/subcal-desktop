/** Main-process only. Login protocol extraction from magpie-community/plugins
 * aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6 (MIT, © 2026 contributors).
 * No plugin runtime, model hooks, external credential files or refresh hooks. */
import { createHash, randomBytes, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AccountCredential } from '../account-access';
import type { LoginFlow, LoginOptions } from './types';

type Obj = Record<string, any>;
const obj = (x: unknown): Obj => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const text = (x: unknown) => typeof x === 'string' ? x : '';
const random = () => randomBytes(32).toString('base64url');
const digest = (x: string) => createHash('sha256').update(x).digest('base64url');
const failure = (message: string): never => { throw new Error(message); };
export const DESKTOP_LOGIN_PROVIDERS = ['kiro-us-east-1', 'kiro-eu-central-1', 'qoder', 'qoder-cn', 'workbuddy', 'workbuddy-ai', 'minimax-code', 'minimax-code-global', 'trae-cn', 'trae-global-sg', 'trae-global-us', 'codearts'] as const;

function credential(providerId: string, a: Obj): AccountCredential {
  const subject = `${providerId}:${digest(JSON.stringify([a.region, a.uid || a.accountId || a.access || a.access_key_id, a.enterpriseId || '', a.profileArn || '']))}`;
  const alias = text(a.name) || providerId;
  return { providerId, subject, alias, organization: text(a.enterpriseId), source: 'desktop-login', secret: JSON.stringify({ ...a, type: 'oauth', provider: providerId, subject, alias, source: 'desktop-login', management: 'static', accessToken: a.access, expiresAt: a.expiresAt ?? a.expires }) };
}
function https(value: unknown): string {
  const u = new URL(text(value));
  if (u.protocol !== 'https:' || u.username || u.password) failure('登录地址无效');
  return u.toString();
}

class Context {
  readonly controller = new AbortController();
  expiresAt: number;
  intervalSeconds = 2;
  cleanups: (() => void)[] = [];
  result: AccountCredential | null = null;
  error: Error | null = null;
  pending: Promise<AccountCredential | null> | null = null;
  constructor(readonly id: string, readonly options: LoginOptions) {
    this.expiresAt = options.now() + 600_000;
    const abort = () => this.cancel();
    options.signal?.addEventListener('abort', abort, { once: true });
    this.cleanups.push(() => options.signal?.removeEventListener('abort', abort));
    const timer = setTimeout(abort, 600_000); timer.unref();
    this.cleanups.push(() => clearTimeout(timer));
    if (options.signal?.aborted) this.cancel();
  }
  cancel = () => { this.controller.abort(); this.close(); this.result = null; };
  close() { this.cleanups.splice(0).forEach(fn => fn()); }
  check() { if (this.controller.signal.aborted) failure('登录已取消'); if (this.options.now() >= this.expiresAt) { this.cancel(); failure('登录已过期，请重试'); } }
  async request(url: string, body?: Obj | URLSearchParams, headers: Record<string, string> = {}) {
    this.check();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]);
    // Also race the injected fetch/body reader: every poll stays bounded even
    // when a transport fails to implement AbortSignal.
    let abort: () => void = () => {};
    const stopped = new Promise<never>((_, reject) => { abort = () => reject(new Error('登录请求取消或超时')); signal.addEventListener('abort', abort, { once: true }); });
    try {
      return await Promise.race([stopped, (async () => {
        const r = await this.options.fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal,
          headers: { Accept: 'application/json', ...(body ? { 'Content-Type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...headers },
          body: body ? body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) : undefined });
        const raw = await r.text(); this.check();
        if (raw.length > 1024 * 1024) failure('登录响应过大');
        let data: Obj; try { data = raw ? obj(JSON.parse(raw)) : {}; } catch { return failure('登录响应格式无效'); }
        return { status: r.status, ok: r.ok, data };
      })()]);
    } catch { this.check(); return failure('登录请求失败，请重试'); }
    finally { signal.removeEventListener('abort', abort); }
  }
  async json(url: string, body?: Obj | URLSearchParams, headers?: Record<string, string>) {
    const r = await this.request(url, body, headers); if (!r.ok) failure(`登录服务拒绝请求（${r.status}）`); return r.data;
  }
  flow(url: string, step: () => Promise<AccountCredential | null>, userCode?: string): LoginFlow {
    const c = this;
    const expiryTimer = setTimeout(c.cancel, Math.max(1, c.expiresAt - c.options.now())); expiryTimer.unref();
    c.cleanups.push(() => clearTimeout(expiryTimer));
    return { url, userCode, instructions: '在浏览器完成授权后返回本应用。', get expiresAt() { return c.expiresAt; }, get intervalSeconds() { return c.intervalSeconds; }, cancel: c.cancel,
      poll() {
        c.check(); if (c.error) return Promise.reject(c.error); if (c.result) return Promise.resolve(c.result);
        if (c.pending) return c.pending;
        c.pending = step().then(value => { c.check(); if (value) { c.result = value; c.close(); } return value; }).finally(() => { c.pending = null; });
        return c.pending;
      } };
  }
}

async function minimax(c: Context) {
  const host = c.id === 'minimax-code' ? 'https://account.minimax.cn' : 'https://account.minimax.io';
  const verifier = random();
  const d = await c.json(host + '/oauth2/device/code', new URLSearchParams({ client_id: 'mcode-public', scope: 'agent.default', audience: 'agent-backend', code_challenge: digest(verifier), code_challenge_method: 'S256' }));
  const byUser = !d.device_code && d.user_code && Number(d.expired_in) > 0;
  if (!d.user_code || !(d.device_code || byUser)) failure('设备授权响应缺少代码');
  const duration = Number(d.expires_in) || (Number(d.expired_in) >= 1e12 ? (Number(d.expired_in) - c.options.now()) / 1000 : Number(d.expired_in)) || 600;
  c.expiresAt = c.options.now() + duration * 1000;
  c.intervalSeconds = Math.max(1, byUser ? Number(d.interval || 5000) / 1000 : Number(d.interval || 5));
  return c.flow(https(d.verification_uri_complete || d.verification_uri || d.verification_url), async () => {
    const r = await c.request(host + '/oauth2/token', new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: 'mcode-public', code_verifier: verifier, [byUser ? 'user_code' : 'device_code']: byUser ? d.user_code : d.device_code }));
    const b = r.data, status = b.error || b.status;
    if (['authorization_pending', 'pending'].includes(status)) return null;
    if (status === 'slow_down') { c.intervalSeconds += 5; return null; }
    if (!r.ok || !b.access_token || !(Number(b.expires_in) > 0)) failure('设备授权被拒绝或已过期');
    return credential(c.id, { access: b.access_token, refresh: b.refresh_token, expires: c.options.now() + b.expires_in * 1000, region: c.id === 'minimax-code' ? 'cn' : 'en' });
  }, d.user_code);
}

async function qoder(c: Context) {
  const cn = c.id === 'qoder-cn', host = cn ? 'https://openapi.qoder.com.cn' : 'https://openapi.qoder.sh';
  const verifier = random(), nonce = randomUUID(), machineId = randomUUID();
  const q = new URLSearchParams({ challenge: digest(verifier), challenge_method: 'S256', nonce, machine_id: machineId, client_id: cn ? 'e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb' : '732aef47-9cf2-46a2-95fe-4cebb5d0d1fa' });
  return c.flow(`${cn ? 'https://qoder.cn' : 'https://qoder.com'}/device/selectAccounts?${q}`, async () => {
    const r = await c.request(`${host}/api/v1/deviceToken/poll?${new URLSearchParams({ nonce, verifier, challenge_method: 'S256' })}`, undefined, { 'User-Agent': 'Qoder', 'Cosy-ClientType': '10' });
    if ([202, 204, 400, 404, 408, 429].includes(r.status) || r.ok && !r.data.token) return null;
    if (!r.ok || !r.data.token) failure('Qoder 授权失败');
    // Usage requires the device token. Do not create a model job token.
    const absoluteExpiry = Date.parse(String(r.data.expires_at ?? ''));
    const expiresAt = Number.isFinite(absoluteExpiry) ? absoluteExpiry : Number(r.data.expires_in)>0 ? c.options.now()+Number(r.data.expires_in)*1000 : undefined;
    return credential(c.id, { access: r.data.token, deviceToken: r.data.token, deviceRefresh: r.data.refresh_token, machineId, uid: String(r.data.user_id || ''), region: new URL(host).host, ...(expiresAt ? { expiresAt } : {}) });
  });
}

async function workbuddy(c: Context) {
  const host = c.id === 'workbuddy' ? 'https://copilot.tencent.com' : 'https://www.workbuddy.ai';
  const call = async (path: string, body?: Obj, headers?: Record<string, string>, pending: number[] = []) => {
    const r = await c.request(host + path, body, { 'User-Agent': 'WorkBuddy/5.5.6', ...headers });
    if ([408, 429].includes(r.status) || pending.includes(Number(r.data.code))) return null;
    if (!r.ok || Number(r.data.code || 0)) failure('WorkBuddy 登录请求失败'); return obj(r.data.data);
  };
  const d = await call(`/v2/plugin/auth/state?platform=${c.id}`, {}, { 'X-No-Authorization': 'true', 'X-No-User-Id': 'true', 'X-No-Enterprise-Id': 'true', 'X-No-Department-Info': 'true' });
  if (!d?.state || !d.authUrl) failure('WorkBuddy 未返回登录地址');
  const u = new URL(https(d!.authUrl)); u.searchParams.set('version', '2.0.0'); u.searchParams.set('loginSessionId', randomBytes(16).toString('hex'));
  let token: Obj | null = null;
  return c.flow(u.toString(), async () => {
    const q = encodeURIComponent(d!.state);
    token ??= await call(`/v2/plugin/auth/token?state=${q}`, undefined, {}, [11217]);
    if (!token?.accessToken) { token = null; return null; }
    const who = await call(`/v2/plugin/login/account?state=${q}`, undefined, { Authorization: `Bearer ${token.accessToken}`, 'X-Domain': token.domain || new URL(host).host, 'X-No-User-Id': 'true', 'X-No-Enterprise-Id': 'true' }, [12151]);
    if (!who?.uid) return null;
    if (!who.enterpriseId && who.type && String(who.type).toLowerCase() !== 'personal') {
      const accounts = await call('/v2/plugin/accounts', undefined, { Authorization: `Bearer ${token.accessToken}`, 'X-Domain': token.domain || new URL(host).host });
      const mine = (Array.isArray(accounts?.accounts) ? accounts.accounts : []).filter((a: Obj) => a.uid === who.uid && a.enterpriseId);
      const same = mine.filter((a: Obj) => String(a.type).toLowerCase() === String(who.type).toLowerCase()), last = mine.filter((a: Obj) => a.lastLogin);
      const pick = same.length === 1 ? same[0] : last.length === 1 ? last[0] : mine.length === 1 ? mine[0] : null;
      if (!pick) failure('WorkBuddy 企业账号归属不唯一，请重新授权');
      who.enterpriseId = pick.enterpriseId;
    }
    return credential(c.id, { ...token, access: token.accessToken, refresh: token.refreshToken, expires: token.expiresAt || (token.expiresIn ? c.options.now() + token.expiresIn * 1000 : undefined), uid: String(who.uid), enterpriseId: String(who.enterpriseId || ''), name: who.nickname, region: new URL(host).host });
  });
}

/** Strict loopback and Host checks; callbacks are never arbitrary destinations. */
async function callbackServer(c: Context, handler: (url: URL, res: ServerResponse) => Promise<void>, ports = [0]) {
  for (const port of ports) {
    const server = createServer((req: IncomingMessage, res) => {
      const localPort = (server.address() as { port: number }).port;
      if (req.socket.remoteAddress !== '127.0.0.1' || ![`127.0.0.1:${localPort}`, `localhost:${localPort}`].includes(req.headers.host || '') || !req.url?.startsWith('/') || req.url.startsWith('//')) { res.writeHead(403).end(); return; }
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      if (c.id.startsWith('trae-')) {
        const origin = c.id === 'trae-cn' ? 'https://www.trae.cn' : 'https://www.trae.ai';
        if (req.headers.origin && req.headers.origin !== origin) { res.writeHead(403).end(); return; }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      }
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      void (async () => { c.check(); await handler(new URL(req.url!, `http://127.0.0.1:${localPort}`), res); })().catch(() => { c.error = new Error('浏览器登录失败，请重新开始'); res.writeHead(400).end('Login failed'); c.close(); });
    });
    const ok = await new Promise<boolean>(resolve => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
    if (!ok) continue;
    c.cleanups.push(() => { server.close(); server.closeAllConnections(); });
    return (server.address() as { port: number }).port;
  }
  return failure('本地登录回调端口不可用');
}

async function kiro(c: Context) {
  const state = random(), verifier = random(), region = c.id.slice(5);
  const scopes = ['completions', 'analysis', 'conversations', 'transformations', 'taskassist'].map(x => 'codewhisperer:' + x);
  let aws: Obj | null = null, busy = false;
  const port = await callbackServer(c, async (u, res) => {
    if (!['/oauth/callback', '/signin/callback'].includes(u.pathname)) { res.writeHead(404).end(); return; }
    const q = u.searchParams;
    if (q.get('state') !== (aws?.state || state)) { res.writeHead(403).end('Invalid state'); return; }
    if (busy) { res.writeHead(409).end(); return; } busy = true;
    try {
      if (q.has('error')) failure('登录被拒绝');
      let a: Obj;
      if (aws) {
        const t = await c.json(`https://oidc.${region}.amazonaws.com/token`, { clientId: aws.clientId, clientSecret: aws.clientSecret, grantType: 'authorization_code', redirectUri: `http://127.0.0.1:${port}/oauth/callback`, code: q.get('code'), codeVerifier: aws.verifier });
        a = { access: t.accessToken, refresh: t.refreshToken, expires: c.options.now() + Number(t.expiresIn || 3600) * 1000, method: 'idc', region, profileArn: t.profileArn || (aws.builderID ? 'arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX' : undefined) };
      } else {
        const opt = q.get('login_option');
        if (['builderid', 'awsidc', 'internal'].includes(opt || '')) {
          if (q.get('idc_region') !== region) failure('所选 Kiro 地区与登录地区不同');
          const issuer = https(q.get('issuer_url'));
          const r = await c.json(`https://oidc.${region}.amazonaws.com/client/register`, { clientName: 'Kiro IDE', clientType: 'public', scopes, grantTypes: ['authorization_code', 'refresh_token'], redirectUris: ['http://127.0.0.1/oauth/callback'], issuerUrl: issuer });
          if (!r.clientId) failure('AWS 未返回客户端');
          aws = { ...r, state: random(), verifier: random(), builderID: opt === 'builderid' };
          const params = new URLSearchParams({ response_type: 'code', client_id: aws.clientId, redirect_uri: `http://127.0.0.1:${port}/oauth/callback`, scopes: scopes.join(','), state: aws.state, code_challenge: digest(aws.verifier), code_challenge_method: 'S256' });
          res.writeHead(302, { Location: `https://oidc.${region}.amazonaws.com/authorize?${params}` }).end(); return;
        }
        if (!['google', 'github'].includes(opt || '') || !q.get('code')) failure('该 Kiro 登录方式不受支持');
        const t = await c.json('https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token', { code: q.get('code'), code_verifier: verifier, redirect_uri: `http://localhost:${port}${u.pathname}?login_option=${opt}` });
        a = { access: t.accessToken, refresh: t.refreshToken, expires: c.options.now() + Number(t.expiresIn || 3600) * 1000, method: 'social', region, profileArn: t.profileArn };
      }
      if (!a.access) failure('Kiro 未返回令牌');
      if (!a.profileArn) {
        const profiles = await c.json(`https://management.${region}.kiro.dev/List-Available-Profiles`, {}, { Authorization: `Bearer ${a.access}` });
        a.profileArn = profiles.profiles?.find((p: Obj) => p.arn)?.arn;
      }
      if (!a.profileArn || a.profileArn.split(':')[3] !== region) failure('Kiro 未返回所选地区的 profile');
      c.result = credential(c.id, a); res.end('Signed in. You can close this tab.'); c.close();
    } finally { busy = false; }
  }, [3128, 4649, 6588, 8008, 9091, 49153, 50153, 51153, 52153, 53153]);
  return c.flow(`https://app.kiro.dev/signin?${new URLSearchParams({ state, code_challenge: digest(verifier), code_challenge_method: 'S256', redirect_uri: `http://localhost:${port}`, redirect_from: 'KiroIDE' })}`, async () => c.result);
}

async function trae(c: Context) {
  const cn = c.id === 'trae-cn', state = random(), machineId = randomUUID();
  let busy = false;
  const deviceId = String(BigInt('0x' + randomBytes(8).toString('hex')) % 9000000000000000000n + 1000000000000000000n);
  const port = await callbackServer(c, async (u, res) => {
    if (u.pathname !== '/authorize') { res.writeHead(404).end(); return; }
    if (u.searchParams.get('state') !== state) { res.writeHead(403).end('Invalid state'); return; }
    if (busy) { res.writeHead(409).end(); return; } busy = true;
    let jwt = obj(JSON.parse(u.searchParams.get('userJwt') || '{}')), info = obj(JSON.parse(u.searchParams.get('userInfo') || '{}'));
    if (!jwt.Token && !jwt.token && u.searchParams.get('refreshToken')) {
      const host = cn ? 'https://api.trae.cn' : 'https://growsg-normal.trae.ai';
      const r = await c.json(host + '/cloudide/api/v3/trae/oauth/ExchangeToken', { ClientID: u.searchParams.get('clientId') || 'ono9krqynydwx5', RefreshToken: u.searchParams.get('refreshToken'), ClientSecret: '-', UserID: '' });
      jwt = obj(r.Result || r.result || r);
      const raw = jwt.UserInfo || jwt.userInfo;
      info = { ...obj(typeof raw === 'string' ? JSON.parse(raw) : raw), ...info };
    }
    const access = jwt.Token || jwt.token;
    if (!access) failure('Trae 回调未提供访问令牌');
    const region = cn ? 'CN' : text(info.region || info.aiRegion || info.Region || info.AIRegion).toUpperCase();
    if (!cn && !new RegExp(c.id.endsWith('-us') ? '^US(?:$|[-_ ])|^USA$' : '^SG(?:$|[-_ ])|^SGP$|^SINGAPORE$').test(region)) failure('Trae 回调地区与所选服务不一致');
    const uid = String(info.UserID || info.userId || u.searchParams.get('userId') || '');
    if (!uid) failure('Trae 回调缺少账号标识');
    const rawExpiry = jwt.TokenExpireAt || jwt.tokenExpireAt;
    const expires = Number(rawExpiry) > 0 ? Number(rawExpiry) * (Number(rawExpiry) < 1e12 ? 1000 : 1) : Date.parse(rawExpiry) || undefined;
    c.result = credential(c.id, { access, refresh: jwt.RefreshToken || jwt.refreshToken, expires, uid, name: info.ScreenName || info.screenName, region, deviceId, machineId, account: info, clientId: jwt.ClientID || 'ono9krqynydwx5' });
    res.end('Signed in. You can close this tab.'); c.close();
  });
  // State is inside the complete callback URL, not an assumed provider echo.
  const q = new URLSearchParams({ login_version: '1', auth_from: 'solo', login_channel: 'native_ide', plugin_version: cn ? '2.3.24254' : '2.3.62834', auth_type: 'local', client_id: 'ono9krqynydwx5', redirect: '0', login_trace_id: randomUUID(), auth_callback_url: `http://127.0.0.1:${port}/authorize?state=${state}`, machine_id: machineId, device_id: deviceId, x_device_id: deviceId, x_machine_id: machineId, x_device_brand: 'ASUS TUF Gaming A15 FA507RM_FA507RM', x_device_type: 'windows', x_os_version: 'Windows 10 Pro', x_env: '', x_app_version: cn ? '3.3.65' : '3.5.51', x_app_type: 'stable', hide_saas_login: 'false' });
  return c.flow(`https://www.trae.${cn ? 'cn' : 'ai'}/authorization?${q}`, async () => c.result);
}

async function codearts(c: Context) {
  const state = randomBytes(32).toString('hex'), verifier = random();
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const endpoint = 'https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens';
  let busy = false;
  const port = await callbackServer(c, async (u, res) => {
    if (u.pathname !== '/oauth/callback') { res.writeHead(404).end(); return; }
    // The pinned portal does not promise a state echo. Its authorization code
    // is instead bound to our private PKCE verifier and DPoP key by STS.
    // Reject an explicitly mismatched echo; never accept credentials until the
    // fixed STS endpoint verifies the code with that verifier.
    const echoedState = u.searchParams.get('ticket_id') || u.searchParams.get('state');
    if (echoedState && echoedState !== state) { res.writeHead(403).end('Invalid state'); return; }
    if (!u.searchParams.get('code')) { res.writeHead(400).end(); return; }
    if (busy) { res.writeHead(409).end(); return; } busy = true;
    const encode = (v: Obj) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const input = encode({ alg: 'ES256', typ: 'dpop+jwt', jwk: keys.publicKey.export({ format: 'jwk' }) }) + '.' + encode({ htm: 'POST', htu: endpoint, iat: Math.floor(c.options.now() / 1000), jti: randomBytes(32).toString('hex') });
    const proof = input + '.' + sign('sha256', Buffer.from(input), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const t = await c.json(endpoint, new URLSearchParams({ client_id: 'codearts-agent', code: u.searchParams.get('code')!, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${port}/oauth/callback` }), { DPoP: proof });
    const a = obj(t.credentials);
    if (!a.access_key_id || !a.secret_access_key || !a.security_token) failure('CodeArts 返回的 STS 凭据不完整');
    c.result = credential(c.id, { ...a, expires_at: a.expiration, expiresAt: a.expiration, region: 'cn-north-4' });
    res.end('Signed in. You can close this tab.'); c.close();
  });
  c.expiresAt = c.options.now() + 180_000;
  return c.flow(`https://codearts.huaweicloud.com/portal/authorize?${new URLSearchParams({ theme: '2', locale: 'zh-cn', uri_scheme: 'codearts-agent', client_id: 'codearts-agent', port: String(port), code_challenge: digest(verifier), code_challenge_method: 'SHA-256', ticket_id: state, 'plugin-name': 'snap_AIIDE', 'plugin-version': '5.2.0' })}`, async () => c.result);
}

export async function createDesktopLogin(providerId: string, options: LoginOptions): Promise<LoginFlow> {
  if (!(DESKTOP_LOGIN_PROVIDERS as readonly string[]).includes(providerId)) failure('不支持的桌面服务登录');
  const c = new Context(providerId, options);
  try {
    c.check();
    return await (providerId.startsWith('minimax-') ? minimax(c) : providerId.startsWith('qoder') ? qoder(c) : providerId.startsWith('workbuddy') ? workbuddy(c) : providerId.startsWith('kiro-') ? kiro(c) : providerId.startsWith('trae-') ? trae(c) : codearts(c));
  } catch (e) { c.cancel(); throw e; }
}
