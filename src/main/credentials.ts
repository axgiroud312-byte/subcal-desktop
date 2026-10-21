import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SafeStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface VaultEntry {
  ref: string;
  connectionId: string;
  cipherBase64: string;
  mask: string;
  updatedAt: number;
}

interface VaultFile {
  version: 1;
  entries: Record<string, VaultEntry>;
}

export function maskSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= 6) {
    return `****${trimmed.slice(-1)}`;
  }
  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  }
  const prefix = trimmed.startsWith('sk-or-')
    ? 'sk-or-'
    : trimmed.startsWith('sk-')
      ? 'sk-'
      : trimmed.slice(0, 3);
  return `${prefix}****${trimmed.slice(-4)}`;
}

function resolveDefaultSafeStorage(): SafeStorageBackend {
  try {
    // Load electron's safeStorage when running in Electron main process
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { safeStorage?: SafeStorageBackend };
    if (electron && typeof electron === 'object' && electron.safeStorage) {
      return electron.safeStorage;
    }
  } catch {
    /* not running inside Electron main process */
  }
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('Electron safeStorage 不可用');
    },
    decryptString: () => {
      throw new Error('Electron safeStorage 不可用');
    },
  };
}

export class CredentialVault {
  private readonly vaultPath: string;
  private readonly backend: SafeStorageBackend;
  private cache: VaultFile = { version: 1, entries: {} };
  private loadError: string | null = null;

  constructor(dataDir: string, customBackend?: SafeStorageBackend) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.vaultPath = path.join(dataDir, 'credentials.vault.json');
    this.backend = customBackend ?? resolveDefaultSafeStorage();
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.vaultPath)) {
        const raw = fs.readFileSync(this.vaultPath, 'utf8');
        const parsed = JSON.parse(raw) as VaultFile;
        if (parsed && parsed.version === 1 && parsed.entries && !Array.isArray(parsed.entries) && typeof parsed.entries === 'object' && Object.entries(parsed.entries).every(([key, e]) => e && e.ref === key && typeof e.connectionId === 'string' && typeof e.cipherBase64 === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(e.cipherBase64) && typeof e.mask === 'string')) {
          this.cache = parsed;
        } else throw new Error('invalid vault');
      }
    } catch {
      this.loadError = '凭据文件损坏，原文件已保留；请恢复备份后重试。';
    }
  }

  private persist(): void {
    if (this.loadError) throw new Error(this.loadError);
    const tmp = `${this.vaultPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.cache, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmp, this.vaultPath);
  }

  public isEncryptionAvailable(): boolean {
    try {
      return Boolean(this.backend.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  /** Roll back a vault mutation when the accompanying SQLite transaction fails. */
  public withRollback<T>(operation:()=>T):T {
    const before=structuredClone(this.cache);
    try {return operation();} catch(error) {
      if(JSON.stringify(before)!==JSON.stringify(this.cache)) {
        this.cache=before;
        this.persist();
      }
      throw error;
    }
  }

  public saveSecret(
    connectionId: string,
    rawSecret: string,
    previousRef?: string | null,
  ): { credentialRef: string; mask: string } {
    if (this.loadError) throw new Error(this.loadError);
    const previous = structuredClone(this.cache);
    const cleaned = rawSecret.trim();
    if (!cleaned || cleaned.length < 4 || cleaned.length > 32768) {
      throw new Error('凭据格式无效：请输入有效的 API Key');
    }
    if (!this.isEncryptionAvailable()) {
      throw new Error(
        '当前系统环境不支持加密存储（safeStorage 不可用），已拒绝降级为明文保存。',
      );
    }

    const encrypted = this.backend.encryptString(cleaned);
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
      throw new Error('凭据加密失败，未写入任何数据');
    }

    // Ensure cipher does not accidentally equal plaintext when > 4 bytes
    if (encrypted.toString('utf8') === cleaned) {
      throw new Error('安全检查未通过：加密后端返回了明文，已拒绝保存');
    }

    if (previousRef && this.cache.entries[previousRef]) {
      delete this.cache.entries[previousRef];
    }
    for (const [key, entry] of Object.entries(this.cache.entries)) {
      if (entry.connectionId === connectionId) {
        delete this.cache.entries[key];
      }
    }

    const ref = `cred-${connectionId}-${randomUUID().slice(0, 12)}`;
    // OAuth envelopes include tokens and local paths: never derive a display mask from JSON.
    const mask = cleaned.startsWith('{') ? '已保存登录' : maskSecret(cleaned);
    this.cache.entries[ref] = {
      ref,
      connectionId,
      cipherBase64: encrypted.toString('base64'),
      mask,
      updatedAt: Date.now(),
    };
    try { this.persist(); } catch (error) { this.cache = previous; throw error; }
    return { credentialRef: ref, mask };
  }

  /**
   * Decrypts a secret strictly inside the trusted main process for passing to a collector run.
   * Never expose the return value to Renderer, logs, backups, or diagnostics.
   */
  public getSecret(credentialRef: string | null | undefined): string | null {
    if (this.loadError) throw new Error(this.loadError);
    if (!credentialRef) return null;
    const entry = this.cache.entries[credentialRef];
    if (!entry) return null;
    if (!this.isEncryptionAvailable()) {
      throw new Error('系统凭据解密服务当前不可用');
    }
    const buf = Buffer.from(entry.cipherBase64, 'base64');
    return this.backend.decryptString(buf);
  }

  public getMask(credentialRef: string | null | undefined): string | undefined {
    if (!credentialRef) return undefined;
    return this.cache.entries[credentialRef]?.mask;
  }

  public deleteSecret(credentialRef: string | null | undefined): void {
    if (this.loadError) throw new Error(this.loadError);
    const previous = structuredClone(this.cache);
    if (!credentialRef) return;
    if (this.cache.entries[credentialRef]) {
      delete this.cache.entries[credentialRef];
      try { this.persist(); } catch (error) { this.cache = previous; throw error; }
    }
  }

  public deleteByConnection(connectionId: string): void {
    if (this.loadError) throw new Error(this.loadError);
    const previous = structuredClone(this.cache);
    let changed = false;
    for (const [key, entry] of Object.entries(this.cache.entries)) {
      if (entry.connectionId === connectionId) {
        delete this.cache.entries[key];
        changed = true;
      }
    }
    if (changed) {
      try { this.persist(); } catch (error) { this.cache = previous; throw error; }
    }
  }
}

export function sanitizeDiagnosticText(input: string): string {
  return input
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, 'sk-[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{6,}\b/g, 'gh-[REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/[A-Za-z]:\\Users\\[^\\"\s]+/gi, 'C:\\Users\\[REDACTED]')
    .replace(/\/Users\/[^/"\s]+/g, '/Users/[REDACTED]')
    .replace(/\/home\/[^/"\s]+/g, '/home/[REDACTED]')
    .replace(/\?[^"\s]+/g, '');
}
