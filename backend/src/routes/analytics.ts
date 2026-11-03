import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { usageLogs, users, departments, auditLogs } from '../db/schema.js';
import { eq, gte, lte, and, sql, count, asc, desc } from 'drizzle-orm';
import { requireAuth, requireAdmin, requireDeptLead } from '../middleware/auth.js';
import { inArray } from 'drizzle-orm';
import { getDailyTokenUsage } from '../services/rateLimiter.js';

const periodSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function analyticsRoutes(app: FastifyInstance) {
  /**
   * GET /analytics/overview
   * Summary stats for the org: total requests, tokens, avg latency (last 30 days)
   */
  app.get('/analytics/overview', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
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
      .where(and(eq(usageLogs.orgId, orgId), gte(usageLogs.createdAt, thirtyDaysAgo)));

    const todayTokens = await getDailyTokenUsage(app.redis, orgId);

    return {
      data: {
        ...stats,
        todayTokens,
      },
    };
  });

  /**
   * GET /analytics/daily
   * Per-day breakdown of requests and tokens for the last N days (default 30)
   */
  app.get('/analytics/daily', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
    const query = periodSchema.safeParse(request.query);
    const from = query.success && query.data.from
      ? new Date(query.data.from)
      : new Date(Date.now() - 30 * 86_400_000);
    const to = query.success && query.data.to ? new Date(query.data.to) : new Date();

    const rows = await db
      .select({
        date: sql<string>`date_trunc('day', ${usageLogs.createdAt})::date`,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        errors: sql<number>`count(*) filter (where ${usageLogs.statusCode} >= 400)::int`,
      })
      .from(usageLogs)
      .where(and(eq(usageLogs.orgId, orgId), gte(usageLogs.createdAt, from), lte(usageLogs.createdAt, to)))
      .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})`)
      .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})`);

    return { data: rows };
  });

  /**
   * GET /analytics/models
   * Per-model usage breakdown
   */
  app.get('/analytics/models', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
    const query = periodSchema.safeParse(request.query);
    const from = query.success && query.data.from ? new Date(query.data.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.success && query.data.to ? new Date(query.data.to) : new Date();

    const rows = await db
      .select({
        model: usageLogs.model,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${usageLogs.requestDurationMs}), 0)::int`,
      })
      .from(usageLogs)
      .where(and(eq(usageLogs.orgId, orgId), gte(usageLogs.createdAt, from), lte(usageLogs.createdAt, to)))
      .groupBy(usageLogs.model)
      .orderBy(sql`count(*) desc`);

    return { data: rows };
  });

  /**
   * GET /analytics/logs
   * Paginated raw usage logs with user info
   */
  app.get('/analytics/logs', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(100).default(50),
        offset: z.coerce.number().default(0),
        sortBy: z.enum(['createdAt', 'model', 'user', 'promptTokens', 'completionTokens', 'totalTokens', 'requestDurationMs', 'statusCode', 'costRub']).default('createdAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
        statusCode: z.coerce.number().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      })
      .safeParse(request.query);
    const { limit, offset, sortBy, sortOrder, statusCode: filterStatus, from, to } = query.success
      ? query.data
      : { limit: 50, offset: 0, sortBy: 'createdAt' as const, sortOrder: 'desc' as const, statusCode: undefined, from: undefined, to: undefined };

    const dir = sortOrder === 'asc' ? asc : desc;
    const orderCol = {
      createdAt:        dir(usageLogs.createdAt),
      model:            dir(usageLogs.model),
      user:             dir(users.email),
      promptTokens:     dir(usageLogs.promptTokens),
      completionTokens: dir(usageLogs.completionTokens),
      totalTokens:      dir(usageLogs.totalTokens),
      requestDurationMs:dir(usageLogs.requestDurationMs),
      statusCode:       dir(usageLogs.statusCode),
      costRub:          dir(usageLogs.costRub),
    }[sortBy];

    const conditions = [eq(usageLogs.orgId, orgId)];
    if (filterStatus !== undefined) conditions.push(eq(usageLogs.statusCode, filterStatus));
    if (from) conditions.push(gte(usageLogs.createdAt, new Date(from)));
    if (to)   conditions.push(lte(usageLogs.createdAt, new Date(to)));
    const whereClause = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      db
        .select({
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
          costRub: usageLogs.costRub,
        })
        .from(usageLogs)
        .leftJoin(users, eq(usageLogs.userId, users.id))
        .where(whereClause)
        .orderBy(orderCol)
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(usageLogs)
        .where(whereClause),
    ]);

    return { data: rows, limit, offset, total: totalResult[0]?.total ?? 0 };
  });

  /**
   * GET /analytics/users
   * Per-user usage breakdown for the org
   */
  app.get('/analytics/users', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
    const query = periodSchema.safeParse(request.query);
    const from = query.success && query.data.from ? new Date(query.data.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.success && query.data.to ? new Date(query.data.to) : new Date();

    const rows = await db
      .select({
        userId: users.id,
        name: users.name,
        surname: users.surname,
        email: users.email,
        requests: sql<number>`count(${usageLogs.id})::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        topModel: sql<string | null>`mode() within group (order by ${usageLogs.model})`,
      })
      .from(usageLogs)
      .innerJoin(users, eq(usageLogs.userId, users.id))
      .where(and(eq(usageLogs.orgId, orgId), gte(usageLogs.createdAt, from), lte(usageLogs.createdAt, to)))
      .groupBy(users.id, users.name, users.surname, users.email)
      .orderBy(sql`count(${usageLogs.id}) desc`);

    return { data: rows };
  });

  /**
   * GET /analytics/errors
   * Error breakdown: daily series, by status code, by model, by user (last 30 days)
   */
  app.get('/analytics/errors', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const base = and(eq(usageLogs.orgId, orgId), gte(usageLogs.createdAt, thirtyDaysAgo));
    const isError = sql`${usageLogs.statusCode} >= 400`;

    const [overview, daily, byStatus, byModel, byUser] = await Promise.all([
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
        total: sql<number>`(select count(*) from usage_logs u2 where u2.org_id = ${orgId} and u2.model = ${usageLogs.model} and u2.created_at >= ${thirtyDaysAgo})::int`,
      }).from(usageLogs).where(and(base, sql`${isError}`))
        .groupBy(usageLogs.model)
        .orderBy(sql`count(*) desc`),

      db.select({
        userId: users.id,
        userName: users.name,
        userSurname: users.surname,
        userEmail: users.email,
        errors: sql<number>`count(${usageLogs.id})::int`,
      }).from(usageLogs)
        .leftJoin(users, eq(usageLogs.userId, users.id))
        .where(and(base, sql`${isError}`))
        .groupBy(users.id, users.name, users.surname, users.email)
        .orderBy(sql`count(${usageLogs.id}) desc`)
        .limit(20),
    ]);

    return { data: { overview: overview[0], daily, byStatus, byModel, byUser } };
  });

  /**
   * GET /analytics/latency
   * Latency breakdown: daily avg, by model with percentiles, slowest requests (last 30 days)
   */
  app.get('/analytics/latency', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const base = and(
      eq(usageLogs.orgId, orgId),
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
        userName: users.name,
        userSurname: users.surname,
        userEmail: users.email,
      }).from(usageLogs)
        .leftJoin(users, eq(usageLogs.userId, users.id))
        .where(base)
        .orderBy(desc(usageLogs.requestDurationMs))
        .limit(20),
    ]);

    return { data: { overview: overview[0], daily, byModel, slowest } };
  });

  /**
   * GET /analytics/departments
   * Per-department usage breakdown for the org
   */
  app.get('/analytics/departments', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
    const query = periodSchema.safeParse(request.query);
    const from = query.success && query.data.from ? new Date(query.data.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.success && query.data.to ? new Date(query.data.to) : new Date();

    const rows = await db
      .select({
        departmentId: departments.id,
        departmentName: departments.name,
        requests: sql<number>`count(${usageLogs.id})::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        topModel: sql<string | null>`mode() within group (order by ${usageLogs.model})`,
      })
      .from(usageLogs)
      .innerJoin(users, eq(usageLogs.userId, users.id))
      .innerJoin(departments, eq(users.departmentId, departments.id))
      .where(and(eq(usageLogs.orgId, orgId), gte(usageLogs.createdAt, from), lte(usageLogs.createdAt, to)))
      .groupBy(departments.id, departments.name)
      .orderBy(sql`count(${usageLogs.id}) desc`);

    return { data: rows };
  });

  /**
   * GET /analytics/export/logs
   * Full (unpaginated) log export for a given period — max 50 000 rows
   */
  app.get('/analytics/export/logs', { preHandler: requireAuth }, async (request) => {
    const orgId = request.user.orgId;
    const query = periodSchema.safeParse(request.query);
    const from = query.success && query.data.from ? new Date(query.data.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.success && query.data.to ? new Date(query.data.to) : new Date();

    const rows = await db
      .select({
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
      })
      .from(usageLogs)
      .leftJoin(users, eq(usageLogs.userId, users.id))
      .where(and(eq(usageLogs.orgId, orgId), gte(usageLogs.createdAt, from), lte(usageLogs.createdAt, to)))
      .orderBy(desc(usageLogs.createdAt))
      .limit(50_000);

    return { data: rows };
  });

  /**
   * GET /analytics/my-department
   * Dept-lead scoped: stats for requests made by users in the lead's department (last 30 days)
   */
  app.get('/analytics/my-department', { preHandler: requireDeptLead }, async (request, reply) => {
    const userId = request.user.sub;
    const [me] = await db.select({ departmentId: users.departmentId })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (!me?.departmentId) return reply.status(400).send({ error: 'Not assigned to a department' });

    const deptId = me.departmentId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    // Get all user IDs in this department
    const deptUsers = await db.select({ id: users.id, name: users.name, surname: users.surname, email: users.email })
      .from(users).where(eq(users.departmentId, deptId));
    const deptUserIds = deptUsers.map((u) => u.id);

    if (!deptUserIds.length) {
      return { data: { overview: { totalRequests: 0, successRequests: 0, totalTokens: 0, avgLatencyMs: 0 }, byModel: [], daily: [], byUser: [] } };
    }

    const base = and(inArray(usageLogs.userId, deptUserIds), gte(usageLogs.createdAt, thirtyDaysAgo));

    const [overview, byModel, daily, byUser] = await Promise.all([
      db.select({
        totalRequests: sql<number>`count(*)::int`,
        successRequests: sql<number>`count(*) filter (where ${usageLogs.statusCode} < 400)::int`,
        totalTokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${usageLogs.requestDurationMs}), 0)::int`,
      }).from(usageLogs).where(base),

      db.select({
        model: usageLogs.model,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${usageLogs.requestDurationMs}), 0)::int`,
      }).from(usageLogs).where(base)
        .groupBy(usageLogs.model)
        .orderBy(sql`count(*) desc`),

      db.select({
        date: sql<string>`date_trunc('day', ${usageLogs.createdAt})::date`,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        errors: sql<number>`count(*) filter (where ${usageLogs.statusCode} >= 400)::int`,
      }).from(usageLogs).where(base)
        .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})`)
        .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})`),

      db.select({
        userId: users.id,
        name: users.name,
        surname: users.surname,
        email: users.email,
        requests: sql<number>`count(${usageLogs.id})::int`,
        tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)::int`,
        topModel: sql<string | null>`mode() within group (order by ${usageLogs.model})`,
      }).from(users)
        .leftJoin(usageLogs, and(eq(usageLogs.userId, users.id), gte(usageLogs.createdAt, thirtyDaysAgo)))
        .where(eq(users.departmentId, deptId))
        .groupBy(users.id, users.name, users.surname, users.email)
        .orderBy(sql`count(${usageLogs.id}) desc`),
    ]);

    return { data: { overview: overview[0], byModel, daily, byUser } };
  });

  /**
   * GET /analytics/audit
   * Paginated audit log for the org (admin only).
   * Superadmins can pass orgId= to view another org's log.
   */
  app.get('/analytics/audit', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      from:        z.string().datetime().optional(),
      to:          z.string().datetime().optional(),
      actorId:     z.string().uuid().optional(),
      targetType:  z.string().optional(),
      action:      z.string().optional(),
      orgId:       z.string().uuid().optional(),
      limit:       z.coerce.number().min(1).max(200).default(50),
      offset:      z.coerce.number().default(0),
    }).safeParse(request.query);

    const {
      from, to, actorId, targetType, action,
      orgId: queryOrgId, limit, offset,
    } = query.success
      ? query.data
      : { from: undefined, to: undefined, actorId: undefined, targetType: undefined, action: undefined, orgId: undefined, limit: 50, offset: 0 };

    // Admins see their own org; superadmins may pass orgId to view another org
    const scopedOrgId =
      request.user.role === 'superadmin' && queryOrgId ? queryOrgId : request.user.orgId;

    const conditions = [eq(auditLogs.orgId, scopedOrgId)];
    if (from)        conditions.push(gte(auditLogs.createdAt, new Date(from)));
    if (to)          conditions.push(lte(auditLogs.createdAt, new Date(to)));
    if (actorId)     conditions.push(eq(auditLogs.actorId, actorId));
    if (targetType)  conditions.push(eq(auditLogs.targetType, targetType));
    if (action)      conditions.push(eq(auditLogs.action, action));
    const where = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      db.select().from(auditLogs).where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(auditLogs).where(where),
    ]);

    return { data: rows, total: totalResult[0]?.total ?? 0, limit, offset };
  });

  /**
   * GET /analytics/export/audit
   * Full unpaginated audit export — max 10 000 rows.
   */
  app.get('/analytics/export/audit', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      from:       z.string().datetime().optional(),
      to:         z.string().datetime().optional(),
      action:     z.string().optional(),
      targetType: z.string().optional(),
      orgId:      z.string().uuid().optional(),
    }).safeParse(request.query);

    const { from, to, action, targetType, orgId: queryOrgId } = query.success
      ? query.data
      : { from: undefined, to: undefined, action: undefined, targetType: undefined, orgId: undefined };

    const scopedOrgId =
      request.user.role === 'superadmin' && queryOrgId ? queryOrgId : request.user.orgId;

    const conditions = [eq(auditLogs.orgId, scopedOrgId)];
    if (from)       conditions.push(gte(auditLogs.createdAt, new Date(from)));
    if (to)         conditions.push(lte(auditLogs.createdAt, new Date(to)));
    if (action)     conditions.push(eq(auditLogs.action, action));
    if (targetType) conditions.push(eq(auditLogs.targetType, targetType));

    const rows = await db.select().from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(10_000);

    return { data: rows };
  });
}
