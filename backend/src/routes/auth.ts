import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, invalidateSessions } from '../middleware/auth.js';
import { config } from '../config.js';
import { sendPasswordResetEmail } from '../utils/mailer.js';

const RESET_TTL_SECONDS = 3600; // 1 hour
const RESET_KEY = (token: string) => `pw_reset:${token}`;

const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: (config.NODE_ENV === 'production' ? 'none' : 'strict') as 'none' | 'strict',
  path: '/',
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  orgName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

/** Strict rate limit config for auth routes (10 req / min per IP). */
const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

const LOGIN_FAIL_KEY = (email: string) => `login_fail:${email.toLowerCase()}`;
const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW_SECONDS = 300; // 5 minutes

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/register — create a new org + admin user
  app.post('/auth/register', authRateLimit, async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });
    }

    const { orgName, email, password } = body.data;

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) {
      // Generic message — don't reveal whether the email is already registered
      return reply.status(409).send({ error: 'Registration failed. Please try a different email.' });
    }

    const slug = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);

    const passwordHash = await bcrypt.hash(password, 12);

    const [org] = await db
      .insert(organizations)
      .values({ name: orgName, slug: `${slug}-${randomBytes(4).toString('hex')}` })
      .returning();

    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, email, passwordHash, role: 'admin' })
      .returning();

    const token = app.jwt.sign({
      sub: user.id,
      orgId: org.id,
      role: user.role,
      sv: user.sessionVersion ?? 1,
    });

    reply.setCookie('token', token, COOKIE_OPTS);

    return reply.status(201).send({
      user: { id: user.id, email: user.email, role: user.role, name: user.name, surname: user.surname, locale: user.locale },
      org: { id: org.id, name: org.name, slug: org.slug },
    });
  });

  // POST /auth/login
  app.post('/auth/login', authRateLimit, async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });
    }

    const { email, password } = body.data;

    // Check account lockout before hitting the DB for the password
    const failKey = LOGIN_FAIL_KEY(email);
    const failCount = await app.redis.get(failKey);
    if (failCount && parseInt(failCount, 10) >= LOGIN_FAIL_MAX) {
      const ttl = await app.redis.ttl(failKey);
      return reply.status(429).send({
        error: `Too many failed login attempts. Try again in ${Math.ceil(ttl / 60)} minute(s).`,
      });
    }

    const result = await db
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(users.orgId, organizations.id))
      .where(eq(users.email, email))
      .limit(1);

    if (!result.length) {
      // Still increment fail counter even for non-existent emails to prevent user enumeration
      const n = await app.redis.incr(failKey);
      if (n === 1) await app.redis.expire(failKey, LOGIN_FAIL_WINDOW_SECONDS);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const { user, org } = result[0];

    if (!user.isActive) {
      return reply.status(403).send({ error: 'Account is disabled' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const n = await app.redis.incr(failKey);
      if (n === 1) await app.redis.expire(failKey, LOGIN_FAIL_WINDOW_SECONDS);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Successful login — clear fail counter
    await app.redis.del(failKey);

    const token = app.jwt.sign({
      sub: user.id,
      orgId: org.id,
      role: user.role,
      sv: user.sessionVersion,
    });

    reply.setCookie('token', token, COOKIE_OPTS);

    return {
      user: { id: user.id, email: user.email, role: user.role, name: user.name, surname: user.surname, locale: user.locale },
      org: { id: org.id, name: org.name, slug: org.slug },
    };
  });

  // POST /auth/reset-password — validate token, set new password
  app.post('/auth/reset-password', authRateLimit, async (request, reply) => {
    const body = z.object({
      token: z.string().min(1),
      password: z.string().min(8).max(128),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });

    const { token, password } = body.data;
    const userId = await app.redis.get(RESET_KEY(token));
    if (!userId) return reply.status(400).send({ error: 'Reset link is invalid or has expired.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const [updated] = await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (!updated) return reply.status(404).send({ error: 'User not found.' });

    // Invalidate the reset token and all existing sessions for this user
    await app.redis.del(RESET_KEY(token));
    await invalidateSessions(app.redis, userId);

    return { ok: true };
  });

  // POST /auth/logout — clear the auth cookie
  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/', sameSite: config.NODE_ENV === 'production' ? 'none' : 'strict', secure: config.NODE_ENV === 'production' });
    return reply.send({ ok: true });
  });

  // GET /auth/me — return current user info
  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    const { sub } = request.user;

    const result = await db
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(users.orgId, organizations.id))
      .where(eq(users.id, sub))
      .limit(1);

    if (!result.length) {
      return { error: 'User not found' };
    }

    const { user, org } = result[0];

    let impersonating: { orgId: string; orgName: string; sessionHandle: string } | undefined;
    let targetOrg: typeof org | undefined;
    if (request.user.imp) {
      const stored = await request.server.redis.get(`impersonate:${request.user.imp}`);
      if (stored) {
        const { targetOrgId, targetOrgName } = JSON.parse(stored) as { targetOrgId: string; targetOrgName: string };
        impersonating = { orgId: targetOrgId, orgName: targetOrgName, sessionHandle: request.user.imp };
        const [targetOrgRow] = await db.select().from(organizations).where(eq(organizations.id, targetOrgId)).limit(1);
        targetOrg = targetOrgRow;
      }
    }

    // When impersonating, use the role and org from the JWT (not the real DB values)
    const effectiveRole = request.user.imp ? request.user.role : user.role;
    const effectiveOrg = targetOrg
      ? { id: targetOrg.id, name: targetOrg.name, slug: targetOrg.slug }
      : { id: org.id, name: org.name, slug: org.slug };

    return {
      user: { id: user.id, email: user.email, role: effectiveRole, name: user.name, surname: user.surname, locale: user.locale },
      org: effectiveOrg,
      ...(impersonating && { impersonating }),
    };
  });
}
