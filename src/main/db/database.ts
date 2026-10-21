import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { schema } from './schema';
import {
  OFFICIAL_ADAPTER_CATALOG,
  type CalendarTarget,
  type Connection,
  type Preferences,
  type Subscription,
} from '../../shared/types';

export const CURRENT_SCHEMA_VERSION = 3;

const MIGRATION_V1_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  backup_ref TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  product TEXT NOT NULL,
  region TEXT NOT NULL,
  capability_manifest TEXT NOT NULL,
  adapter_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  auth_type TEXT NOT NULL,
  credential_ref TEXT,
  state TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  next_allowed_at INTEGER,
  error_json TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  verification TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  provider_subject TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '个人',
  region TEXT NOT NULL DEFAULT '未指定',
  alias TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES providers(id),
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  plan TEXT,
  lifecycle TEXT NOT NULL,
  archived_from TEXT,
  auto_renew TEXT NOT NULL,
  amount_decimal TEXT,
  currency TEXT NOT NULL,
  billing_type TEXT NOT NULL,
  billing_group_id TEXT,
  quota_pool_id TEXT,
  possible_shared_wallet INTEGER NOT NULL DEFAULT 0,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  website TEXT NOT NULL DEFAULT '',
  reminder TEXT NOT NULL DEFAULT 'local',
  pinned INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  record_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS field_assertions (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  field TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  observed_at INTEGER,
  provider_at INTEGER,
  precision TEXT NOT NULL DEFAULT 'day',
  locked INTEGER NOT NULL DEFAULT 0,
  supersedes TEXT
);

CREATE TABLE IF NOT EXISTS schedule_rules (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  anchor_date TEXT,
  timezone TEXT NOT NULL,
  interval_type TEXT NOT NULL,
  interval_count INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS billing_occurrences (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES schedule_rules(id) ON DELETE CASCADE,
  occurrence_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  instant INTEGER,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_occurrences_rule_kind_idx
  ON billing_occurrences(rule_id, kind, occurrence_index);

CREATE TABLE IF NOT EXISTS quota_pools (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  provider_pool_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  scope_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_pool_links (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  pool_id TEXT NOT NULL REFERENCES quota_pools(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_pool_links_unique
  ON subscription_pool_links(subscription_id, pool_id);

CREATE TABLE IF NOT EXISTS metric_observations (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES quota_pools(id) ON DELETE CASCADE,
  meter_key TEXT NOT NULL,
  used TEXT,
  remaining TEXT,
  limit_val TEXT,
  unit TEXT NOT NULL,
  currency TEXT,
  window_start INTEGER,
  reset_at INTEGER,
  observed_at INTEGER,
  source TEXT NOT NULL,
  availability TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_jobs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  next_run_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  lease_until INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 1,
  consecutive_schema_errors INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_jobs_conn_cap
  ON collection_jobs(connection_id, capability);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result TEXT NOT NULL,
  error_code TEXT,
  adapter_version TEXT NOT NULL,
  sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_targets (
  id TEXT PRIMARY KEY,
  backend TEXT NOT NULL,
  credential_ref TEXT,
  account_ref TEXT NOT NULL,
  remote_calendar_id TEXT,
  calendar_source TEXT NOT NULL,
  sync_token TEXT,
  state TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'idle',
  revision INTEGER NOT NULL DEFAULT 1,
  message TEXT NOT NULL,
  remote_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS calendar_bindings (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES calendar_targets(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  ical_uid TEXT NOT NULL,
  etag TEXT,
  remote_hash TEXT,
  synced_revision INTEGER NOT NULL DEFAULT 1,
  suppressed INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_bindings_target_occ_kind
  ON calendar_bindings(target_id, occurrence_id, event_kind);

CREATE TABLE IF NOT EXISTS calendar_outbox (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES calendar_targets(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL,
  action TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  lease_until INTEGER,
  retry_at INTEGER
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  rule TEXT NOT NULL,
  occurrence_or_meter TEXT NOT NULL,
  window_key TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  delivered_at INTEGER,
  state TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_deliveries_dedupe
  ON notification_deliveries(dedupe_key);

CREATE TABLE IF NOT EXISTS settings_and_assets (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const MIGRATION_V2_SQL = `
CREATE INDEX IF NOT EXISTS idx_subscriptions_connection ON subscriptions(connection_id);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_next_run ON collection_jobs(state, next_run_at);
CREATE INDEX IF NOT EXISTS idx_metric_observations_pool ON metric_observations(pool_id, observed_at);
`;

const MIGRATION_V3_SQL = `
ALTER TABLE metric_observations ADD COLUMN observation_json TEXT;
UPDATE subscriptions SET record_json=json_set(record_json,'$.management','automatic')
WHERE connection_id IS NOT NULL AND json_extract(record_json,'$.management') IS NULL;
`;
const MIGRATIONS: readonly { version: number; sql: string }[] = [
  { version: 1, sql: MIGRATION_V1_SQL },
  { version: 2, sql: MIGRATION_V2_SQL },
  { version: 3, sql: MIGRATION_V3_SQL },
];

export const DEFAULT_PRODUCTION_PREFERENCES: Preferences = {
  theme: 'light',
  density: 'comfortable',
  quotaView: 'remaining',
  timezone: 'Asia/Shanghai',
  reducedMotion: false,
  closeToTray: true,
  reminder: 'local',
  dndStart: '23:00',
  dndEnd: '08:00',
  notificationsMuted: false,
  walletThresholds: { CNY: '10.00', USD: '5.00' },
  order: [],
};

export const DEFAULT_PRODUCTION_TARGETS: readonly CalendarTarget[] = [
  {
    id: 'google',
    name: 'SubCal · Google 专用日历',
    account: '待连接 Google 账号',
    location: 'Google Calendar API · calendar.app.created',
    state: 'paused',
    stage: 'idle',
    revision: 1,
    remote: [],
    message: '待接入外部日历同步',
  },
  {
    id: 'eventkit',
    name: 'SubCal · macOS 系统日历',
    account: '待连接 Apple 账号',
    location: 'macOS EventKit 专用日历',
    state: 'paused',
    stage: 'idle',
    revision: 1,
    remote: [],
    message: '待接入系统日历同步；本机读回不等于 iCloud 云端确认',
  },
  {
    id: 'icloud-caldav',
    name: 'SubCal · iCloud CalDAV 日历',
    account: '待连接 Apple 专用密码',
    location: 'Windows → iCloud CalDAV 专用日历',
    state: 'paused',
    stage: 'idle',
    revision: 1,
    remote: [],
    message: '待接入外部日历同步',
  },
];

export class SubCalDatabase {
  public readonly dbPath: string;
  public readonly backupDir: string;
  private sqlite!: DatabaseSync;
  public orm!: SqliteRemoteDatabase<typeof schema>;
  private storageError: string | null = null;
  private inTransaction = false;

  constructor(dataDir: string, dbFileName = 'subcal.sqlite') {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.join(dataDir, dbFileName);
    this.backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.openAndMigrate();
  }

  private openAndMigrate(): void {
    try {
      this.sqlite = new DatabaseSync(this.dbPath);
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
      this.sqlite.exec('PRAGMA busy_timeout = 5000;');
      const journalRes = this.sqlite.prepare('PRAGMA journal_mode = WAL;').get() as
        | { journal_mode?: string }
        | undefined;
      if (!journalRes) {
        throw new Error('无法开启 WAL 模式');
      }
      const integrity = this.sqlite.prepare('PRAGMA quick_check;').get() as
        | { quick_check?: string }
        | undefined;
      if (integrity?.quick_check && integrity.quick_check !== 'ok') {
        throw new Error(`SQLite 完整性检查未通过: ${integrity.quick_check}`);
      }

      this.orm = this.createDrizzleInstance();
      this.applyMigrations();
      this.seedBaseCatalog();
      this.storageError = null;
    } catch (err) {
      this.storageError = `本地 SQLite 资料库读取异常：${(err as Error).message}。原始数据库文件已保留，未自动清空。`;
      try { this.sqlite?.close(); } catch { /* preserve original failure */ }
      // Open an in-memory fallback only for read-only error reporting while preserving the broken file on disk
      this.sqlite = new DatabaseSync(':memory:');
      this.sqlite.exec(MIGRATION_V1_SQL);
      this.sqlite.exec(MIGRATION_V2_SQL);
      this.sqlite.exec(MIGRATION_V3_SQL);
      this.orm = this.createDrizzleInstance();
      // Error reporting only: never seed or write the fallback database.
    }
  }

  private createDrizzleInstance(): SqliteRemoteDatabase<typeof schema> {
    return drizzle(
      async (sql, params, method) => {
        const stmt = this.sqlite.prepare(sql);
        const boundParams = (params ?? []) as (string | number | bigint | Buffer | null)[];
        if (method === 'run') {
          stmt.run(...boundParams);
          return { rows: [] };
        }
        const rawRows = stmt.all(...boundParams) as Record<string, unknown>[];
        const rows = rawRows.map((row) => Object.values(row));
        if (method === 'get') {
          return { rows: rows[0] ?? [] };
        }
        return { rows };
      },
      { schema },
    );
  }

  public getStorageError(): string | null {
    return this.storageError;
  }

  public recoverCorruptedStorage(): string | null {
    if (!this.storageError) return null;
    try {
      try {
        this.sqlite.close();
      } catch {
        /* ignore */
      }
      let recoveryPath: string | null = null;
      if (fs.existsSync(this.dbPath)) {
        recoveryPath = path.join(
          this.backupDir,
          `corrupted-${Date.now()}-${path.basename(this.dbPath)}`,
        );
        fs.copyFileSync(this.dbPath, recoveryPath);
        fs.unlinkSync(this.dbPath);
        for (const ext of ['-wal', '-shm']) {
          if (fs.existsSync(`${this.dbPath}${ext}`)) {
            fs.unlinkSync(`${this.dbPath}${ext}`);
          }
        }
      }
      this.storageError = null;
      this.openAndMigrate();
      return recoveryPath;
    } catch (err) {
      throw new Error(`恢复存储失败：${(err as Error).message}`);
    }
  }

  /**
   * Consistent SQLite backup using VACUUM INTO (safe even while WAL is active).
   */
  public createConsistentBackup(label = 'manual'): string {
    const fileName = `subcal-backup-${label}-${Date.now()}.sqlite`;
    const targetPath = path.join(this.backupDir, fileName);
    const escaped = targetPath.replace(/'/g, "''");
    this.sqlite.exec(`VACUUM INTO '${escaped}';`);
    return targetPath;
  }

  private applyMigrations(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        backup_ref TEXT
      );
    `);

    const appliedRows = this.sqlite
      .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
      .all() as { version: number }[];
    const applied = new Set(appliedRows.map((r) => Number(r.version)));
    if([...applied].some(version=>version>CURRENT_SCHEMA_VERSION))throw new Error('资料库来自更高版本，请升级应用后打开');

    const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
    if (pending.length === 0) return;

    // If database already has prior migrations applied, create a consistent backup before migrating!
    let backupRef: string | null = null;
    if (applied.size > 0 && this.dbPath !== ':memory:') {
      backupRef = this.createConsistentBackup(`pre-v${pending[0].version}`);
    }

    for (const migration of pending) {
      this.writeTransaction(() => {
        this.sqlite.exec(migration.sql);
        this.sqlite
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at, backup_ref) VALUES (?, ?, ?)',
          )
          .run(migration.version, Date.now(), backupRef);
      });
    }
  }

  public getAppliedMigrations(): { version: number; appliedAt: number; backupRef: string | null }[] {
    const rows = this.sqlite
      .prepare('SELECT version, applied_at, backup_ref FROM schema_migrations ORDER BY version ASC')
      .all() as { version: number; applied_at: number; backup_ref: string | null }[];
    return rows.map((r) => ({
      version: Number(r.version),
      appliedAt: Number(r.applied_at),
      backupRef: r.backup_ref ?? null,
    }));
  }

  /**
   * Single-writer transaction boundary (BEGIN IMMEDIATE).
   */
  public writeTransaction<T>(fn: () => T): T {
    if (this.storageError) {
      throw new Error(this.storageError);
    }
    if (this.inTransaction) {
      return fn();
    }
    this.inTransaction = true;
    try {
      this.sqlite.exec('BEGIN IMMEDIATE;');
      const result = fn();
      this.sqlite.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.sqlite.exec('ROLLBACK;');
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  private seedBaseCatalog(): void {
    this.writeTransaction(() => {
      const nowMs = Date.now();
      for (const item of OFFICIAL_ADAPTER_CATALOG) {
        const manifestJson = JSON.stringify({
          fields: item.fields,
          unsupported: item.unsupported,
          permissions: item.permissions,
          credentialLocation: item.credentialLocation,
          endpointSummary: item.endpointSummary,
          minIntervalSeconds: item.minIntervalSeconds,
          defaultForegroundSeconds: item.defaultForegroundSeconds,
          defaultBackgroundSeconds: item.defaultBackgroundSeconds,
          supportTier: item.supportTier,
        });
        this.sqlite
          .prepare(
            `INSERT INTO providers (id, brand, product, region, capability_manifest, adapter_version)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               brand = excluded.brand,
               product = excluded.product,
               region = excluded.region,
               capability_manifest = excluded.capability_manifest,
               adapter_version = excluded.adapter_version`,
          )
          .run(item.adapterId, item.brand, item.provider, item.region, manifestJson, item.version);

        const existingConn = this.sqlite
          .prepare('SELECT id, state FROM connections WHERE id = ?')
          .get(item.adapterId) as { id: string; state: string } | undefined;

        if (existingConn?.state === 'refreshing') {
          // Recover interrupted refresh on startup without faking success
          this.sqlite
            .prepare(
              `UPDATE connections
               SET state = 'ready',
                   error_json = ?
               WHERE id = ?`,
            )
            .run(
              JSON.stringify({
                code: 'INTERRUPTED',
                message: '上次采集在上次退出时中断，已保留最后已知观察值',
                action: '点击刷新重新核对',
              }),
              item.adapterId,
            );
        }
      }

      for (const target of DEFAULT_PRODUCTION_TARGETS) {
        const existingTarget = this.sqlite
          .prepare('SELECT id, stage FROM calendar_targets WHERE id = ?')
          .get(target.id) as { id: string; stage: string } | undefined;
        if (!existingTarget) {
          this.sqlite
            .prepare(
              `INSERT INTO calendar_targets (
                 id, backend, credential_ref, account_ref, remote_calendar_id,
                 calendar_source, sync_token, state, stage, revision, message, remote_json
               ) VALUES (?, ?, NULL, ?, NULL, ?, NULL, ?, ?, ?, ?, ?)`,
            )
            .run(
              target.id,
              target.id,
              target.account,
              target.location,
              target.state,
              target.stage,
              target.revision,
              target.message,
              JSON.stringify(target.remote),
            );
        } else if (existingTarget.stage === 'queued' || existingTarget.stage === 'written') {
          this.sqlite
            .prepare(
              `UPDATE calendar_targets
               SET state = 'paused', stage = 'idle', message = '上次同步被中断，请重新预览核对'
               WHERE id = ?`,
            )
            .run(target.id);
        }
      }

      // Initialize settings_and_assets defaults if not present
      const prefRow = this.sqlite
        .prepare('SELECT value_json FROM settings_and_assets WHERE key = ?')
        .get('preferences') as { value_json: string } | undefined;
      if (!prefRow) {
        this.sqlite
          .prepare(
            'INSERT INTO settings_and_assets (key, value_json, updated_at) VALUES (?, ?, ?)',
          )
          .run('preferences', JSON.stringify(DEFAULT_PRODUCTION_PREFERENCES), nowMs);
      }

      const revRow = this.sqlite
        .prepare('SELECT value_json FROM settings_and_assets WHERE key = ?')
        .get('space_revision') as { value_json: string } | undefined;
      if (!revRow) {
        this.sqlite
          .prepare(
            'INSERT INTO settings_and_assets (key, value_json, updated_at) VALUES (?, ?, ?)',
          )
          .run('space_revision', JSON.stringify(1), nowMs);
      }
    });
  }

  public getSpaceRevision(): number {
    const row = this.sqlite
      .prepare('SELECT value_json FROM settings_and_assets WHERE key = ?')
      .get('space_revision') as { value_json: string } | undefined;
    return row ? Number(JSON.parse(row.value_json)) || 1 : 1;
  }

  public ensureConnection(providerId:string,connectionId=providerId):string {
    const item=OFFICIAL_ADAPTER_CATALOG.find(m=>m.adapterId===providerId);
    if(!item)throw new Error('不支持的连接类型');
    this.writeTransaction(()=>this.sqlite.prepare(`INSERT INTO connections(id,provider_id,auth_type,state,generation,verification) VALUES(?,?,?,'disconnected',1,'pending') ON CONFLICT(id) DO NOTHING`).run(connectionId,item.adapterId,item.authMode));
    return connectionId;
  }

  public bumpSpaceRevision(): number {
    const next = this.getSpaceRevision() + 1;
    this.sqlite
      .prepare(
        `INSERT INTO settings_and_assets (key, value_json, updated_at)
         VALUES ('space_revision', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(next), Date.now());
    return next;
  }

  public getPreferences(): Preferences {
    const row = this.sqlite
      .prepare('SELECT value_json FROM settings_and_assets WHERE key = ?')
      .get('preferences') as { value_json: string } | undefined;
    if (!row) return structuredClone(DEFAULT_PRODUCTION_PREFERENCES);
    try {
      return {
        ...structuredClone(DEFAULT_PRODUCTION_PREFERENCES),
        ...(JSON.parse(row.value_json) as Partial<Preferences>),
      };
    } catch {
      return structuredClone(DEFAULT_PRODUCTION_PREFERENCES);
    }
  }

  public savePreferences(prefs: Preferences): void {
    this.writeTransaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO settings_and_assets (key, value_json, updated_at)
           VALUES ('preferences', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(JSON.stringify(prefs), Date.now());
    });
  }

  public getSetting<T>(key: string, fallback: T): T {
    const row = this.sqlite
      .prepare('SELECT value_json FROM settings_and_assets WHERE key = ?')
      .get(key) as { value_json: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return fallback;
    }
  }

  public setSetting(key: string, value: unknown): void {
    this.writeTransaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO settings_and_assets (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(key, JSON.stringify(value), Date.now());
    });
  }

  public listSubscriptions(): Subscription[] {
    const rows = this.sqlite
      .prepare('SELECT record_json FROM subscriptions ORDER BY created_at ASC, id ASC')
      .all() as { record_json: string }[];
    return rows.map((r) => JSON.parse(r.record_json) as Subscription);
  }

  public getSubscription(id: string): Subscription | null {
    const row = this.sqlite
      .prepare('SELECT record_json FROM subscriptions WHERE id = ?')
      .get(id) as { record_json: string } | undefined;
    return row ? (JSON.parse(row.record_json) as Subscription) : null;
  }

  public upsertSubscription(sub: Subscription, isNew = false): void {
    this.writeTransaction(() => {
      const nowMs = Date.now();
      const providerRow = sub.connectionId
        ? (this.sqlite
            .prepare('SELECT provider_id AS id FROM connections WHERE id = ?')
            .get(sub.connectionId) as { id: string } | undefined)
        : undefined;
      const connRow = sub.connectionId
        ? (this.sqlite
            .prepare('SELECT id FROM connections WHERE id = ?')
            .get(sub.connectionId) as { id: string } | undefined)
        : undefined;

      this.sqlite
        .prepare(
          `INSERT INTO subscriptions (
             id, provider_id, account_id, name, brand, plan, lifecycle, archived_from,
             auto_renew, amount_decimal, currency, billing_type, billing_group_id,
             quota_pool_id, possible_shared_wallet, connection_id, website, reminder,
             pinned, notes, revision, record_json, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             provider_id = excluded.provider_id,
             name = excluded.name,
             brand = excluded.brand,
             plan = excluded.plan,
             lifecycle = excluded.lifecycle,
             archived_from = excluded.archived_from,
             auto_renew = excluded.auto_renew,
             amount_decimal = excluded.amount_decimal,
             currency = excluded.currency,
             billing_type = excluded.billing_type,
             billing_group_id = excluded.billing_group_id,
             quota_pool_id = excluded.quota_pool_id,
             possible_shared_wallet = excluded.possible_shared_wallet,
             connection_id = excluded.connection_id,
             website = excluded.website,
             reminder = excluded.reminder,
             pinned = excluded.pinned,
             notes = excluded.notes,
             revision = excluded.revision,
             record_json = excluded.record_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          sub.id,
          providerRow ? providerRow.id : null,
          sub.product,
          sub.brand,
          sub.plan.value,
          sub.lifecycle,
          sub.archivedFrom ?? null,
          sub.autoRenew,
          sub.price.value,
          sub.currency,
          sub.kind,
          sub.billingGroupId,
          sub.quotaPoolId,
          sub.possibleSharedWallet ? 1 : 0,
          connRow ? connRow.id : null,
          sub.website,
          sub.reminder,
          sub.pinned ? 1 : 0,
          sub.notes,
          sub.revision,
          JSON.stringify(sub),
          nowMs,
          nowMs,
        );

      // Sync normalized schedule_rules and field_assertions
      for (const fieldName of ['plan', 'price', 'startDate', 'renewalDate', 'paidThrough', 'trialEnd'] as const) {
        const f = sub[fieldName];
        const assertionId = `${sub.id}:${fieldName}`;
        this.sqlite
          .prepare(
            `INSERT INTO field_assertions (
               id, entity, field, value_json, source_kind, observed_at, provider_at, precision, locked, supersedes
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
             ON CONFLICT(id) DO UPDATE SET
               value_json = excluded.value_json,
               source_kind = excluded.source_kind,
                observed_at = excluded.observed_at,
                precision = excluded.precision,
               locked = excluded.locked`,
          )
          .run(
            assertionId,
            `subscription:${sub.id}`,
            fieldName,
            JSON.stringify(f),
            f.dataOrigin || 'manual',
            f.observedAt ? Date.parse(f.observedAt) : null,
            fieldName.endsWith('Date') || fieldName === 'paidThrough' || fieldName === 'trialEnd'
              ? (f.value?.includes('T') ? 'instant' : 'day')
              : 'exact',
            f.locked ? 1 : 0,
          );
      }

      const ruleId = `rule:${sub.id}`;
      this.sqlite
        .prepare(
          `INSERT INTO schedule_rules (
             id, subscription_id, kind, anchor_date, timezone, interval_type, interval_count, status, revision
           ) VALUES (?, ?, 'renewal', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             anchor_date = excluded.anchor_date,
             timezone = excluded.timezone,
             interval_type = excluded.interval_type,
             interval_count = excluded.interval_count,
             status = excluded.status,
             revision = excluded.revision`,
        )
        .run(
          ruleId,
          sub.id,
          sub.anchorDate ?? sub.renewalDate.value,
          sub.timezone,
          sub.cycle,
          sub.intervalDays,
          sub.lifecycle,
          sub.revision,
        );

      if (sub.quotaPoolId) {
        this.sqlite
          .prepare(
            `INSERT INTO quota_pools (id, account_id, provider_pool_id, unit, scope_json)
             VALUES (?, NULL, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          )
          .run(
            sub.quotaPoolId,
            sub.quotaPoolId,
            sub.metrics[0]?.unit ?? '%',
            JSON.stringify({ product: sub.product }),
          );
        this.sqlite
          .prepare(
            `INSERT INTO subscription_pool_links (subscription_id, pool_id)
             VALUES (?, ?)
             ON CONFLICT(subscription_id, pool_id) DO NOTHING`,
          )
          .run(sub.id, sub.quotaPoolId);
      }
      if (isNew) {
        this.bumpSpaceRevision();
      }
    });
  }

  public deleteSubscription(id: string): void {
    this.writeTransaction(() => {
      this.sqlite.prepare('DELETE FROM field_assertions WHERE entity = ?').run(`subscription:${id}`);
      this.sqlite.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
      this.bumpSpaceRevision();
    });
  }

  public listConnections(getMask?: (ref: string | null) => string | undefined): Connection[] {
    const rows = this.sqlite
      .prepare(
        `SELECT c.id, c.provider_id, c.auth_type, c.credential_ref, c.state, c.generation,
                c.last_attempt_at, c.last_success_at, c.next_allowed_at, c.error_json,
                c.runs, c.verification,
                p.product, p.region AS provider_region, p.capability_manifest, p.adapter_version,
                (SELECT alias FROM accounts a WHERE a.connection_id = c.id LIMIT 1) AS account_alias,
                (SELECT region FROM accounts a WHERE a.connection_id = c.id LIMIT 1) AS account_region
         FROM connections c
         JOIN providers p ON p.id = c.provider_id
         ORDER BY CASE c.id
           WHEN 'codex-local' THEN 1
           WHEN 'copilot-local' THEN 2
           WHEN 'deepseek-balance' THEN 3
           WHEN 'kimi-platform-cn' THEN 4
           WHEN 'openrouter-key' THEN 5
           ELSE 99 END`,
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => {
      const manifest = JSON.parse(String(r.capability_manifest || '{}')) as {
        fields?: string[];
        unsupported?: string[];
      };
      const credentialRef = (r.credential_ref as string | null) ?? null;
      const mask = getMask ? getMask(credentialRef) : undefined;
      return {
        id: String(r.id),
        adapterId: String(r.provider_id),
        provider: String(r.product),
        account: r.account_alias ? String(r.account_alias) : '未连接',
        region: r.account_region ? String(r.account_region) : String(r.provider_region),
        state: r.state as Connection['state'],
        generation: Number(r.generation),
        fields: manifest.fields ?? [],
        unsupported: manifest.unsupported ?? [],
        version: String(r.adapter_version),
        lastAttempt:
          r.last_attempt_at !== null && r.last_attempt_at !== undefined
            ? new Date(Number(r.last_attempt_at)).toISOString()
            : null,
        lastSuccess:
          r.last_success_at !== null && r.last_success_at !== undefined
            ? new Date(Number(r.last_success_at)).toISOString()
            : null,
        nextAllowed:
          r.next_allowed_at !== null && r.next_allowed_at !== undefined
            ? new Date(Number(r.next_allowed_at)).toISOString()
            : null,
        error: r.error_json
          ? (JSON.parse(String(r.error_json)) as Connection['error'])
          : null,
        runs: Number(r.runs),
        verification: (r.verification === 'verified' ? 'verified' : 'pending') as
          | 'pending'
          | 'verified',
        ...(mask ? { credentialMask: mask } : {}),
      };
    });
  }

  public getConnectionRow(id: string): {
    id: string;
    providerId: string;
    authType: string;
    credentialRef: string | null;
    state: Connection['state'];
    generation: number;
    lastAttemptAt: number | null;
    lastSuccessAt: number | null;
    nextAllowedAt: number | null;
    error: Connection['error'];
    runs: number;
    verification: 'pending' | 'verified';
    accountAlias: string;
    accountSubject: string | null;
  } | null {
    const r = this.sqlite
      .prepare(
        `SELECT c.*,
                (SELECT alias FROM accounts a WHERE a.connection_id = c.id LIMIT 1) AS account_alias,
                (SELECT provider_subject FROM accounts a WHERE a.connection_id = c.id LIMIT 1) AS account_subject
         FROM connections c WHERE c.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      providerId: String(r.provider_id),
      authType: String(r.auth_type),
      credentialRef: (r.credential_ref as string | null) ?? null,
      state: r.state as Connection['state'],
      generation: Number(r.generation),
      lastAttemptAt: r.last_attempt_at !== null ? Number(r.last_attempt_at) : null,
      lastSuccessAt: r.last_success_at !== null ? Number(r.last_success_at) : null,
      nextAllowedAt: r.next_allowed_at !== null ? Number(r.next_allowed_at) : null,
      error: r.error_json ? (JSON.parse(String(r.error_json)) as Connection['error']) : null,
      runs: Number(r.runs),
      verification: r.verification === 'verified' ? 'verified' : 'pending',
      accountAlias: r.account_alias ? String(r.account_alias) : '未连接',
      accountSubject: r.account_subject ? String(r.account_subject) : null,
    };
  }

  public updateConnection(
    id: string,
    patch: Partial<{
      credentialRef: string | null;
      state: Connection['state'];
      generation: number;
      lastAttemptAt: number | null;
      lastSuccessAt: number | null;
      nextAllowedAt: number | null;
      error: Connection['error'];
      runs: number;
      verification: 'pending' | 'verified';
      accountAlias: string;
      accountSubject: string;
      accountRegion: string;
      accountOrg: string;
    }>,
  ): void {
    this.writeTransaction(() => {
      const current = this.getConnectionRow(id);
      if (!current) throw new Error(`未找到连接: ${id}`);

      const credentialRef =
        patch.credentialRef !== undefined ? patch.credentialRef : current.credentialRef;
      const state = patch.state !== undefined ? patch.state : current.state;
      const generation = patch.generation !== undefined ? patch.generation : current.generation;
      const lastAttemptAt =
        patch.lastAttemptAt !== undefined ? patch.lastAttemptAt : current.lastAttemptAt;
      const lastSuccessAt =
        patch.lastSuccessAt !== undefined ? patch.lastSuccessAt : current.lastSuccessAt;
      const nextAllowedAt =
        patch.nextAllowedAt !== undefined ? patch.nextAllowedAt : current.nextAllowedAt;
      const error = patch.error !== undefined ? patch.error : current.error;
      const runs = patch.runs !== undefined ? patch.runs : current.runs;
      const verification =
        patch.verification !== undefined ? patch.verification : current.verification;

      this.sqlite
        .prepare(
          `UPDATE connections
           SET credential_ref = ?,
               state = ?,
               generation = ?,
               last_attempt_at = ?,
               last_success_at = ?,
               next_allowed_at = ?,
               error_json = ?,
               runs = ?,
               verification = ?
           WHERE id = ?`,
        )
        .run(
          credentialRef,
          state,
          generation,
          lastAttemptAt,
          lastSuccessAt,
          nextAllowedAt,
          error ? JSON.stringify(error) : null,
          runs,
          verification,
          id,
        );

      if (patch.accountAlias !== undefined) {
        const accId = `acc:${id}`;
        this.sqlite
          .prepare(
            `INSERT INTO accounts (id, connection_id, provider_subject, organization, region, alias)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               provider_subject = excluded.provider_subject,
               organization = excluded.organization,
               region = excluded.region,
               alias = excluded.alias`,
          )
          .run(
            accId,
            id,
            patch.accountSubject ?? patch.accountAlias,
            patch.accountOrg ?? '个人',
            patch.accountRegion ?? '默认',
            patch.accountAlias,
          );
      }
      this.bumpSpaceRevision();
    });
  }

  public recordMetricObservation(params: {
    poolId: string;
    unit: string;
    meterKey: string;
    remaining: string | null;
    total: string | null;
    resetAtMs: number | null;
    observedAtMs: number;
    source: string;
    availability: string;
    used?: string | null;
    observation?: unknown;
  }): void {
    this.writeTransaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO quota_pools (id, account_id, provider_pool_id, unit, scope_json)
           VALUES (?, NULL, ?, ?, '{}')
           ON CONFLICT(id) DO NOTHING`,
        )
        .run(params.poolId, params.poolId, params.unit);

      this.sqlite
        .prepare(
          `INSERT INTO metric_observations (
             id, pool_id, meter_key, used, remaining, limit_val, unit, currency,
             window_start, reset_at, observed_at, source, availability, observation_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(
          `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          params.poolId,
          params.meterKey,
          params.used ?? null,
          params.remaining,
          params.total,
          params.unit,
          /^[A-Z]{3}$/.test(params.unit) ? params.unit : null,
          params.resetAtMs,
          params.observedAtMs,
          params.source,
          params.availability,
          params.observation ? JSON.stringify(params.observation) : null,
        );
    });
  }

  public listCalendarTargets(): CalendarTarget[] {
    const rows = this.sqlite
      .prepare(
        `SELECT id, backend, account_ref, calendar_source, state, stage, revision, message, remote_json
         FROM calendar_targets
         ORDER BY CASE id WHEN 'google' THEN 1 WHEN 'eventkit' THEN 2 ELSE 3 END`,
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as CalendarTarget['id'],
      name:
        r.id === 'google'
          ? 'SubCal · Google 专用日历'
          : r.id === 'eventkit'
            ? 'SubCal · macOS 系统日历'
            : 'SubCal · iCloud CalDAV 日历',
      account: String(r.account_ref),
      location: String(r.calendar_source),
      state: r.state as CalendarTarget['state'],
      stage: r.stage as CalendarTarget['stage'],
      revision: Number(r.revision),
      remote: JSON.parse(String(r.remote_json || '[]')) as CalendarTarget['remote'],
      message: String(r.message),
    }));
  }

  public saveCalendarTarget(target: CalendarTarget): void {
    this.writeTransaction(() => {
      this.sqlite
        .prepare(
          `UPDATE calendar_targets
           SET account_ref = ?,
               calendar_source = ?,
               state = ?,
               stage = ?,
               revision = ?,
               message = ?,
               remote_json = ?
           WHERE id = ?`,
        )
        .run(
          target.account,
          target.location,
          target.state,
          target.stage,
          target.revision,
          target.message,
          JSON.stringify(target.remote),
          target.id,
        );
      this.bumpSpaceRevision();
    });
  }

  public rawPrepare(sql: string) {
    return this.sqlite.prepare(sql);
  }

  public close(): void {
    try {
      this.sqlite.close();
    } catch {
      /* ignore */
    }
  }
}
