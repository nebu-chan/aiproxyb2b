import type { FastifyInstance } from 'fastify';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const bytes = randomBytes(32).toString('base64url');
  const raw = `sk-${bytes}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12); // "sk-XXXXXXXX"
  return { raw, hash, prefix };
}

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
});

export async function apiKeyRoutes(app: FastifyInstance) {
  // GET /api-keys — list org's keys
  app.get('/api-keys', { preHandler: requireAuth }, async (request) => {
    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        isActive: apiKeys.isActive,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.orgId, request.user.orgId));

    return { data: keys };
  });

  // POST /api-keys — create a new key
  app.post('/api-keys', { preHandler: requireAuth }, async (request, reply) => {
    const body = createKeySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation error', details: body.error.flatten() });
    }

    const { raw, hash, prefix } = generateApiKey();

    const [key] = await db
      .insert(apiKeys)
      .values({
        orgId: request.user.orgId,
        name: body.data.name,
        keyHash: hash,
        keyPrefix: prefix,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        isActive: apiKeys.isActive,
        createdAt: apiKeys.createdAt,
      });

    return reply.status(201).send({
      // Raw key is only returned once — instruct clients to store it
      key: raw,
      data: key,
    });
  });

  // PATCH /api-keys/:id — enable / disable
  app.patch('/api-keys/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ isActive: z.boolean() }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation error' });
    }

    const [updated] = await db
      .update(apiKeys)
      .set({ isActive: body.data.isActive })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, request.user.orgId)))
      .returning({ id: apiKeys.id, isActive: apiKeys.isActive });

    if (!updated) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    return { data: updated };
  });

  // DELETE /api-keys/:id
  app.delete('/api-keys/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [deleted] = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, request.user.orgId)))
      .returning({ id: apiKeys.id });

    if (!deleted) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    return reply.status(204).send();
  });
}
