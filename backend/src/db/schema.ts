import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  text,
  index,
  jsonb,
  numeric,
} from 'drizzle-orm/pg-core';

export type ModelSetting = { allowed: boolean };
export type ModelSettings = Record<string, ModelSetting>;
import { relations } from 'drizzle-orm';

// ─── Organizations ────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  // AES-256-GCM encrypted AI Mediator API key (never stored in plaintext)
  aiMediatorKey: text('ai_mediator_key'),
  // Day of month (1–28) on which the monthly balance resets for all users/departments
  balanceResetDay: integer('balance_reset_day').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Departments ──────────────────────────────────────────────────────────────

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  modelSettings: jsonb('model_settings').$type<ModelSettings>(),
  aiMediatorKeyId: uuid('ai_mediator_key_id'),
  balanceRub: numeric('balance_rub', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }),
  surname: varchar('surname', { length: 100 }),
  phone: varchar('phone', { length: 50 }),
  // UI language preference, restricted to supported locales via CHECK constraint (see migrations)
  locale: varchar('locale', { length: 10 }).notNull().default('en'),
  modelSettings: jsonb('model_settings').$type<ModelSettings>(),
  // role: 'superadmin' can manage all orgs, 'admin' manages own org, 'member' read-only
  role: varchar('role', { length: 20 }).notNull().default('member'),
  isActive: boolean('is_active').notNull().default(true),
  balanceRub: numeric('balance_rub', { precision: 12, scale: 2 }),
  // Incremented on password change or deactivation to invalidate existing JWTs
  sessionVersion: integer('session_version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── AI Mediator Keys ─────────────────────────────────────────────────────────

/** Up to 6 AI Mediator API keys per org, stored encrypted. Can be assigned to departments. */
export const aiMediatorKeys = pgTable(
  'ai_mediator_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }).notNull().default(''),
    encryptedKey: text('encrypted_key').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('ai_mediator_keys_org_idx').on(t.orgId)],
);

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    // SHA-256 hash of the full key — never store the raw key
    keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
    // First 12 chars for display: "sk-abcd1234..."
    keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('api_keys_org_idx').on(t.orgId)],
);

// ─── Upstream AI Providers ────────────────────────────────────────────────────

export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  baseUrl: varchar('base_url', { length: 500 }).notNull(),
  // Header to use when forwarding auth to the upstream provider
  authHeaderName: varchar('auth_header_name', { length: 100 })
    .notNull()
    .default('Authorization'),
  authHeaderPrefix: varchar('auth_header_prefix', { length: 50 }).default('Bearer'),
  // The upstream provider's API key (store encrypted in production)
  apiKey: text('api_key'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Quotas ───────────────────────────────────────────────────────────────────

export const quotas = pgTable('quotas', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' })
    .unique(),
  requestsPerMinute: integer('requests_per_minute').notNull().default(60),
  requestsPerDay: integer('requests_per_day').notNull().default(10_000),
  tokensPerDay: integer('tokens_per_day'),
  tokensPerMonth: integer('tokens_per_month'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Usage Logs ───────────────────────────────────────────────────────────────

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
    providerId: uuid('provider_id').references(() => providers.id),
    model: varchar('model', { length: 255 }),
    endpoint: varchar('endpoint', { length: 500 }),
    promptTokens: integer('prompt_tokens').default(0),
    completionTokens: integer('completion_tokens').default(0),
    totalTokens: integer('total_tokens').default(0),
    requestDurationMs: integer('request_duration_ms'),
    statusCode: integer('status_code'),
    errorMessage: text('error_message'),
    requestId: varchar('request_id', { length: 255 }),
    costRub: numeric('cost_rub', { precision: 12, scale: 6 }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('usage_logs_org_idx').on(t.orgId),
    index('usage_logs_created_idx').on(t.createdAt),
    index('usage_logs_org_created_idx').on(t.orgId, t.createdAt),
  ],
);

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: varchar('actor_email', { length: 255 }).notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    targetType: varchar('target_type', { length: 50 }).notNull(),
    targetId: varchar('target_id', { length: 255 }).notNull(),
    targetLabel: varchar('target_label', { length: 255 }),
    diff: jsonb('diff').$type<{ before?: Record<string, unknown>; after?: Record<string, unknown> }>(),
    ip: varchar('ip', { length: 100 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('audit_logs_org_created_idx').on(t.orgId, t.createdAt),
    index('audit_logs_actor_idx').on(t.actorId),
  ],
);

// ─── Image Storage ────────────────────────────────────────────────────────────

/** Raw image bytes (base64) for generated images that return b64_json. */
export const imageFiles = pgTable('image_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  data: text('data').notNull(), // base64-encoded PNG
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type ImageRef = {
  fileId?: string;       // points to image_files.id (b64 images)
  url?: string;          // external URL (url-type responses)
  revisedPrompt?: string;
};

/** One generation request (may produce 1–4 images). */
export const imageGenerations = pgTable(
  'image_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    prompt: text('prompt').notNull(),
    model: varchar('model', { length: 255 }).notNull(),
    size: varchar('size', { length: 50 }),
    quality: varchar('quality', { length: 50 }),
    n: integer('n').notNull().default(1),
    images: jsonb('images').$type<ImageRef[]>().notNull().default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('image_gen_user_idx').on(t.userId),
    index('image_gen_org_created_idx').on(t.orgId, t.createdAt),
  ],
);


// ─── Billing Sync Log ─────────────────────────────────────────────────────────

/** Tracks the last successful billing sync per AI Mediator key. */
export const billingSyncLog = pgTable(
  'billing_sync_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    aiMediatorKeyId: uuid('ai_mediator_key_id').notNull().references(() => aiMediatorKeys.id, { onDelete: 'cascade' }).unique(),
    syncedThrough: timestamp('synced_through').notNull(),
    recordsSynced: integer('records_synced').notNull().default(0),
    lastSyncAt: timestamp('last_sync_at').defaultNow().notNull(),
  },
  (t) => [index('billing_sync_log_key_idx').on(t.aiMediatorKeyId)],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const organizationRelations = relations(organizations, ({ many, one }) => ({
  users: many(users),
  departments: many(departments),
  apiKeys: many(apiKeys),
  usageLogs: many(usageLogs),
  quota: one(quotas, { fields: [organizations.id], references: [quotas.orgId] }),
}));

export const departmentRelations = relations(departments, ({ one, many }) => ({
  organization: one(organizations, { fields: [departments.orgId], references: [organizations.id] }),
  users: many(users),
  aiMediatorKey: one(aiMediatorKeys, { fields: [departments.aiMediatorKeyId], references: [aiMediatorKeys.id] }),
}));

export const aiMediatorKeyRelations = relations(aiMediatorKeys, ({ one, many }) => ({
  organization: one(organizations, { fields: [aiMediatorKeys.orgId], references: [organizations.id] }),
  departments: many(departments),
}));

export const userRelations = relations(users, ({ one }) => ({
  organization: one(organizations, { fields: [users.orgId], references: [organizations.id] }),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
}));

export const apiKeyRelations = relations(apiKeys, ({ one, many }) => ({
  organization: one(organizations, { fields: [apiKeys.orgId], references: [organizations.id] }),
  usageLogs: many(usageLogs),
}));

export const usageLogRelations = relations(usageLogs, ({ one }) => ({
  organization: one(organizations, { fields: [usageLogs.orgId], references: [organizations.id] }),
  apiKey: one(apiKeys, { fields: [usageLogs.apiKeyId], references: [apiKeys.id] }),
  provider: one(providers, { fields: [usageLogs.providerId], references: [providers.id] }),
}));
