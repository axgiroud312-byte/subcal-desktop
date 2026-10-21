/** Main-process ONLY. Read-only mappings from magpie-community/plugins
 * aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6 (MIT):
 * Copyright (c) 2026 magpie-community contributors.
 * kiro/index.mjs:57-165; workbuddy/index.mjs:1037-1082;
 * trae/index.mjs:376-420,803-900; minimax/index.mjs:1-8,819-836.
 * MiniMax deliberately has NO ~/.minimax reader in this baseline. Its saved
 * OpenCode OAuth is supported instead; Trae Global likewise has no invented
 * desktop path. No network, refresh consumption, source writes or renderer API.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { win32, posix } from 'node:path';
import type { AccountCredential } from './account-access';
import { SERVICE_ACCESS, EXISTING_LOGIN_SERVICES } from '../shared/service-access';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown): string => typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
const token = (v: unknown): string => typeof v === 'string' && v.trim() && !/[\r\n]/.test(v) ? v : '';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
export class DesktopSourceError extends Error {
  constructor(public readonly code: 'SOURCE_UNREADABLE' | 'SCHEMA_CHANGED' | 'AUTH_REQUIRED' | 'ACCOUNT_MISMATCH' | 'UNSUPPORTED', message: string) { super(message); this.name = 'DesktopSourceError'; }
}
const fail = (code: DesktopSourceError['code'], message: string): never => { throw new DesktopSourceError(code, message); };
function json(s: string): Obj {
  if (Buffer.byteLength(s, 'utf8') > 8 * 1024 * 1024) return fail('SOURCE_UNREADABLE', '账号来源过大');
  try { const v = JSON.parse(s.replace(/^\uFEFF/, '')); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(); return v; }
  catch { return fail('SCHEMA_CHANGED', '账号来源格式无效；未输出文件内容'); }
}

export interface DesktopSourceLocator {
  kind: 'service';
  format: 'kiro-cli' | 'kiro-ide' | 'workbuddy-desktop' | 'trae-desktop' | 'desktop-opencode';
  path: string;
  entry?: string;
}
export interface DesktopSourceOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** null means positively absent. Permission/codec errors MUST throw. */
  readText?: (path: string) => Promise<string | null>;
  /** Fixed SELECT auth_kv entry; implementations must open SQLite read-only. */
  readKiroEntry?: (path: string, key: string) => Promise<string | null>;
  /** Optional host-provided codec. Never call external apps or write a source. */
  decrypt?: (value: unknown, context: { format: 'workbuddy' | 'trae'; path: string; field: string }) => Promise<string>;
}

const oauthIDs = ['kiro', 'workbuddy', 'workbuddy-ai', 'trae-cn', 'trae-global', 'minimax-code', 'minimax-code-global'] as const;
export function desktopSourceLocators(options: DesktopSourceOptions = {}): DesktopSourceLocator[] {
  const env = options.env ?? process.env, platform = options.platform ?? process.platform;
  const home = options.home ?? env.HOME ?? homedir(), p = platform === 'win32' ? win32 : posix;
  const cli = platform === 'win32' ? p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'kiro-cli', 'data.sqlite3') : platform === 'darwin' ? p.join(home, 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3') : p.join(home, '.local', 'share', 'kiro-cli', 'data.sqlite3');
  const wb = platform === 'win32' ? p.join(home, 'AppData', 'Local', 'CodeBuddyExtension') : platform === 'darwin' ? p.join(home, 'Library', 'Application Support', 'CodeBuddyExtension') : p.join(home, '.local', 'share', 'CodeBuddyExtension');
  const roots = platform === 'win32' ? [env.APPDATA || p.join(home, 'AppData', 'Roaming'), p.join(home, 'AppData', 'Roaming')] : [platform === 'darwin' ? p.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || p.join(home, '.config')];
  const traePaths = roots.flatMap(root => (platform === 'darwin' ? ['Trae CN'] : ['Trae CN', 'trae-cn']).map(name => p.join(root, name, 'User', 'globalStorage', 'storage.json')));
  const unique = [...new Map(traePaths.map(path => [platform === 'win32' ? path.toLowerCase() : path, path])).values()];
  const auth = p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'opencode', 'auth.json');
  return [
    ...['social', 'odic', 'external-idp'].map(kind => ({ kind: 'service' as const, format: 'kiro-cli' as const, path: cli, entry: `kirocli:${kind}:token` })),
    { kind: 'service', format: 'kiro-ide', path: p.join(home, '.aws', 'sso', 'cache', 'kiro-auth-token.json') },
    ...['workbuddy', 'workbuddy-ai'].map(entry => ({ kind: 'service' as const, format: 'workbuddy-desktop' as const, path: p.join(wb, 'Data', 'Public', 'auth', entry === 'workbuddy' ? 'workbuddy-desktop.info' : 'workbuddy-desktop-ai.info'), entry })),
    ...unique.map(path => ({ kind: 'service' as const, format: 'trae-desktop' as const, path, entry: 'trae-cn' })),
    ...oauthIDs.map(entry => ({ kind: 'service' as const, format: 'desktop-opencode' as const, path: auth, entry })),
  ];
}

async function defaultText(path: string): Promise<string | null> {
  try { if ((await stat(path)).size > 8 * 1024 * 1024) return fail('SOURCE_UNREADABLE', '账号文件过大'); return await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; if (e instanceof DesktopSourceError) throw e; return fail('SOURCE_UNREADABLE', '账号来源不可读；未输出路径或内容'); }
}
async function defaultKiroEntry(path: string, key: string): Promise<string | null> {
  try { await stat(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; return fail('SOURCE_UNREADABLE', 'Kiro 数据库不可读'); }
  let db: import('node:sqlite').DatabaseSync | undefined;
  try { const { DatabaseSync } = await import('node:sqlite'); db = new DatabaseSync(path, { readOnly: true }); const row = db.prepare('SELECT value FROM auth_kv WHERE key = ?').get(key); return row ? String(row.value) : null; }
  catch { return fail('SOURCE_UNREADABLE', 'Kiro 只读 SQLite 不可用或读取被拒绝'); }
  finally { db?.close(); }
}
function when(v: unknown): number | undefined {
  const s = str(v); if (!s) return undefined;
  const n = /^\d+(?:\.\d+)?$/.test(s) ? Number(s) * (Number(s) < 1e11 ? 1000 : 1) : Date.parse(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function credentials(providerId: string, locator: DesktopSourceLocator, original: Obj, region: string, uid: string, organization: string): AccountCredential {
  // Local user metadata is NOT proof of token validity. No unverified JWT claims
  // are used to guess an identity. Without an explicit source identity, rotations
  // invalidate the snapshot binding and require another selection.
  const context = [original.profileArn ?? original.profile ?? '', original.domain ?? '', original.host ?? '', original.authHost ?? ''];
  const subject = `${providerId}:${hash(canonical([region, organization, context, uid ? ['source-identity', uid] : ['snapshot', original]]))}`;
  const alias = `${[...SERVICE_ACCESS,...EXISTING_LOGIN_SERVICES].find(s=>s.id===providerId)?.name??'服务'} 账号`;
  const source = locator.format;
  return { providerId, subject, alias, organization, source, secret: JSON.stringify({
    ...original, rawAuth: original, provider: providerId, region, subject, alias, source, management: 'external', locator,
    accessToken: original.access, refreshToken: original.refresh,
    expiresAt: when(original.expires),
  }) };
}
async function decoded(value: unknown, locator: DesktopSourceLocator, field: string, format: 'workbuddy' | 'trae', options: DesktopSourceOptions): Promise<string> {
  if (!options.decrypt) return fail('SOURCE_UNREADABLE', format === 'workbuddy' ? 'WorkBuddy 加密登录不可读，请使用正式登录；不能判定为没有账号' : 'Trae 登录使用客户端编码，需主进程提供只读解码器或使用正式登录');
  try { const s = await options.decrypt(value, { format, path: locator.path, field }); if (!token(s)) throw new Error(); return s; }
  catch { return fail('SOURCE_UNREADABLE', '登录解密失败；未输出原始错误或凭据'); }
}

/** Secrets and locators returned here must stay in main-process memory/storage.
 * This is not a renderer discovery DTO; callers expose only their opaque ID and
 * masked label. Expiry/validity is verified by the separate read-only adapter. */
export async function readDesktopSource(locator: DesktopSourceLocator, options: DesktopSourceOptions = {}): Promise<AccountCredential | null> {
  const read = async (path: string) => {
    try { const s = await (options.readText ?? defaultText)(path); if (s !== null && s.length > 8 * 1024 * 1024) return fail('SOURCE_UNREADABLE', '账号文件过大'); return s; }
    catch (e) { if (e instanceof DesktopSourceError) throw e; return fail('SOURCE_UNREADABLE', '账号来源不可读；未输出原始错误'); }
  };
  if (locator.format === 'kiro-cli') {
    if (!/^kirocli:(social|odic|external-idp):token$/.test(locator.entry ?? '')) return fail('UNSUPPORTED', 'Kiro 来源条目不受支持');
    let s: string | null;
    try { s = await (options.readKiroEntry ?? defaultKiroEntry)(locator.path, locator.entry!); }
    catch { return fail('SOURCE_UNREADABLE', 'Kiro 数据库读取失败；未输出原始错误'); }
    if (s === null) return null;
    const m = json(s); if (!token(m.access_token)) return null;
    const region = str(m.region) || 'us-east-1';
    const original = { ...m, access: m.access_token, refresh: m.refresh_token, expires: when(m.expires_at), profileArn: m.profile_arn, method: locator.entry!.includes(':social:') ? 'social' : locator.entry!.includes(':odic:') ? 'idc' : 'external-idp' };
    return credentials(`kiro-${region}`, locator, original, region, str(m.uid ?? m.user_id), str(m.organization_id ?? m.tenant_id));
  }
  const s = await read(locator.path); if (s === null) return null;
  const root = json(s);
  if (locator.format === 'kiro-ide') {
    if (!token(root.accessToken)) return null;
    const region = str(root.region) || 'us-east-1';
    // No auxiliary client secret needed: this module never refreshes credentials.
    return credentials(`kiro-${region}`, locator, { ...root, access: root.accessToken, refresh: root.refreshToken, expires: when(root.expiresAt), method: str(root.authMethod).toLowerCase() === 'social' ? 'social' : 'idc' }, region, str(root.uid ?? root.userId), str(root.organizationId ?? root.tenantId));
  }
  if (locator.format === 'workbuddy-desktop') {
    const id = locator.entry; if (id !== 'workbuddy' && id !== 'workbuddy-ai') return fail('UNSUPPORTED', 'WorkBuddy 地区来源无效');
    const a = obj(root.auth), who = obj(root.account);
    let access = token(a.accessToken), refresh = token(a.refreshToken);
    if (obj(a.accessToken).$wbEncrypted) access = await decoded(a.accessToken, locator, 'accessToken', 'workbuddy', options);
    if (obj(a.refreshToken).$wbEncrypted) refresh = await decoded(a.refreshToken, locator, 'refreshToken', 'workbuddy', options);
    if (!access) return null;
    const region = id === 'workbuddy' ? 'copilot.tencent.com' : 'www.workbuddy.ai';
    return credentials(id, locator, { ...a, access, refresh, expires: when(a.expiresAt), uid: who.uid, enterpriseId: who.enterpriseId, account: who }, region, str(who.uid), str(who.enterpriseId));
  }
  if (locator.format === 'trae-desktop') {
    const raw = root['iCubeAuthInfo://icube.cloudide']; if (raw === undefined || raw === '') return null;
    let a: Obj;
    if (typeof raw === 'string') a = raw.trim().startsWith('{') ? json(raw) : json(await decoded(raw, locator, 'icube.cloudide', 'trae', options));
    else return fail('SCHEMA_CHANGED', 'Trae 客户端账号格式已变化');
    const access = token(a.token); if (!access) return null;
    const devices = Object.keys(root).filter(k => k.startsWith('iCubeAuthInfo://icube-dc:')).map(k => k.slice('iCubeAuthInfo://icube-dc:'.length));
    const deviceId = devices.length === 1 && /^\d{8,20}$/.test(devices[0]) ? devices[0] : '';
    if (!deviceId) return fail('SCHEMA_CHANGED', 'Trae 设备标识缺失或不唯一；未虚构设备');
    const account=obj(a.account);
    return credentials('trae-cn', locator, { ...a, access, refresh: a.refreshToken, uid: a.userId, deviceId, account }, 'CN', str(a.userId), str(account.organizationId??account.enterpriseId??account.workspaceId));
  }
  if (locator.format !== 'desktop-opencode' || !oauthIDs.includes(locator.entry as typeof oauthIDs[number])) return fail('UNSUPPORTED', '账号来源格式不受支持');
  const id = locator.entry!, a = obj(root[id]);
  // A plugin's desktop marker holds NO access token. Do not advertise it as a
  // signed-in account or invent an identity; the actual desktop locator is used.
  if (a.type !== 'oauth' || !token(a.access)) return null;
  let region: string, providerId = id;
  if (id === 'kiro') {
    region = str(a.region) || 'us-east-1'; providerId = `kiro-${region}`;
  } else if (id === 'trae-global') {
    const regionValue = str(a.region ?? a.aiRegion ?? a.Region ?? a.AIRegion);
    if (regionValue && !/^(US|SG)(?:[-_ ]|$)/i.test(regionValue)) return fail('SCHEMA_CHANGED', 'Trae 国际地区尚未识别');
    const api = str(a.api);
    if (!regionValue && !/api-us|coreva|coresg|api-sg/i.test(api)) return fail('SCHEMA_CHANGED', 'Trae 国际来源缺少明确地区；未猜测部署');
    const us = /^US(?:[-_ ]|$)/i.test(regionValue) || /api-us|coreva/i.test(api);
    if (/^SG(?:[-_ ]|$)/i.test(regionValue) && /api-us|coreva/i.test(api)) return fail('SCHEMA_CHANGED', 'Trae 地区与部署主机冲突');
    region = us ? 'US' : regionValue || 'SG'; providerId = us ? 'trae-global-us' : 'trae-global-sg';
  } else region = ({ workbuddy: 'copilot.tencent.com', 'workbuddy-ai': 'www.workbuddy.ai', 'trae-cn': 'CN', 'minimax-code': 'cn', 'minimax-code-global': 'en' } as Record<string, string>)[id];
  const uid = str(a.uid ?? a.realUserID);
  const organization = [a.enterpriseId,a.opGroupId,a.workspaceID??a.workspaceId].map(str).filter(Boolean).join(' · ');
  return credentials(providerId, locator, a, region, uid, organization);
}

/** Re-read on selection/refresh, rejecting account or region changes. No OAuth
 * exchange is performed; opaque snapshots deliberately require reselection. */
export async function resolveDesktopSource(locator: DesktopSourceLocator, expected: Pick<AccountCredential, 'subject' | 'providerId'>, options: DesktopSourceOptions = {}): Promise<AccountCredential> {
  const fresh = await readDesktopSource(locator, options);
  if (!fresh) return fail('AUTH_REQUIRED', '选定来源已退出登录或凭据不存在');
  if (fresh.subject !== expected.subject || fresh.providerId !== expected.providerId) return fail('ACCOUNT_MISMATCH', '来源账号、组织、地区或不透明凭据已变化，请重新选择');
  return fresh;
}
