import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export type LocalRuntime = { path: string; command: string; args: string[]; version: string };

// Only locate installed official entrypoints. Never interpret cmd/PowerShell
// wrappers, accept renderer paths, download a runtime, or read auth files.
export async function findRuntime(name: 'codex' | 'copilot'): Promise<LocalRuntime | null> {
  const dirs = [...new Set([
    ...(process.env.PATH || '').split(path.delimiter),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
    path.join(os.homedir(), '.local', 'bin'),
  ].filter(p => p && path.isAbsolute(p) && path.resolve(p) !== process.cwd()))];
  const packageName = name === 'codex' ? '@openai/codex' : '@github/copilot';
  const candidates: { path: string; command: string; args: string[] }[] = [];
  for (const dir of dirs) {
    const executable = path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    if (fs.existsSync(executable)) candidates.push({ path: executable, command: executable, args: [] });
    const root = path.join(dir, 'node_modules', packageName);
    try {
      const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      if (metadata.name !== packageName) continue;
      const entry = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[name];
      if (typeof entry !== 'string') continue;
      const resolved = path.resolve(root, entry);
      if (!resolved.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(resolved)) continue;
      if (resolved.endsWith('.js')) candidates.push({ path: resolved, command: process.execPath, args: [resolved] });
    } catch { /* not an installed npm runtime */ }
  }
  for (const candidate of candidates) {
    try {
      const { stdout } = await exec(candidate.command, [...candidate.args, '--version'], {
        timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      const version = stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
      if (version) return { ...candidate, version };
    } catch { /* continue to another installed entrypoint */ }
  }
  return null;
}

export function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}
