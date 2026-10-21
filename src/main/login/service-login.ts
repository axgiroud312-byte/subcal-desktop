/** Login-only protocol ports from magpie-community/plugins aee6b9de (MIT).
 * See docs/evidence/full-service/service-login.md. No upstream runtime is loaded.
 * Credentials returned by poll belong exclusively to the main-process vault.
 */
import { constants, createHash, generateKeyPairSync, privateDecrypt, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AccountCredential } from '../account-access';
import type { LoginFlow, LoginOptions } from './types';
import { parseZCodeCredential, zcodeAccountSubject } from '../adapters/zcode-adapter';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const failure = () => new Error('登录未完成，请在应用内重新发起登录（未输出供应商响应或凭据）');
class RetryableRequestError extends Error { constructor() { super('登录网络暂不可用，请稍后重试'); } }
function https(value: unknown, hosts?: string[]) {
  let u: URL; try { u = new URL(text(value)); } catch { throw failure(); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' || hosts && !hosts.includes(u.hostname)) throw failure();
  return u.href;
}
function credential(providerId: string, token: string, uid = '', extra: Obj = {}): AccountCredential {
  if (!token || /[\r\n]/.test(token)) throw failure();
  const subject = `${providerId}:${hash(JSON.stringify([uid || hash(token), extra.org ?? '', extra.project ?? '']))}`;
  const alias = `${providerId} 账号`;
  const data = { ...extra, accessToken: token, accountId: uid || undefined, subject, alias, provider: providerId, source: providerId, management: 'static' };
  if (providerId.startsWith('zcode-')) {
    const bound = { ...data, identitySubject: subject };
    data.subject = zcodeAccountSubject(parseZCodeCredential(JSON.stringify(bound), providerId), providerId);
    return { providerId, subject: data.subject, alias, source: providerId, secret: JSON.stringify({ ...bound, subject: data.subject }) };
  }
  return { providerId, subject, alias, source: providerId, secret: JSON.stringify(data) };
}

/** One flow owns all timers, sockets, request cancellation and poll serialization. */
class Session {
  readonly controller = new AbortController();
  expiresAt: number;
  intervalSeconds = 2;
  private timer: ReturnType<typeof setTimeout>;
  private cleanup: (() => void)[] = [];
  private result: AccountCredential | null = null;
  private inflight?: Promise<AccountCredential | null>;
  private nextPoll = 0;
  constructor(readonly options: LoginOptions) {
    this.expiresAt = options.now() + 600_000;
    this.timer = setTimeout(() => this.cancel(), 600_000); this.timer.unref();
    options.signal?.addEventListener('abort', this.cancel, { once: true });
    if (options.signal?.aborted) this.cancel();
  }
  cancel = () => { this.controller.abort(); this.release(); this.result = null; };
  release() { clearTimeout(this.timer); this.options.signal?.removeEventListener('abort', this.cancel); for (const fn of this.cleanup.splice(0)) fn(); }
  onClose(fn: () => void) { this.cleanup.push(fn); if (this.controller.signal.aborted) this.release(); }
  check() { if (this.controller.signal.aborted || this.options.now() >= this.expiresAt) { this.cancel(); throw new Error('登录已取消或过期，请重新登录'); } }
  async request(url: string, init: RequestInit = {}) {
    this.check();
    try {
      const r = await this.options.fetch(url, { ...init, redirect: init.redirect ?? 'error', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]) });
      this.check(); return r;
    } catch { this.check(); throw new RetryableRequestError(); }
  }
  async json(url: string, init: RequestInit = {}): Promise<{ response: Response; data: Obj }> {
    const response = await this.request(url, init);
    try { const data = obj(await response.json()); this.check(); return { response, data }; } catch { this.check(); throw failure(); }
  }
  flow(url: string, poll: () => Promise<AccountCredential | null>, userCode?: string): LoginFlow {
    const s = this;
    this.check(); clearTimeout(this.timer);
    this.timer = setTimeout(() => this.cancel(), Math.max(1, this.expiresAt - this.options.now())); this.timer.unref();
    return { url, userCode, instructions: '在浏览器完成登录并确认授权，然后返回应用。',
      get expiresAt() { return s.expiresAt; }, get intervalSeconds() { return s.intervalSeconds; }, cancel: s.cancel,
      poll() {
        if (s.inflight) return s.inflight;
        const run = async () => {
          s.check(); if (s.result) return s.result;
          if (s.options.now() < s.nextPoll) return null;
          s.nextPoll = s.options.now() + s.intervalSeconds * 1000;
          const result = await poll(); s.check();
          if (result) { s.result = result; s.release(); }
          return result;
        };
        s.inflight = run().catch(e => { if (e instanceof RetryableRequestError) return null; s.cancel(); throw e; }).finally(() => { s.inflight = undefined; });
        return s.inflight;
      },
    };
  }
}
const post = (body: Obj): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
const form = (body: Record<string, string>): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(body).toString() });
const ok = (r: { response: Response; data: Obj }) => { if (!r.response.ok) throw failure(); return r.data; };
const envelope = (r: { response: Response; data: Obj }) => { const e = ok(r); if (e.code !== undefined && ![0, 200, '0', '200'].includes(e.code as number)) throw failure(); return obj(e.data); };

async function cline(s: Session) {
  const client_id = 'client_01K3A541FN8TA3EPPHTD2325AR';
  const d = ok(await s.json('https://api.workos.com/user_management/authorize/device', form({ client_id })));
  if (!text(d.device_code)) throw failure();
  s.intervalSeconds = Math.max(1, Number(d.interval) || 5);
  s.expiresAt = s.options.now() + Math.min(600, Math.max(1, Number(d.expires_in) || 300)) * 1000;
  let workos: Obj | undefined;
  return s.flow(https(d.verification_uri_complete || d.verification_uri), async () => {
    if (!workos) {
      const r = await s.json('https://api.workos.com/user_management/authenticate', form({ client_id, device_code: text(d.device_code), grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }));
      if (r.response.status >= 500 || r.data.error === 'authorization_pending') return null;
      if (r.data.error === 'slow_down') { s.intervalSeconds += 1; return null; }
      workos = ok(r); if (workos.error || !text(workos.access_token)) throw failure();
    }
    const init = post({ accessToken: workos.access_token, refreshToken: workos.refresh_token ?? '' });
    init.headers = { ...init.headers, 'HTTP-Referer': 'https://cline.bot', 'X-Title': 'Cline', 'User-Agent': 'Cline/3.0.68', 'X-IS-MULTIROOT': 'false', 'X-CLIENT-TYPE': 'cline-cli', 'X-CLIENT-VERSION': '3.0.68', 'X-PLATFORM': 'cli', 'X-CORE-VERSION': '0.0.90' };
    const e = ok(await s.json('https://api.cline.bot/api/v1/auth/register', init));
    if (e.success === false) throw failure();
    const data = 'success' in e ? obj(e.data) : e, user = obj(data.userInfo), token = text(data.accessToken);
    if (!token) throw failure();
    return credential('cline', /^workos:/i.test(token) ? token : `workos:${token}`, text(user.clineUserId) || text(user.subject), { userId: text(user.clineUserId) || text(user.subject) });
  }, text(d.user_code) || undefined);
}

async function openDesign(s: Session) {
  const base = 'https://amr-api.open-design.ai/api/v1/cli/device-authorizations';
  const d = ok(await s.json(base, post({ cliVersion: '0.1.4', host: 'SubCal', profile: 'prod' })));
  if (!text(d.deviceId) || !text(d.deviceSecret)) throw failure();
  s.intervalSeconds = Math.max(1, Number(d.pollIntervalSeconds) || 2);
  s.expiresAt = Math.min(s.expiresAt, Date.parse(text(d.expiresAt)) || s.expiresAt);
  return s.flow(https(d.activationUrl), async () => {
    const r = await s.json(`${base}/${encodeURIComponent(text(d.deviceId))}/token`, post({ deviceSecret: d.deviceSecret }));
    if (r.response.status >= 500) return null;
    if ([401, 404].includes(r.response.status) || ['expired', 'canceled', 'cancelled', 'denied', 'rejected'].includes(text(r.data.status).toLowerCase())) throw failure();
    if (!text(r.data.controlKey) || !text(r.data.runtimeKey)) return null;
    ok(r); const user = obj(r.data.user);
    return credential('opendesign', text(r.data.controlKey), text(user.id) || text(user.appUserId) || text(user.email), { controlKey: r.data.controlKey });
  }, text(d.userCode) || undefined);
}

function reply(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'" }); res.end(message);
}
async function body(req: IncomingMessage): Promise<Obj> {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 10_000) throw failure(); }
  if (text(req.headers['content-type']).startsWith('application/json')) return obj(JSON.parse(raw));
  const q = new URLSearchParams(raw); if (q.getAll('state').length !== 1) throw failure();
  return Object.fromEntries(q);
}
async function loopback(s: Session, handler: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>, port = 0) {
  const server = createServer((req, res) => {
    const address = server.address(); const local = `127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    if (req.headers.host !== local && req.headers.host !== local.replace('127.0.0.1', 'localhost')) { reply(res, 403, 'Forbidden'); return; }
    try { s.check(); } catch { reply(res, 410, '登录已结束'); return; }
    let url: URL; try { url = new URL(req.url || '/', `http://${local}`); } catch { reply(res, 400, '登录请求无效'); return; }
    handler(req, res, url).catch(() => { if (!res.headersSent) reply(res, 400, '登录请求无效'); });
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000; server.timeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  s.onClose(() => { server.close(); server.closeAllConnections(); }); s.check();
  const a = server.address(); if (!a || typeof a === 'string') throw failure();
  return `http://127.0.0.1:${a.port}`;
}

async function callbackLogin(id: 'raccoon' | 'commandcode', s: Session) {
  const state = randomBytes(32).toString('hex'); let received: Obj | undefined;
  const path = id === 'raccoon' ? '/auth/callback' : '/callback';
  const local = await loopback(s, async (req, res, url) => {
    if (url.pathname !== path) { reply(res, 404, 'Not found'); return; }
    if (id === 'commandcode') {
      if (req.headers.origin && req.headers.origin !== 'https://commandcode.ai') { reply(res, 403, 'Forbidden'); return; }
      res.setHeader('Access-Control-Allow-Origin', 'https://commandcode.ai');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    }
    if (req.method !== (id === 'raccoon' ? 'GET' : 'POST')) { reply(res, 405, 'Method not allowed'); return; }
    const data = id === 'raccoon' ? Object.fromEntries(url.searchParams) : await body(req);
    if (data.state !== state || id === 'raccoon' && url.searchParams.getAll('state').length !== 1) { reply(res, 403, '回调不属于本次登录'); return; }
    if (received) { reply(res, 409, '回调已经接收'); return; }
    if (!data.error && !(id === 'raccoon' ? text(data.code) : text(data.apiKey))) { reply(res, 400, '缺少授权结果'); return; }
    received = data;
    if (id === 'commandcode' && text(req.headers['content-type']).startsWith('application/json')) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"success":true}'); }
    else reply(res, 200, '授权结果已接收，请返回应用。');
  });
  const url = new URL(id === 'raccoon' ? 'https://xiaohuanxiong.com/code/authorize' : 'https://commandcode.ai/studio/auth/cli');
  for (const [k, v] of Object.entries(id === 'raccoon' ? { login_source: 'desktop', appname: '办公小浣熊客户端', state, desktop_callback: 'loopback', redirect: local + path } : { callback: local + path, state, mode: 'redirect' })) url.searchParams.set(k, v);
  return s.flow(url.href, async () => {
    if (!received) return null; if (received.error) throw failure();
    if (id === 'commandcode') return credential(id, text(received.apiKey), text(received.userId));
    const r = await s.json('https://xiaohuanxiong.com/api/web/auth/v1/login_with_authorization_code', post({ authorization_code: received.code }));
    const e = ok(r); if (e.code === 200035) throw failure(); const d = obj(e.data);
    return credential(id, text(d.access_token).replace(/^Bearer\s+/i, ''));
  });
}

async function zcode(id: string, s: Session) {
  const site = id === 'zcode-team-cn' ? 'bigmodel' : 'zai', device = randomUUID();
  const headers = { Authorization: `Bearer ${randomBytes(32).toString('hex')}`, 'X-Device-Mid': device, 'User-Agent': 'ZCode/3.14.3' };
  const root = 'https://zcode.z.ai';
  const init = post({ provider: site }); init.headers = { ...init.headers, ...headers };
  const d = envelope(await s.json(root + '/api/v1/oauth/cli/init', init)); if (!text(d.flow_id)) throw failure();
  const url = new URL(https(d.authorize_url));
  url.searchParams.set(site === 'bigmodel' ? 'redirect' : 'redirect_uri', root + '/app/oauth/login?' + new URLSearchParams({ redirect: 'zcode://oauth/callback', app_version: '3.14.3' }));
  s.intervalSeconds = Math.max(1, Number(d.poll_interval_sec) || 1);
  if (Number(d.expires_at) > 0) s.expiresAt = Math.min(s.expiresAt, Number(d.expires_at) * 1000);
  let team: { token: string; jwt: string; uid: string; projects: { org: string; project: string }[]; index: number } | undefined;
  const business = site === 'bigmodel' ? 'https://bigmodel.cn' : 'https://api.z.ai';
  return s.flow(url.href, async () => {
    if (team) {
      const p = team.projects[team.index]; if (!p) throw new Error('此账号没有已生效的团队席位，请选择其他账号');
      const detail = envelope(await s.json(business + '/api/biz/team/subscribe/product/querySubscribeDetail', { headers: { Authorization: team.token, 'Bigmodel-Organization': p.org, 'Bigmodel-Project': p.project, 'Set-Language': site === 'bigmodel' ? 'zh' : 'en', 'Accept-Language': 'en-US,en' } }));
      team.index++;
      if (detail.hasSubscription === false || text(detail.status).toUpperCase() !== 'EFFECTIVE' || text(detail.memberGrantStatus).toUpperCase() !== 'VALID') return null;
      return credential(id, team.token, team.uid, { site, device, jwt: team.jwt, token: team.token, ...p });
    }
    const r = await s.json(root + '/api/v1/oauth/cli/poll/' + encodeURIComponent(text(d.flow_id)), { headers });
    if (r.response.status >= 500 || [408, 429].includes(r.response.status)) return null;
    const got = envelope(r); if (!got.status || got.status === 'pending') return null;
    if (got.status !== 'ready') throw failure();
    const jwt = text(got.token), uid = text(obj(got.user).user_id) || text(obj(got.user).email);
    if (id === 'zcode-gift') return credential(id, jwt, uid, { site, device, jwt });
    const signed = obj(got[site]); let token = text(signed.access_token) || text(signed.accessToken);
    if (!token) throw failure();
    if (site === 'zai') { const b = envelope(await s.json(business + '/api/auth/z/login', post({ token }))); if (!text(b.access_token)) throw failure(); token = 'Bearer ' + text(b.access_token); }
    const info = envelope(await s.json(business + '/api/biz/customer/getCustomerInfo', { headers: { Authorization: token } }));
    const organizations = Array.isArray(info.organizations) ? info.organizations.map(obj) : [];
    const projects: { org: string; project: string }[] = [];
    for (const o of organizations) for (const p of (Array.isArray(o.projects) ? o.projects.map(obj) : [])) {
      if (!text(o.organizationId) || !text(p.projectId) || String(p.projectType) !== '2') continue;
      projects.push({ org: text(o.organizationId), project: text(p.projectId) });
    }
    // Inspect one team per poll, select the first effective granted seat as upstream.
    // Usage collection accepts the business token; do not mint model keys.
    if (projects.length) { team = { token, jwt, uid, projects, index: 0 }; return null; }
    throw new Error('登录成功，但此账号没有团队项目；请使用赠送权益入口或其他团队账号');
  });
}

type Cookie = { name: string; value: string; domain: string; path: string; hostOnly: boolean };
class XiaomiCookies {
  private cookies: Cookie[] = [];
  seed(name: string, value: string) { if (value && !/[;\r\n]/.test(value)) this.cookies.push({ name, value, domain: 'account.xiaomi.com', path: '/', hostOnly: true }); }
  take(response: Response, url: string, now: number) {
    const u = new URL(url);
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';'), eq = pair.indexOf('='); if (eq < 1) continue;
      const c: Cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: u.hostname, path: u.pathname.slice(0, u.pathname.lastIndexOf('/')) || '/', hostOnly: true };
      if (!/^[A-Za-z0-9_-]+$/.test(c.name) || /[;\r\n]/.test(c.value)) throw failure();
      let gone = false;
      for (const attr of attrs) {
        const n = attr.indexOf('='), k = (n < 0 ? attr : attr.slice(0, n)).trim().toLowerCase(), v = n < 0 ? '' : attr.slice(n + 1).trim();
        if (k === 'domain') { const d = v.replace(/^\./, '').toLowerCase(); if (d !== u.hostname && (!u.hostname.endsWith('.' + d) || !['xiaomi.com', 'xiaomimimo.com'].includes(d))) throw failure(); c.domain = d; c.hostOnly = false; }
        if (k === 'path' && v.startsWith('/')) c.path = v;
        if (k === 'max-age' && Number(v) <= 0 || k === 'expires' && Date.parse(v) <= now) gone = true;
      }
      this.cookies = this.cookies.filter(x => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
      if (!gone) this.cookies.push(c);
    }
  }
  values(url: string) { const u = new URL(url); return this.cookies.filter(c => (c.hostOnly ? u.hostname === c.domain : u.hostname === c.domain || u.hostname.endsWith('.' + c.domain)) && (c.path === '/' || u.pathname === c.path || u.pathname.startsWith(c.path.replace(/\/$/, '') + '/'))); }
  header(url: string) { return this.values(url).map(c => `${c.name}=${c.value}`).join('; '); }
}
async function mimo(id: string, s: Session) {
  const region = id === 'mimo-token-plan' ? 'SGP' : id.slice('mimo-app-'.length).toUpperCase();
  const base = `https://mimo-server-${region.toLowerCase()}.xiaomimimo.com/api`, account = 'https://account.xiaomi.com';
  const platform = 'https://platform.xiaomimimo.com';
  const ua = 'miNative PC/Normal Windows_NT/10.0.26100 SDKV/1.0.0 DEVT/PC DEVS/Windows APP/miaccount_desktop APPV/0.1.0';
  const headers = { 'User-Agent': ua, 'X-Client-Version': '26.929.292248' };
  const device = 'pc_' + randomBytes(16).toString('hex');
  const accountHeaders = { 'User-Agent': ua, Cookie: `deviceId=${device}; pass_ua=pc; uLocale=zh_CN` };
  const initial = await s.request(base + '/user/xiaomi/me', { headers, redirect: 'manual' });
  let sid = 'mimosgp', callback = base + '/sts';
  const location = initial.headers.get('location'); await initial.body?.cancel();
  if (location) { const q = new URL(https(new URL(location, base).href, ['account.xiaomi.com'])).searchParams; sid = q.get('sid') || sid; callback = q.get('callback') || callback; }
  https(callback, [new URL(base).hostname]);
  const q = new URLSearchParams({ _group: 'DEFAULT', _qrsize: '240', qs: '%3Fsid%3D' + encodeURIComponent(sid) + '%26_json%3Dtrue', callback, _hasLogo: 'false', sid, serviceParam: '', _locale: 'en_US' });
  const accountJSON = async (r: Response) => { try { return obj(JSON.parse((await r.text()).trim().replace(/^&&&START&&&/, ''))); } catch { throw failure(); } };
  const ticket = await accountJSON(await s.request(account + '/longPolling/loginUrl?' + q, { headers: accountHeaders }));
  if (ticket.code !== 0) throw failure();
  const pollUrl = https(ticket.lp, ['account.xiaomi.com']);
  const loginUrl = https(ticket.loginUrl, ['account.xiaomi.com']);
  s.expiresAt = s.options.now() + Math.min(600, Math.max(1, Number(ticket.timeout) || 600)) * 1000;
  const jar = new XiaomiCookies(); let user = '', at = '', hops = 0;
  const target = id === 'mimo-token-plan' ? platform + '/api/v1/tokenPlan/detail' : base + '/user/xiaomi/me';
  const allowed = ['account.xiaomi.com', new URL(base).hostname, ...(id === 'mimo-token-plan' ? ['platform.xiaomimimo.com'] : [])];
  return s.flow(loginUrl, async () => {
    if (!user) {
      // Xiaomi's long poll is clipped to one bounded request; no hidden loop.
      const r = await s.request(pollUrl, { headers: accountHeaders });
      if (!r.ok) { await r.body?.cancel(); return null; }
      const p = await accountJSON(r);
      if (!text(p.passToken) || !String(p.userId ?? '')) return null;
      user = String(p.userId);
      for (const [k, v] of Object.entries({ userId: user, passToken: text(p.passToken), cUserId: text(p.cUserId), deviceId: device, pass_ua: 'pc', uLocale: 'zh_CN' })) jar.seed(k, v);
      at = target; return null;
    }
    const response = await s.request(https(at, allowed), { headers: { ...headers, Cookie: jar.header(at) }, redirect: 'manual' });
    jar.take(response, at, s.options.now());
    const loc = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && loc) {
      await response.body?.cancel(); if (++hops > 10) throw failure();
      const next = new URL(loc, at); if (next.protocol === 'http:' && next.hostname === new URL(target).hostname) next.protocol = 'https:';
      at = https(next.href, allowed); return null;
    }
    const data = await accountJSON(response);
    if (id === 'mimo-token-plan' && response.status === 401 && text(data.loginUrl)) {
      if (++hops > 10) throw failure(); at = https(data.loginUrl, ['account.xiaomi.com']); return null;
    }
    if (!response.ok || data.code !== 0 || new URL(at).hostname !== new URL(target).hostname) throw failure();
    const me = obj(data.data);
    if (id !== 'mimo-token-plan' && (String(me.userId ?? '') !== user || text(me.region) && text(me.region).toUpperCase() !== region)) throw new Error('小米账号返回的地区或身份与所选服务不一致，请选择对应地区重新登录');
    const paths = id === 'mimo-token-plan' ? ['/api/v1/tokenPlan/detail', '/api/v1/tokenPlan/usage'] : ['/api/user/xiaomi/subscription/self', '/api/user/usage'];
    const origin = new URL(target).origin;
    const cookiesByPath = Object.fromEntries(paths.map(path => [path, jar.header(origin + path)]));
    const cookie = Object.values(cookiesByPath).find(Boolean); if (!cookie) throw failure();
    return credential(id, cookie, user, { cookiesByPath, region: new URL(target).hostname });
  });
}

async function zed(s: Session) {
  // Zed's native protocol binds the callback ciphertext to a fresh RSA keypair,
  // not an OAuth state parameter (packages/zed/index.mjs:427–522).
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'pkcs1', format: 'der' }).toString('base64url');
  const pub = der + '='.repeat((4 - der.length % 4) % 4), systemId = randomUUID();
  let received: { userId: string; access: string } | undefined;
  const local = await loopback(s, async (req, res, url) => {
    if (req.method !== 'GET') { reply(res, 405, 'Method not allowed'); return; }
    if (received) { reply(res, 409, '回调已经接收'); return; }
    const q = url.searchParams, userId = q.get('user_id') || '', ciphertext = q.get('access_token') || '';
    if (q.getAll('user_id').length !== 1 || q.getAll('access_token').length !== 1 || !/^[0-9]+$/.test(userId) || !/^[A-Za-z0-9_-]+={0,2}$/.test(ciphertext)) { reply(res, 400, '授权回调无效'); return; }
    const ct = Buffer.from(ciphertext, 'base64url'); let access = '';
    if (ct.length !== 256) { reply(res, 400, '授权回调无效'); return; }
    try { access = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, ct).toString('utf8'); }
    catch {
      // Upstream legacy RSAES-PKCS1-v1_5, without enabling Node's disabled
      // native v1.5 path. Reject malformed padding before accepting any bytes.
      try { const em = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, ct), end = em.indexOf(0, 2); if (em[0] === 0 && em[1] === 2 && end >= 10) access = em.subarray(end + 1).toString('utf8'); } catch { /* same public failure as OAEP */ }
    }
    if (!access || /[\s\u0000-\u001f\u007f\ufffd]/.test(access)) { reply(res, 400, '授权回调无效'); return; }
    received = { userId, access }; reply(res, 200, '授权已接收，请返回应用。');
  });
  const q = new URLSearchParams({ native_app_port: new URL(local).port, native_app_public_key: pub, system_id: systemId });
  return s.flow('https://zed.dev/native_app_signin?' + q, async () => {
    if (!received) return null;
    const { userId, access } = received;
    const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform;
    const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch;
    const me = ok(await s.json('https://cloud.zed.dev/client/users/me', { headers: { Authorization: `${userId} ${access}`, 'x-zed-system-id': systemId, 'Content-Type': 'application/json', 'User-Agent': `Zed/1.23.0 (${os}; ${arch})` } }));
    const user = obj(me.user); if (!Object.keys(user).length || user.legacy_user_id !== undefined && String(user.legacy_user_id) !== userId) throw failure();
    // Entitlement adapter chooses the current organization from the profile;
    // do not load models, request an LLM token or reject non-model accounts.
    return credential('zed', access, userId, { userId, systemId });
  });
}

async function autoClawCn(s: Session) {
  const nonce = randomBytes(32).toString('hex'), device = randomBytes(32).toString('hex');
  let local = '', phone = '', busy = false, resendAt = 0, result: AccountCredential | null = null;
  const call = async (path: string, data: Obj) => {
    const ts = String(Math.floor(s.options.now() / 1000)), tm = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
    const init = post({ source_id: 'autoclaw', device_id: device, ...data });
    // SMS login uses upstream bizHeaders (1.18.1/AutoClaw4), not the CN model headers.
    init.headers = { ...init.headers, 'User-Agent': `AutoClaw/1.18.1 (${tm}-${process.arch})`, 'X-Version': '1.18.1', 'X-Tm': tm, 'X-Product': 'autoclaw', 'X-Auth-Appid': '100003', 'X-Auth-TimeStamp': ts,
      'X-Auth-Sign': createHash('md5').update(`100003&${ts}&38d2391985e2369a5fb8227d8e6cd5e5`).digest('hex'), 'X-Trace-Id': randomBytes(16).toString('hex'), 'X-Lang': 'zh-CN', 'X-Channel': 'AutoClaw4', Origin: 'http://localhost:18432', Referer: 'http://localhost:18432/' };
    return envelope(await s.json('https://autoglm-api.zhipuai.cn/userapi/v1/' + path, init));
  };
  const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AutoClaw 国内登录</title><body><h1>AutoClaw 国内登录</h1><form id="form"><label>手机号 <input id="phone" inputmode="tel" autocomplete="tel" pattern="1[0-9]{10}" required></label><button id="send" type="button">发送验证码</button><label>短信验证码 <input id="code" inputmode="numeric" autocomplete="one-time-code" required></label><button id="login">登录</button></form><p id="message"></p><script>
const nonce=${JSON.stringify(nonce)},form=document.getElementById('form'),phone=document.getElementById('phone'),code=document.getElementById('code'),message=document.getElementById('message');
async function ask(path,data){const r=await fetch(path+'?session='+nonce,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error('请求未完成，请检查输入后重试；短信重发需间隔一分钟');}
document.getElementById('send').onclick=async()=>{const b=document.getElementById('send');b.disabled=true;try{await ask('/send-code',{phone:phone.value});message.textContent='验证码已发送';phone.readOnly=true}catch(e){message.textContent=e.message}finally{b.disabled=false}};
form.onsubmit=async e=>{e.preventDefault();const b=document.getElementById('login');b.disabled=true;try{await ask('/login',{code:code.value});code.value='';message.textContent='登录成功，请返回应用';form.hidden=true}catch(e){message.textContent=e.message;b.disabled=false}};
</script></body></html>`;
  local = await loopback(s, async (req, res, url) => {
    if (url.searchParams.getAll('session').length !== 1 || url.searchParams.get('session') !== nonce) { reply(res, 403, 'Forbidden'); return; }
    if (url.pathname === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); res.end(page); return; }
    if (req.method !== 'POST' || req.headers.origin !== local || !text(req.headers['content-type']).startsWith('application/json')) { reply(res, 403, 'Forbidden'); return; }
    if (!['/send-code', '/login'].includes(url.pathname)) { reply(res, 404, 'Not found'); return; }
    if (busy || result) { reply(res, 409, '请求正在处理或登录已完成'); return; }
    busy = true;
    try {
      const data = await body(req); s.check();
      if (url.pathname === '/send-code') {
        const value = text(data.phone); if (!/^1\d{10}$/.test(value)) throw failure();
        if (s.options.now() < resendAt) { reply(res, 429, '请稍后重新发送'); return; }
        resendAt = s.options.now() + 60_000;
        await call('agent-send-code', { phone: value }); s.check(); phone = value;
      } else {
        const code = text(data.code); if (!phone || !/^\d{4,8}$/.test(code)) throw failure();
        const tokens = await call('agent-login/', { phone, code }); s.check();
        result = credential('autoclaw-cn', text(tokens.access_token).replace(/^Bearer\s+/i, ''), text(tokens.user_id), { deviceId: device }); phone = '';
      }
      reply(res, 200, '请求已完成');
    } finally { busy = false; }
  });
  s.onClose(() => { phone = ''; result = null; });
  return s.flow(local + '/?session=' + nonce, async () => result);
}

async function autoClaw(s: Session) {
  const device = randomBytes(32).toString('hex'), nonce = randomBytes(32).toString('hex');
  let local = '', state = '', code = '', receipt = '', opening = false;
  const call = async (path: string, data: Obj) => {
    const ts = String(Math.floor(s.options.now() / 1000)), tm = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
    const init = post(data);
    init.headers = { ...init.headers, 'User-Agent': `AutoClaw/1.18.1 (${tm}-${process.arch})`, 'X-Version': '1.18.1', 'X-Tm': tm, 'X-Product': 'autoclaw', 'X-Auth-Appid': '100003', 'X-Auth-TimeStamp': ts,
      'X-Auth-Sign': createHash('md5').update(`100003&${ts}&38d2391985e2369a5fb8227d8e6cd5e5`).digest('hex'), 'X-Trace-Id': randomBytes(16).toString('hex'), 'X-Lang': 'zh-CN', 'X-Channel': 'AutoClaw4', Origin: 'http://localhost:18432', Referer: 'http://localhost:18432/' };
    return envelope(await s.json('https://autoglm-api.autoglm.ai/userapi/overseasv1/' + path, init));
  };
  const redirect = () => local.replace('127.0.0.1', 'localhost') + '/auth/callback-google';
  const page = () => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AutoClaw 登录</title><body><h1>AutoClaw 登录</h1><p id="message">正在加载安全验证…</p><div id="captcha"></div><button id="trigger" hidden>验证</button><button id="go" disabled>继续 Google 授权</button><script>
const nonce=${JSON.stringify(nonce)};const message=document.getElementById('message'),go=document.getElementById('go');
async function ask(path,body){const r=await fetch(path+'?session='+nonce,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});if(!r.ok)throw Error('登录请求失败，请返回应用重试');return r.json()}
go.onclick=async()=>{go.disabled=true;try{const d=await ask('/open-auth');location.href=d.url}catch(e){message.textContent=e.message;go.disabled=false}};
(async()=>{const c=await ask('/captcha-config');if(!c.enabled){message.textContent='请继续浏览器授权';go.disabled=false;return}
window.AliyunCaptchaConfig={region:c.region||'ga',prefix:c.prefix||'sq51tr'};await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';script.onload=resolve;script.onerror=reject;document.head.append(script)});
window.initAliyunCaptcha({SceneId:c.scene_id,mode:'popup',element:'#captcha',button:'#trigger',language:'cn',slideStyle:{width:320,height:40},captchaVerifyCallback(params){const receipt=typeof params==='string'?params:params.captchaVerifyParam||JSON.stringify(params);ask('/captcha',{receipt}).then(()=>{message.textContent='请继续授权';go.disabled=false}).catch(()=>{message.textContent='验证未完成，请刷新重试'});return {captchaResult:true}},onBizResultCallback(){},getInstance(){},onError(){message.textContent='验证出错，请刷新重试'}});setTimeout(()=>document.getElementById('trigger').click(),2300)
})().catch(()=>{message.textContent='无法加载安全验证，请返回应用重新登录'});
</script></body></html>`;
  const handler = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname === '/auth/callback-google') {
      if (req.method !== 'GET' || !state || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) { reply(res, 403, '回调不属于本次登录'); return; }
      if (code) { reply(res, 409, '已接收回调'); return; }
      if (url.searchParams.get('error')) { reply(res, 400, '授权已取消'); s.cancel(); return; }
      if (url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code')) { reply(res, 400, '缺少授权码'); return; }
      code = url.searchParams.get('code')!; reply(res, 200, '授权已接收，请返回应用。'); return;
    }
    if (url.searchParams.get('session') !== nonce) { reply(res, 403, 'Forbidden'); return; }
    if (url.pathname === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); res.end(page()); return; }
    if (req.method !== 'POST' || req.headers.origin && req.headers.origin !== local) { reply(res, 403, 'Forbidden'); return; }
    const send = (data: Obj) => { s.check(); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/captcha-config') { send(await call('oauth-captcha-config', {})); return; }
    if (url.pathname === '/captcha') { receipt = text((await body(req)).receipt); if (!receipt) throw failure(); send({ ok: true }); return; }
    if (url.pathname === '/open-auth') {
      if (opening || state) { reply(res, 409, '授权已经发起'); return; } opening = true;
      try {
        const d = await call('google-oauth-url', { source_id: 'autoclaw', device_id: device, navigate_uri: redirect(), ...(receipt ? { ali_captcha_verify_param: receipt } : {}) });
        const auth = new URL(https(d.oauth_url || d.url || d.login_url || d.auth_url || d.verify_url));
        state = auth.searchParams.get('state') || ''; if (!state) throw failure(); send({ url: auth.href });
      } finally { opening = false; }
      return;
    }
    reply(res, 404, 'Not found');
  };
  for (const port of [18432, 19654, 19723, 53699]) {
    try { local = await loopback(s, handler, port); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e; }
  }
  if (!local) throw new Error('AutoClaw 授权回调端口均被占用，请释放 18432、19654、19723 或 53699 后重试');
  return s.flow(local + '/?session=' + nonce, async () => {
    if (!code) return null;
    const d = await call('google-oauth-login', { source_id: 'autoclaw', device_id: device, navigate_uri: redirect(), code, state });
    return credential('autoclaw', text(d.access_token).replace(/^Bearer\s+/i, ''), text(d.user_id), { deviceId: device });
  });
}

export const SERVICE_LOGIN_PROVIDERS: readonly string[] = ['cline', 'opendesign', 'commandcode', 'raccoon', 'zcode-gift', 'zcode-team-cn', 'zcode-team-global', 'mimo-app-sgp', 'mimo-app-ru', 'mimo-app-in', 'mimo-token-plan', 'autoclaw', 'zed', 'autoclaw-cn'];
export async function createServiceLogin(providerId: string, options: LoginOptions): Promise<LoginFlow> {
  if (!SERVICE_LOGIN_PROVIDERS.includes(providerId)) throw new Error('此服务尚无符合当前登录合同的直接授权流程；详见 service-login.md');
  const s = new Session(options);
  try {
    if (providerId === 'cline') return await cline(s);
    if (providerId === 'opendesign') return await openDesign(s);
    if (providerId === 'raccoon' || providerId === 'commandcode') return await callbackLogin(providerId, s);
    if (providerId.startsWith('mimo-')) return await mimo(providerId, s);
    if (providerId === 'autoclaw') return await autoClaw(s);
    if (providerId === 'autoclaw-cn') return await autoClawCn(s);
    if (providerId === 'zed') return await zed(s);
    return await zcode(providerId, s);
  } catch (e) { s.cancel(); throw e; }
}
