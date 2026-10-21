/** Standalone authorization protocol port; MIT source pins and boundaries:
 * docs/evidence/full-service/priority-login.md. No upstream runtime is loaded. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AccountCredential } from '../account-access';
import type { LoginFlow, LoginOptions } from './types';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Obj : {};
const str = (x: unknown): string => typeof x === 'string' ? x : '';
const hash = (x: string) => createHash('sha256').update(x).digest('hex');
function claims(token: string): Obj { try { return obj(JSON.parse(Buffer.from(token.split('$').at(-1)!.split('.')[1], 'base64url').toString())); } catch { return {}; } }
export class PriorityLoginError extends Error {
  constructor(public readonly code: 'UNSUPPORTED' | 'CANCELLED' | 'EXPIRED' | 'DENIED' | 'NETWORK' | 'SCHEMA_CHANGED', message: string) { super(message); this.name = 'PriorityLoginError'; }
}
export const PRIORITY_LOGIN_PROVIDERS = ['cursor', 'devin', 'factory'] as const;
const WORKOS = 'https://api.workos.com/user_management';
const FACTORY_CLIENT = 'client_01HNM792M5G5G1A2THWPXKFMXB';
const RELOGIN = '登录到期后，请在本应用重新点击登录。';

function credential(providerId: string, token: string, extra: Obj = {}): AccountCredential {
  if (!token) throw new PriorityLoginError('SCHEMA_CHANGED', '授权服务没有返回凭据');
  const c = claims(token), identity = str(extra.accountId) || str(c.sub) || hash(token);
  const subject = `${providerId}:${hash(JSON.stringify([identity, extra.organizationId ?? '', extra.region ?? ''])).slice(0, 24)}`;
  const alias = str(extra.email) || str(c.email) || providerId;
  const expiresAt = typeof c.exp === 'number' && c.exp > 0 ? c.exp * 1000 : extra.expiresAt;
  return { providerId, subject, alias, source: providerId,
    secret: JSON.stringify({ ...extra, accessToken: token, accountId: identity, subject, alias, source: providerId, management: 'static', ...(expiresAt ? { expiresAt } : {}) }) };
}

/** Caller opens only flow.url, and must keep poll()'s credential in main. */
export async function createPriorityLogin(providerId: string, options: LoginOptions): Promise<LoginFlow> {
  if (!(PRIORITY_LOGIN_PROVIDERS as readonly string[]).includes(providerId)) {
    const reason: Record<string, string> = {
      'opencode-go': 'OpenCode Go 使用订阅成员在原工作区创建的 API Key；固定源码没有浏览器授权回传协议。',
      'grok-build': '固定源码通过 Grok CLI 执行登录，未提供可独立移植的完整设备授权协议。',
      'kimi-code': '固定社区源码未包含 Kimi Code 独立授权协议。',
      'kimi-code-cn': '固定社区源码未包含 Kimi Code 国内独立授权协议。',
      'kimi-work': '固定源码只读取 Kimi Work 桌面登录，未提供独立网页授权协议。',
    };
    throw new PriorityLoginError('UNSUPPORTED', reason[providerId] || '该服务尚未提供独立登录协议');
  }
  const controller = new AbortController();
  let cancelled = false, completed: AccountCredential | null = null, inflight: Promise<AccountCredential | null> | undefined;
  let dispose = () => {};
  let expiry = options.now() + 10 * 60_000;
  const cancel = () => { cancelled = true; completed = null; controller.abort(); dispose(); options.signal?.removeEventListener('abort', cancel); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const check = () => {
    if (cancelled) throw new PriorityLoginError('CANCELLED', '登录已取消');
    if (options.now() >= expiry) { cancel(); throw new PriorityLoginError('EXPIRED', '登录已过期，请重新点击登录'); }
  };
  const request = async (url: string, init: RequestInit = {}, signal?: AbortSignal) => {
    check();
    try {
      const r = await options.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([controller.signal, signal || AbortSignal.timeout(15_000)]) });
      const text = await r.text(); check();
      if (text.length > 1024 * 1024) throw new PriorityLoginError('SCHEMA_CHANGED', '授权响应过大');
      let data: Obj = {}; try { data = obj(JSON.parse(text)); } catch { if (r.ok) throw new PriorityLoginError('SCHEMA_CHANGED', '授权响应格式无效'); }
      return { status: r.status, data };
    } catch (e) { if (e instanceof PriorityLoginError) throw e; check(); throw new PriorityLoginError('NETWORK', '无法连接授权服务，请重试'); }
  };
  const form = (url: string, body: Record<string, string>, signal?: AbortSignal) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(body).toString() }, signal);
  let flow: LoginFlow;
  let step: (signal: AbortSignal) => Promise<AccountCredential | null>;
  try {
    check();
    if (providerId === 'cursor') {
      const verifier = randomBytes(32).toString('base64url'), uuid = randomUUID();
      const url = new URL('https://cursor.com/loginDeepControl');
      url.search = new URLSearchParams({ challenge: createHash('sha256').update(verifier).digest('base64url'), uuid, mode: 'login', redirectTarget: 'cli' }).toString();
      flow = { url: url.href, instructions: `在浏览器登录 Cursor，完成后自动返回。${RELOGIN}`, expiresAt: expiry, intervalSeconds: 2, poll, cancel };
      step = async signal => {
        const r = await request(`https://api2.cursor.sh/auth/poll?${new URLSearchParams({ uuid, verifier })}`, { headers: { 'Content-Type': 'application/json', 'x-cursor-client-type': 'cli', 'x-cursor-client-version': 'cli-2026.09.23-86fc751' } }, signal);
        if (r.status === 404) return null;
        if (r.status !== 200) throw new PriorityLoginError(r.status === 403 ? 'DENIED' : 'NETWORK', 'Cursor 授权尚未完成或被拒绝');
        if (!str(r.data.accessToken) || !('refreshToken' in r.data)) throw new PriorityLoginError('SCHEMA_CHANGED', 'Cursor 授权响应缺少凭据');
        return credential(providerId, str(r.data.accessToken));
      };
    } else if (providerId === 'devin') {
      const verifier = randomBytes(48).toString('base64url'), state = randomBytes(24).toString('base64url');
      let code = '', denied = false, used = false;
      const server = createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        if (req.method !== 'GET' || u.pathname !== '/callback') { res.writeHead(404).end(); return; }
        if (cancelled || options.now() >= expiry || used) { res.writeHead(410).end('登录已结束，请回应用重试。'); return; }
        if (u.searchParams.get('state') !== state) { res.writeHead(400).end('登录状态不匹配。'); return; }
        if (u.searchParams.has('error')) { denied = true; used = true; res.end('授权未完成，请返回应用。'); return; }
        if (!u.searchParams.get('code')) { res.writeHead(400).end('缺少授权码。'); return; }
        code = u.searchParams.get('code')!; used = true;
        res.end('已收到授权，请返回应用完成登录。');
      });
      dispose = () => { server.close(); server.closeAllConnections(); };
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      check(); server.unref();
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('callback listener unavailable');
      const redirect = `http://127.0.0.1:${address.port}/callback`;
      const params = new URLSearchParams({ redirect_uri: redirect, state, prompt: 'select_account', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', cli_pkce_marker: '1' });
      flow = { url: `https://app.devin.ai/auth/cli/continue?${params}`, instructions: `在浏览器登录 Devin，完成后自动回到应用。${RELOGIN}`, expiresAt: expiry, intervalSeconds: 1, poll, cancel };
      step = async signal => {
        if (denied) throw new PriorityLoginError('DENIED', 'Devin 授权被拒绝');
        if (!code) return null;
        const r = await request('https://server.codeium.com/exa.seat_management_pb.SeatManagementService/ExchangeDevinCLIPKCECode', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirect }) }, signal);
        if (r.status !== 200) throw new PriorityLoginError('DENIED', 'Devin 授权码交换失败，请重新登录');
        const token = str(r.data.sessionToken) || str(r.data.session_token);
        code = ''; return credential(providerId, token);
      };
    } else {
      const start = await form(WORKOS + '/authorize/device', { client_id: FACTORY_CLIENT });
      const dc = start.data;
      if (start.status !== 200 || !str(dc.device_code) || !str(dc.user_code)) throw new PriorityLoginError('SCHEMA_CHANGED', 'Factory 未返回有效设备授权');
      const url = new URL(str(dc.verification_uri_complete) || str(dc.verification_uri));
      if (url.protocol !== 'https:' || url.username || url.password) throw new PriorityLoginError('SCHEMA_CHANGED', 'Factory 授权地址无效');
      expiry = options.now() + (typeof dc.expires_in === 'number' && dc.expires_in > 0 ? Math.min(dc.expires_in, 1800) : 300) * 1000;
      flow = { url: url.href, userCode: str(dc.user_code), instructions: `在 Factory 网页确认设备码。${RELOGIN}`, expiresAt: expiry, intervalSeconds: typeof dc.interval === 'number' ? Math.max(1, dc.interval) : 5, poll, cancel };
      step = async signal => {
        let r = await form(WORKOS + '/authenticate', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: str(dc.device_code), client_id: FACTORY_CLIENT }, signal);
        if (r.data.error === 'authorization_pending') return null;
        if (r.data.error === 'slow_down') { flow.intervalSeconds += 1; return null; }
        if (r.data.error === 'expired_token') throw new PriorityLoginError('EXPIRED', '设备码已过期，请重新登录');
        if (r.status !== 200 || r.data.error) throw new PriorityLoginError('DENIED', 'Factory 授权被拒绝');
        let token = str(r.data.access_token); if (!token) throw new PriorityLoginError('SCHEMA_CHANGED', 'Factory 未返回访问凭据');
        const c = claims(token);
        if (!str(r.data.organization_id) && !str(c.org_id) && !str(c.external_org_id)) {
          const orgs = await request('https://api.factory.ai/api/cli/org', { headers: { Authorization: `Bearer ${token}`, 'X-Factory-Client': 'cli', 'X-Client-Version': '0.242.0', 'User-Agent': 'factory-cli/0.242.0' } }, signal);
          const org = Array.isArray(orgs.data.workosOrgIds) ? str(orgs.data.workosOrgIds[0]) : '';
          if (org && str(r.data.refresh_token)) {
            r = await form(WORKOS + '/authenticate', { grant_type: 'refresh_token', refresh_token: str(r.data.refresh_token), client_id: FACTORY_CLIENT, organization_id: org }, signal);
            if (r.status !== 200 || !str(r.data.access_token)) throw new PriorityLoginError('DENIED', 'Factory 组织授权失败');
            token = str(r.data.access_token);
          }
        }
        const who = await request('https://api.factory.ai/api/cli/whoami', { headers: { Authorization: `Bearer ${token}`, 'X-Factory-Whoami-Extended': 'true' } }, signal);
        if (who.status !== 200) throw new PriorityLoginError('DENIED', 'Factory 未能确认账号及组织');
        return credential(providerId, token, { accountId: str(who.data.userId) || str(obj(r.data.user).id), email: str(who.data.email) || str(obj(r.data.user).email), organizationId: str(who.data.orgId), region: who.data.region === 'eu' ? 'eu' : 'us', ...(typeof r.data.expires_in === 'number' ? { expiresAt: options.now() + r.data.expires_in * 1000 } : {}) });
      };
    }
    const originalDispose = dispose;
    const timer = setTimeout(cancel, Math.max(1, expiry - options.now())); timer.unref();
    dispose = () => { clearTimeout(timer); originalDispose(); };
    return flow;
  } catch (e) { cancel(); throw e; }

  function poll(): Promise<AccountCredential | null> {
    try { check(); } catch (e) { return Promise.reject(e); }
    if (completed) return Promise.resolve(completed);
    if (inflight) return inflight;
    inflight = (async () => {
      const result = await step(AbortSignal.timeout(15_000)); check();
      if (result) { completed = result; dispose(); options.signal?.removeEventListener('abort', cancel); }
      return result;
    })().finally(() => { inflight = undefined; });
    return inflight;
  }
}
