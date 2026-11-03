import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, departments, organizations, apiKeys, quotas, imageFiles, imageGenerations, usageLogs, aiMediatorKeys, billingSyncLog } from '../db/schema.js';
import type { ModelSettings, ImageRef } from '../db/schema.js';
import { eq, sql, and, desc, gte, sum, count, isNotNull } from 'drizzle-orm';
import { requireAdmin, requireAuth, requireDeptLead, invalidateSessions } from '../middleware/auth.js';
import { checkRateLimits, trackTokenUsage, getDailyTokenUsage, trackUserTokenUsage, getDailyUserTokenUsage } from '../services/rateLimiter.js';
import { resolveProvider, forwardRequest } from '../services/proxyService.js';
import { trackUsage, extractTokensFromResponse, extractCostRub } from '../services/usageTracker.js';
import { encrypt, decrypt } from '../utils/encrypt.js';
import { sendPasswordResetEmail } from '../utils/mailer.js';
import { logAudit, pickFields, modelSettingsChanged } from '../utils/audit.js';
import { logAiMediatorCall } from '../utils/aiMediatorLogger.js';
import { randomBytes } from 'crypto';
import { config } from '../config.js';

const EXTERNAL_TIMEOUT_MS = 120_000; // 2 min — large models can take time

function mergeModelSettings(
  userSettings: ModelSettings | null | undefined,
  deptSettings: ModelSettings | null | undefined,
  model: string,
): { allowed: boolean } {
  const u = userSettings?.[model];
  const d = deptSettings?.[model];
  // User-level explicit setting always wins; department is only the default when no user setting exists.
  const allowed = u?.allowed !== undefined ? u.allowed : d?.allowed !== false;
  return { allowed };
}

/** Read and decrypt the AI Mediator key for a request.
 *  Uses the key assigned to the user's department when available.
 *  Falls back to any active org key (e.g. during impersonation where the caller has no department). */
async function getOrgAiKey(orgId: string, departmentId?: string | null): Promise<string | null> {
  if (departmentId) {
    const [dept] = await db
      .select({ aiMediatorKeyId: departments.aiMediatorKeyId })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.orgId, orgId)))
      .limit(1);
    if (dept?.aiMediatorKeyId) {
      const [keyRow] = await db
        .select({ encryptedKey: aiMediatorKeys.encryptedKey })
        .from(aiMediatorKeys)
        .where(and(eq(aiMediatorKeys.id, dept.aiMediatorKeyId), eq(aiMediatorKeys.orgId, orgId), eq(aiMediatorKeys.isActive, true)))
        .limit(1);
      if (keyRow?.encryptedKey) {
        try { return decrypt(keyRow.encryptedKey); } catch { /* fall through to org-level fallback */ }
      }
    }
  }
  // Fallback: any active key in the org (used when user has no department, e.g. impersonation)
  const [fallback] = await db
    .select({ encryptedKey: aiMediatorKeys.encryptedKey })
    .from(aiMediatorKeys)
    .where(and(eq(aiMediatorKeys.orgId, orgId), eq(aiMediatorKeys.isActive, true)))
    .orderBy(aiMediatorKeys.createdAt)
    .limit(1);
  if (!fallback?.encryptedKey) return null;
  try { return decrypt(fallback.encryptedKey); } catch { return null; }
}

/** Compute the start of the current monthly billing period given a reset day (1–28). */
function getBillingPeriodStart(resetDay: number): Date {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  if (day >= resetDay) {
    return new Date(Date.UTC(year, month, resetDay));
  }
  // Period started last month
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  return new Date(Date.UTC(prevYear, prevMonth, resetDay));
}

/** Check ruble balance for user and department. Returns an error message if exceeded, null if ok. */
async function checkRubleBalance(userId: string, departmentId: string | null | undefined, orgId: string): Promise<string | null> {
  // Fetch org's billing reset day to compute current period window
  const [orgRow] = await db
    .select({ balanceResetDay: organizations.balanceResetDay })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const periodStart = getBillingPeriodStart(orgRow?.balanceResetDay ?? 1);

  // Check user balance
  const [userRow] = await db
    .select({ balanceRub: users.balanceRub })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userRow?.balanceRub !== null && userRow?.balanceRub !== undefined) {
    const limit = Number(userRow.balanceRub);
    const [spentRow] = await db
      .select({ total: sum(usageLogs.costRub) })
      .from(usageLogs)
      .where(and(eq(usageLogs.userId, userId), isNotNull(usageLogs.costRub), gte(usageLogs.createdAt, periodStart)));
    const spent = Number(spentRow?.total ?? 0);
    if (spent >= limit) {
      return `Личный баланс исчерпан (использовано ${spent.toFixed(2)} ₽ из ${limit.toFixed(2)} ₽)`;
    }
  }

  // Check department balance
  if (departmentId) {
    const [deptRow] = await db
      .select({ balanceRub: departments.balanceRub })
      .from(departments)
      .where(eq(departments.id, departmentId))
      .limit(1);

    if (deptRow?.balanceRub !== null && deptRow?.balanceRub !== undefined) {
      const limit = Number(deptRow.balanceRub);
      const [spentRow] = await db
        .select({ total: sum(usageLogs.costRub) })
        .from(usageLogs)
        .where(and(eq(usageLogs.departmentId, departmentId), isNotNull(usageLogs.costRub), gte(usageLogs.createdAt, periodStart)));
      const spent = Number(spentRow?.total ?? 0);
      if (spent >= limit) {
        return `Баланс отдела исчерпан (использовано ${spent.toFixed(2)} ₽ из ${limit.toFixed(2)} ₽)`;
      }
    }
  }

  return null;
}

/** Sanitize upstream error messages before storing in DB (truncate, strip tokens). */
function sanitizeErrorMessage(msg: string | null | undefined): string | null {
  if (!msg) return null;
  // Strip anything that looks like a Bearer token or API key
  return String(msg).replace(/\b(sk-|Bearer\s)[A-Za-z0-9\-_]{8,}/g, '[REDACTED]').slice(0, 500);
}

/** Fetch with a hard timeout to avoid event-loop stalls on slow upstreams. */
function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) });
}

export async function orgRoutes(app: FastifyInstance) {
  // ── AI Mediator key management ────────────────────────────────────────────

  /** Returns whether the org has an AI Mediator key configured. Never returns the raw key. */
  app.get('/org/ai-mediator-key', { preHandler: requireAuth }, async (request) => {
    const { orgId } = request.user;
    const [org] = await db.select({ aiMediatorKey: organizations.aiMediatorKey })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return { configured: !!org?.aiMediatorKey };
  });

  /** Save or replace the org's AI Mediator key (admin only). */
  app.put('/org/ai-mediator-key', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const body = z.object({ apiKey: z.string().min(10) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'apiKey required (min 10 chars)' });

    const encrypted = encrypt(body.data.apiKey);
    await db.update(organizations).set({ aiMediatorKey: encrypted }).where(eq(organizations.id, orgId));
    logAudit({ orgId, actorId: request.user.sub, action: 'org.api_key.set', targetType: 'org', targetId: orgId, ip: request.ip });
    return { ok: true };
  });

  /** Remove the org's AI Mediator key (admin only). */
  app.delete('/org/ai-mediator-key', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    await db.update(organizations).set({ aiMediatorKey: null }).where(eq(organizations.id, orgId));
    logAudit({ orgId, actorId: request.user.sub, action: 'org.api_key.removed', targetType: 'org', targetId: orgId, ip: request.ip });
    return reply.status(204).send();
  });

  // ── AI Mediator keys CRUD (multi-key support, up to 6) ────────────────────

  /** List all AI Mediator keys for the org (never returns the raw key). */
  app.get('/org/ai-mediator-keys', { preHandler: requireAdmin }, async (request) => {
    const { orgId } = request.user;
    const rows = await db
      .select({ id: aiMediatorKeys.id, description: aiMediatorKeys.description, isActive: aiMediatorKeys.isActive, createdAt: aiMediatorKeys.createdAt })
      .from(aiMediatorKeys)
      .where(eq(aiMediatorKeys.orgId, orgId))
      .orderBy(aiMediatorKeys.createdAt);
    return { data: rows };
  });

  /** Add a new AI Mediator key (admin only, max 6 per org). */
  app.post('/org/ai-mediator-keys', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const body = z.object({
      apiKey: z.string().min(10),
      description: z.string().max(255).default(''),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error' });

    const [{ cnt }] = await db.select({ cnt: count() }).from(aiMediatorKeys).where(eq(aiMediatorKeys.orgId, orgId));
    if (cnt >= 6) return reply.status(400).send({ error: 'Maximum of 6 AI Mediator keys allowed per organization.' });

    const encryptedKey = encrypt(body.data.apiKey);
    const [created] = await db.insert(aiMediatorKeys).values({
      orgId,
      description: body.data.description,
      encryptedKey,
    }).returning({ id: aiMediatorKeys.id, description: aiMediatorKeys.description, isActive: aiMediatorKeys.isActive, createdAt: aiMediatorKeys.createdAt });

    logAudit({ orgId, actorId: request.user.sub, action: 'org.ai_mediator_key.added', targetType: 'ai_mediator_key', targetId: created.id, targetLabel: body.data.description, ip: request.ip });
    return reply.status(201).send({ data: created });
  });

  /** Update description of an AI Mediator key (admin only). */
  app.patch('/org/ai-mediator-keys/:keyId', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { keyId } = request.params as { keyId: string };
    const body = z.object({ description: z.string().max(255) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error' });

    const [updated] = await db.update(aiMediatorKeys)
      .set({ description: body.data.description })
      .where(and(eq(aiMediatorKeys.id, keyId), eq(aiMediatorKeys.orgId, orgId)))
      .returning({ id: aiMediatorKeys.id, description: aiMediatorKeys.description, isActive: aiMediatorKeys.isActive, createdAt: aiMediatorKeys.createdAt });
    if (!updated) return reply.status(404).send({ error: 'Key not found' });
    return { data: updated };
  });

  /** Delete an AI Mediator key (admin only). Clears it from any departments using it. */
  app.delete('/org/ai-mediator-keys/:keyId', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { keyId } = request.params as { keyId: string };

    // Clear from departments before deleting
    await db.update(departments).set({ aiMediatorKeyId: null })
      .where(and(eq(departments.orgId, orgId), eq(departments.aiMediatorKeyId, keyId)));

    const [deleted] = await db.delete(aiMediatorKeys)
      .where(and(eq(aiMediatorKeys.id, keyId), eq(aiMediatorKeys.orgId, orgId)))
      .returning({ id: aiMediatorKeys.id });
    if (!deleted) return reply.status(404).send({ error: 'Key not found' });

    logAudit({ orgId, actorId: request.user.sub, action: 'org.ai_mediator_key.removed', targetType: 'ai_mediator_key', targetId: keyId, ip: request.ip });
    return reply.status(204).send();
  });

  // ── AI Mediator direct proxy ───────────────────────────────────────────────

  app.post('/org/ai-mediator/chat', { preHandler: requireAuth }, async (request, reply) => {
    const contentPartSchema = z.union([
      z.string(),
      z.array(z.union([
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string() }) }),
      ])),
    ]);
    const body = z.object({
      model: z.string().min(1),
      messages: z.array(z.object({ role: z.string(), content: contentPartSchema })).min(1),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const { model, messages } = body.data;
    const userId = request.user.sub;
    const { orgId } = request.user;

    const [userRow] = await db.select({ modelSettings: users.modelSettings, departmentId: users.departmentId })
      .from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId))).limit(1);

    const apiKey = await getOrgAiKey(orgId, userRow?.departmentId);
    if (!apiKey) return reply.status(400).send({ error: 'No AI Mediator key is configured for this organization. Contact your administrator.' });

    let deptSettings: ModelSettings | null = null;
    if (userRow?.departmentId) {
      const [deptRow] = await db.select({ modelSettings: departments.modelSettings })
        .from(departments).where(eq(departments.id, userRow.departmentId)).limit(1);
      deptSettings = deptRow?.modelSettings ?? null;
    }

    const { allowed } = mergeModelSettings(userRow?.modelSettings, deptSettings, model);

    if (!allowed) {
      return reply.status(403).send({
        error: 'model_access_denied',
        message: `Access to model "${model}" is not permitted for your account.`,
      });
    }

    const balanceError = await checkRubleBalance(userId, userRow?.departmentId, orgId);
    if (balanceError) {
      return reply.status(402).send({ error: 'balance_exceeded', message: balanceError });
    }

    // ── Streaming response ──────────────────────────────────────────────────
    const STREAM_TIMEOUT_MS = 5 * 60_000; // 5 min for long reasoning models
    const startTime = Date.now();
    let statusCode = 200;
    let requestId: string | null = null;
    let promptTokens = 0, completionTokens = 0, totalTokens = 0;
    let errorMessage: string | null = null;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch('https://api.ai-mediator.ru/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
      });
    } catch (err) {
      return reply.status(502).send({ error: 'Failed to reach AI Mediator' });
    }

    statusCode = upstreamResponse.status;
    // Present for fast/small responses; a true stream's cost isn't known until
    // it completes, so this is often null and billingSync remains the fallback.
    const costRub = extractCostRub(upstreamResponse.headers);

    // Non-2xx: forward the error JSON directly (not a stream)
    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const errText = await upstreamResponse.text().catch(() => '');
      let errBody: unknown;
      try { errBody = JSON.parse(errText); } catch { errBody = { error: errText || `HTTP ${statusCode}` }; }
      errorMessage = sanitizeErrorMessage((errBody as any)?.error?.message ?? `HTTP ${statusCode}`);
      trackUsage({ orgId, userId, apiKeyId: null, providerId: null, model, endpoint: '/chat/completions', promptTokens: 0, completionTokens: 0, totalTokens: 0, requestDurationMs: Date.now() - startTime, statusCode, errorMessage, departmentId: userRow?.departmentId ?? null, costRub });
      return reply.status(statusCode).send(errBody);
    }

    // Hijack the Fastify response so we can stream raw SSE
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': request.headers.origin ?? '*',
      'Access-Control-Allow-Credentials': 'true',
    });

    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        reply.raw.write(chunk);

        // Parse SSE lines to extract request_id and final usage
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.id && !requestId) requestId = parsed.id;
            if (parsed.usage) {
              promptTokens    = parsed.usage.prompt_tokens     ?? 0;
              completionTokens = parsed.usage.completion_tokens ?? 0;
              totalTokens     = parsed.usage.total_tokens      ?? 0;
            }
          } catch { /* ignore malformed chunks */ }
        }
      }
    } catch (err) {
      statusCode = 502;
      errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : 'Stream error');
    } finally {
      reply.raw.end();

      const duration = Date.now() - startTime;
      trackUsage({
        orgId, userId, apiKeyId: null, providerId: null,
        model, endpoint: '/chat/completions',
        promptTokens, completionTokens, totalTokens,
        requestDurationMs: duration, statusCode, errorMessage,
        requestId, departmentId: userRow?.departmentId ?? null, costRub,
      });

      if (totalTokens > 0) {
        trackTokenUsage(app.redis, orgId, totalTokens).catch((e) => app.log.warn(e, 'trackTokenUsage failed'));
        trackUserTokenUsage(app.redis, userId, model, totalTokens).catch((e) => app.log.warn(e, 'trackUserTokenUsage failed'));
      }

      logAiMediatorCall({
        timestamp: new Date().toISOString(),
        orgId, userId, departmentId: userRow?.departmentId ?? null,
        request: { url: 'https://api.ai-mediator.ru/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: { model, messages } },
        response: { status: statusCode, body: { streamed: true, promptTokens, completionTokens, totalTokens } },
        durationMs: duration,
      }).catch(() => {});
    }

    return reply;
  });

  // ── Current user usage (per model) ────────────────────────────────────────

  /** Returns whether the current user can use the chat — checks department and key assignment. */
  app.get('/org/me/chat-access', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user.sub;
    const { orgId, role } = request.user;

    // Admins (including impersonation) bypass the department check — check only that org has an active key
    if (role === 'admin' || role === 'superadmin') {
      const [anyKey] = await db.select({ id: aiMediatorKeys.id }).from(aiMediatorKeys)
        .where(and(eq(aiMediatorKeys.orgId, orgId), eq(aiMediatorKeys.isActive, true))).limit(1);
      return anyKey ? { ok: true, reason: null } : { ok: false, reason: 'no_key' };
    }

    const [userRow] = await db.select({ departmentId: users.departmentId }).from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId))).limit(1);
    if (!userRow?.departmentId) return { ok: false, reason: 'no_department' };
    const [dept] = await db.select({ aiMediatorKeyId: departments.aiMediatorKeyId }).from(departments)
      .where(and(eq(departments.id, userRow.departmentId), eq(departments.orgId, orgId))).limit(1);
    if (!dept?.aiMediatorKeyId) return { ok: false, reason: 'no_key' };
    const [keyRow] = await db.select({ id: aiMediatorKeys.id }).from(aiMediatorKeys)
      .where(and(eq(aiMediatorKeys.id, dept.aiMediatorKeyId), eq(aiMediatorKeys.isActive, true))).limit(1);
    if (!keyRow) return { ok: false, reason: 'no_key' };
    return { ok: true, reason: null };
  });

  app.get('/org/me', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user.sub;
    const [row] = await db
      .select({ id: users.id, email: users.email, name: users.name, surname: users.surname, role: users.role, locale: users.locale })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return reply.status(404).send({ error: 'User not found' });
    return { data: row };
  });

  app.patch('/org/me', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user.sub;
    const body = z.object({
      name: z.string().optional(),
      surname: z.string().optional(),
      email: z.string().email().optional(),
      password: z.string().min(8).optional(),
      locale: z.enum(['en', 'ru']).optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const { name, surname, email, password, locale } = body.data;
    if (!name && !surname && !email && !password && !locale) return reply.status(400).send({ error: 'Nothing to update' });

    if (email) {
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length && existing[0].id !== userId) return reply.status(409).send({ error: 'Email already in use' });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (surname !== undefined) updates.surname = surname;
    if (email !== undefined) updates.email = email;
    if (password) updates.passwordHash = await bcrypt.hash(password, 12);
    if (locale !== undefined) updates.locale = locale;

    const [updated] = await db.update(users).set(updates).where(eq(users.id, userId))
      .returning({ id: users.id, email: users.email, name: users.name, surname: users.surname, role: users.role, locale: users.locale });

    if (password) await invalidateSessions(app.redis, userId);

    return { data: updated };
  });

  // POST /org/me/send-reset-link — user sends a reset link to themselves
  app.post('/org/me/send-reset-link', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user.sub;

    // Rate limit: max 3 reset emails per user per hour
    const rlKey = `pw_reset_rl:${userId}`;
    const attempts = await app.redis.incr(rlKey);
    if (attempts === 1) await app.redis.expire(rlKey, 3600);
    if (attempts > 3) {
      return reply.status(429).send({ error: 'Too many reset attempts. Try again later.' });
    }

    const [me] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me) return { ok: true }; // silent — don't leak existence

    const token = randomBytes(32).toString('hex');
    await app.redis.set(`pw_reset:${token}`, me.id, 'EX', 3600);

    const resetUrl = `${config.APP_URL}/reset-password#token=${token}`;
    await sendPasswordResetEmail(me.email, resetUrl);

    return { ok: true };
  });

  // POST /org/users/:userId/send-reset-link — admin sends password-reset email to a user
  app.post('/org/users/:userId/send-reset-link', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { userId } = request.params as { userId: string };

    const [target] = await db
      .select({ id: users.id, email: users.email, orgId: users.orgId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!target || target.orgId !== orgId) return reply.status(404).send({ error: 'User not found' });

    const token = randomBytes(32).toString('hex');
    await app.redis.set(`pw_reset:${token}`, target.id, 'EX', 3600);

    const resetUrl = `${config.APP_URL}/reset-password#token=${token}`;
    await sendPasswordResetEmail(target.email, resetUrl);
    logAudit({ orgId, actorId: request.user.sub, action: 'user.password_reset_sent', targetType: 'user', targetId: target.id, targetLabel: target.email, ip: request.ip });

    return { ok: true };
  });

  // ── Department Lead routes ────────────────────────────────────────────────

  app.get('/org/my-department', { preHandler: requireDeptLead }, async (request, reply) => {
    const userId = request.user.sub;
    const [me] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me?.departmentId) return reply.status(404).send({ error: 'You are not assigned to a department' });

    const deptId = me.departmentId;
    const [dept] = await db.select().from(departments).where(eq(departments.id, deptId)).limit(1);
    const members = await db.select({
      id: users.id, email: users.email, name: users.name, surname: users.surname,
      role: users.role, isActive: users.isActive, modelSettings: users.modelSettings, createdAt: users.createdAt,
    }).from(users).where(eq(users.departmentId, deptId));

    return { data: { dept, members } };
  });

  app.post('/org/my-department/users', { preHandler: requireDeptLead }, async (request, reply) => {
    const userId = request.user.sub;
    const { orgId } = request.user;
    const [me] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me?.departmentId) return reply.status(400).send({ error: 'You are not assigned to a department' });

    const body = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().optional(),
      surname: z.string().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const existing = await db.select().from(users).where(eq(users.email, body.data.email)).limit(1);
    if (existing.length) return reply.status(409).send({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(body.data.password, 12);
    const [created] = await db.insert(users).values({
      orgId, email: body.data.email, passwordHash, name: body.data.name,
      surname: body.data.surname, role: 'member', departmentId: me.departmentId,
    }).returning({ id: users.id, email: users.email, name: users.name, surname: users.surname, role: users.role, isActive: users.isActive, modelSettings: users.modelSettings, createdAt: users.createdAt });

    logAudit({ orgId, actorId: userId, action: 'user.created', targetType: 'user', targetId: created.id, targetLabel: created.email, diff: { after: { email: created.email, role: created.role, departmentId: me.departmentId } }, ip: request.ip });
    return reply.status(201).send({ data: created });
  });

  app.patch('/org/my-department/users/:memberId', { preHandler: requireDeptLead }, async (request, reply) => {
    const userId = request.user.sub;
    const { memberId } = request.params as { memberId: string };

    const [me] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me?.departmentId) return reply.status(400).send({ error: 'You are not assigned to a department' });

    if (memberId === userId) return reply.status(403).send({ error: 'You cannot modify your own model settings' });

    const [target] = await db.select({ departmentId: users.departmentId, modelSettings: users.modelSettings }).from(users).where(eq(users.id, memberId)).limit(1);
    if (!target || target.departmentId !== me.departmentId) return reply.status(404).send({ error: 'User not found in your department' });

    const body = z.object({
      modelSettings: z.record(z.object({ allowed: z.boolean() })).optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const [updated] = await db.update(users).set({ modelSettings: body.data.modelSettings ?? null })
      .where(eq(users.id, memberId))
      .returning({ id: users.id, email: users.email, name: users.name, surname: users.surname, role: users.role, isActive: users.isActive, modelSettings: users.modelSettings, createdAt: users.createdAt });
    if (modelSettingsChanged(target.modelSettings, body.data.modelSettings ?? null)) {
      logAudit({ orgId: request.user.orgId, actorId: userId, action: 'user.policy_updated', targetType: 'user', targetId: memberId, targetLabel: updated.email, diff: { before: { modelSettings: target.modelSettings ?? null }, after: { modelSettings: body.data.modelSettings } }, ip: request.ip });
    }
    return { data: updated };
  });

  app.delete('/org/my-department/users/:memberId', { preHandler: requireDeptLead }, async (request, reply) => {
    const userId = request.user.sub;
    const { memberId } = request.params as { memberId: string };

    const [me] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me?.departmentId) return reply.status(400).send({ error: 'You are not assigned to a department' });

    const [target] = await db.select({ departmentId: users.departmentId, email: users.email }).from(users).where(eq(users.id, memberId)).limit(1);
    if (!target || target.departmentId !== me.departmentId) return reply.status(404).send({ error: 'User not found in your department' });

    await db.update(users).set({ departmentId: null }).where(eq(users.id, memberId));
    logAudit({ orgId: request.user.orgId, actorId: userId, action: 'user.removed_from_department', targetType: 'user', targetId: memberId, targetLabel: target.email, ip: request.ip });
    return reply.status(204).send();
  });

  app.get('/org/me/usage', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.sub;
    const query = z.object({ model: z.string().optional() }).safeParse(request.query);
    const model = query.success ? (query.data.model ?? '') : '';

    if (!model) return { data: { tokensUsedToday: 0 } };

    // Read from DB (source of truth) — Redis counters can be lost on restart
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const [usageRow] = await db
      .select({ total: sum(usageLogs.totalTokens) })
      .from(usageLogs)
      .where(and(
        eq(usageLogs.userId, userId),
        eq(usageLogs.model, model),
        gte(usageLogs.createdAt, todayUtc),
      ));
    const tokensUsedToday = Number(usageRow?.total ?? 0);

    return { data: { tokensUsedToday } };
  });

  app.get('/org/me/model-settings', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.sub;
    const orgId = request.user.orgId;
    const [userRow] = await db.select({ modelSettings: users.modelSettings, departmentId: users.departmentId })
      .from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId))).limit(1);

    let deptSettings: ModelSettings | null = null;
    if (userRow?.departmentId) {
      const [deptRow] = await db.select({ modelSettings: departments.modelSettings })
        .from(departments).where(eq(departments.id, userRow.departmentId)).limit(1);
      deptSettings = deptRow?.modelSettings ?? null;
    }

    const userSettings = userRow?.modelSettings ?? null;
    const allModels = new Set([
      ...Object.keys(userSettings ?? {}),
      ...Object.keys(deptSettings ?? {}),
    ]);

    const merged: ModelSettings = {};
    for (const m of allModels) {
      const { allowed } = mergeModelSettings(userSettings, deptSettings, m);
      merged[m] = { allowed };
    }

    return { data: merged };
  });

  // ── Ruble balance endpoints ───────────────────────────────────────────────

  /** Returns the current user's ruble balance limit and spent for the current billing period. */
  app.get('/org/me/balance', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.sub;
    const { orgId } = request.user;

    const [orgRow] = await db
      .select({ balanceResetDay: organizations.balanceResetDay })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const resetDay = orgRow?.balanceResetDay ?? 1;
    const periodStart = getBillingPeriodStart(resetDay);

    const [userRow] = await db
      .select({ balanceRub: users.balanceRub, departmentId: users.departmentId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [userSpent] = await db
      .select({ total: sum(usageLogs.costRub) })
      .from(usageLogs)
      .where(and(eq(usageLogs.userId, userId), isNotNull(usageLogs.costRub), gte(usageLogs.createdAt, periodStart)));

    const spentRub = Number(userSpent?.total ?? 0);
    const limitRub = userRow?.balanceRub !== null && userRow?.balanceRub !== undefined
      ? Number(userRow.balanceRub)
      : null;

    let deptBalance: { limitRub: number; spentRub: number } | null = null;
    if (userRow?.departmentId) {
      const [deptRow] = await db
        .select({ balanceRub: departments.balanceRub })
        .from(departments)
        .where(eq(departments.id, userRow.departmentId))
        .limit(1);

      if (deptRow?.balanceRub !== null && deptRow?.balanceRub !== undefined) {
        const [deptSpent] = await db
          .select({ total: sum(usageLogs.costRub) })
          .from(usageLogs)
          .where(and(eq(usageLogs.departmentId, userRow.departmentId), isNotNull(usageLogs.costRub), gte(usageLogs.createdAt, periodStart)));
        deptBalance = {
          limitRub: Number(deptRow.balanceRub),
          spentRub: Number(deptSpent?.total ?? 0),
        };
      }
    }

    return { data: { spentRub, limitRub, deptBalance, periodStart: periodStart.toISOString(), resetDay } };
  });

  // ── Admin balance lookup endpoints ───────────────────────────────────────

  /** Returns current-period spend and limit for a specific user (admin only). */
  app.get('/org/users/:userId/balance', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { userId } = request.params as { userId: string };

    const [orgRow] = await db
      .select({ balanceResetDay: organizations.balanceResetDay })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const periodStart = getBillingPeriodStart(orgRow?.balanceResetDay ?? 1);

    const [userRow] = await db
      .select({ balanceRub: users.balanceRub })
      .from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId))).limit(1);
    if (!userRow) return reply.status(404).send({ error: 'User not found' });

    const [spentRow] = await db
      .select({ total: sum(usageLogs.costRub) })
      .from(usageLogs)
      .where(and(eq(usageLogs.userId, userId), isNotNull(usageLogs.costRub), gte(usageLogs.createdAt, periodStart)));

    return {
      data: {
        spentRub: Number(spentRow?.total ?? 0),
        limitRub: userRow.balanceRub !== null ? Number(userRow.balanceRub) : null,
        periodStart: periodStart.toISOString(),
      },
    };
  });

  /** Returns current-period spend and limit for a department (admin only). */
  app.get('/org/departments/:deptId/balance', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { deptId } = request.params as { deptId: string };

    const [orgRow] = await db
      .select({ balanceResetDay: organizations.balanceResetDay })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const periodStart = getBillingPeriodStart(orgRow?.balanceResetDay ?? 1);

    const [deptRow] = await db
      .select({ balanceRub: departments.balanceRub })
      .from(departments).where(and(eq(departments.id, deptId), eq(departments.orgId, orgId))).limit(1);
    if (!deptRow) return reply.status(404).send({ error: 'Department not found' });

    const [spentRow] = await db
      .select({ total: sum(usageLogs.costRub) })
      .from(usageLogs)
      .where(and(eq(usageLogs.departmentId, deptId), isNotNull(usageLogs.costRub), gte(usageLogs.createdAt, periodStart)));

    return {
      data: {
        spentRub: Number(spentRow?.total ?? 0),
        limitRub: deptRow.balanceRub !== null ? Number(deptRow.balanceRub) : null,
        periodStart: periodStart.toISOString(),
      },
    };
  });

  /** Returns total org spend for the current billing period (admin only). */
  app.get('/org/billing/period-cost', { preHandler: requireAdmin }, async (request) => {
    const { orgId } = request.user;
    const [orgRow] = await db
      .select({ balanceResetDay: organizations.balanceResetDay })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const periodStart = getBillingPeriodStart(orgRow?.balanceResetDay ?? 1);

    const [row] = await db
      .select({ total: sum(usageLogs.costRub) })
      .from(usageLogs)
      .where(and(eq(usageLogs.orgId, orgId), isNotNull(usageLogs.costRub), gte(usageLogs.createdAt, periodStart)));

    return {
      data: {
        totalCostRub: Number(row?.total ?? 0),
        periodStart: periodStart.toISOString(),
        resetDay: orgRow?.balanceResetDay ?? 1,
      },
    };
  });

  // ── Org settings ─────────────────────────────────────────────────────────

  /** Returns org-level settings (billing cycle reset day, etc). */
  app.get('/org/settings', { preHandler: requireAdmin }, async (request) => {
    const { orgId } = request.user;
    const [orgRow] = await db
      .select({ balanceResetDay: organizations.balanceResetDay, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!orgRow) return { data: { balanceResetDay: 1 } };
    return { data: { balanceResetDay: orgRow.balanceResetDay, name: orgRow.name } };
  });

  /** Updates org-level settings. */
  app.patch('/org/settings', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const body = z.object({
      balanceResetDay: z.number().int().min(1).max(28).optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const [updated] = await db
      .update(organizations)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning({ balanceResetDay: organizations.balanceResetDay });
    if (!updated) return reply.status(404).send({ error: 'Organization not found' });

    logAudit({ orgId, actorId: request.user.sub, action: 'org.settings_updated', targetType: 'organization', targetId: orgId, diff: { after: body.data }, ip: request.ip });
    return { data: updated };
  });

  /** Returns billing sync status. */
  app.get('/org/billing/sync-status', { preHandler: requireAdmin }, async (request) => {
    const { orgId } = request.user;
    const rows = await db
      .select({
        keyId: billingSyncLog.aiMediatorKeyId,
        syncedThrough: billingSyncLog.syncedThrough,
        recordsSynced: billingSyncLog.recordsSynced,
        lastSyncAt: billingSyncLog.lastSyncAt,
      })
      .from(billingSyncLog)
      .where(eq(billingSyncLog.orgId, orgId));
    return { data: rows };
  });

  // ── AI Mediator proxy endpoints — key read from DB ─────────────────────────

  app.post('/org/ai-mediator/balance', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const body = z.object({ keyId: z.string().uuid().optional() }).safeParse(request.body ?? {});
    const keyId = body.success ? body.data.keyId : undefined;

    let apiKey: string | null = null;
    if (keyId) {
      const [keyRow] = await db
        .select({ encryptedKey: aiMediatorKeys.encryptedKey })
        .from(aiMediatorKeys)
        .where(and(eq(aiMediatorKeys.id, keyId), eq(aiMediatorKeys.orgId, orgId), eq(aiMediatorKeys.isActive, true)))
        .limit(1);
      if (keyRow?.encryptedKey) {
        try { apiKey = decrypt(keyRow.encryptedKey); } catch { /* fall through */ }
      }
    } else {
      apiKey = await getOrgAiKey(orgId);
    }
    if (!apiKey) return reply.status(400).send({ error: 'AI Mediator key not configured' });

    const balanceUrl = 'https://app.ai-mediator.ru/api/customer/balance';
    const startBalance = Date.now();
    let balanceStatus = 200;
    let balanceData: unknown;
    try {
      const response = await fetchWithTimeout(balanceUrl, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      });
      balanceStatus = response.status;
      const text = await response.text();
      try { balanceData = JSON.parse(text); } catch { balanceData = text; }
      return reply.status(balanceStatus).send(balanceData);
    } catch (err) {
      balanceStatus = 502;
      return reply.status(502).send({ error: 'Failed to reach AI Mediator' });
    } finally {
      logAiMediatorCall({
        timestamp: new Date().toISOString(),
        orgId, userId: request.user.sub,
        request: { url: balanceUrl, method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` } },
        response: { status: balanceStatus, body: balanceData },
        durationMs: Date.now() - startBalance,
      }).catch(() => {});
    }
  });

  app.post('/org/ai-mediator/models', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = request.user;
    const [userRow] = await db.select({ departmentId: users.departmentId }).from(users).where(and(eq(users.id, request.user.sub), eq(users.orgId, orgId))).limit(1);
    const apiKey = await getOrgAiKey(orgId, userRow?.departmentId);
    if (!apiKey) return reply.status(400).send({ error: 'AI Mediator key not configured' });

    const modelsUrl = 'https://api.ai-mediator.ru/v1/models';
    const startModels = Date.now();
    let modelsStatus = 200;
    let modelsRaw: any;
    try {
      const response = await fetchWithTimeout(modelsUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      modelsStatus = response.status;
      const text = await response.text();
      try { modelsRaw = JSON.parse(text); } catch { modelsRaw = text; }
      if (modelsStatus >= 400) return reply.status(modelsStatus).send(modelsRaw);
      const filtered = (modelsRaw?.data ?? []).filter((m: { id: string }) => {
        const id = m.id.toLowerCase();
        return !id.includes('image') && !id.includes('embedding');
      });
      return { data: filtered };
    } catch (err) {
      modelsStatus = 502;
      return reply.status(502).send({ error: 'Failed to reach AI Mediator' });
    } finally {
      logAiMediatorCall({
        timestamp: new Date().toISOString(),
        orgId, userId: request.user.sub, departmentId: userRow?.departmentId ?? null,
        request: { url: modelsUrl, method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` } },
        response: { status: modelsStatus, body: modelsRaw },
        durationMs: Date.now() - startModels,
      }).catch(() => {});
    }
  });

  app.post('/org/ai-mediator/image-models', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = request.user;
    const [userRow2] = await db.select({ departmentId: users.departmentId }).from(users).where(and(eq(users.id, request.user.sub), eq(users.orgId, orgId))).limit(1);
    const apiKey = await getOrgAiKey(orgId, userRow2?.departmentId);
    if (!apiKey) return reply.status(400).send({ error: 'AI Mediator key not configured' });

    const imgModelsUrl = 'https://api.ai-mediator.ru/v1/models';
    const startImgModels = Date.now();
    let imgModelsStatus = 200;
    let imgModelsRaw: any;
    try {
      const response = await fetchWithTimeout(imgModelsUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      imgModelsStatus = response.status;
      const text = await response.text();
      try { imgModelsRaw = JSON.parse(text); } catch { imgModelsRaw = text; }
      if (imgModelsStatus >= 400) return reply.status(imgModelsStatus).send(imgModelsRaw);
      const filtered = (imgModelsRaw?.data ?? []).filter((m: { id: string }) => m.id.toLowerCase().includes('image'));
      return { data: filtered };
    } catch (err) {
      imgModelsStatus = 502;
      return reply.status(502).send({ error: 'Failed to reach AI Mediator' });
    } finally {
      logAiMediatorCall({
        timestamp: new Date().toISOString(),
        orgId, userId: request.user.sub, departmentId: userRow2?.departmentId ?? null,
        request: { url: imgModelsUrl, method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` } },
        response: { status: imgModelsStatus, body: imgModelsRaw },
        durationMs: Date.now() - startImgModels,
      }).catch(() => {});
    }
  });

  // ── Image generation via AI Mediator ─────────────────────────────────────

  app.post('/org/ai-mediator/images', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({
      model:   z.string().min(1),
      prompt:  z.string().min(1),
      n:       z.number().int().min(1).max(4).optional().default(1),
      size:    z.string().optional(),
      quality: z.enum(['low', 'medium', 'high']).optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const { model, prompt, n, size, quality } = body.data;
    const userId = request.user.sub;
    const { orgId } = request.user;

    const [userRow] = await db.select({ modelSettings: users.modelSettings, departmentId: users.departmentId })
      .from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId))).limit(1);

    const apiKey = await getOrgAiKey(orgId, userRow?.departmentId);
    if (!apiKey) return reply.status(400).send({ error: 'No AI Mediator key is configured for this organization. Contact your administrator.' });

    let deptSettings: ModelSettings | null = null;
    if (userRow?.departmentId) {
      const [deptRow] = await db.select({ modelSettings: departments.modelSettings })
        .from(departments).where(eq(departments.id, userRow.departmentId)).limit(1);
      deptSettings = deptRow?.modelSettings ?? null;
    }

    const { allowed } = mergeModelSettings(userRow?.modelSettings, deptSettings, model);
    if (!allowed) {
      return reply.status(403).send({
        error: 'model_access_denied',
        message: `Access to model "${model}" is not permitted for your account.`,
      });
    }

    const imageBalanceError = await checkRubleBalance(userId, userRow?.departmentId, orgId);
    if (imageBalanceError) {
      return reply.status(402).send({ error: 'balance_exceeded', message: imageBalanceError });
    }

    const payload: Record<string, unknown> = { model, prompt, n };
    if (size)    payload.size    = size;
    if (quality) payload.quality = quality;

    const startTime = Date.now();
    let statusCode = 200;
    let errorMessage: string | null = null;
    let data: any = null;
    let responseHeaders: Record<string, string> = {};

    try {
      const response = await fetchWithTimeout('https://api.ai-mediator.ru/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
      });
      statusCode = response.status;
      responseHeaders = Object.fromEntries(response.headers.entries());
      const text = await response.text();
      try { data = JSON.parse(text); } catch { data = text; }
      if (statusCode >= 400) {
        errorMessage = sanitizeErrorMessage(data?.error?.message ?? `HTTP ${statusCode}`);
        return reply.status(statusCode).send(data);
      }

      // Persist each image to DB; replace b64 payloads with internal file references
      const rawImages: any[] = data?.data ?? [];
      const imageRefs: ImageRef[] = [];
      for (const img of rawImages) {
        if (img.b64_json) {
          const [fileRow] = await db.insert(imageFiles).values({
            orgId, userId,
            data: img.b64_json,
          }).returning({ id: imageFiles.id });
          imageRefs.push({ fileId: fileRow.id, revisedPrompt: img.revised_prompt });
        } else if (img.url) {
          imageRefs.push({ url: img.url, revisedPrompt: img.revised_prompt });
        }
      }

      const [genRow] = await db.insert(imageGenerations).values({
        orgId, userId,
        prompt, model,
        size: size || null,
        quality: quality || null,
        n,
        images: imageRefs,
      }).returning({ id: imageGenerations.id });

      // Return without b64 data — frontend uses /org/images/files/:fileId
      return reply.send({
        ...data,
        generationId: genRow.id,
        data: imageRefs.map((ref) => ({
          fileId: ref.fileId,
          url: ref.url,
          revised_prompt: ref.revisedPrompt,
        })),
      });
    } catch (err) {
      statusCode = 502;
      errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      return reply.status(502).send({ error: 'Failed to reach AI Mediator' });
    } finally {
      const usage = (typeof data === 'object' && data !== null) ? (data as Record<string, any>).usage : null;
      const promptTokens    = usage?.input_tokens  ?? 0;
      const completionTokens = usage?.output_tokens ?? 0;
      const totalTokens     = usage?.total_tokens  ?? 0;
      trackUsage({
        orgId, userId, apiKeyId: null, providerId: null,
        model, endpoint: '/images/generations',
        promptTokens, completionTokens, totalTokens,
        requestDurationMs: Date.now() - startTime, statusCode, errorMessage,
        requestId: (typeof data === 'object' && data !== null) ? (data as any).id ?? null : null,
        costRub: extractCostRub(responseHeaders),
        departmentId: userRow?.departmentId ?? null,
      });
      if (totalTokens > 0) {
        trackTokenUsage(app.redis, orgId, totalTokens)
          .catch((e) => app.log.warn(e, 'trackTokenUsage failed'));
        trackUserTokenUsage(app.redis, userId, model, totalTokens)
          .catch((e) => app.log.warn(e, 'trackUserTokenUsage failed'));
      }

      logAiMediatorCall({
        timestamp: new Date().toISOString(),
        orgId, userId, departmentId: userRow?.departmentId ?? null,
        request: {
          url: 'https://api.ai-mediator.ru/v1/images/generations',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: payload,
        },
        response: { status: statusCode, body: data, headers: responseHeaders },
        durationMs: Date.now() - startTime,
      }).catch(() => {});
    }
  });

  // ── Image history ─────────────────────────────────────────────────────────

  app.get('/org/images', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.sub;
    const { orgId } = request.user;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).safeParse(request.query);
    const limit = query.success ? query.data.limit : 100;
    const rows = await db.select()
      .from(imageGenerations)
      .where(and(eq(imageGenerations.userId, userId), eq(imageGenerations.orgId, orgId)))
      .orderBy(desc(imageGenerations.createdAt))
      .limit(limit);
    return { data: rows };
  });

  app.delete('/org/images/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.sub;
    const { orgId } = request.user;

    const [gen] = await db.select({ id: imageGenerations.id, images: imageGenerations.images })
      .from(imageGenerations)
      .where(and(eq(imageGenerations.id, id), eq(imageGenerations.userId, userId), eq(imageGenerations.orgId, orgId)))
      .limit(1);

    if (!gen) return reply.status(404).send({ error: 'Not found' });

    // Delete associated stored files
    const fileIds = (gen.images as ImageRef[]).map((r) => r.fileId).filter(Boolean) as string[];
    for (const fileId of fileIds) {
      await db.delete(imageFiles).where(and(eq(imageFiles.id, fileId), eq(imageFiles.orgId, orgId)));
    }
    await db.delete(imageGenerations).where(eq(imageGenerations.id, id));
    return reply.status(204).send();
  });

  // ── Serve stored image file ───────────────────────────────────────────────

  app.get('/org/images/files/:fileId', { preHandler: requireAuth }, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const { orgId, sub: userId } = request.user;
    const download = (request.query as any).download === '1';

    const [file] = await db.select({ data: imageFiles.data })
      .from(imageFiles)
      .where(and(eq(imageFiles.id, fileId), eq(imageFiles.orgId, orgId), eq(imageFiles.userId, userId)))
      .limit(1);

    if (!file) return reply.status(404).send({ error: 'Not found' });

    const buf = Buffer.from(file.data, 'base64');
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (download) reply.header('Content-Disposition', `attachment; filename="image_${fileId.slice(0, 8)}.png"`);
    return reply.send(buf);
  });

  // ── Chat via proxy (any authenticated user) ───────────────────────────────

  app.post('/org/chat', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = request.user;

    const body = z.object({
      apiKeyId: z.string().uuid(),
      provider: z.string().min(1),
      model: z.string().min(1),
      messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const { apiKeyId, provider, model, messages } = body.data;

    const keyRows = await db.select({ id: apiKeys.id, isActive: apiKeys.isActive })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.orgId, orgId)))
      .limit(1);
    if (!keyRows.length || !keyRows[0].isActive) {
      return reply.status(403).send({ error: 'Invalid or inactive API key' });
    }

    const quotaRows = await db.select().from(quotas).where(eq(quotas.orgId, orgId)).limit(1);
    const quota = quotaRows[0] ?? { requestsPerMinute: 60, requestsPerDay: 10_000, tokensPerDay: 1_000_000 };

    const rateCheck = await checkRateLimits(app.redis, orgId, quota);
    if (rateCheck.exceeded) {
      reply.header('Retry-After', String(rateCheck.retryAfter ?? 60));
      return reply.status(429).send({ error: rateCheck.reason });
    }

    const currentTokens = await getDailyTokenUsage(app.redis, orgId);
    if (quota.tokensPerDay != null && currentTokens >= quota.tokensPerDay) {
      return reply.status(429).send({ error: 'Daily token quota exceeded' });
    }

    const target = await resolveProvider(provider);
    if (!target) return reply.status(404).send({ error: `Unknown provider: ${provider}` });

    const startTime = Date.now();
    let statusCode = 200;
    let responseBody: unknown = null;
    let errorMessage: string | null = null;
    let costRub: string | null = null;

    try {
      const upstreamResponse = await forwardRequest(
        target, 'chat/completions', 'POST',
        { 'content-type': 'application/json' },
        JSON.stringify({ model, messages }),
      );
      statusCode = upstreamResponse.status;
      costRub = extractCostRub(upstreamResponse.headers);
      const responseText = await upstreamResponse.text();
      try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }
      reply.status(statusCode);
      if (statusCode >= 400) return reply.send(responseBody);
    } catch (err) {
      statusCode = 502;
      errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : 'Upstream error');
      return reply.status(502).send({ error: 'Bad Gateway' });
    } finally {
      const duration = Date.now() - startTime;
      const { promptTokens, completionTokens, totalTokens, model: resModel } = extractTokensFromResponse(responseBody);
      if (totalTokens > 0) {
        trackTokenUsage(app.redis, orgId, totalTokens)
          .catch((e) => app.log.warn(e, 'trackTokenUsage failed'));
      }
      trackUsage({
        orgId, apiKeyId, providerId: target.id,
        model: resModel, endpoint: '/chat/completions',
        promptTokens, completionTokens, totalTokens,
        requestDurationMs: duration, statusCode, errorMessage, costRub,
      });
    }

    return responseBody;
  });

  // ── Users (org admin: own org only) ───────────────────────────────────────

  app.get('/org/users', { preHandler: requireAdmin }, async (request) => {
    const { orgId } = request.user;
    const rows = await db
      .select({
        id: users.id, email: users.email, name: users.name, surname: users.surname,
        phone: users.phone, modelSettings: users.modelSettings, role: users.role,
        isActive: users.isActive, departmentId: users.departmentId,
        departmentName: departments.name, createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(departments, eq(users.departmentId, departments.id))
      .where(and(eq(users.orgId, orgId), sql`${users.role} != 'superadmin'`))
      .orderBy(users.createdAt);
    return { data: rows };
  });

  app.get('/org/users/:userId', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { userId } = request.params as { userId: string };
    const rows = await db
      .select({
        id: users.id, email: users.email, name: users.name, surname: users.surname,
        phone: users.phone, modelSettings: users.modelSettings, role: users.role,
        isActive: users.isActive, departmentId: users.departmentId,
        departmentName: departments.name, createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(departments, eq(users.departmentId, departments.id))
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .limit(1);
    if (!rows.length) return reply.status(404).send({ error: 'User not found' });
    return { data: rows[0] };
  });

  app.post('/org/users', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const body = z.object({
      email: z.string().email(),
      name: z.string().optional(),
      surname: z.string().optional(),
      role: z.enum(['admin', 'member', 'dept_lead']).default('member'),
      departmentId: z.string().uuid().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const existing = await db.select().from(users).where(eq(users.email, body.data.email)).limit(1);
    if (existing.length) return reply.status(409).send({ error: 'Email already registered' });

    // Generate a random unusable password — user will set their own via the reset link
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
    const [created] = await db
      .insert(users)
      .values({ orgId, email: body.data.email, passwordHash, name: body.data.name, surname: body.data.surname, role: body.data.role, departmentId: body.data.departmentId })
      .returning({ id: users.id, email: users.email, name: users.name, surname: users.surname, phone: users.phone, modelSettings: users.modelSettings, role: users.role, isActive: users.isActive, departmentId: users.departmentId, createdAt: users.createdAt });
    logAudit({ orgId, actorId: request.user.sub, action: 'user.created', targetType: 'user', targetId: created.id, targetLabel: created.email, diff: { after: { email: created.email, role: created.role, departmentId: created.departmentId } }, ip: request.ip });

    // Send a password-set link so the user can choose their own password
    const token = randomBytes(32).toString('hex');
    await app.redis.set(`pw_reset:${token}`, created.id, 'EX', 7 * 24 * 3600); // 7 days for new accounts
    const resetUrl = `${config.APP_URL}/reset-password#token=${token}`;
    // Fire-and-forget — don't block the response on email delivery
    sendPasswordResetEmail(created.email, resetUrl).catch(() => {
      console.warn(`[mailer] Failed to send welcome email to ${created.email}`);
    });

    return reply.status(201).send({ data: created });
  });

  app.patch('/org/users/:userId', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { userId } = request.params as { userId: string };

    // Non-superadmin admins cannot modify superadmin accounts or elevate anyone to superadmin
    const [targetUser] = await db
      .select({ role: users.role, isActive: users.isActive, email: users.email, modelSettings: users.modelSettings, departmentId: users.departmentId, name: users.name, surname: users.surname, phone: users.phone, balanceRub: users.balanceRub })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .limit(1);
    if (targetUser?.role === 'superadmin' && request.user.role !== 'superadmin') {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z.object({
      email: z.string().email().optional(),
      name: z.string().max(100).nullable().optional(),
      surname: z.string().max(100).nullable().optional(),
      phone: z.string().max(50).nullable().optional(),
      role: z.enum(['admin', 'member', 'dept_lead']).optional(),
      isActive: z.boolean().optional(),
      departmentId: z.string().uuid().nullable().optional(),
      modelSettings: z.record(z.object({ allowed: z.boolean() })).nullable().optional(),
      balanceRub: z.number().positive().nullable().optional(),
      password: z.string().min(8).optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    if (body.data.email) {
      const conflict = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, body.data.email)).limit(1);
      if (conflict.length && conflict[0].id !== userId) {
        return reply.status(409).send({ error: 'Email already in use' });
      }
    }

    const { password, balanceRub: userBalanceRub, ...fields } = body.data;
    const setFields: Record<string, unknown> = { ...fields, updatedAt: new Date() };
    if (userBalanceRub !== undefined) setFields.balanceRub = userBalanceRub !== null ? String(userBalanceRub) : null;
    if (password) setFields.passwordHash = await bcrypt.hash(password, 12);

    const [updated] = await db
      .update(users).set(setFields)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .returning({ id: users.id, email: users.email, name: users.name, surname: users.surname, phone: users.phone, modelSettings: users.modelSettings, role: users.role, isActive: users.isActive, departmentId: users.departmentId, createdAt: users.createdAt });
    if (!updated) return reply.status(404).send({ error: 'User not found' });

    // Invalidate sessions if password changed or account was deactivated
    if (password || body.data.isActive === false) {
      await invalidateSessions(app.redis, userId);
    }

    const infoKeys = ['role', 'departmentId', 'email', 'name', 'surname', 'phone'];
    const infoAfter = pickFields(fields as Record<string, unknown>, infoKeys);
    if (password) infoAfter.password = '(changed)';
    if (Object.keys(infoAfter).length) {
      const infoBefore = pickFields(
        { role: targetUser?.role, email: targetUser?.email, departmentId: targetUser?.departmentId, name: targetUser?.name, surname: targetUser?.surname, phone: targetUser?.phone } as Record<string, unknown>,
        Object.keys(infoAfter),
      );
      const anyInfoChange = Object.keys(infoAfter).some((k) => JSON.stringify(infoBefore[k]) !== JSON.stringify(infoAfter[k]));
      if (anyInfoChange) {
        logAudit({ orgId, actorId: request.user.sub, action: 'user.info_updated', targetType: 'user', targetId: userId, targetLabel: updated.email, diff: { before: infoBefore, after: infoAfter }, ip: request.ip });
      }
    }
    if ('modelSettings' in fields && modelSettingsChanged(targetUser?.modelSettings, fields.modelSettings as never)) {
      logAudit({ orgId, actorId: request.user.sub, action: 'user.policy_updated', targetType: 'user', targetId: userId, targetLabel: updated.email, diff: { before: { modelSettings: targetUser?.modelSettings }, after: { modelSettings: fields.modelSettings } }, ip: request.ip });
    }
    if ('isActive' in fields && fields.isActive !== targetUser?.isActive) {
      const action = fields.isActive ? 'user.enabled' : 'user.disabled';
      logAudit({ orgId, actorId: request.user.sub, action, targetType: 'user', targetId: userId, targetLabel: updated.email, ip: request.ip });
    }
    if (userBalanceRub !== undefined) {
      const balanceBefore = targetUser?.balanceRub !== null && targetUser?.balanceRub !== undefined ? Number(targetUser.balanceRub) : null;
      if (balanceBefore !== userBalanceRub) {
        logAudit({ orgId, actorId: request.user.sub, action: 'user.balance_updated', targetType: 'user', targetId: userId, targetLabel: updated.email, diff: { before: { balanceRub: balanceBefore }, after: { balanceRub: userBalanceRub } }, ip: request.ip });
      }
    }

    return { data: updated };
  });

  app.delete('/org/users/:userId', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { userId } = request.params as { userId: string };
    const [pre] = await db.select({ email: users.email }).from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId))).limit(1);
    const [deleted] = await db
      .delete(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .returning({ id: users.id });
    if (!deleted) return reply.status(404).send({ error: 'User not found' });
    logAudit({ orgId, actorId: request.user.sub, action: 'user.deleted', targetType: 'user', targetId: userId, targetLabel: pre?.email, diff: { before: { email: pre?.email } }, ip: request.ip });
    return reply.status(204).send();
  });

  // ── Departments (org admin: own org only) ─────────────────────────────────

  app.get('/org/departments', { preHandler: requireAdmin }, async (request) => {
    const { orgId } = request.user;
    const rows = await db
      .select({
        id: departments.id, name: departments.name, orgId: departments.orgId,
        modelSettings: departments.modelSettings, aiMediatorKeyId: departments.aiMediatorKeyId,
        createdAt: departments.createdAt,
        userCount: sql<number>`(select count(*) from users where department_id = departments.id)::int`,
      })
      .from(departments)
      .where(eq(departments.orgId, orgId))
      .orderBy(departments.name);
    return { data: rows };
  });

  app.get('/org/departments/:deptId', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { deptId } = request.params as { deptId: string };
    const rows = await db
      .select({
        id: departments.id, name: departments.name, orgId: departments.orgId,
        modelSettings: departments.modelSettings, aiMediatorKeyId: departments.aiMediatorKeyId,
        createdAt: departments.createdAt,
        userCount: sql<number>`(select count(*) from users where department_id = departments.id)::int`,
      })
      .from(departments)
      .where(and(eq(departments.id, deptId), eq(departments.orgId, orgId)))
      .limit(1);
    if (!rows.length) return reply.status(404).send({ error: 'Department not found' });
    return { data: rows[0] };
  });

  app.post('/org/departments', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const body = z.object({ name: z.string().min(1).max(255) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error' });
    const [created] = await db.insert(departments).values({ orgId, name: body.data.name }).returning();
    logAudit({ orgId, actorId: request.user.sub, action: 'department.created', targetType: 'department', targetId: created.id, targetLabel: created.name, diff: { after: { name: created.name } }, ip: request.ip });
    return reply.status(201).send({ data: created });
  });

  app.patch('/org/departments/:deptId', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { deptId } = request.params as { deptId: string };
    const body = z.object({
      name: z.string().min(1).max(255).optional(),
      modelSettings: z.record(z.object({ allowed: z.boolean() })).nullable().optional(),
      aiMediatorKeyId: z.string().uuid().nullable().optional(),
      balanceRub: z.number().positive().nullable().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error' });

    // Validate that the key belongs to this org
    if (body.data.aiMediatorKeyId) {
      const [keyRow] = await db.select({ id: aiMediatorKeys.id }).from(aiMediatorKeys)
        .where(and(eq(aiMediatorKeys.id, body.data.aiMediatorKeyId), eq(aiMediatorKeys.orgId, orgId))).limit(1);
      if (!keyRow) return reply.status(400).send({ error: 'AI Mediator key not found' });
    }

    const [pre] = await db.select({ name: departments.name, modelSettings: departments.modelSettings, balanceRub: departments.balanceRub }).from(departments).where(and(eq(departments.id, deptId), eq(departments.orgId, orgId))).limit(1);
    const { balanceRub: deptBalanceRub, ...deptRest } = body.data;
    const deptSetFields = {
      ...deptRest,
      ...(deptBalanceRub !== undefined ? { balanceRub: deptBalanceRub !== null ? String(deptBalanceRub) : null } : {}),
    };
    const [updated] = await db.update(departments).set(deptSetFields)
      .where(and(eq(departments.id, deptId), eq(departments.orgId, orgId)))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Department not found' });
    if (body.data.name !== undefined && body.data.name !== pre?.name) {
      logAudit({ orgId, actorId: request.user.sub, action: 'department.info_updated', targetType: 'department', targetId: deptId, targetLabel: updated.name, diff: { before: { name: pre?.name }, after: { name: body.data.name } }, ip: request.ip });
    }
    if ('modelSettings' in body.data && modelSettingsChanged(pre?.modelSettings, body.data.modelSettings ?? null)) {
      logAudit({ orgId, actorId: request.user.sub, action: 'department.policy_updated', targetType: 'department', targetId: deptId, targetLabel: updated.name, diff: { before: { modelSettings: pre?.modelSettings }, after: { modelSettings: body.data.modelSettings } }, ip: request.ip });
    }
    if (deptBalanceRub !== undefined) {
      const balanceBefore = pre?.balanceRub !== null && pre?.balanceRub !== undefined ? Number(pre.balanceRub) : null;
      if (balanceBefore !== deptBalanceRub) {
        logAudit({ orgId, actorId: request.user.sub, action: 'department.balance_updated', targetType: 'department', targetId: deptId, targetLabel: updated.name, diff: { before: { balanceRub: balanceBefore }, after: { balanceRub: deptBalanceRub } }, ip: request.ip });
      }
    }
    return { data: updated };
  });

  app.delete('/org/departments/:deptId', { preHandler: requireAdmin }, async (request, reply) => {
    const { orgId } = request.user;
    const { deptId } = request.params as { deptId: string };
    const [pre] = await db.select({ name: departments.name }).from(departments).where(and(eq(departments.id, deptId), eq(departments.orgId, orgId))).limit(1);
    const [deleted] = await db.delete(departments)
      .where(and(eq(departments.id, deptId), eq(departments.orgId, orgId)))
      .returning({ id: departments.id });
    if (!deleted) return reply.status(404).send({ error: 'Department not found' });
    logAudit({ orgId, actorId: request.user.sub, action: 'department.deleted', targetType: 'department', targetId: deptId, targetLabel: pre?.name, diff: { before: { name: pre?.name } }, ip: request.ip });
    return reply.status(204).send();
  });
}
