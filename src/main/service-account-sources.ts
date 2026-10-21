/** Read-only source layouts ported from magpie-community/plugins
 * aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6 packages/{cursor,devin}/index.mjs
 * Copyright (c) 2026 magpie-community contributors, MIT (third_party).
 * No external refresh token is consumed and no source file is written.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountCredential, CredentialLocator } from './account-access';
import { OPENCODE_SOURCE_IDS, SERVICE_ACCESS, EXISTING_LOGIN_SERVICES } from '../shared/service-access';
import { parseZCodeCredential } from './adapters/zcode-adapter';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
function claims(token: string) { try { return object(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))); } catch { return {}; } }
// Magpie ba319a7: provider.go file/providers + balanceToken; balance.go:79–83.
// Installed/XDG layout only (appdir/appdir.go); no guessed portable paths.
function magpieAccountLocators(path: string): CredentialLocator[] {
  try {
    if (statSync(path).size > 8 * 1024 * 1024) throw new Error('size');
    const root = object(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')));
    if (!Array.isArray(root.providers)) throw new Error('schema');
    return [...new Set(root.providers.map(p => text(object(p).id)).filter(Boolean))].map(entry => ({ kind: 'service', format: 'magpie-aihubmix', path, entry }));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [{ kind: 'service', format: 'magpie-aihubmix', path }];
  }
}
export function serviceSourceLocators(home: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): CredentialLocator[] {
  const config = env.XDG_CONFIG_HOME || join(home, '.config');
  const data = env.XDG_DATA_HOME || join(home, '.local', 'share');
  const app = platform === 'win32' ? env.APPDATA || join(home, 'AppData', 'Roaming') : platform === 'darwin' ? join(home, 'Library', 'Application Support') : config;
  return [
    { kind: 'service', format: 'cursor', path: platform === 'win32' ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Cursor', 'auth.json') : platform === 'darwin' ? join(home, '.cursor', 'auth.json') : join(config, 'cursor', 'auth.json') },
    { kind: 'service', format: 'devin', path: platform === 'win32' ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'devin', 'credentials.toml') : join(data, 'devin', 'credentials.toml') },
    { kind: 'service', format: 'grok-build', path: join(env.GROK_HOME || join(home, '.grok'), 'auth.json') },
    { kind: 'service', format: 'kimi-work', path: join(app, 'kimi-desktop', 'daimon-share', 'daimon', 'config.json') },
    ...['zcode-team-cn', 'zcode-team-global', 'zcode-gift'].map(entry => ({ kind: 'service' as const, format: 'zcode', path: join(data, 'opencode', 'auth.json'), entry })),
    ...magpieAccountLocators(join(config, 'magpie', 'providers.json')),
    ...Object.keys(OPENCODE_SOURCE_IDS).filter(id=>!['kiro','minimax-code','minimax-code-global','workbuddy','workbuddy-ai','trae-cn','trae-global'].includes(id)).map(entry => ({ kind: 'service' as const, format: 'opencode', path: join(data, 'opencode', 'auth.json'), entry })),
  ];
}
export async function readServiceSource(locator: CredentialLocator): Promise<AccountCredential | null> {
  let raw: string;
  try { if ((await stat(locator.path)).size > 8 * 1024 * 1024) throw new Error('size'); raw = await readFile(locator.path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('无法读取账号来源；未输出文件内容'); }
  let token = '', identity = '', alias = '', providerId = '', accountId: string | undefined;
  let payload: Record<string, unknown> = {};
  if (locator.format === 'devin') {
    // Scalar TOML fields only. A custom server is not silently sent credentials
    // at the public server: it needs a separate reviewed endpoint registration.
    const scalar = (key: string) => raw.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\r\\n]*)"\\s*(?:#.*)?$`, 'm'))?.[1] ?? '';
    token = scalar('windsurf_api_key');
    const server = scalar('api_server_url');
    if (server && server.replace(/\/+$/, '') !== 'https://server.codeium.com') throw new Error('此 Devin 私有服务器尚未接入，未向公共服务器发送凭据');
    if (!token) return null;
    providerId = 'devin'; alias = 'Devin 账号';
    // Key-scoped until the supplier confirms identity; never merge by name.
    identity = `key:${hash(token)}`;
  } else {
    let root: Record<string, unknown>;
    try { root = object(JSON.parse(raw.replace(/^\uFEFF/, ''))); } catch { throw new Error('账号来源格式无法识别；未输出文件内容'); }
    if (locator.format === 'zcode') {
      // Community aee6b9d zcode/index.mjs:966,1146: access + refresh state JSON.
      const entry = object(root.zcode);
      if (entry.type !== 'oauth' || !text(entry.access)) return null;
      let state: Record<string, unknown>;
      try { state = object(JSON.parse(text(entry.refresh))); } catch { throw new Error('ZCode 登录状态无法识别'); }
      providerId = locator.entry || '';
      if (!['zcode-team-cn', 'zcode-team-global', 'zcode-gift'].includes(providerId)) return null;
      if (providerId === 'zcode-gift') {
        if (!text(state.jwt) || !text(state.device)) return null;
      } else {
        if (!text(state.org) || !text(state.project)) return null;
        if (state.site !== (providerId === 'zcode-team-cn' ? 'bigmodel' : 'zai')) return null;
      }
      const c = parseZCodeCredential(JSON.stringify({ ...entry, source: 'zcode', provider: providerId }), providerId);
      token = text(entry.access); accountId = text(entry.accountId) || undefined;
      identity = JSON.stringify([accountId || hash(JSON.stringify([c.key, c.token, c.jwt])), c.site, c.org || '', c.project || '', c.device || '']);
      payload = { ...entry, provider: providerId };
      alias = `${EXISTING_LOGIN_SERVICES.find(s=>s.id===providerId)!.name} 账号`;
    } else if (locator.format === 'magpie-aihubmix') {
      if (!Array.isArray(root.providers)) throw new Error('Magpie 供应商配置无法识别');
      const matches = root.providers.map(object).filter(p=>text(p.id)===locator.entry);
      if (matches.length > 1) throw new Error('Magpie 来源标识重复');
      const p = matches[0]; if (!p || !text(p.balanceToken)) return null;
      // A custom balanceURL overrides host inference upstream; do not reinterpret it.
      if (text(p.balanceURL)) return null;
      const urls = [p.chat, p.responses, p.anthropic].map(text).filter(Boolean);
      if (!urls.length || !urls.every(value=>{ try { const u=new URL(value); return u.protocol==='https:'&&u.hostname==='aihubmix.com'&&!u.username&&!u.password&&(!u.port||u.port==='443'); } catch { return false; } })) return null;
      token = text(p.balanceToken); providerId = 'aihubmix-account';
      identity = JSON.stringify([locator.entry, hash(token)]);
      payload = { provider: providerId, origin: 'https://aihubmix.com' };
      alias = 'AiHubMix 账号';
    } else if (locator.format === 'kimi-work') {
      const c = object(root.credentials), work = object(c.kimiCode), web = object(c.kimiWeb);
      if (text(work.baseUrl).replace(/\/$/, '') !== 'https://agent-gw.kimi.com/coding/v1' || !text(work.apiKey) || !text(web.accessToken) || !text(web.userId)) return null;
      token = text(web.accessToken); accountId = text(web.userId); providerId = 'kimi-work'; identity = accountId; alias = 'Kimi Work 账号';
    } else if (locator.format === 'cursor' || locator.format === 'grok-build') {
      token = text(root.accessToken) || text(root.access_token);
      if (locator.format === 'grok-build') {
        const selected = Object.keys(root).sort().map(k=>object(root[k])).find(c=>text(c.key));
        if (selected) { token = text(selected.key); accountId = text(selected.user_id) || text(claims(token).sub); }
      }
      if (!token) return null;
      accountId ||= text(claims(token).sub);
      if (!accountId && locator.format === 'cursor') throw new Error('Cursor 登录缺少账号标识，请重新登录');
      providerId = locator.format; identity = accountId || `opaque:${hash(token)}`; alias = providerId === 'cursor' ? 'Cursor 账号' : 'Grok Build 账号';
    } else {
      const entry = object(root[locator.entry || 'opencode-go']);
      token = text(entry.key) || text(entry.accessToken) || text(entry.access) || text(entry.token) || text(entry.deviceToken);
      if (!['api', 'oauth'].includes(text(entry.type)) || !token) return null;
      providerId = OPENCODE_SOURCE_IDS[locator.entry || 'opencode-go'];
      if (!providerId) return null;
      payload = { ...entry };
      if(locator.entry==='tencent-cloud'){
        let signed=entry;try{signed={...object(JSON.parse(token)),...entry};}catch{/* scalar access */}
        const selected=text(signed.region)||text(signed.Region);
        if(selected==='ap-singapore')providerId='tencent-token-plan-ap-singapore';
        payload = { ...signed };
      }
      // Preserve original provider metadata inside the encrypted envelope only.
      // No refresh/claim/model hooks are loaded. Region is part of identity.
      const region = text(payload.region) || text(payload.Region);
      if (locator.entry === 'kiro' && region === 'eu-central-1') providerId = 'kiro-eu-central-1';
      if (locator.entry === 'mimo-app') {
        let meta: Record<string, unknown> = {}; try { meta = object(JSON.parse(text(entry.refresh))); } catch { /* no metadata */ }
        const base = text(meta.base), r = text(meta.region).toLowerCase();
        if (base.includes('mimo-server-ru.') || r === 'ru') providerId = 'mimo-app-ru';
        if (base.includes('mimo-server-in.') || r === 'in') providerId = 'mimo-app-in';
      }
      accountId = text(entry.userId) || text(entry.uid) || text(entry.accountId) || text(claims(token).sub) || undefined;
      identity = JSON.stringify([accountId || `opaque:${hash(token)}`, region, entry.organizationId ?? entry.orgId ?? '', entry.workspaceId ?? '', entry.profileArn ?? '', entry.opGroupId ?? '', payload.teamId ?? payload.TeamId ?? '']);
      alias = `${[...SERVICE_ACCESS,...EXISTING_LOGIN_SERVICES].find(s=>s.id===providerId)?.name??'服务'} 账号`;
    }
  }
  const subject = `${providerId}:${hash(identity)}`;
  return { providerId, subject, alias, source: providerId, secret: JSON.stringify({ ...payload, accessToken: token, subject, alias, accountId, source: providerId, management: 'external', locator }) };
}
