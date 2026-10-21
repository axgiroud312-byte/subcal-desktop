/** Standalone ports of Magpie builtin Google / StepFun authorization.
 * See docs/evidence/full-service/builtin-login.md for pins and protocol boundaries. */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AccountCredential } from '../account-access';
import type { LoginFlow, LoginOptions, LoginWindow } from './types';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';
const random = () => randomBytes(32).toString('base64url');
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const jwt = (v: string): Obj => { try { if (v.split('.').length !== 3) return {}; return obj(JSON.parse(Buffer.from(v.split('.')[1], 'base64url').toString())); } catch { return {}; } };
export const BUILTIN_LOGIN_PROVIDERS = ['gemini-cli', 'antigravity', 'stepfun-plan-com', 'stepfun-plan-ai'] as const;
export class BuiltinLoginError extends Error {
  constructor(public readonly code: 'UNSUPPORTED' | 'CANCELLED' | 'EXPIRED' | 'NETWORK' | 'DENIED' | 'INVALID_INPUT', message: string) { super(message); this.name = 'BuiltinLoginError'; }
}
const apps = {
  'gemini-cli': { prefix: 'SUBCAL_GEMINI_OAUTH', callback: '/oauth2callback', host: '127.0.0.1' },
  antigravity: { prefix: 'SUBCAL_ANTIGRAVITY_OAUTH', callback: '/oauth-callback', host: 'localhost' },
} as const;
function pack(id: string, token: string, identity: string, alias: string, extra: Obj): AccountCredential {
  const subject = `${id}:${hash(JSON.stringify([identity, extra.project ?? '', extra.site ?? ''])).slice(0, 24)}`;
  return { providerId: id, subject, alias, source: id, secret: JSON.stringify({ ...extra, accessToken: token, accountId: identity, subject, alias, provider: id, source: id, management: 'static' }) };
}
function reply(res: ServerResponse, status: number, content: string, html = false) {
  res.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }); res.end(content);
}
async function formBody(req: IncomingMessage): Promise<URLSearchParams> {
  if (!text(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) throw new BuiltinLoginError('INVALID_INPUT', '表单格式无效');
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 32768) throw new BuiltinLoginError('INVALID_INPUT', '输入过长'); }
  return new URLSearchParams(raw);
}
function page(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{font:16px/1.6 system-ui;max-width:680px;margin:40px auto;padding:0 18px;color:#202124;background:#fafafa}input,textarea,button{font:inherit;padding:8px;box-sizing:border-box}textarea,input{width:100%}button{margin-top:12px}a{color:#2459bb}p{overflow-wrap:anywhere}</style><h1>${escape(title)}</h1>${body}</html>`;
}

/** Exact flow.url is a nonce-protected loopback page; never expose poll results to Renderer. */
export async function createBuiltinLogin(providerId: string, options: LoginOptions & { googleOAuth?: { clientId: string; clientSecret: string } }): Promise<LoginFlow> {
  if (!(BUILTIN_LOGIN_PROVIDERS as readonly string[]).includes(providerId)) throw new BuiltinLoginError('UNSUPPORTED', '此服务不支持内置登录');
  const controller = new AbortController(), nonce = random(), state = random(), verifier = random();
  const expiresAt = options.now() + 10 * 60_000;
  let ended = false, result: AccountCredential | null = null, pending: Promise<AccountCredential | null> | undefined;
  let origin = '', oauth = '', code = '', consumed = false, token = '', tokenExpiry = 0, identity = '', alias = '', project = '', loadNeeded = false;
  let pasted: Obj | null = null, message = '', denied = false;
  const google = providerId === 'gemini-cli' || providerId === 'antigravity';
  const config = google ? apps[providerId as keyof typeof apps] : null;
  const app = config ? { ...config, client: options.googleOAuth?.clientId ?? process.env[config.prefix + '_CLIENT_ID'] ?? '', secret: options.googleOAuth?.clientSecret ?? process.env[config.prefix + '_CLIENT_SECRET'] ?? '' } : null;
  if(app && (!app.client || !app.secret))throw new BuiltinLoginError('UNSUPPORTED', '此版本尚未配置 Google OAuth 应用，暂时无法发起 Google 登录');
  const site = providerId.endsWith('-ai') ? 'ai' : 'com';
  const platform = `https://platform.stepfun.${site}`;
  let window: LoginWindow | undefined, opening: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { if (timer) clearTimeout(timer); window?.close(); window = undefined; server.close(); server.closeAllConnections(); options.signal?.removeEventListener('abort', cancel); };
  const cancel = () => { ended = true; result = null; pasted = null; code = ''; token = ''; controller.abort(); close(); };
  const check = () => {
    if (ended || options.signal?.aborted) throw new BuiltinLoginError('CANCELLED', '登录已取消');
    if (options.now() >= expiresAt) { cancel(); throw new BuiltinLoginError('EXPIRED', '登录已过期，请重新点击登录'); }
  };
  const json = async (url: string, init: RequestInit, signal: AbortSignal) => {
    check();
    const combined = AbortSignal.any([controller.signal, signal]);
    let abort = () => {};
    const stopped = new Promise<never>((_, reject) => { abort = () => reject(new BuiltinLoginError('NETWORK', '授权请求已取消或超时')); combined.addEventListener('abort', abort, { once: true }); if (combined.aborted) abort(); });
    try {
      return await Promise.race([stopped, (async () => {
        const r = await options.fetch(url, { ...init, redirect: 'error', signal: combined });
        const raw = await r.text(); check();
        if (!r.ok || raw.length > 1024 * 1024) throw new BuiltinLoginError('DENIED', '服务未接受授权或只读账号查询，请重新登录');
        try { return obj(JSON.parse(raw)); } catch { throw new BuiltinLoginError('DENIED', '授权响应格式无效'); }
      })()]);
    } catch (e) { check(); if (e instanceof BuiltinLoginError) throw e; throw new BuiltinLoginError('NETWORK', '授权服务暂不可用，请重试'); }
    finally { combined.removeEventListener('abort', abort); }
  };
  const submitProject = (value: string) => {
    if (!token || !identity) throw new BuiltinLoginError('INVALID_INPUT', '请先完成 Google 授权');
    const p = value.trim(); if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(p)) throw new BuiltinLoginError('INVALID_INPUT', '请输入已有 Google Cloud project ID');
    project = p; loadNeeded = true; message = '正在验证已有项目，请返回本应用等待确认；不会创建项目或开通服务。';
  };
  const submitStep = (value: string) => {
    let input: Obj;
    try { if (!value.trim().startsWith('magpie-stepfun:')) throw Error(); input = obj(JSON.parse(value.trim().slice('magpie-stepfun:'.length))); } catch { throw new BuiltinLoginError('INVALID_INPUT', '官方登录页面未返回有效会话，请重新登录'); }
    if (input.site !== site) throw new BuiltinLoginError('INVALID_INPUT', '登录站点与所选 StepFun 地区不同');
    const access = text(input.access), refresh = text(input.refresh), c = jwt(access), r = jwt(refresh);
    const account = typeof c.oasis_id === 'string' ? c.oasis_id : typeof c.oasis_id === 'number' && Number.isSafeInteger(c.oasis_id) ? String(c.oasis_id) : '';
    const webId = typeof r.device_id === 'string' || typeof r.device_id === 'number' && Number.isSafeInteger(r.device_id) ? String(r.device_id) : text(input.webId);
    if (!/^[A-Za-z0-9_.-]+$/.test(access) || !/^[A-Za-z0-9_.-]+$/.test(refresh) || !Object.keys(r).length || c.activated !== true || !account || !webId || /[\r\n]/.test(webId) || typeof c.exp !== 'number' || c.exp * 1000 <= options.now()) throw new BuiltinLoginError('INVALID_INPUT', 'StepFun 会话无效、未激活或已过期，请在官方窗口重新登录');
    pasted = { access, refresh, webId, account, expiresAt: c.exp * 1000 };
    message = '已收到会话，请返回本应用等待只读验证。';
  };
  // Fixed main-process script, never supplied by the renderer. This is the
  // upstream bookmarklet's same-origin session renewal without clipboard/UI.
  const sessionScript = `(async()=>{if(location.origin!==${JSON.stringify(platform)})return null;try{let w='';try{w=localStorage.getItem('web_id')||''}catch{}const r=await fetch('/passport/proto.api.passport.v1.PassportService/RefreshToken',{method:'POST',credentials:'include',body:'{}',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','connect-protocol-version':'1','oasis-appid':'${site === 'ai' ? '20700' : '10300'}','oasis-platform':'web','oasis-webid':w}});const j=r.ok?await r.json():{},a=j.accessToken&&j.accessToken.raw,f=j.refreshToken&&j.refreshToken.raw;if(!a||!f)return null;const c=JSON.parse(atob(a.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(c.activated!==true)return null;return {site:'${site}',access:a,refresh:f,webId:w}}catch{return null}})()`;
  const render = () => page(google ? `${providerId === 'gemini-cli' ? 'Gemini CLI' : 'Antigravity'} 登录` : `StepFun ${site === 'ai' ? '国际' : '国内'}登录`,
    `<p>${escape(message || (google ? '请通过下方 Google 官方页面登录，然后返回本应用。' : '平台没有应用回调；请完成以下浏览器操作，无需终端。'))}</p>` + (google
      ? `<p><a href="${escape(oauth)}">前往 Google 授权</a></p><p>只读取已有 Code Assist 项目，不会创建项目、开通云服务或调用模型。</p>${token ? `<form method="post" action="/project?session=${nonce}"><label>若未找到已有项目，请输入 Google Cloud project ID<input name="project" required maxlength="63" placeholder="my-existing-project"></label><button>验证已有项目</button></form><p>没有已开通项目时，请在 <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud 控制台</a>自行确认套餐、项目与服务设置，再回来验证。本页面不执行 onboardUser。</p>` : ''}`
      : '<p>请在应用打开的 StepFun 官方登录窗口完成登录，系统会自动确认。</p>') + '<p>登录到期后，请在本应用重新点击登录。</p>');
  const server = createServer((req, res) => {
    void (async () => {
      check(); const u = new URL(req.url || '/', origin);
      const port = new URL(origin).port;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host || '') || !req.url?.startsWith('/') || req.url.startsWith('//')) { reply(res, 403, 'Forbidden'); return; }
      if (app && u.pathname === app.callback) {
        if (req.method !== 'GET' || u.searchParams.getAll('state').length !== 1 || u.searchParams.get('state') !== state) { reply(res, 403, '授权状态不匹配'); return; }
        if (consumed) { reply(res, 409, '回调已接收'); return; }
        if (u.searchParams.has('error')) { denied = true; consumed = true; reply(res, 400, 'Google 授权未完成，请返回应用重试'); return; }
        if (u.searchParams.getAll('code').length !== 1 || !u.searchParams.get('code')) { reply(res, 400, '缺少授权码'); return; }
        consumed = true; code = u.searchParams.get('code')!; message = '已收到 Google 授权。请返回应用等待验证；若提示缺少项目，可刷新本页输入已有项目。';
        res.writeHead(303, { Location: `${origin}/?session=${nonce}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); return;
      }
      if (u.searchParams.getAll('session').length !== 1 || u.searchParams.get('session') !== nonce) { reply(res, 403, 'Forbidden'); return; }
      if (req.method === 'GET' && u.pathname === '/') { reply(res, 200, render(), true); return; }
      if (req.method !== 'POST' || req.headers.origin !== origin || u.pathname !== '/project') { reply(res, 403, 'Forbidden'); return; }
      const form = await formBody(req); check();
      if (google && u.pathname === '/project') submitProject(form.get('project') || '');
      else { reply(res, 404, 'Not found'); return; }
      reply(res, 200, render(), true);
    })().catch(e => { if (!res.headersSent) reply(res, 400, e instanceof BuiltinLoginError ? e.message : '登录请求无效'); });
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000; server.timeout = 10_000;
  try {
    check();
    if (!google && !options.openWindow) throw new BuiltinLoginError('UNSUPPORTED', 'StepFun 登录需要应用内隔离浏览器窗口，请在桌面应用中点击登录');
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    origin = `http://127.0.0.1:${address.port}`; server.unref();
    const redirect = app ? `http://${app.host}:${address.port}${app.callback}` : '';
    if (app) {
      const scopes = ['cloud-platform', 'userinfo.email', 'userinfo.profile', ...(providerId === 'antigravity' ? ['cclog', 'experimentsandconfigs'] : [])].map(s => 'https://www.googleapis.com/auth/' + s);
      oauth = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: app.client, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    }
    options.signal?.addEventListener('abort', cancel, { once: true }); check();
    timer = setTimeout(cancel, Math.max(1, expiresAt - options.now())); timer.unref();
    const step = async (): Promise<AccountCredential | null> => {
      const signal = AbortSignal.timeout(15_000); check();
      if (denied) throw new BuiltinLoginError('DENIED', 'Google 授权被拒绝，请重新登录');
      if (app) {
        if (!token) {
          if (!code) return null;
          const t = await json('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: app.client, client_secret: app.secret, code_verifier: verifier }).toString() }, signal);
          if (!text(t.access_token) || !(typeof t.expires_in === 'number' && t.expires_in > 0)) throw new BuiltinLoginError('DENIED', 'Google 未返回有效访问凭据');
          token = text(t.access_token); tokenExpiry = options.now() + t.expires_in * 1000; code = ''; return null;
        }
        if (options.now() >= tokenExpiry) throw new BuiltinLoginError('EXPIRED', 'Google 登录凭据已过期，请重新登录');
        if (!identity) {
          const who = await json('https://www.googleapis.com/oauth2/v2/userinfo?alt=json', { headers: { Authorization: `Bearer ${token}` } }, signal);
          if (!text(who.email)) throw new BuiltinLoginError('DENIED', 'Google 未返回账号身份');
          alias = text(who.email); identity = text(who.id) || alias; loadNeeded = true; return null;
        }
        if (!loadNeeded) return null;
        const metadata: Obj = providerId === 'antigravity' ? { ideType: 'ANTIGRAVITY' } : { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI', ...(project ? { duetProject: project } : {}) };
        const loaded = await json('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': providerId === 'antigravity' ? `antigravity/hub/2.9.1 ${process.platform === 'win32' ? 'windows' : process.platform}/${process.arch === 'x64' ? 'amd64' : process.arch}` : `GeminiCLI/0.61.0/gemini-2.5-pro (${process.platform}; ${process.arch}; terminal)` }, body: JSON.stringify({ metadata, ...(project ? { cloudaicompanionProject: project } : {}) }) }, signal);
        const found = text(loaded.cloudaicompanionProject) || text(obj(loaded.cloudaicompanionProject).id);
        const actual = found || (providerId === 'gemini-cli' && loaded.currentTier ? project : '');
        loadNeeded = false;
        if (!actual || providerId === 'gemini-cli' && !loaded.currentTier) { message = 'Google 尚未返回已开通的项目。请输入已有项目并验证；需要首次开通时请在 Google 控制台自行确认后再试，本应用不会自动开通。'; return null; }
        return pack(providerId, token, identity, alias, { project: actual, expiresAt: tokenExpiry });
      }
      if (window?.closed()) { cancel(); throw new BuiltinLoginError('CANCELLED', 'StepFun 登录窗口已关闭，请重新点击登录'); }
      if (!pasted) {
        if (!window) return null;
        let abort = () => {};
        const combined = AbortSignal.any([controller.signal, signal]);
        const stopped = new Promise<never>((_, reject) => { abort = () => reject(new BuiltinLoginError('NETWORK', '登录窗口查询取消或超时')); combined.addEventListener('abort', abort, { once: true }); if (combined.aborted) abort(); });
        try {
          const received = await Promise.race([window.evaluate<Obj>(sessionScript), stopped]); check();
          if (window.closed()) { cancel(); throw new BuiltinLoginError('CANCELLED', 'StepFun 登录窗口已关闭'); }
          if (!received) return null;
          submitStep('magpie-stepfun:' + JSON.stringify(received));
        } finally { combined.removeEventListener('abort', abort); }
      }
      const saved = pasted;
      if (!saved) return null;
      if (Number(saved.expiresAt) <= options.now()) throw new BuiltinLoginError('EXPIRED', 'StepFun 会话已过期，请重新登录');
      await json(`${platform}/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'Oasis-Appid': site === 'ai' ? '20700' : '10300', 'Oasis-Platform': 'web', 'Oasis-Webid': text(saved.webId), Cookie: `Oasis-Token=${saved.access}...${saved.refresh}` }, body: '{}' }, signal);
      return pack(providerId, text(saved.access), text(saved.account), `StepFun ${site === 'ai' ? '国际' : '国内'}账号`, { site, access: saved.access, refresh: saved.refresh, webId: saved.webId, expiresAt: saved.expiresAt });
    };
    return { url: google ? `${origin}/?session=${nonce}` : `${platform}/step-plan`, expiresAt, intervalSeconds: google ? 1 : 3, instructions: google ? '在本地授权页面点击 Google 登录；缺少项目时可填写已有项目，不自动开通服务。登录到期后重新点击登录。' : '在应用打开的 StepFun 官方窗口完成登录，系统会自动确认。登录到期后请重新点击登录。', cancel,
      ...(!google ? { open: () => {
        if (opening) return opening;
        opening = (async () => {
          check(); if (result || window && !window.closed()) return;
          const created = await options.openWindow!(`${platform}/step-plan`, { allowedOrigins: [platform], title: `StepFun ${site === 'ai' ? '国际' : '国内'}登录` });
          try { check(); window = created; } catch (e) { created.close(); throw e; }
        })().finally(() => { opening = undefined; });
        return opening;
      } } : {}),
      poll() {
        try { check(); } catch (e) { return Promise.reject(e); }
        if (result) return Promise.resolve(result);
        if (pending) return pending;
        pending = step().then(value => { check(); if (value) { result = value; pasted = null; token = ''; close(); } return value; }).finally(() => { pending = undefined; });
        return pending;
      } };
  } catch (e) { cancel(); throw e; }
}
