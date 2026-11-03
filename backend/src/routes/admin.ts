import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { organizations, users, quotas, providers, usageLogs } from '../db/schema.js';
import { eq, sql, desc, max, gte, lte, and, ne, asc, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireSuperAdmin, requireAdmin, requireAuth } from '../middleware/auth.js';
import { encrypt, decrypt } from '../utils/encrypt.js';
import { logAudit, pickFields } from '../utils/audit.js';

/** Block SSRF: reject URLs pointing at localhost, private, or link-local addresses. */
function isSafeUrl(raw: string): boolean {
  try {
    const { hostname, protocol } = new URL(raw);
    if (!['http:', 'https:'].includes(protocol)) return false;
    // IPv4 loopback and named loopback
    if (/^(localhost|127\.\d+\.\d+\.\d+)$/i.test(hostname)) return false;
    // Unspecified address (routes to localhost on most OSes)
    if (/^0\.0\.0\.0$/.test(hostname)) return false;
    // RFC-1918 private ranges
    if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)) return false;
    if (/^192\.168\.\d+\.\d+$/.test(hostname)) return false;
    // Link-local (includes AWS metadata 169.254.169.254)
    if (/^169\.254\.\d+\.\d+$/.test(hostname)) return false;
    // IPv6: strip brackets if present, then check
    const bare = hostname.replace(/^\[|\]$/g, '');
    if (/^::1$/.test(bare)) return false;                        // IPv6 loopback
    if (/^::/i.test(bare) && bare.length <= 3) return false;     // :: (all zeros)
    if (/^fe80:/i.test(bare)) return false;                      // IPv6 link-local
    if (/^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/i.test(bare)) return false; // IPv6 ULA (fc00::/7)
    return true;
  } catch {
    return false;
  }
}

const providerSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  authHeaderName: z.string().default('Authorization'),
  authHeaderPrefix: z.string().default('Bearer').optional(),
  apiKey: z.string().optional(),
  isActive: z.boolean().default(true),
});

const quotaSchema = z.object({
  requestsPerMinute: z.number().int().min(1).optional(),
  requestsPerDay: z.number().int().min(1).optional(),
  tokensPerDay: z.number().int().min(1).optional(),
  tokensPerMonth: z.number().int().min(1).nullable().optional(),
});

/** Tighter rate limit for admin write operations. */
const adminWriteLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

export async function adminRoutes(app: FastifyInstance) {
  // ── Organizations (superadmin only) ───────────────────────────────────────

  app.get('/admin/orgs', { preHandler: requireSuperAdmin }, async () => {
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        createdAt: organizations.createdAt,
        userCount: sql<number>`(select count(*) from users where org_id = organizations.id)::int`,
        deptCount: sql<number>`(select count(*) from departments where org_id = organizations.id)::int`,
        requests30d: sql<number>`coalesce((select count(*) from usage_logs where org_id = organizations.id and created_at >= now() - interval '30 days'), 0)::int`,
        tokens30d: sql<number>`coalesce((select sum(total_tokens) from usage_logs where org_id = organizations.id and created_at >= now() - interval '30 days'), 0)::int`,
        lastActiveAt: sql<string | null>`(select created_at from usage_logs where org_id = organizations.id order by created_at desc limit 1)`,
        admins: sql<{ id: string; name: string | null; surname: string | null; email: string; isActive: boolean }[]>`
          coalesce((
            select json_agg(json_build_object('id', u.id, 'name', u.name, 'surname', u.surname, 'email', u.email, 'isActive', u.is_active)
              order by u.email)
            from users u
            where u.org_id = organizations.id and u.role = 'admin'
          ), '[]'::json)`,
      })
      .from(organizations)
      .orderBy(organizations.createdAt);

    return { data: rows };
  });

  app.patch('/admin/orgs/:id', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({ isActive: z.boolean().optional() })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error' });

    const [pre] = await db.select({ isActive: organizations.isActive, name: organizations.name }).from(organizations).where(eq(organizations.id, id)).limit(1);
    const [updated] = await db
      .update(organizations)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();

    if (!updated) return reply.status(404).send({ error: 'Organization not found' });
    const afterFields = pickFields(body.data as Record<string, unknown>, ['isActive']);
    const beforeFields = pickFields({ isActive: pre?.isActive } as Record<string, unknown>, Object.keys(afterFields));
    logAudit({ orgId: id, actorId: request.user.sub, action: 'org.updated', targetType: 'org', targetId: id, targetLabel: pre?.name, diff: { before: beforeFields, after: afterFields }, ip: request.ip });
    return { data: updated };
  });

  // ── Quotas ────────────────────────────────────────────────────────────────

  app.get('/admin/orgs/:id/quota', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Admins can only view their own org's quota; superadmins can view any
    if (request.user.role !== 'superadmin' && id !== request.user.orgId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const rows = await db.select().from(quotas).where(eq(quotas.orgId, id)).limit(1);
    if (!rows.length) return reply.status(404).send({ error: 'Quota not found' });
    return { data: rows[0] };
  });

  app.patch('/admin/orgs/:id/quota', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = quotaSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    // Filter out undefined values so we only update explicitly provided fields
    const updates = Object.fromEntries(Object.entries(body.data).filter(([, v]) => v !== undefined));

    const [upserted] = await db
      .insert(quotas)
      .values({ orgId: id, requestsPerMinute: 1000, requestsPerDay: 100000, ...updates })
      .onConflictDoUpdate({ target: quotas.orgId, set: { ...updates, updatedAt: new Date() } })
      .returning();

    logAudit({ orgId: id, actorId: request.user.sub, action: 'org.quota_updated', targetType: 'org', targetId: id, diff: { after: updates as Record<string, unknown> }, ip: request.ip });
    return { data: upserted };
  });

  // ── Platform admin users (superadmin only) ───────────────────────────────

  app.get('/admin/admins', { preHandler: requireSuperAdmin }, async () => {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        surname: users.surname,
        email: users.email,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.role, 'superadmin'))
      .orderBy(users.createdAt);
    return { data: rows };
  });

  app.post('/admin/admins', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1).max(100),
      surname: z.string().max(100).optional(),
      email: z.string().email(),
      password: z.string().min(8),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    // Superadmins must belong to the platform-admin org
    const [platformOrg] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, 'platform-admin'))
      .limit(1);
    if (!platformOrg) return reply.status(500).send({ error: 'Platform admin org not found' });

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.data.email)).limit(1);
    if (existing.length) return reply.status(409).send({ error: 'Email already in use' });

    const passwordHash = await bcrypt.hash(body.data.password, 12);
    const [created] = await db.insert(users).values({
      orgId: platformOrg.id,
      email: body.data.email,
      passwordHash,
      name: body.data.name,
      surname: body.data.surname ?? null,
      role: 'superadmin',
    }).returning({ id: users.id, name: users.name, surname: users.surname, email: users.email, isActive: users.isActive, createdAt: users.createdAt });

    logAudit({ orgId: platformOrg.id, actorId: request.user.sub, action: 'admin.created', targetType: 'user', targetId: created.id, targetLabel: created.email, ip: request.ip });
    return reply.status(201).send({ data: created });
  });

  app.patch('/admin/admins/:id/active', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user.sub) return reply.status(400).send({ error: 'Cannot deactivate yourself' });

    const body = z.object({ isActive: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error' });

    const [updated] = await db.update(users)
      .set({ isActive: body.data.isActive, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, isActive: users.isActive });
    if (!updated) return reply.status(404).send({ error: 'User not found' });

    logAudit({ orgId: request.user.orgId, actorId: request.user.sub, action: 'admin.toggled', targetType: 'user', targetId: id, diff: { after: { isActive: body.data.isActive } }, ip: request.ip });
    return { data: updated };
  });

  app.post('/admin/admins/:id/reset-password', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    const newPassword = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const passwordHash = await bcrypt.hash(newPassword, 12);

    const [updated] = await db.update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email });
    if (!updated) return reply.status(404).send({ error: 'User not found' });

    logAudit({ orgId: request.user.orgId, actorId: request.user.sub, action: 'admin.password_reset', targetType: 'user', targetId: id, targetLabel: updated.email, ip: request.ip });
    return { data: { password: newPassword } };
  });

  app.delete('/admin/admins/:id', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user.sub) return reply.status(400).send({ error: 'Cannot delete yourself' });

    const [deleted] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id, email: users.email });
    if (!deleted) return reply.status(404).send({ error: 'User not found' });

    logAudit({ orgId: request.user.orgId, actorId: request.user.sub, action: 'admin.deleted', targetType: 'user', targetId: id, targetLabel: deleted.email, ip: request.ip });
    return reply.status(204).send();
  });

  // ── Providers (superadmin only) ───────────────────────────────────────────

  app.get('/admin/providers', { preHandler: requireSuperAdmin }, async () => {
    const rows = await db
      .select({
        id: providers.id,
        name: providers.name,
        baseUrl: providers.baseUrl,
        authHeaderName: providers.authHeaderName,
        authHeaderPrefix: providers.authHeaderPrefix,
        isActive: providers.isActive,
        createdAt: providers.createdAt,
        // Never return the actual API key
      })
      .from(providers)
      .orderBy(providers.name);

    return { data: rows };
  });

  app.post('/admin/providers', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const body = providerSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    if (!isSafeUrl(body.data.baseUrl)) {
      return reply.status(400).send({ error: 'Invalid base URL: must be a public HTTPS/HTTP address' });
    }

    const { apiKey, ...rest } = body.data;
    const [created] = await db
      .insert(providers)
      .values({ ...rest, name: rest.name.toLowerCase(), apiKey: apiKey ? encrypt(apiKey) : null })
      .returning({ id: providers.id, name: providers.name, baseUrl: providers.baseUrl, isActive: providers.isActive });

    logAudit({ orgId: request.user.orgId, actorId: request.user.sub, action: 'provider.created', targetType: 'provider', targetId: created.id, targetLabel: created.name, diff: { after: { name: created.name, baseUrl: created.baseUrl } }, ip: request.ip });
    return reply.status(201).send({ data: created });
  });

  app.patch('/admin/providers/:id', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = providerSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error' });

    if (body.data.baseUrl && !isSafeUrl(body.data.baseUrl)) {
      return reply.status(400).send({ error: 'Invalid base URL: must be a public HTTPS/HTTP address' });
    }

    const { apiKey, ...rest } = body.data;
    const setFields: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (apiKey !== undefined) setFields.apiKey = apiKey ? encrypt(apiKey) : null;

    const [updated] = await db
      .update(providers)
      .set(setFields)
      .where(eq(providers.id, id))
      .returning({ id: providers.id, name: providers.name, isActive: providers.isActive });

    if (!updated) return reply.status(404).send({ error: 'Provider not found' });
    const afterFields = pickFields(rest as Record<string, unknown>, ['name', 'baseUrl', 'isActive']);
    if (apiKey !== undefined) afterFields.apiKey = apiKey ? '(changed)' : null;
    logAudit({ orgId: request.user.orgId, actorId: request.user.sub, action: 'provider.updated', targetType: 'provider', targetId: id, targetLabel: updated.name, diff: { after: afterFields }, ip: request.ip });
    return { data: updated };
  });

  app.delete('/admin/providers/:id', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [pre] = await db.select({ name: providers.name }).from(providers).where(eq(providers.id, id)).limit(1);
    const [deleted] = await db.delete(providers).where(eq(providers.id, id)).returning({ id: providers.id });
    if (!deleted) return reply.status(404).send({ error: 'Provider not found' });
    logAudit({ orgId: request.user.orgId, actorId: request.user.sub, action: 'provider.deleted', targetType: 'provider', targetId: id, targetLabel: pre?.name, diff: { before: { name: pre?.name } }, ip: request.ip });
    return reply.status(204).send();
  });

  // ── Public provider list (any authenticated user) ────────────────────────

  app.get('/providers', { preHandler: requireAuth }, async () => {
    const rows = await db
      .select({ id: providers.id, name: providers.name })
      .from(providers)
      .where(eq(providers.isActive, true))
      .orderBy(providers.name);
    return { data: rows };
  });

  // ── Per-org usage breakdown (superadmin) ─────────────────────────────────

  app.get('/admin/orgs/usage', { preHandler: requireSuperAdmin }, async () => {
    const rows = await db
      .select({
        orgId: organizations.id,
        orgName: organizations.name,
        isActive: organizations.isActive,
        userCount: sql<number>`(select count(*) from users where org_id = organizations.id)::int`,
        requests: sql<number>`coalesce(count(${usageLogs.id}), 0)::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        lastActiveAt: max(usageLogs.createdAt),
      })
      .from(organizations)
      .leftJoin(usageLogs, eq(usageLogs.orgId, organizations.id))
      .groupBy(organizations.id)
      .orderBy(desc(sql`coalesce(count(${usageLogs.id}), 0)`));

    return { data: rows };
  });

  // ── Platform-wide request log (superadmin) ───────────────────────────────

  app.get('/admin/logs', { preHandler: requireSuperAdmin }, async (request) => {
    const query = z.object({
      limit: z.coerce.number().min(1).max(100).default(50),
      offset: z.coerce.number().default(0),
      sortBy: z.enum(['createdAt', 'model', 'user', 'promptTokens', 'completionTokens', 'totalTokens', 'requestDurationMs', 'statusCode']).default('createdAt'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
      statusCode: z.coerce.number().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }).safeParse(request.query);
    const { limit, offset, sortBy, sortOrder, statusCode: filterStatus, from, to } = query.success
      ? query.data
      : { limit: 50, offset: 0, sortBy: 'createdAt' as const, sortOrder: 'desc' as const, statusCode: undefined, from: undefined, to: undefined };

    const dir = sortOrder === 'asc' ? asc : desc;
    const orderCol = {
      createdAt:         dir(usageLogs.createdAt),
      model:             dir(usageLogs.model),
      user:              dir(users.email),
      promptTokens:      dir(usageLogs.promptTokens),
      completionTokens:  dir(usageLogs.completionTokens),
      totalTokens:       dir(usageLogs.totalTokens),
      requestDurationMs: dir(usageLogs.requestDurationMs),
      statusCode:        dir(usageLogs.statusCode),
    }[sortBy];

    const conditions = [];
    if (filterStatus !== undefined) conditions.push(eq(usageLogs.statusCode, filterStatus));
    if (from) conditions.push(gte(usageLogs.createdAt, new Date(from)));
    if (to)   conditions.push(lte(usageLogs.createdAt, new Date(to)));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      db.select({
          id: usageLogs.id,
          model: usageLogs.model,
          endpoint: usageLogs.endpoint,
          promptTokens: usageLogs.promptTokens,
          completionTokens: usageLogs.completionTokens,
          totalTokens: usageLogs.totalTokens,
          requestDurationMs: usageLogs.requestDurationMs,
          statusCode: usageLogs.statusCode,
          errorMessage: usageLogs.errorMessage,
          createdAt: usageLogs.createdAt,
          userId: usageLogs.userId,
          userName: users.name,
          userSurname: users.surname,
          userEmail: users.email,
          orgId: organizations.id,
          orgName: organizations.name,
        })
        .from(usageLogs)
        .leftJoin(users, eq(usageLogs.userId, users.id))
        .leftJoin(organizations, eq(usageLogs.orgId, organizations.id))
        .where(whereClause)
        .orderBy(orderCol)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(usageLogs).where(whereClause),
    ]);

    return { data: rows, limit, offset, total: totalResult[0]?.total ?? 0 };
  });

  // ── Impersonation (superadmin) ────────────────────────────────────────────

  // ── List admin users of an org (for user-based impersonation) ───────────────

  app.get('/admin/orgs/:id/admins', { preHandler: requireSuperAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db
      .select({ id: users.id, name: users.name, surname: users.surname, email: users.email, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.orgId, id), eq(users.role, 'admin')))
      .orderBy(users.email);
    return { data: rows };
  });

  // Step 1: issue a short-lived one-time token (OTT) for the new-tab flow.
  // The OTT is stored in Redis for 60 s and is single-use.
  app.post('/admin/impersonate/ott/:orgId', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const body = z.object({ userId: z.string().uuid().optional() }).safeParse(request.body ?? {});
    const targetUserId = body.success ? body.data.userId : undefined;

    const [org] = await db
      .select({ id: organizations.id, name: organizations.name, isActive: organizations.isActive })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) return reply.status(404).send({ error: 'Organization not found' });
    if (!org.isActive) return reply.status(400).send({ error: 'Organization is suspended' });

    let targetUserSv: number | undefined;
    if (targetUserId) {
      const [targetUser] = await db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(and(eq(users.id, targetUserId), eq(users.orgId, orgId)))
        .limit(1);
      if (!targetUser) return reply.status(404).send({ error: 'User not found in organization' });
      targetUserSv = targetUser.sessionVersion;
    }

    const ott = randomUUID();
    const payload = JSON.stringify({
      superAdminId: request.user.sub,
      superAdminOrgId: request.user.orgId,
      superAdminSv: request.user.sv,
      targetOrgId: orgId,
      targetOrgName: org.name,
      ...(targetUserId && { targetUserId, targetUserSv }),
    });
    await app.redis.set(`ott:${ott}`, payload, 'EX', 60);

    return { data: { ott } };
  });

  // Step 2: exchange OTT for an impersonation JWT (returned in body, not cookie).
  // Called from the new tab before any authenticated state exists there.
  app.post('/admin/impersonate/exchange', async (request, reply) => {
    const { ott } = request.body as { ott?: string };
    if (!ott) return reply.status(400).send({ error: 'Missing ott' });

    const raw = await app.redis.get(`ott:${ott}`);
    if (!raw) return reply.status(400).send({ error: 'Invalid or expired token' });

    // Delete immediately — single-use
    await app.redis.del(`ott:${ott}`);

    const { superAdminId, superAdminOrgId, superAdminSv, targetOrgId, targetOrgName, targetUserId, targetUserSv } =
      JSON.parse(raw) as {
        superAdminId: string;
        superAdminOrgId: string;
        superAdminSv: number;
        targetOrgId: string;
        targetOrgName: string;
        targetUserId?: string;
        targetUserSv?: number;
      };

    const sessionHandle = randomUUID();
    const stored = JSON.stringify({ superAdminId, superAdminOrgId, targetOrgId, targetOrgName });
    await app.redis.set(`impersonate:${sessionHandle}`, stored, 'EX', 3700);
    await app.redis.set(`impersonate:user:${superAdminId}`, sessionHandle, 'EX', 3700);

    const jwtSub = targetUserId ?? superAdminId;
    const jwtSv = targetUserId ? (targetUserSv ?? 0) : superAdminSv;
    const token = app.jwt.sign(
      { sub: jwtSub, orgId: targetOrgId, role: 'admin', sv: jwtSv, imp: sessionHandle },
      { expiresIn: '1h' },
    );

    logAudit({ orgId: targetOrgId, actorId: superAdminId, action: 'impersonate.start' as any, targetType: 'org', targetId: targetOrgId, targetLabel: targetOrgName, ip: request.ip });
    return { data: { token, orgId: targetOrgId, orgName: targetOrgName } };
  });

  app.post('/admin/impersonate/:orgId', { preHandler: requireSuperAdmin, ...adminWriteLimit }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };

    const [org] = await db
      .select({ id: organizations.id, name: organizations.name, isActive: organizations.isActive })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) return reply.status(404).send({ error: 'Organization not found' });
    if (!org.isActive) return reply.status(400).send({ error: 'Organization is suspended' });

    const sessionHandle = randomUUID();
    const superAdminId = request.user.sub;
    const superAdminOrgId = request.user.orgId;

    const stored = JSON.stringify({ superAdminId, superAdminOrgId, targetOrgId: orgId, targetOrgName: org.name });
    await app.redis.set(`impersonate:${sessionHandle}`, stored, 'EX', 3700);
    await app.redis.set(`impersonate:user:${superAdminId}`, sessionHandle, 'EX', 3700);

    const token = app.jwt.sign(
      { sub: superAdminId, orgId, role: 'admin', sv: request.user.sv, imp: sessionHandle },
      { expiresIn: '1h' },
    );

    const isProd = process.env.NODE_ENV === 'production';
    reply.setCookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'strict',
      path: '/',
      maxAge: 3600,
    });

    logAudit({ orgId, actorId: superAdminId, action: 'impersonate.start' as any, targetType: 'org', targetId: orgId, targetLabel: org.name, ip: request.ip });
    return { data: { orgId, orgName: org.name, sessionHandle } };
  });

  app.post('/admin/impersonate/exit', { preHandler: requireAuth }, async (request, reply) => {
    const { imp, sub } = request.user;
    if (!imp) return reply.status(400).send({ error: 'Not currently impersonating' });

    const stored = await app.redis.get(`impersonate:${imp}`);
    if (!stored) return reply.status(400).send({ error: 'Impersonation session expired' });

    const { superAdminId, superAdminOrgId } = JSON.parse(stored) as { superAdminId: string; superAdminOrgId: string };

    const [superAdmin] = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, superAdminId))
      .limit(1);

    if (!superAdmin) return reply.status(404).send({ error: 'Original user not found' });

    const token = app.jwt.sign(
      { sub: superAdminId, orgId: superAdminOrgId, role: 'superadmin', sv: superAdmin.sessionVersion },
      { expiresIn: '7d' },
    );

    const isProd = process.env.NODE_ENV === 'production';
    reply.setCookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    await app.redis.del(`impersonate:${imp}`);
    await app.redis.del(`impersonate:user:${superAdminId}`);

    logAudit({ orgId: superAdminOrgId, actorId: sub, action: 'impersonate.exit' as any, targetType: 'org', targetId: request.user.orgId, ip: request.ip });
    return { ok: true };
  });

  // ── Platform Stats (superadmin) ───────────────────────────────────────────

  app.get('/admin/stats', { preHandler: requireSuperAdmin }, async () => {
    const [stats] = await db
      .select({
        totalOrgs: sql<number>`(select count(*) from organizations)::int`,
        activeOrgs: sql<number>`(select count(*) from organizations where is_active = true)::int`,
        totalUsers: sql<number>`(select count(*) from users)::int`,
        totalRequests: sql<number>`(select count(*) from usage_logs)::int`,
        totalTokens: sql<number>`(select coalesce(sum(total_tokens), 0) from usage_logs)::int`,
      })
      .from(organizations)
      .limit(1);

    return { data: stats };
  });

  // ── Platform analytics: 30-day overview (superadmin) ─────────────────────

  app.get('/admin/stats/overview', { preHandler: requireSuperAdmin }, async (request) => {
    const daysParam = z.coerce.number().int().min(1).max(365).default(30).safeParse((request.query as any).days);
    const days = daysParam.success ? daysParam.data : 30;
    const thirtyDaysAgo = new Date(Date.now() - days * 86_400_000);

    const [stats] = await db
      .select({
        totalRequests: sql<number>`count(*)::int`,
        successRequests: sql<number>`count(*) filter (where ${usageLogs.statusCode} < 400)::int`,
        totalTokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${usageLogs.requestDurationMs}), 0)::int`,
      })
      .from(usageLogs)
      .where(gte(usageLogs.createdAt, thirtyDaysAgo));

    const [todayRow] = await db
      .select({ todayTokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int` })
      .from(usageLogs)
      .where(gte(usageLogs.createdAt, sql`current_date`));

    return { data: { ...stats, todayTokens: todayRow?.todayTokens ?? 0 } };
  });

  app.get('/admin/stats/daily', { preHandler: requireSuperAdmin }, async (request) => {
    const daysParam = z.coerce.number().int().min(1).max(365).default(30).safeParse((request.query as any).days);
    const days = daysParam.success ? daysParam.data : 30;
    const from = new Date(Date.now() - days * 86_400_000);
    const to = new Date();

    const rows = await db
      .select({
        date: sql<string>`date_trunc('day', ${usageLogs.createdAt})::date`,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        errors: sql<number>`count(*) filter (where ${usageLogs.statusCode} >= 400)::int`,
      })
      .from(usageLogs)
      .where(and(gte(usageLogs.createdAt, from), lte(usageLogs.createdAt, to)))
      .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})`)
      .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})`);

    return { data: rows };
  });

  // ── Platform analytics: errors (superadmin) ───────────────────────────────

  app.get('/admin/analytics/errors', { preHandler: requireSuperAdmin }, async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const base = gte(usageLogs.createdAt, thirtyDaysAgo);
    const isError = sql`${usageLogs.statusCode} >= 400`;

    const [overview, daily, byStatus, byModel, byOrg] = await Promise.all([
      db.select({
        totalRequests: sql<number>`count(*)::int`,
        errorRequests: sql<number>`count(*) filter (where ${isError})::int`,
        successRequests: sql<number>`count(*) filter (where ${usageLogs.statusCode} < 400)::int`,
      }).from(usageLogs).where(base),

      db.select({
        date: sql<string>`date_trunc('day', ${usageLogs.createdAt})::date`,
        total: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${isError})::int`,
        successes: sql<number>`count(*) filter (where ${usageLogs.statusCode} < 400)::int`,
      }).from(usageLogs).where(base)
        .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})`)
        .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})`),

      db.select({
        statusCode: usageLogs.statusCode,
        count: sql<number>`count(*)::int`,
      }).from(usageLogs).where(and(base, sql`${isError}`))
        .groupBy(usageLogs.statusCode)
        .orderBy(sql`count(*) desc`),

      db.select({
        model: usageLogs.model,
        errors: sql<number>`count(*)::int`,
        total: sql<number>`(select count(*) from usage_logs u2 where u2.model = ${usageLogs.model} and u2.created_at >= ${thirtyDaysAgo})::int`,
      }).from(usageLogs).where(and(base, sql`${isError}`))
        .groupBy(usageLogs.model)
        .orderBy(sql`count(*) desc`),

      db.select({
        orgId: organizations.id,
        orgName: organizations.name,
        errors: sql<number>`count(${usageLogs.id})::int`,
        total: sql<number>`(select count(*) from usage_logs u2 where u2.org_id = organizations.id and u2.created_at >= ${thirtyDaysAgo})::int`,
      }).from(usageLogs)
        .innerJoin(organizations, eq(usageLogs.orgId, organizations.id))
        .where(and(base, sql`${isError}`))
        .groupBy(organizations.id, organizations.name)
        .orderBy(sql`count(${usageLogs.id}) desc`),
    ]);

    return { data: { overview: overview[0], daily, byStatus, byModel, byOrg } };
  });

  // ── Platform analytics: token usage (superadmin) ──────────────────────────

  app.get('/admin/analytics/tokens', { preHandler: requireSuperAdmin }, async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [modelStats, orgStats] = await Promise.all([
      db.select({
        model: usageLogs.model,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${usageLogs.requestDurationMs}), 0)::int`,
      }).from(usageLogs)
        .where(gte(usageLogs.createdAt, thirtyDaysAgo))
        .groupBy(usageLogs.model)
        .orderBy(sql`coalesce(sum(${usageLogs.totalTokens}), 0) desc`),

      db.select({
        orgId: organizations.id,
        orgName: organizations.name,
        requests: sql<number>`count(${usageLogs.id})::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        topModel: sql<string | null>`mode() within group (order by ${usageLogs.model})`,
      }).from(usageLogs)
        .innerJoin(organizations, eq(usageLogs.orgId, organizations.id))
        .where(gte(usageLogs.createdAt, thirtyDaysAgo))
        .groupBy(organizations.id, organizations.name)
        .orderBy(sql`coalesce(sum(${usageLogs.totalTokens}), 0) desc`),
    ]);

    return { data: { models: modelStats, orgs: orgStats } };
  });

  // ── Platform analytics: latency (superadmin) ──────────────────────────────

  app.get('/admin/analytics/latency', { preHandler: requireSuperAdmin }, async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const base = and(
      gte(usageLogs.createdAt, thirtyDaysAgo),
      sql`${usageLogs.requestDurationMs} is not null`,
    );

    const [overview, daily, byModel, slowest] = await Promise.all([
      db.select({
        avgMs: sql<number>`coalesce(avg(${usageLogs.requestDurationMs}), 0)::int`,
        p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageLogs.requestDurationMs}), 0)::int`,
        p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageLogs.requestDurationMs}), 0)::int`,
        p99: sql<number>`coalesce(percentile_cont(0.99) within group (order by ${usageLogs.requestDurationMs}), 0)::int`,
        minMs: sql<number>`coalesce(min(${usageLogs.requestDurationMs}), 0)::int`,
        maxMs: sql<number>`coalesce(max(${usageLogs.requestDurationMs}), 0)::int`,
      }).from(usageLogs).where(base),

      db.select({
        date: sql<string>`date_trunc('day', ${usageLogs.createdAt})::date`,
        avgMs: sql<number>`coalesce(avg(${usageLogs.requestDurationMs}), 0)::int`,
        p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageLogs.requestDurationMs}), 0)::int`,
      }).from(usageLogs).where(base)
        .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})`)
        .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})`),

      db.select({
        model: usageLogs.model,
        requests: sql<number>`count(*)::int`,
        avgMs: sql<number>`coalesce(avg(${usageLogs.requestDurationMs}), 0)::int`,
        p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageLogs.requestDurationMs}), 0)::int`,
        p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageLogs.requestDurationMs}), 0)::int`,
        p99: sql<number>`coalesce(percentile_cont(0.99) within group (order by ${usageLogs.requestDurationMs}), 0)::int`,
        minMs: sql<number>`coalesce(min(${usageLogs.requestDurationMs}), 0)::int`,
        maxMs: sql<number>`coalesce(max(${usageLogs.requestDurationMs}), 0)::int`,
      }).from(usageLogs).where(base)
        .groupBy(usageLogs.model)
        .orderBy(sql`avg(${usageLogs.requestDurationMs}) desc`),

      db.select({
        id: usageLogs.id,
        model: usageLogs.model,
        requestDurationMs: usageLogs.requestDurationMs,
        statusCode: usageLogs.statusCode,
        totalTokens: usageLogs.totalTokens,
        createdAt: usageLogs.createdAt,
        orgName: organizations.name,
      }).from(usageLogs)
        .innerJoin(organizations, eq(usageLogs.orgId, organizations.id))
        .where(base)
        .orderBy(desc(usageLogs.requestDurationMs))
        .limit(20),
    ]);

    return { data: { overview: overview[0], daily, byModel, slowest } };
  });
}
