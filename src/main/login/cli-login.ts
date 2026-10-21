import { spawn, execFile, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, stat, realpath } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, delimiter, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { AccountCredential } from '../account-access';
import type { LoginFlow, LoginOptions } from './types';

export const CLI_LOGIN_PROVIDERS = ['claude-local', 'grok-build'] as const;
export interface CliLoginFlow extends LoginFlow { submit?(code: string): Promise<void> }
export interface CliLoginOptions extends LoginOptions {
  /** Main-process/test injection only; never accept these fields from renderer IPC. */
  cli?: {
    executable?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string; tempRoot?: string;
    spawn?: (file: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
    readText?: (path: string) => Promise<string>;
    systemSecret?: (service: string, remove: boolean) => Promise<string | null>;
    linkTimeoutMs?: number; lifetimeMs?: number; pasteGraceMs?: number;
  };
}
export class CliLoginError extends Error {
  constructor(public readonly code: 'RUNTIME_MISSING' | 'CANCELLED' | 'EXPIRED' | 'CLI_FAILED' | 'NO_URL' | 'CREDENTIAL_UNREADABLE' | 'INVALID_CODE', message: string) { super(message); this.name = 'CliLoginError'; }
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const parse = (s: string) => object(JSON.parse(s.replace(/^\uFEFF/, '')));
const claims = (s: string) => { try { return parse(Buffer.from(s.split('.')[1], 'base64url').toString()); } catch { return {}; } };

async function executable(provider: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): Promise<string | undefined> {
  const grok = provider === 'grok-build', name = (grok ? 'grok' : 'claude') + (platform === 'win32' ? '.exe' : '');
  const own = grok ? [env.GROK_BIN_DIR, join(env.GROK_HOME || join(home, '.grok'), 'bin'), join(home, '.grok', 'bin')] : [join(home, '.local', 'bin'), ...(platform==='win32' && env.APPDATA ? [join(env.APPDATA,'npm','node_modules','@anthropic-ai','claude-code','bin')] : [])];
  for (const dir of [...own, ...(env.PATH || env.Path || '').split(delimiter)]) {
    if (!dir || !isAbsolute(dir)) continue;
    const file = join(dir, name);
    try {
      if (!(await stat(file)).isFile()) continue;
      if (grok && !own.includes(dir) && !(await realpath(file)).replaceAll('\\', '/').toLowerCase().includes('/.grok/')) continue;
      return file;
    } catch { /* next installed location */ }
  }
}
function keychain(service: string, remove: boolean): Promise<string | null> {
  return new Promise((resolve, reject) => execFile('/usr/bin/security', [remove ? 'delete-generic-password' : 'find-generic-password', '-s', service, '-a', userInfo().username, ...(remove ? [] : ['-w'])], { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) { if (Number(error.code) === 44) resolve(null); else reject(new CliLoginError('CREDENTIAL_UNREADABLE', '无法访问此次登录的系统凭据。')); }
    else { const raw = stdout.trim(); resolve(/^(?:[a-f\d]{2})+$/i.test(raw) ? Buffer.from(raw, 'hex').toString() : raw); }
  }));
}
function loginUrl(raw: string, claude: boolean): string | undefined {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password) return;
    if (!(claude ? ['claude.ai', 'claude.com', 'console.anthropic.com', 'platform.claude.com'] : ['auth.x.ai', 'accounts.x.ai', 'grok.com']).includes(u.hostname)) return;
    if (/\/(?:token|device\/code)$/.test(u.pathname)) return;
    return u.href;
  } catch { return; }
}
function loopback(raw: string): boolean {
  try { const u = new URL(new URL(raw).searchParams.get('redirect_uri') || ''); return ['http:', 'https:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch { return false; }
}

export async function createCliLogin(providerId: string, options: CliLoginOptions): Promise<CliLoginFlow> {
  if (!(CLI_LOGIN_PROVIDERS as readonly string[]).includes(providerId)) throw new Error('不支持此 CLI 登录提供方。');
  const d = options.cli || {}, platform = d.platform || process.platform, claude = providerId === 'claude-local';
  const env = { ...(d.env || process.env) }, file = d.executable || await executable(providerId, env, platform, d.home || homedir());
  if (!file) throw new CliLoginError('RUNTIME_MISSING', `未找到 ${claude ? 'Claude Code' : 'Grok Build'} 官方 CLI。请先安装官方运行组件，再回到此处点击登录；无需在终端登录。`);
  if (options.signal?.aborted) throw new CliLoginError('CANCELLED', '登录已取消。');
  const dir = await mkdtemp(join(d.tempRoot || (platform==='win32' && env.LOCALAPPDATA ? join(env.LOCALAPPDATA,'Temp','opencode') : tmpdir()), 'subcal-cli-login-'));
  const read = d.readText || ((p: string) => readFile(p, 'utf8'));
  const service = 'Claude Code-credentials-' + hash(dir.normalize('NFC')).slice(0, 8);
  const system = d.systemSecret || keychain;
  let child: ChildProcessWithoutNullStreams | undefined, failure: CliLoginError | undefined, closed = false, exitCode: number | null = null;
  let result: AccountCredential | undefined, cleaning: Promise<void> | undefined, printed = '', printedAt = 0, output = '', userCode: string | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => cleaning ||= (async () => {
    if (lifetime) clearTimeout(lifetime);
    options.signal?.removeEventListener('abort', abort);
    if (child && !closed) {
      const stopped = new Promise<void>(resolve => { child!.once('close', () => resolve()); setTimeout(resolve, 2000).unref(); });
      if (platform === 'win32' && child.pid) {
        await new Promise<void>(resolve => execFile('taskkill.exe', ['/PID', String(child!.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 }, () => resolve()));
      } else if (child.pid && !d.spawn) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      else child.kill('SIGKILL');
      await stopped;
    }
    if (claude && platform === 'darwin') await system(service, true).catch(() => null);
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  })();
  const stop = (error: CliLoginError) => { if (!result) failure ||= error; void cleanup(); };
  const abort = () => stop(new CliLoginError('CANCELLED', '登录已取消。'));
  const expiresAt = options.now() + (d.lifetimeMs ?? 10 * 60_000);
  const check = () => { if (!result && options.now() >= expiresAt) stop(new CliLoginError('EXPIRED', '登录已过期，请重新点击登录。')); if (failure) throw failure; };
  try {
    for (const k of Object.keys(env)) if (/^(?:ANTHROPIC_|CLAUDE_|CLAUDECODE$|GROK_|XAI_API_KEY$|BROWSER$)/i.test(k)) delete env[k];
    env[claude ? 'CLAUDE_CONFIG_DIR' : 'GROK_HOME'] = dir;
    const opened = join(dir, '.opened-url');
    env.SUBCAL_CLI_OPENED_URL = opened;
    const browser = join(dir, platform === 'win32' ? 'browser.cmd' : 'browser');
    if (platform === 'win32') {
      await writeFile(join(dir, 'browser.ps1'), 'param([string]$Url)\nif ($Url.StartsWith("https://")) { [IO.File]::WriteAllText($env:SUBCAL_CLI_OPENED_URL, $Url) }\n', { mode: 0o600 });
      await writeFile(browser, '@echo off\r\npowershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0browser.ps1" -Url "%~1"\r\n', { mode: 0o700 });
    } else await writeFile(browser, '#!/bin/sh\ncase "$1" in https://*) umask 077; printf "%s" "$1" > "$SUBCAL_CLI_OPENED_URL";; esac\n', { mode: 0o700 });
    env.BROWSER = browser;
    child = (d.spawn || spawn)(file, claude ? ['auth', 'login', '--claudeai'] : ['login', '--device-auth'], { cwd: dir, env, windowsHide: true, detached: platform !== 'win32', stdio: 'pipe' });
    const onData = (chunk: Buffer | string) => {
      output = (output + chunk.toString()).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').slice(-16384);
      for (const line of output.split(/[\r\n]/).slice(0, -1)) {
        if (/\berror\b/i.test(line)) continue;
        for (const match of line.matchAll(/https:\/\/[^\s<>"']+/g)) { const url = loginUrl(match[0], claude); if (url && !printed) { printed = url; printedAt = options.now(); } }
      }
      userCode ||= /(?:enter|code)\s*[:：]?\s*([A-Z0-9]{4}-[A-Z0-9]{4})\b/i.exec(output)?.[1];
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.stdin.on('error', () => stop(new CliLoginError('CLI_FAILED', '登录组件输入通道已关闭，请重试。')));
    child.on('error', (e: NodeJS.ErrnoException) => stop(new CliLoginError(e.code === 'ENOENT' ? 'RUNTIME_MISSING' : 'CLI_FAILED', '官方登录组件无法启动，请检查安装后重试。')));
    child.on('close', code => { onData('\n'); closed = true; exitCode = code; if (code !== 0 && !failure) stop(new CliLoginError('CLI_FAILED', '官方登录未完成，请重新点击登录。')); });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    lifetime = setTimeout(() => stop(new CliLoginError('EXPIRED', '登录已过期，请重新点击登录。')), d.lifetimeMs ?? 10 * 60_000); lifetime.unref();
    const deadline = Date.now() + (d.linkTimeoutMs ?? 30_000);
    let url = '';
    while (!url) {
      check();
      const captured = loginUrl(await read(opened).catch(() => ''), claude);
      if (captured && (!claude || loopback(captured))) url = captured;
      else if (printed && (!claude || options.now() - printedAt >= (d.pasteGraceMs ?? 3000) || closed)) url = printed;
      else if (captured && Date.now() >= deadline) url = captured;
      if (!url && (Date.now() >= deadline || closed)) throw new CliLoginError('NO_URL', '登录组件没有返回可用授权页面，请检查网络和组件版本后重试。');
      if (!url) await new Promise(resolve => setTimeout(resolve, 50));
    }
    const paste = claude && !loopback(url);
    let polling: Promise<AccountCredential | null> | undefined;
    const poll = async (): Promise<AccountCredential | null> => {
      check(); if (result) return result;
      if (!closed) return null;
      if (exitCode !== 0) throw new CliLoginError('CLI_FAILED', '官方登录未完成。');
      try {
        let raw: string | null = null;
        if (claude && platform === 'darwin') raw = await system(service, false);
        raw ||= await read(join(dir, claude ? '.credentials.json' : 'auth.json'));
        const root = parse(raw), entry = claude ? object(root.claudeAiOauth) : Object.values(root).map(object).find(v => text(v.key));
        if (!entry) throw new Error();
        const token = text(claude ? entry.accessToken : entry.key), identity = claims(token);
        const subject = text(entry.accountId) || text(entry.user_id) || text(identity.sub) || text(entry.email) || (token ? hash(token) : '');
        const alias = text(entry.email) || text(identity.email) || (claude ? 'Claude Code' : 'Grok Build');
        const expiry = claude ? Number(entry.expiresAt) : Date.parse(text(entry.expires_at));
        if (!token || !subject || (Number.isFinite(expiry) && expiry > 0 && expiry <= options.now())) throw new Error();
        check();
        result = { providerId, subject, alias, source: claude ? 'claude' : 'grok-build', secret: JSON.stringify({ accessToken: token, subject, alias, source: claude ? 'claude' : 'grok-build', management: 'static', ...(Number.isFinite(expiry) && expiry > 0 ? { expiresAt: expiry } : {}) }) };
        await cleanup(); return result;
      } catch { stop(new CliLoginError('CREDENTIAL_UNREADABLE', '登录组件未留下可读取的有效凭据，请更新官方组件后重试。')); throw failure; }
    };
    return { url, userCode, expiresAt, intervalSeconds: 1,
      instructions: paste ? '在官方页面完成登录后，将页面显示的授权码粘贴到本应用。' : !claude && ['win32', 'darwin'].includes(platform) ? '官方组件可能已打开浏览器，请在授权页面完成登录。' : '请在浏览器完成授权，本应用会自动确认。',
      poll: () => polling ||= poll().finally(() => { polling = undefined; }), cancel: abort,
      ...(paste ? { submit: async (code: string) => { check(); if (closed || !/^[^\s\x00-\x1f\x7f]{1,4096}$/.test(code.trim())) throw new CliLoginError('INVALID_CODE', '请输入官方页面显示的完整授权码。'); await new Promise<void>((resolve, reject) => child!.stdin.write(code.trim() + '\n', e => e ? reject(new CliLoginError('CLI_FAILED', '授权码提交失败，请重试。')) : resolve())); } } : {}),
    };
  } catch (e) { await cleanup(); if (e instanceof CliLoginError) throw e; throw new CliLoginError('CLI_FAILED', '无法启动官方登录，请检查组件安装和目录权限。'); }
}
