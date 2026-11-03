import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // unix ms
}

/**
 * Sliding-window rate limiter using Redis sorted sets.
 *
 * @param redis  - Redis client
 * @param key    - Unique key for this window (e.g. "ratelimit:org123:minute")
 * @param limit  - Max requests allowed in the window
 * @param windowMs - Window size in milliseconds
 */
export async function slidingWindowLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowMs;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, '-inf', windowStart);
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  pipeline.zcard(key);
  pipeline.pexpire(key, windowMs);

  const results = await pipeline.exec();
  const count = (results?.[2]?.[1] as number) ?? 0;
  const allowed = count <= limit;

  return {
    allowed,
    remaining: Math.max(0, limit - count),
    resetAt: now + windowMs,
  };
}

/**
 * Check all relevant rate limits for an org.
 * Returns the first exceeded limit, or null if all pass.
 */
export async function checkRateLimits(
  redis: Redis,
  orgId: string,
  quota: { requestsPerMinute: number; requestsPerDay: number },
): Promise<{ exceeded: boolean; reason?: string; retryAfter?: number }> {
  const [perMinute, perDay] = await Promise.all([
    slidingWindowLimit(redis, `rl:${orgId}:minute`, quota.requestsPerMinute, 60_000),
    slidingWindowLimit(redis, `rl:${orgId}:day`, quota.requestsPerDay, 86_400_000),
  ]);

  if (!perMinute.allowed) {
    return {
      exceeded: true,
      reason: `Rate limit exceeded: ${quota.requestsPerMinute} requests/minute`,
      retryAfter: Math.ceil((perMinute.resetAt - Date.now()) / 1000),
    };
  }

  if (!perDay.allowed) {
    return {
      exceeded: true,
      reason: `Daily limit exceeded: ${quota.requestsPerDay} requests/day`,
      retryAfter: Math.ceil((perDay.resetAt - Date.now()) / 1000),
    };
  }

  return { exceeded: false };
}

/**
 * Increment daily token usage counter. Returns the new total.
 */
export async function trackTokenUsage(
  redis: Redis,
  orgId: string,
  tokens: number,
): Promise<number> {
  const key = `tokens:${orgId}:${todayKey()}`;
  const pipeline = redis.pipeline();
  pipeline.incrby(key, tokens);
  pipeline.expire(key, 86_400 * 2); // keep for 2 days
  const results = await pipeline.exec();
  return (results?.[0]?.[1] as number) ?? 0;
}

/**
 * Get current daily token usage for an org.
 */
export async function getDailyTokenUsage(redis: Redis, orgId: string): Promise<number> {
  const val = await redis.get(`tokens:${orgId}:${todayKey()}`);
  return val ? parseInt(val, 10) : 0;
}

/**
 * Increment daily token usage counter for a user+model. Returns the new total.
 */
export async function trackUserTokenUsage(
  redis: Redis,
  userId: string,
  model: string,
  tokens: number,
): Promise<number> {
  const key = `user_tokens:${userId}:${model}:${todayKey()}`;
  const pipeline = redis.pipeline();
  pipeline.incrby(key, tokens);
  pipeline.expire(key, 86_400 * 2);
  const results = await pipeline.exec();
  return (results?.[0]?.[1] as number) ?? 0;
}

/**
 * Get current daily token usage for a user+model.
 */
export async function getDailyUserTokenUsage(
  redis: Redis,
  userId: string,
  model: string,
): Promise<number> {
  const val = await redis.get(`user_tokens:${userId}:${model}:${todayKey()}`);
  return val ? parseInt(val, 10) : 0;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}
