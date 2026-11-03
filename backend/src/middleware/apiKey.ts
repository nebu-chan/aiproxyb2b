import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { apiKeys, organizations, quotas } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export interface ApiKeyContext {
  apiKeyId: string;
  orgId: string;
  orgSlug: string;
  quota: {
    requestsPerMinute: number;
    requestsPerDay: number;
    tokensPerDay: number;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyContext: ApiKeyContext;
  }
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Extracts and validates the API key from the Authorization header.
 * Populates `request.apiKeyContext` on success.
 */
export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) {
    return reply.status(401).send({ error: 'Empty API key' });
  }

  const keyHash = hashApiKey(rawKey);

  const result = await db
    .select({
      apiKeyId: apiKeys.id,
      orgId: organizations.id,
      orgSlug: organizations.slug,
      orgIsActive: organizations.isActive,
      keyIsActive: apiKeys.isActive,
      requestsPerMinute: quotas.requestsPerMinute,
      requestsPerDay: quotas.requestsPerDay,
      tokensPerDay: quotas.tokensPerDay,
    })
    .from(apiKeys)
    .innerJoin(organizations, eq(apiKeys.orgId, organizations.id))
    .leftJoin(quotas, eq(organizations.id, quotas.orgId))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!result.length) {
    return reply.status(401).send({ error: 'Invalid API key' });
  }

  const row = result[0];

  if (!row.keyIsActive) {
    return reply.status(401).send({ error: 'API key is disabled' });
  }

  if (!row.orgIsActive) {
    return reply.status(403).send({ error: 'Organization is suspended' });
  }

  request.apiKeyContext = {
    apiKeyId: row.apiKeyId,
    orgId: row.orgId,
    orgSlug: row.orgSlug,
    quota: {
      requestsPerMinute: row.requestsPerMinute ?? 60,
      requestsPerDay: row.requestsPerDay ?? 10_000,
      tokensPerDay: row.tokensPerDay ?? 1_000_000,
    },
  };

  // Update last_used_at asynchronously (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.apiKeyId))
    .catch(() => {});
}
