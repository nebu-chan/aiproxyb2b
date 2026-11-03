import type { FastifyInstance } from 'fastify';
import { requireApiKey } from '../middleware/apiKey.js';
import { checkRateLimits, trackTokenUsage, getDailyTokenUsage } from '../services/rateLimiter.js';
import { resolveProvider, forwardRequest } from '../services/proxyService.js';
import { trackUsage, extractTokensFromResponse, extractCostRub } from '../services/usageTracker.js';

/**
 * Proxy routes.
 *
 * All requests require a valid Bearer API key.
 *
 * Route pattern:
 *   POST/GET /v1/proxy/:provider/*
 *
 * The :provider segment is matched against the `providers` table.
 * Everything after :provider is forwarded as the path to the upstream API.
 *
 * Example:
 *   POST /v1/proxy/openai/chat/completions
 *   → forwarded to https://api.openai.com/chat/completions
 *
 * When the AI provider spec arrives, additional typed routes can be added here.
 */
export async function proxyRoutes(app: FastifyInstance) {
  // Generic catch-all proxy
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/v1/proxy/:provider/*',
    preHandler: requireApiKey,
    handler: async (request, reply) => {
      const { provider } = request.params as { provider: string; '*': string };
      const upstreamPath = (request.params as Record<string, string>)['*'] ?? '';
      const { orgId, apiKeyId, quota } = request.apiKeyContext;

      // ── Rate limiting ──────────────────────────────────────────────────────
      const rateCheck = await checkRateLimits(app.redis, orgId, quota);
      if (rateCheck.exceeded) {
        reply.header('Retry-After', String(rateCheck.retryAfter ?? 60));
        return reply.status(429).send({ error: rateCheck.reason });
      }

      // ── Token quota check ─────────────────────────────────────────────────
      const currentTokens = await getDailyTokenUsage(app.redis, orgId);
      if (currentTokens >= quota.tokensPerDay) {
        return reply.status(429).send({ error: 'Daily token quota exceeded' });
      }

      // ── Resolve upstream provider ─────────────────────────────────────────
      const target = await resolveProvider(provider);
      if (!target) {
        return reply.status(404).send({ error: `Unknown provider: ${provider}` });
      }

      const startTime = Date.now();
      let statusCode = 200;
      let responseBody: unknown = null;
      let errorMessage: string | null = null;
      let costRub: string | null = null;

      try {
        const bodyText =
          request.method !== 'GET' && request.body
            ? JSON.stringify(request.body)
            : undefined;

        const headers = request.headers as Record<string, string>;
        const upstreamResponse = await forwardRequest(
          target,
          upstreamPath,
          request.method,
          headers,
          bodyText,
        );

        statusCode = upstreamResponse.status;
        costRub = extractCostRub(upstreamResponse.headers);
        const responseText = await upstreamResponse.text();

        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = responseText;
        }

        reply.status(statusCode);

        // Forward relevant response headers
        for (const [k, v] of upstreamResponse.headers.entries()) {
          if (['content-type', 'x-request-id'].includes(k.toLowerCase())) {
            reply.header(k, v);
          }
        }
      } catch (err) {
        statusCode = 502;
        errorMessage = err instanceof Error ? err.message : 'Upstream error';
        request.log.error({ err }, 'Upstream proxy error');
        return reply.status(502).send({ error: 'Bad Gateway' });
      } finally {
        const duration = Date.now() - startTime;
        const { promptTokens, completionTokens, totalTokens, model } =
          extractTokensFromResponse(responseBody);

        // Track token usage in Redis (async)
        if (totalTokens > 0) {
          trackTokenUsage(app.redis, orgId, totalTokens).catch(() => {});
        }

        // Persist usage log (async, fire-and-forget)
        trackUsage({
          orgId,
          apiKeyId,
          providerId: target.id,
          model,
          endpoint: `/${upstreamPath}`,
          promptTokens,
          completionTokens,
          totalTokens,
          requestDurationMs: duration,
          statusCode,
          errorMessage,
          costRub,
        });
      }

      return responseBody;
    },
  });
}
