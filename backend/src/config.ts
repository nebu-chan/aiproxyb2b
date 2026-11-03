import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { z } from 'zod';

const INSECURE_JWT_PATTERNS = ['change-me', 'secret', 'changeme', 'password', 'example'];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 characters'),
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be exactly 64 hex characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  APP_URL: z.string().default('http://localhost:5173'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('AI Gateway <noreply@localhost>'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const cfg = parsed.data;

// Block obviously insecure JWT secrets in production
if (cfg.NODE_ENV === 'production') {
  const lower = cfg.JWT_SECRET.toLowerCase();
  if (INSECURE_JWT_PATTERNS.some((p) => lower.includes(p))) {
    console.error('❌ Insecure JWT_SECRET detected in production. Aborting.');
    process.exit(1);
  }
}

export const config = cfg;
