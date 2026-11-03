import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { config } from './config.js';
import redisPlugin from './plugins/redis.js';

import { authRoutes } from './routes/auth.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { proxyRoutes } from './routes/proxy.js';
import { analyticsRoutes } from './routes/analytics.js';
import { adminRoutes } from './routes/admin.js';
import { orgRoutes } from './routes/org.js';
import { runBillingSync } from './services/billingSync.js';

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  },
  bodyLimit: 20 * 1024 * 1024, // 20 MB — needed for base64 image payloads
});

// ── Security headers ──────────────────────────────────────────────────────────

await app.register(helmet, {
  // Strict CSP for a pure JSON API — no scripts, frames, or external resources allowed
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: { policy: 'unsafe-none' }, // don't enforce COEP on API responses
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // API must be readable cross-origin (Vite proxy)
});

// ── CORS ─────────────────────────────────────────────────────────────────────

await app.register(cors, {
  origin: config.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

// ── Cookies (must be before JWT so jwt can read cookies) ─────────────────────

await app.register(cookie);

// ── JWT ───────────────────────────────────────────────────────────────────────

await app.register(jwt, {
  secret: config.JWT_SECRET,
  sign: { expiresIn: '7d' },
  cookie: { cookieName: 'token', signed: false },
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
  // Per-route overrides are set in each route file via config.rateLimit
});

// ── Redis ─────────────────────────────────────────────────────────────────────

await app.register(redisPlugin);

// ── Routes ───────────────────────────────────────────────────────────────────

await app.register(authRoutes);
await app.register(apiKeyRoutes);
await app.register(proxyRoutes);
await app.register(analyticsRoutes);
await app.register(adminRoutes);
await app.register(orgRoutes);

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Start ────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`🚀 API Gateway running on http://localhost:${config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// ── Billing sync ──────────────────────────────────────────────────────────────

const BILLING_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

async function scheduleBillingSync() {
  try {
    await runBillingSync();
  } catch (err) {
    app.log.error(err, '[billingSync] Unhandled error during sync');
  }
  setTimeout(scheduleBillingSync, BILLING_SYNC_INTERVAL_MS);
}

// Run first sync after 30s to let server fully warm up, then every 15 min
setTimeout(scheduleBillingSync, 30_000);
