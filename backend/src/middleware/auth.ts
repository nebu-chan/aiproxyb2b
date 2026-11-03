import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

export interface JwtPayload {
  sub: string;     // user id
  orgId: string;
  role: string;
  sv: number;      // session version — invalidated on password change / deactivation
  imp?: string;    // impersonation session handle (present only during impersonation)
}

// Tell @fastify/jwt what shape our tokens have
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

const SV_CACHE_KEY = (userId: string) => `sv:${userId}`;
const SV_CACHE_TTL = 600; // 10 minutes

/**
 * CSRF protection: require X-Requested-With header on state-changing requests.
 * Browsers never send this header automatically on cross-origin requests,
 * so a missing header indicates a potential CSRF attempt.
 */
export function requireCsrfHeader(request: FastifyRequest, reply: FastifyReply) {
  const method = request.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!request.headers['x-requested-with']) {
      return reply.status(403).send({ error: 'Forbidden: missing CSRF header' });
    }
  }
}

/** Require a valid JWT and a non-revoked session. Attaches `request.user`. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  requireCsrfHeader(request, reply);
  if (reply.sent) return;

  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const { sub, sv } = request.user;
  const redis = request.server.redis;

  // Fast path: session version cached in Redis (avoids DB hit on every request)
  const cached = await redis.get(SV_CACHE_KEY(sub));
  if (cached !== null) {
    if (parseInt(cached, 10) !== sv) {
      return reply.status(401).send({ error: 'Session expired. Please log in again.' });
    }
    return;
  }

  // Cache miss: query DB, populate cache, then validate
  const [row] = await db
    .select({ sessionVersion: users.sessionVersion, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, sub))
    .limit(1);

  if (!row || !row.isActive) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  await redis.set(SV_CACHE_KEY(sub), row.sessionVersion, 'EX', SV_CACHE_TTL);

  if (row.sessionVersion !== sv) {
    return reply.status(401).send({ error: 'Session expired. Please log in again.' });
  }
}

/** Require the authenticated user to have one of the allowed roles. */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!roles.includes(request.user.role)) {
      reply.status(403).send({ error: 'Forbidden' });
    }
  };
}

/** Shorthand: only superadmin can proceed. */
export const requireSuperAdmin = requireRole('superadmin');

/** Shorthand: org admin or superadmin. */
export const requireAdmin = requireRole('admin', 'superadmin');

/** Shorthand: dept_lead, admin, or superadmin. */
export const requireDeptLead = requireRole('dept_lead', 'admin', 'superadmin');

/**
 * Bump sessionVersion for a user, invalidating all their existing JWTs.
 * Call after password change or account deactivation.
 */
export async function invalidateSessions(redis: Redis, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ sessionVersion: sql`session_version + 1`, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await redis.del(SV_CACHE_KEY(userId));
}
