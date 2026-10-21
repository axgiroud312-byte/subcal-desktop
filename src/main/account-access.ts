/**
 * Read-only credential discovery and in-memory device authorization.
 * Protocol/layout references (MIT; license notices are integrated by the parent task):
 * Copyright (c) 2026 yetone, yetone/magpie@ba319a7587923fc7a4ea3859658244d591261a59:
 * internal/provider/{account.go,copilot_cli.go,codex_store.go,claude_dirs.go,importapps.go},
 * internal/gui/importapps.go (opaque candidates and re-read on import).
 * Copyright (c) 2025 Jason Young, farion1231/cc-switch@c776fd0ebfe35d769b5909b86bdfa1ccdf089988:
 * src-tauri/src/proxy/providers/{codex_oauth_auth.rs,copilot_auth.rs},
 * src-tauri/src/services/subscription.rs (storage identity, OAuth, refresh serialization).
 * No source files, keychain entries or external databases are ever written here.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join, resolve as absolute } from 'node:path';
import { execFile } from 'node:child_process';
import { hashKeySubject } from './adapters/http-adapters';
import { readServiceSource, serviceSourceLocators } from './service-account-sources';
import { copilotHost } from '../shared/copilot-host';
import { desktopSourceLocators, readDesktopSource, DesktopSourceError, type DesktopSourceLocator } from './desktop-account-sources';
import { OFFICIAL_ADAPTER_CATALOG } from '../shared/types';
import { tencentTeamCredential } from './tencent-account-teams';

export interface AccountCredential { providerId: string; subject: string; alias: string; organization?: string; secret: string; source?: string }
export interface DiscoveredAccount { id: string; providerId: string; alias: string; source: string; organization?: string }
export type AccountSource = string;
export interface CredentialLocator { kind: 'codex' | 'claude' | 'editor' | 'cli' | 'api' | 'service'; path: string; entry?: string; format?: string }
export interface CredentialEnvelope {
  accessToken: string; refreshToken?: string; expiresAt?: number; accountId?: string;
  /** Membership claim only; never populated from the access token expiry. */
  membershipExpiresAt?: string;
  plan?: string;
  host?: string;
  subject: string; alias: string; source: AccountSource; management: 'external' | 'managed';
  locator?: CredentialLocator; generation?: number;
  tencentBaseSubject?: string; teamId?: string;
}
export class AccountAccessError extends Error {
  constructor(public readonly code: 'SOURCE_UNREADABLE' | 'ACCOUNT_MISMATCH' | 'AUTH_REQUIRED' | 'UNSUPPORTED' | 'NETWORK' | 'SCHEMA_CHANGED' | 'STALE_GENERATION', message: string) { super(message); this.name = 'AccountAccessError'; }
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const fail = (code: AccountAccessError['code'], message: string): never => { throw new AccountAccessError(code, message); };
const missing = (e: unknown) => obj(e).code === 'ENOENT';
function json(text: string): Obj {
  try { return obj(JSON.parse(text.replace(/^\uFEFF/, ''))); } catch { return fail('SCHEMA_CHANGED', '凭据配置不是有效 JSON；未输出原始内容'); }
}
/** JSONC scanner preserves comment-like strings (URLs and tokens). */
function jsonc(text: string): Obj {
  let out = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quoted) { out += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; out += c; }
    else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; out += ' '; }
    else if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
    else out += c;
  }
  return json(out);
}
function jwt(token: string): Obj { try { return obj(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))); } catch { return {}; } }
function mask(v: string): string { const at = v.indexOf('@'); return at > 0 ? `${v.slice(0, 2)}***${v.slice(at)}` : `${v.slice(0, 2)}***`; }
function envelope(c: AccountCredential): CredentialEnvelope | undefined {
  if (!c.secret.startsWith('{')) return undefined;
  const e = json(c.secret);
  if (!str(e.accessToken) || !['external', 'managed'].includes(str(e.management)) || e.subject !== c.subject) return fail('AUTH_REQUIRED', '凭据封装无效');
  return e as unknown as CredentialEnvelope;
}
const CODEX_CLIENT = 'app_EMoamEEZ73f0CkXaXp7hrann';
const GITHUB_CLIENT = 'Iv1.b507a08c87ecfe98';
type Login = { id: string; providerId: string; device: string; userCode: string; verificationUri: string; intervalSeconds: number; expiresAt: number; nextPoll: number; epoch: number; result?: AccountCredential; exchange?: Obj };
export interface AccountAccessOptions {
  home?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; now?: () => number; fetch?: typeof fetch;
  /** Returns null only for positively absent entries; denied/unavailable MUST throw. */
  readSystemSecret?: (service: string, account: string) => Promise<string | null>;
}

export class AccountAccess {
  private readonly home: string; private readonly env: NodeJS.ProcessEnv; private readonly platform: NodeJS.Platform;
  private readonly now: () => number; private readonly http: typeof fetch;
  private readonly candidates = new Map<string, { locator: CredentialLocator; subject: string; providerId: string }>();
  private readonly logins = new Map<string, Login>();
  private readonly loginEpoch = new Map<string, number>();
  private readonly polls = new Map<string, Promise<{ status: 'pending' | 'complete' | 'expired'; credential?: AccountCredential }>>();
  private readonly locks = new Map<string, Promise<AccountCredential>>();
  private readonly managed = new Map<string, AccountCredential>();
  private readonly claudeIdentities = new Map<string, { accountId: string; organization: string; email: string }>();
  constructor(private readonly options: AccountAccessOptions = {}) {
    this.home = options.home ?? homedir(); this.env = options.env ?? process.env; this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now; this.http = options.fetch ?? fetch;
  }
  private async text(path: string): Promise<string | null> {
    try { if ((await stat(path)).size > 8 * 1024 * 1024) fail('SOURCE_UNREADABLE', '凭据配置过大，未读取'); return await readFile(path, 'utf8'); }
    catch (e) { if (missing(e)) return null; if (e instanceof AccountAccessError) throw e; return fail('SOURCE_UNREADABLE', '无法读取凭据配置（权限、文件类型或系统错误）'); }
  }
  private async system(service: string, account: string): Promise<string | null> {
    if (this.options.readSystemSecret) {
      try { return await this.options.readSystemSecret(service, account); } catch { return fail('SOURCE_UNREADABLE', '系统凭据库不可读或访问被拒绝'); }
    }
    if (this.platform === 'win32') return this.windowsSecret(service, account);
    if (this.platform !== 'darwin' && this.platform !== 'linux') return fail('SOURCE_UNREADABLE', '当前平台的系统凭据库尚不可读，不能判定为没有账号');
    const run = (command: string, args: string[]) => new Promise<string | null>((resolve, reject) => {
      execFile(command, args, { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          if (this.platform === 'darwin' && Number(error.code) === 44) resolve(null);
          else if (this.platform === 'linux' && Number(error.code) === 1 && !error.killed && !stderr.trim()) resolve(null);
          else reject(new AccountAccessError('SOURCE_UNREADABLE', '系统凭据库不可读、授权被拒或读取超时'));
        } else resolve(stdout.trim() || null);
      });
    });
    if (this.platform === 'darwin') {
      const raw = await run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w']);
      if (raw && /^(?:[a-fA-F0-9]{2})+$/.test(raw)) { const decoded = Buffer.from(raw, 'hex').toString('utf8'); if (decoded.startsWith('{')) return decoded; }
      return raw;
    }
    return await run('secret-tool', ['lookup', 'service', service, 'account', account]) ?? await run('secret-tool', ['lookup', 'service', service, 'username', account]);
  }
  private windowsSecret(service: string, account: string): Promise<string | null> {
    // Known keytar (service/account) and keyring-rs v3 (account.service) targets.
    // Values travel over a private pipe, never command arguments, disk or logs.
    const script = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SubCalCred {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
  public UInt32 Flags, Type; public string TargetName, Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist, AttributeCount;
  public IntPtr Attributes; public string TargetAlias, UserName;
 }
 [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);
 [DllImport("advapi32.dll", EntryPoint="CredFree")] public static extern void Free(IntPtr credential);
}
'@
foreach($target in @(($env:SUBCAL_CRED_SERVICE+'/'+$env:SUBCAL_CRED_ACCOUNT), ($env:SUBCAL_CRED_ACCOUNT+'.'+$env:SUBCAL_CRED_SERVICE))) {
 $p=[IntPtr]::Zero
 if(-not [SubCalCred]::Read($target,1,0,[ref]$p)) { if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168){continue}; exit 3 }
 try {
  $c=[Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][SubCalCred+CREDENTIAL])
  if($c.CredentialBlobSize -gt 1048576){exit 3}
  $b=New-Object byte[] $c.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$b.Length)
  [Console]::Out.Write([Convert]::ToBase64String($b)); exit 0
 } finally {if($p -ne [IntPtr]::Zero){[SubCalCred]::Free($p)}}
}
exit 44`;
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        env: { ...process.env, SUBCAL_CRED_SERVICE: service, SUBCAL_CRED_ACCOUNT: account }, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8',
      }, (error, stdout) => {
        if (error) { if (Number(error.code) === 44) resolve(null); else reject(new AccountAccessError('SOURCE_UNREADABLE', 'Windows 凭据读取失败或访问被拒绝')); return; }
        const bytes = Buffer.from(stdout.trim(), 'base64');
        const wide = bytes.length > 1 && bytes.length % 2 === 0 && bytes[1] === 0;
        resolve(bytes.toString(wide ? 'utf16le' : 'utf8').replace(/\0+$/, '') || null);
      });
    });
  }
  private pack(providerId: string, source: AccountSource, accessToken: string, identity: string, alias: string, extra: Partial<CredentialEnvelope> = {}, organization?: string): AccountCredential {
    const subject = `${source.startsWith('copilot') ? 'copilot' : source}:${hash(identity)}`;
    const e: CredentialEnvelope = { accessToken, subject, alias, source, management: 'external', ...extra };
    return { providerId, subject, alias, organization, source, secret: JSON.stringify(e) };
  }
  private codex(raw: Obj, locator?: CredentialLocator): AccountCredential | null {
    if (raw.auth_mode && raw.auth_mode !== 'chatgpt') return null;
    const t = obj(raw.tokens), access = str(t.access_token); if (!access) return null;
    const accessClaims = jwt(access), idClaims = jwt(str(t.id_token));
    const claims = { ...accessClaims, ...idClaims }, auth = { ...obj(accessClaims['https://api.openai.com/auth']), ...obj(idClaims['https://api.openai.com/auth']) };
    const accountId = str(t.account_id) || str(auth.chatgpt_account_id), user = str(auth.chatgpt_user_id) || str(claims.sub);
    if (!accountId || !user) return fail('SCHEMA_CHANGED', 'Codex 凭据缺少稳定账号标识，不能安全绑定');
    const email = str(claims.email) || str(obj(claims['https://api.openai.com/profile']).email);
    return this.pack('codex-local', 'codex', access, `${accountId}:${user}`, email ? `Codex (${mask(email)})` : 'Codex 账号', {
      accountId, refreshToken: str(t.refresh_token) || undefined, expiresAt: typeof jwt(access).exp === 'number' ? Number(jwt(access).exp) * 1000 : undefined, locator,
      membershipExpiresAt: str(obj(jwt(str(t.id_token))['https://api.openai.com/auth']).chatgpt_subscription_active_until) || undefined,
    });
  }
  private async readCodex(locator: CredentialLocator): Promise<AccountCredential | null> {
    const config = await this.text(join(locator.path, 'config.toml')) ?? '';
    // Only root storage and [features] are relevant; do not mistake a profile's key for root.
    const root = config.split(/^\s*\[/m)[0];
    const match = root.match(/^\s*cli_auth_credentials_store\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m);
    if (/^\s*cli_auth_credentials_store\s*=/m.test(root) && !match) fail('SCHEMA_CHANGED', 'Codex 凭据存储配置无法解析');
    const mode = match?.[1] ?? 'file';
    if (!['file', 'auto', 'keyring', 'ephemeral'].includes(mode)) fail('SCHEMA_CHANGED', 'Codex 凭据存储方式未知');
    if (mode === 'ephemeral') return fail('SOURCE_UNREADABLE', 'Codex 使用仅内存凭据，无法从本机文件发现');
    if (mode !== 'file') {
      const features = (config.split(/^\s*\[features\]\s*$/m)[1] ?? '').split(/^\s*\[/m)[0];
      const encrypted = features.match(/^\s*secret_auth_storage\s*=\s*(true|false)/m)?.[1];
      if (encrypted === 'true' || (encrypted !== 'false' && this.platform === 'win32')) return fail('SOURCE_UNREADABLE', 'Codex 使用加密系统存储，当前不可读；不会改用可能属于其他账号的 auth.json');
      let canonical = locator.path; try { canonical = await realpath(canonical); } catch { /* upstream hashes original path when canonicalization fails */ }
      const raw = await this.system('Codex Auth', `cli|${hash(canonical).slice(0, 16)}`);
      if (raw !== null) return this.codex(json(raw), locator);
      if (mode === 'keyring') return null;
    }
    const raw = await this.text(join(locator.path, 'auth.json')); return raw === null ? null : this.codex(json(raw), locator);
  }
  private async readClaude(locator: CredentialLocator): Promise<AccountCredential | null> {
    let raw: string | null = null;
    const custom = absolute(locator.path) !== absolute(join(this.home, '.claude'));
    if (this.platform === 'darwin') {
      const service = custom ? `Claude Code-credentials-${hash(locator.path.normalize('NFC')).slice(0, 8)}` : 'Claude Code-credentials';
      let user = this.env.USER; if (!user) { try { user = userInfo().username; } catch { user = ''; } }
      raw = await this.system(service, /^[a-zA-Z0-9._-]+$/.test(user) ? user : 'claude-code-user');
    }
    if (raw === null) raw = await this.text(join(locator.path, '.credentials.json'));
    if (raw === null) return null;
    const root = json(raw), t = obj(root.claudeAiOauth ?? root['claude.ai_oauth']), token = str(t.accessToken); if (!token) return null;
    // The profile file can lag a logout/login. Never attach its identity to a new
    // opaque token without verifying that token's read-only OAuth profile first.
    const profilePath = custom ? join(locator.path, '.claude.json') : join(this.home, '.claude.json');
    const profileText = await this.text(profilePath), local = profileText ? obj(json(profileText).oauthAccount) : {};
    let identity = this.claudeIdentities.get(hash(token));
    if (!identity) {
      const response = await this.request('https://api.anthropic.com/api/oauth/profile', undefined, token, false, { 'anthropic-beta': 'oauth-2025-04-20' });
      if (response.status === 401 || response.status === 403) return fail('AUTH_REQUIRED', 'Claude OAuth 身份核验被拒绝，请在官方客户端重新登录');
      if (response.status !== 200) return fail('SOURCE_UNREADABLE', 'Claude OAuth 身份接口不可用，无法安全核实不透明令牌所属账号');
      const account = obj(response.data.account), organization = obj(response.data.organization);
      const accountId = str(account.uuid) || str(response.data.account_uuid), org = str(organization.uuid) || str(response.data.organization_uuid);
      if (!accountId || !org) return fail('SCHEMA_CHANGED', 'Claude 身份响应缺少账号或组织 UUID，未使用令牌指纹伪造账号身份');
      identity = { accountId, organization: org, email: str(account.email_address) || str(response.data.email_address) };
      if (this.claudeIdentities.size > 64) this.claudeIdentities.clear();
      this.claudeIdentities.set(hash(token), identity);
    }
    if ((str(local.accountUuid) && local.accountUuid !== identity.accountId) || (str(local.organizationUuid) && local.organizationUuid !== identity.organization)) return fail('ACCOUNT_MISMATCH', 'Claude 配置身份与令牌身份不一致，请等待官方客户端完成登录');
    return this.pack('claude-local', 'claude', token, `${identity.accountId}:${identity.organization}`, identity.email ? `Claude (${mask(identity.email)})` : 'Claude Code 账号', { accountId: identity.accountId, refreshToken: str(t.refreshToken) || undefined, expiresAt: typeof t.expiresAt === 'number' ? t.expiresAt : undefined, plan: str(t.subscriptionType) || undefined, locator }, identity.organization);
  }
  private async readEditor(locator: CredentialLocator): Promise<AccountCredential | null> {
    const text = await this.text(locator.path); if (text === null) return null;
    const item = obj(jsonc(text)[locator.entry!]), token = str(item.oauth_token), user = str(item.user);
    if (!token) return null;
    let host: string; try { host = copilotHost(locator.entry!.split(':')[0]); } catch { return fail('UNSUPPORTED', '此 Copilot 主机尚未适配，未向其他主机发送凭据'); }
    return this.pack('copilot-local', 'copilot-editor', token, user ? `${host}:${user.toLowerCase()}` : `${host}:opaque:${hash(token)}`, user ? `Copilot (${mask(user)}${host !== 'github.com' ? ` · ${host}` : ''})` : 'Copilot 编辑器账号', { locator, host });
  }
  private async readCli(locator: CredentialLocator): Promise<AccountCredential | null> {
    const text = await this.text(locator.path); if (text === null) return null;
    const cfg = jsonc(text), users = [cfg.lastLoggedInUser, ...(Array.isArray(cfg.loggedInUsers) ? cfg.loggedInUsers : [])].map(obj);
    const user = users.find(u => `${str(u.host).replace(/\/$/, '')}:${str(u.login)}` === locator.entry);
    if (!user) return null;
    let host: string; try { host = copilotHost(str(user.host)); } catch { return fail('UNSUPPORTED', '此 Copilot CLI 主机尚未适配'); }
    const token = str(obj(cfg.copilotTokens)[locator.entry!]) || await this.system('copilot-cli', locator.entry!);
    if (!token) return null;
    return this.pack('copilot-local', 'copilot-cli', token, `${host}:${str(user.login).toLowerCase()}`, `Copilot CLI (${mask(str(user.login))}${host !== 'github.com' ? ` · ${host}` : ''})`, { locator, host });
  }
  private providerFor(base: string): string | undefined {
    try { const u = new URL(base); if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return undefined;
      return ({ 'api.deepseek.com': 'deepseek-balance', 'api.moonshot.cn': 'kimi-platform-cn', 'openrouter.ai': 'openrouter-key' } as Record<string, string>)[u.hostname];
    } catch { return undefined; }
  }
  private apiCredential(providerId: string, key: string, locator: CredentialLocator): AccountCredential {
    // API-key identity is necessarily key-scoped; never embed keys in candidate IDs.
    const names:Record<string,string>={'deepseek-balance':'DeepSeek API','kimi-platform-cn':'Kimi API 国内站','openrouter-key':'OpenRouter'};
    return { providerId, subject: hashKeySubject(providerId, key), alias: `${names[providerId]??'API'} 账号`, source: locator.format ?? 'api', secret: key };
  }
  private async apiEntries(locator: CredentialLocator): Promise<Map<string, AccountCredential>> {
    const entries = new Map<string, AccountCredential>();
    const add = (id: string, base: string, key: string, provider?: string) => { const p = provider ?? this.providerFor(base); if (p && key) entries.set(id, this.apiCredential(p, key, { ...locator, entry: id })); };
    if (locator.format === 'cc-switch' || locator.format === 'alma') {
      try { await stat(locator.path); } catch (e) { if (missing(e)) return entries; return fail('SOURCE_UNREADABLE', 'CC Switch 数据库不可读'); }
      let db: import('node:sqlite').DatabaseSync | undefined;
      try {
        const { DatabaseSync } = await import('node:sqlite'); db = new DatabaseSync(locator.path, { readOnly: true });
        if (locator.format === 'alma') {
          const defaults: Record<string, string> = { deepseek: 'https://api.deepseek.com', moonshot: 'https://api.moonshot.cn', openrouter: 'https://openrouter.ai' };
          for (const row of db.prepare('SELECT id, type, api_key, base_url, enabled FROM providers').all()) {
            if (row.enabled) add(String(row.id), str(row.base_url) || defaults[str(row.type)] || '', str(row.api_key));
          }
          return entries;
        }
        const rows = db.prepare('SELECT id, app_type, settings_config FROM providers').all();
        for (const row of rows) {
          const s = json(str(row.settings_config)), env = obj(s.env), opts = obj(s.options);
          add(`${row.app_type}:${row.id}`, str(env.ANTHROPIC_BASE_URL) || str(s.baseUrl) || str(s.baseURL) || str(opts.baseURL), str(env.ANTHROPIC_AUTH_TOKEN) || str(env.ANTHROPIC_API_KEY) || str(s.apiKey) || str(opts.apiKey));
          // Codex providers store auth JSON and TOML config together.
          const cfg = str(s.config), auth = typeof s.auth === 'string' ? json(s.auth) : obj(s.auth);
          add(`${row.app_type}:${row.id}:codex`, cfg.match(/^\s*base_url\s*=\s*["']([^"']+)["']/m)?.[1] ?? '', str(auth.OPENAI_API_KEY));
        }
      } catch { return fail('SOURCE_UNREADABLE', 'CC Switch 数据库读取失败或本机 SQLite 不可用'); } finally { db?.close(); }
      return entries;
    }
    const raw = await this.text(locator.path); if (raw === null) return entries;
    if (locator.format === 'codex-config') {
      const authText = await this.text(join(absolute(locator.path, '..'), 'auth.json'));
      const auth = authText ? json(authText) : {};
      for (const block of raw.split(/^\s*\[/m)) {
        const base = block.match(/^\s*base_url\s*=\s*["']([^"']+)["']/m)?.[1]; if (!base) continue;
        const envKey = block.match(/^\s*env_key\s*=\s*["']([^"']+)["']/m)?.[1];
        add(hash(base), base, envKey ? str(this.env[envKey]) : str(auth.OPENAI_API_KEY));
      }
    } else {
      const root = jsonc(raw);
      if (locator.format === 'opencode') {
        const known: Record<string, string> = { deepseek: 'deepseek-balance', moonshot: 'kimi-platform-cn', 'moonshot-cn': 'kimi-platform-cn', openrouter: 'openrouter-key' };
        for (const [id, v] of Object.entries(root)) { const a = obj(v); if (a.type === 'api' && known[id]) add(id, '', str(a.key), known[id]); }
      } else {
        const env = obj(root.env); add('env', str(env.ANTHROPIC_BASE_URL), str(env.ANTHROPIC_AUTH_TOKEN) || str(env.ANTHROPIC_API_KEY));
      }
    }
    return entries;
  }
  private async readLocator(locator: CredentialLocator): Promise<AccountCredential | null> {
    switch (locator.kind) {
      case 'codex': return this.readCodex(locator);
      case 'claude': return this.readClaude(locator);
      case 'editor': return this.readEditor(locator);
      case 'cli': return this.readCli(locator);
      case 'api': return (await this.apiEntries(locator)).get(locator.entry!) ?? null;
      case 'service': return this.readService(locator);
      default: return fail('AUTH_REQUIRED', '凭据来源定位无效');
    }
  }
  private async readService(locator:CredentialLocator):Promise<AccountCredential|null>{
    try{
      return ['kiro-cli','kiro-ide','workbuddy-desktop','trae-desktop','desktop-opencode'].includes(locator.format??'')
        ? await readDesktopSource(locator as DesktopSourceLocator,{home:this.home,env:this.env,platform:this.platform})
        : await readServiceSource(locator);
    }catch(e){if(e instanceof DesktopSourceError)throw new AccountAccessError(e.code,e.message);throw new AccountAccessError('SOURCE_UNREADABLE',e instanceof Error?e.message:'无法读取已有登录');}
  }
  async discover(): Promise<{ accounts: DiscoveredAccount[]; warnings: string[] }> {
    const accounts: DiscoveredAccount[] = [], warnings: string[] = [];
    const codex = absolute(this.env.CODEX_HOME || join(this.home, '.codex')), claude = absolute(this.env.CLAUDE_CONFIG_DIR || join(this.home, '.claude'));
    const add = (c: AccountCredential, locator: CredentialLocator) => {
      const id = hash(`${JSON.stringify(locator)}:${c.subject}`);
      this.candidates.set(id, { locator, subject: c.subject, providerId: c.providerId });
      const names:Record<string,string>={codex:'Codex 本机登录',claude:'Claude Code 本机登录',cursor:'Cursor 本机登录',devin:'Devin 本机登录','opencode-go':'OpenCode 已有凭据','copilot-editor':'Copilot 编辑器登录','copilot-cli':'Copilot CLI 登录',opencode:'OpenCode 配置','claude-settings':'Claude Code 供应商配置','codex-config':'Codex 供应商配置','cc-switch':'CC Switch 配置',alma:'Alma 配置'};
      accounts.push({ id, providerId: c.providerId, alias: c.alias, source: names[c.source??'']??'供应商配置', organization: c.organization });
    };
    const attempt = async (label: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { warnings.push(`${label}：${e instanceof AccountAccessError ? e.message : '读取失败，未输出原始错误'}`); } };
    for (const locator of [{ kind: 'codex', path: codex }, { kind: 'claude', path: claude }] as CredentialLocator[]) {
      await attempt(locator.kind, async () => { const c = await this.readLocator(locator); if (c) add(c, locator); });
    }
    const claudeDirs = new Set([absolute(join(this.home, '.claude'))]);
    // Existing isolated Magpie accounts are read where the original client
    // maintains them; SubCal never creates directories or transfers refreshes.
    const savedRoot = join(this.env.XDG_CONFIG_HOME || join(this.home, '.config'), 'magpie', 'claude-accounts');
    await attempt('Claude Code 多账号', async () => {
      let entries; try { entries = await readdir(savedRoot, { withFileTypes: true }); } catch (e) { if (missing(e)) return; throw e; }
      for (const entry of entries.slice(0, 128)) if (entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name)) claudeDirs.add(join(savedRoot, entry.name));
    });
    for (const path of claudeDirs) if (absolute(path) !== claude) await attempt('Claude Code 已有账号', async () => {
      const locator: CredentialLocator = { kind: 'claude', path }; const c = await this.readClaude(locator); if (c) add(c, locator);
    });
    const configDirs = new Set([this.env.XDG_CONFIG_HOME || join(this.home, '.config')]);
    if (this.platform === 'win32') configDirs.add(this.env.LOCALAPPDATA || join(this.home, 'AppData', 'Local'));
    for (const dir of configDirs) for (const name of ['apps.json', 'hosts.json']) {
      const path = join(dir, 'github-copilot', name);
      await attempt(`Copilot 编辑器 ${name}`, async () => {
        const raw = await this.text(path); if (raw === null) return;
        for (const entry of Object.keys(jsonc(raw))) await attempt('Copilot 编辑器账号', async () => { const locator: CredentialLocator = { kind: 'editor', path, entry }; const c = await this.readEditor(locator); if (c) add(c, locator); });
      });
    }
    const cliPath = join(this.env.COPILOT_HOME || join(this.home, '.copilot'), 'config.json');
    await attempt('Copilot CLI', async () => {
      const raw = await this.text(cliPath); if (raw === null) return;
      const cfg = jsonc(raw), users = [cfg.lastLoggedInUser, ...(Array.isArray(cfg.loggedInUsers) ? cfg.loggedInUsers : [])].map(obj);
      for (const entry of new Set(users.filter(u => str(u.login)).map(u => `${str(u.host).replace(/\/$/, '')}:${str(u.login)}`))) await attempt('Copilot CLI 账号', async () => {
        const locator: CredentialLocator = { kind: 'cli', path: cliPath, entry }; const c = await this.readCli(locator); if (c) add(c, locator);
      });
    });
    const sources = [
      { format: 'opencode', path: join(this.env.XDG_DATA_HOME || join(this.home, '.local', 'share'), 'opencode', 'auth.json') },
      { format: 'claude-settings', path: join(claude, 'settings.json') },
      { format: 'codex-config', path: join(codex, 'config.toml') },
      { format: 'cc-switch', path: join(this.home, '.cc-switch', 'cc-switch.db') },
      { format: 'alma', path: join(this.platform === 'darwin' ? join(this.home, 'Library', 'Application Support') : this.platform === 'win32' ? this.env.APPDATA || join(this.home, 'AppData', 'Roaming') : this.env.XDG_CONFIG_HOME || join(this.home, '.config'), 'alma', 'chat_threads.db') },
    ];
    for (const source of sources) await attempt(source.format, async () => {
      const locator: CredentialLocator = { kind: 'api', ...source };
      for (const [entry, c] of await this.apiEntries(locator)) add(c, { ...locator, entry });
    });
    for (const locator of [...serviceSourceLocators(this.home, this.env, this.platform),...desktopSourceLocators({home:this.home,env:this.env,platform:this.platform})]) await attempt(locator.format ?? '账号', async () => {
      const c = await this.readService(locator); if (c&&OFFICIAL_ADAPTER_CATALOG.some(a=>a.adapterId===c.providerId)) add(c, locator);
    });
    return { accounts, warnings };
  }
  async resolve(candidateId: string): Promise<AccountCredential> {
    const selected = this.candidates.get(candidateId); if (!selected) return fail('AUTH_REQUIRED', '候选已失效，请重新发现账号');
    const fresh = await this.readLocator(selected.locator);
    if (!fresh) return fail('AUTH_REQUIRED', '选定来源已退出登录或凭据已删除');
    if (fresh.subject !== selected.subject || fresh.providerId !== selected.providerId) return fail('ACCOUNT_MISMATCH', '发现后来源账号已变化，请重新选择；未导入新账号');
    return fresh;
  }
  async refreshExternal(credential: AccountCredential): Promise<AccountCredential> {
    const e = envelope(credential);
    if (!e) return credential; // API keys have no external token refresh contract.
    if (e.management !== 'external' || !e.locator) return fail('AUTH_REQUIRED', '外部凭据缺少来源定位');
    const fresh = await this.readLocator(e.locator);
    if (!fresh) return fail('AUTH_REQUIRED', '原来源凭据已删除或退出登录');
    const originalSubject = credential.providerId.startsWith('tencent-token-plan-') && e.tencentBaseSubject ? e.tencentBaseSubject : credential.subject;
    if (fresh.subject !== originalSubject || fresh.providerId !== credential.providerId || fresh.source !== e.source) return fail('ACCOUNT_MISMATCH', '来源账号已切换；已停止更新原绑定，未覆写新账号');
    if (e.tencentBaseSubject && credential.providerId.startsWith('tencent-token-plan-')) {
      const bound = tencentTeamCredential(fresh, { id: e.teamId ?? '', name: credential.alias });
      if (bound.subject !== credential.subject) return fail('ACCOUNT_MISMATCH', '团队绑定已变化');
      return bound;
    }
    return fresh;
  }
  private async request(url: string, body?: Obj, bearer?: string, form = false, extraHeaders: Record<string, string> = {}): Promise<{ status: number; data: Obj }> {
    try {
      const response = await this.http(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/json', 'User-Agent': 'SubCal-Desktop/0.1', ...extraHeaders, ...(body ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        body: body ? form ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString() : JSON.stringify(body) : undefined,
      });
      const text = await response.text(); if (text.length > 1024 * 1024) fail('SCHEMA_CHANGED', '授权响应过大');
      let data: Obj; try { data = obj(JSON.parse(text)); } catch { data = {}; }
      return { status: response.status, data };
    } catch (e) { if (e instanceof AccountAccessError) throw e; return fail('NETWORK', '授权服务请求失败或超时；未输出请求和响应内容'); }
  }
  private checked(response: { status: number; data: Obj }): Obj {
    if (response.status < 200 || response.status >= 300 || response.data.error) return fail(response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED' : 'NETWORK', `授权服务拒绝请求（HTTP ${response.status}）`);
    return response.data;
  }
  async startLogin(providerId: string): Promise<{ id: string; userCode: string; verificationUri: string; intervalSeconds: number; expiresAt: number }> {
    if (!['codex-local', 'copilot-local'].includes(providerId)) return fail('UNSUPPORTED', '此供应商尚不支持设备码授权');
    // New login invalidates an older outstanding login even if its network response arrives later.
    const epoch = (this.loginEpoch.get(providerId) ?? 0) + 1; this.loginEpoch.set(providerId, epoch);
    for (const [id, l] of this.logins) if (l.providerId === providerId || l.expiresAt <= this.now()) this.logins.delete(id);
    const codex = providerId === 'codex-local';
    const data = this.checked(await this.request(codex ? 'https://auth.openai.com/api/accounts/deviceauth/usercode' : 'https://github.com/login/device/code', codex ? { client_id: CODEX_CLIENT } : { client_id: GITHUB_CLIENT, scope: 'read:user' }, undefined, !codex));
    if (this.loginEpoch.get(providerId) !== epoch) return fail('STALE_GENERATION', '此授权流程已被新流程替代');
    const device = str(codex ? data.device_auth_id : data.device_code), userCode = str(data.user_code);
    if (!device || !userCode) return fail('SCHEMA_CHANGED', '设备授权响应缺少必要字段');
    const intervalSeconds = Math.max(1, Math.min(60, Number(data.interval) || 5));
    const expiresAt = this.now() + Math.max(1, Math.min(1800, Number(data.expires_in) || 900)) * 1000;
    const id = randomUUID(), verificationUri = codex ? 'https://auth.openai.com/codex/device' : 'https://github.com/login/device';
    this.logins.set(id, { id, providerId, device, userCode, verificationUri, intervalSeconds, expiresAt, nextPoll: this.now() + intervalSeconds * 1000, epoch });
    return { id, userCode, verificationUri, intervalSeconds, expiresAt };
  }
  pollLogin(id: string): Promise<{ status: 'pending' | 'complete' | 'expired'; credential?: AccountCredential }> {
    const active = this.polls.get(id); if (active) return active;
    const run = this.poll(id).finally(() => { if (this.polls.get(id) === run) this.polls.delete(id); }); this.polls.set(id, run); return run;
  }
  private async poll(id: string): Promise<{ status: 'pending' | 'complete' | 'expired'; credential?: AccountCredential }> {
    const l = this.logins.get(id);
    if (!l || l.expiresAt <= this.now() || this.loginEpoch.get(l.providerId) !== l.epoch) { this.logins.delete(id); return { status: 'expired' }; }
    if (l.result) return { status: 'complete', credential: { ...l.result } };
    if (this.now() < l.nextPoll) return { status: 'pending' };
    l.nextPoll = this.now() + l.intervalSeconds * 1000;
    const codex = l.providerId === 'codex-local';
    let data = l.exchange;
    if (!data) {
      const response = await this.request(codex ? 'https://auth.openai.com/api/accounts/deviceauth/token' : 'https://github.com/login/oauth/access_token', codex ? { device_auth_id: l.device, user_code: l.userCode } : { client_id: GITHUB_CLIENT, device_code: l.device, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, undefined, !codex);
      const error = str(response.data.error);
      if (error === 'slow_down' || response.status === 429) { l.intervalSeconds = Math.min(300, l.intervalSeconds + 5); l.nextPoll = this.now() + l.intervalSeconds * 1000; return { status: 'pending' }; }
      if (error === 'authorization_pending' || (codex && [403, 404].includes(response.status))) return { status: 'pending' };
      if (['expired_token', 'access_denied'].includes(error) || response.status === 410) { this.logins.delete(id); return { status: 'expired' }; }
      data = this.checked(response); l.exchange = data;
    }
    let credential: AccountCredential;
    if (codex) {
      if (!str(data.authorization_code) || !str(data.code_verifier)) return fail('SCHEMA_CHANGED', 'Codex 授权响应缺少交换参数');
      const t = this.checked(await this.request('https://auth.openai.com/oauth/token', { grant_type: 'authorization_code', client_id: CODEX_CLIENT, code: data.authorization_code, code_verifier: data.code_verifier, redirect_uri: 'https://auth.openai.com/deviceauth/callback' }, undefined, true));
      credential = this.codex({ auth_mode: 'chatgpt', tokens: t }) ?? fail('SCHEMA_CHANGED', 'Codex 授权未返回有效凭据');
    } else {
      const access = str(data.access_token); if (!access) return fail('SCHEMA_CHANGED', 'GitHub 授权未返回访问令牌');
      const user = this.checked(await this.request('https://api.github.com/user', undefined, access));
      if (!str(user.login) || !(typeof user.id === 'number' || str(user.id))) return fail('SCHEMA_CHANGED', 'GitHub 未返回稳定用户身份');
      credential = this.pack('copilot-local', 'copilot-device', access, `github.com:${str(user.login).toLowerCase()}`, `Copilot (${mask(str(user.login))})`, { accountId: String(user.id) });
    }
    if (this.logins.get(id) !== l || l.expiresAt <= this.now() || this.loginEpoch.get(l.providerId) !== l.epoch) return { status: 'expired' };
    const e = envelope(credential)!; e.management = 'managed'; delete e.locator;
    const key = `${credential.providerId}:${credential.subject}`, previous = this.managed.get(key);
    e.generation = (previous ? envelope(previous)!.generation ?? 0 : 0) + 1;
    credential.secret = JSON.stringify(e); this.managed.set(key, credential); l.result = credential; l.exchange = undefined; l.device = '';
    return { status: 'complete', credential: { ...credential } };
  }
  async refresh(credential: AccountCredential): Promise<AccountCredential> {
    const e = envelope(credential); if (!e) return credential;
    if (e.management === 'external') return this.refreshExternal(credential);
    const key = `${credential.providerId}:${credential.subject}`;
    const cached = this.managed.get(key);
    if (cached && cached.secret !== credential.secret) {
      if ((envelope(cached)!.generation ?? 0) >= (e.generation ?? 0)) return { ...cached };
      if (this.locks.has(key)) return fail('STALE_GENERATION', '刷新进行中，不能采用另一代凭据');
    }
    const active = this.locks.get(key); if (active) return active;
    if (e.source === 'codex' && e.expiresAt && e.expiresAt > this.now() + 120000) return { ...credential };
    // Device-flow GitHub tokens have no expiry and no refresh grant.
    if (e.source === 'copilot-device' && (!e.expiresAt || e.expiresAt > this.now() + 120000)) return { ...credential };
    this.managed.set(key, { ...credential });
    const task = this.refreshManaged(credential, e, key).finally(() => { if (this.locks.get(key) === task) this.locks.delete(key); });
    this.locks.set(key, task); return task;
  }
  private async refreshManaged(c: AccountCredential, e: CredentialEnvelope, key: string): Promise<AccountCredential> {
    let next: AccountCredential;
    if (e.source === 'codex') {
      if (!e.refreshToken) return fail('AUTH_REQUIRED', '托管 Codex 凭据缺少刷新令牌，请重新授权');
      const response=await this.request('https://auth.openai.com/oauth/token', { client_id: CODEX_CLIENT, grant_type: 'refresh_token', refresh_token: e.refreshToken, scope: 'openid profile email' }, undefined, true);
      const errorCode=str(response.data.error)||str(obj(response.data.error).code);
      if(['refresh_token_reused','refresh_token_expired','refresh_token_invalidated','invalid_grant'].includes(errorCode)||[400,401,403].includes(response.status)) {
        const live=this.managed.get(key);
        if(live&&live.secret!==c.secret&&(envelope(live)!.generation??0)>(e.generation??0))return {...live};
        return fail('AUTH_REQUIRED','登录已失效或刷新令牌已被替换，请重新登录；保留已有资料');
      }
      const t = this.checked(response);
      // A refresh can omit id_token; access_token must still identify the same account.
      next = this.codex({ auth_mode: 'chatgpt', tokens: { ...t, account_id: e.accountId } }) ?? fail('SCHEMA_CHANGED', '刷新未返回有效 Codex 凭据');
      if (next.subject !== c.subject) return fail('ACCOUNT_MISMATCH', '刷新返回了另一账号，已拒绝更新');
      const ne = envelope(next)!; ne.refreshToken ||= e.refreshToken; ne.management = 'managed'; ne.generation = (e.generation ?? 0) + 1; next.secret = JSON.stringify(ne);
    } else if (e.source === 'copilot-device') {
      // GitHub device tokens do not expire/rotate via a refresh grant. Validate
      // identity; editor session-token exchange belongs to the usage adapter.
      const user = this.checked(await this.request('https://api.github.com/user', undefined, e.accessToken));
      if (String(user.id) !== e.accountId || `copilot:${hash(`github.com:${str(user.login).toLowerCase()}`)}` !== c.subject) return fail('ACCOUNT_MISMATCH', 'GitHub 凭据身份不匹配');
      next = { ...c, secret: JSON.stringify({ ...e, generation: (e.generation ?? 0) + 1 }) };
    } else return fail('UNSUPPORTED', '此来源不支持托管刷新');
    const latest = this.managed.get(key);
    if (latest?.secret !== c.secret) return latest ? { ...latest } : fail('STALE_GENERATION', '凭据代次已失效');
    this.managed.set(key, next); return { ...next };
  }
}
