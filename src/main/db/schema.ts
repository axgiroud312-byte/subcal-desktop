import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const providersTable = sqliteTable('providers', {
  id: text('id').primaryKey(),
  brand: text('brand').notNull(),
  product: text('product').notNull(),
  region: text('region').notNull(),
  capabilityManifest: text('capability_manifest').notNull(),
  adapterVersion: text('adapter_version').notNull(),
});

export const connectionsTable = sqliteTable('connections', {
  id: text('id').primaryKey(),
  providerId: text('provider_id')
    .notNull()
    .references(() => providersTable.id),
  authType: text('auth_type').notNull(),
  credentialRef: text('credential_ref'),
  state: text('state').notNull(),
  generation: integer('generation').notNull().default(1),
  lastAttemptAt: integer('last_attempt_at'),
  lastSuccessAt: integer('last_success_at'),
  nextAllowedAt: integer('next_allowed_at'),
  errorJson: text('error_json'),
  runs: integer('runs').notNull().default(0),
  verification: text('verification').notNull().default('pending'),
});

export const accountsTable = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id')
    .notNull()
    .references(() => connectionsTable.id, { onDelete: 'cascade' }),
  providerSubject: text('provider_subject').notNull(),
  organization: text('organization').notNull().default('个人'),
  region: text('region').notNull().default('未指定'),
  alias: text('alias').notNull(),
});

export const subscriptionsTable = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').references(() => providersTable.id),
  accountId: text('account_id').references(() => accountsTable.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  brand: text('brand').notNull(),
  plan: text('plan'),
  lifecycle: text('lifecycle').notNull(),
  archivedFrom: text('archived_from'),
  autoRenew: text('auto_renew').notNull(),
  amountDecimal: text('amount_decimal'),
  currency: text('currency').notNull(),
  billingType: text('billing_type').notNull(),
  billingGroupId: text('billing_group_id'),
  quotaPoolId: text('quota_pool_id'),
  possibleSharedWallet: integer('possible_shared_wallet').notNull().default(0),
  connectionId: text('connection_id').references(() => connectionsTable.id, { onDelete: 'set null' }),
  website: text('website').notNull().default(''),
  reminder: text('reminder').notNull().default('local'),
  pinned: integer('pinned').notNull().default(0),
  notes: text('notes').notNull().default(''),
  revision: integer('revision').notNull().default(1),
  recordJson: text('record_json').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const fieldAssertionsTable = sqliteTable('field_assertions', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull(),
  field: text('field').notNull(),
  valueJson: text('value_json').notNull(),
  sourceKind: text('source_kind').notNull(),
  observedAt: integer('observed_at'),
  providerAt: integer('provider_at'),
  precision: text('precision').notNull().default('day'),
  locked: integer('locked').notNull().default(0),
  supersedes: text('supersedes'),
});

export const scheduleRulesTable = sqliteTable('schedule_rules', {
  id: text('id').primaryKey(),
  subscriptionId: text('subscription_id')
    .notNull()
    .references(() => subscriptionsTable.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  anchorDate: text('anchor_date'),
  timezone: text('timezone').notNull(),
  intervalType: text('interval_type').notNull(),
  intervalCount: integer('interval_count').notNull().default(30),
  status: text('status').notNull(),
  revision: integer('revision').notNull().default(1),
});

export const billingOccurrencesTable = sqliteTable(
  'billing_occurrences',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => scheduleRulesTable.id, { onDelete: 'cascade' }),
    occurrenceIndex: integer('occurrence_index').notNull(),
    kind: text('kind').notNull(),
    date: text('date').notNull(),
    instant: integer('instant'),
    confidence: text('confidence').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [
    uniqueIndex('idx_billing_occurrences_rule_kind_idx').on(
      table.ruleId,
      table.kind,
      table.occurrenceIndex,
    ),
  ],
);

export const quotaPoolsTable = sqliteTable('quota_pools', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  providerPoolId: text('provider_pool_id').notNull(),
  unit: text('unit').notNull(),
  scopeJson: text('scope_json').notNull(),
});

export const subscriptionPoolLinksTable = sqliteTable(
  'subscription_pool_links',
  {
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscriptionsTable.id, { onDelete: 'cascade' }),
    poolId: text('pool_id')
      .notNull()
      .references(() => quotaPoolsTable.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('idx_sub_pool_links_unique').on(table.subscriptionId, table.poolId),
  ],
);

export const metricObservationsTable = sqliteTable('metric_observations', {
  id: text('id').primaryKey(),
  poolId: text('pool_id')
    .notNull()
    .references(() => quotaPoolsTable.id, { onDelete: 'cascade' }),
  meterKey: text('meter_key').notNull(),
  used: text('used'),
  remaining: text('remaining'),
  limit: text('limit_val'),
  unit: text('unit').notNull(),
  currency: text('currency'),
  windowStart: integer('window_start'),
  resetAt: integer('reset_at'),
  observedAt: integer('observed_at'),
  source: text('source').notNull(),
  availability: text('availability').notNull(),
});

export const collectionJobsTable = sqliteTable(
  'collection_jobs',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connectionsTable.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    nextRunAt: integer('next_run_at').notNull(),
    state: text('state').notNull(),
    leaseUntil: integer('lease_until'),
    attempt: integer('attempt').notNull().default(0),
    generation: integer('generation').notNull().default(1),
    consecutiveSchemaErrors: integer('consecutive_schema_errors').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_collection_jobs_conn_cap').on(table.connectionId, table.capability),
  ],
);

export const collectionRunsTable = sqliteTable('collection_runs', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => collectionJobsTable.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  result: text('result').notNull(),
  errorCode: text('error_code'),
  adapterVersion: text('adapter_version').notNull(),
  sequence: integer('sequence').notNull(),
});

export const calendarTargetsTable = sqliteTable('calendar_targets', {
  id: text('id').primaryKey(),
  backend: text('backend').notNull(),
  credentialRef: text('credential_ref'),
  accountRef: text('account_ref').notNull(),
  remoteCalendarId: text('remote_calendar_id'),
  calendarSource: text('calendar_source').notNull(),
  syncToken: text('sync_token'),
  state: text('state').notNull(),
  stage: text('stage').notNull().default('idle'),
  revision: integer('revision').notNull().default(1),
  message: text('message').notNull(),
  remoteJson: text('remote_json').notNull().default('[]'),
});

export const calendarBindingsTable = sqliteTable(
  'calendar_bindings',
  {
    id: text('id').primaryKey(),
    targetId: text('target_id')
      .notNull()
      .references(() => calendarTargetsTable.id, { onDelete: 'cascade' }),
    occurrenceId: text('occurrence_id').notNull(),
    eventKind: text('event_kind').notNull(),
    remoteId: text('remote_id').notNull(),
    icalUid: text('ical_uid').notNull(),
    etag: text('etag'),
    remoteHash: text('remote_hash'),
    syncedRevision: integer('synced_revision').notNull().default(1),
    suppressed: integer('suppressed').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_calendar_bindings_target_occ_kind').on(
      table.targetId,
      table.occurrenceId,
      table.eventKind,
    ),
  ],
);

export const calendarOutboxTable = sqliteTable('calendar_outbox', {
  id: text('id').primaryKey(),
  targetId: text('target_id')
    .notNull()
    .references(() => calendarTargetsTable.id, { onDelete: 'cascade' }),
  occurrenceId: text('occurrence_id').notNull(),
  action: text('action').notNull(),
  revision: integer('revision').notNull(),
  state: text('state').notNull(),
  leaseUntil: integer('lease_until'),
  retryAt: integer('retry_at'),
});

export const notificationDeliveriesTable = sqliteTable(
  'notification_deliveries',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull(),
    rule: text('rule').notNull(),
    occurrenceOrMeter: text('occurrence_or_meter').notNull(),
    windowKey: text('window_key').notNull(),
    scheduledAt: integer('scheduled_at').notNull(),
    deliveredAt: integer('delivered_at'),
    state: text('state').notNull(),
  },
  (table) => [uniqueIndex('idx_notification_deliveries_dedupe').on(table.dedupeKey)],
);

export const settingsAndAssetsTable = sqliteTable('settings_and_assets', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const schemaMigrationsTable = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at').notNull(),
  backupRef: text('backup_ref'),
});

export const schema = {
  providers: providersTable,
  connections: connectionsTable,
  accounts: accountsTable,
  subscriptions: subscriptionsTable,
  fieldAssertions: fieldAssertionsTable,
  scheduleRules: scheduleRulesTable,
  billingOccurrences: billingOccurrencesTable,
  quotaPools: quotaPoolsTable,
  subscriptionPoolLinks: subscriptionPoolLinksTable,
  metricObservations: metricObservationsTable,
  collectionJobs: collectionJobsTable,
  collectionRuns: collectionRunsTable,
  calendarTargets: calendarTargetsTable,
  calendarBindings: calendarBindingsTable,
  calendarOutbox: calendarOutboxTable,
  notificationDeliveries: notificationDeliveriesTable,
  settingsAndAssets: settingsAndAssetsTable,
  schemaMigrations: schemaMigrationsTable,
};
