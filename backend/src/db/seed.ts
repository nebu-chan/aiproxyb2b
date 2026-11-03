/**
 * Seeds the database with a superadmin user and default quota.
 * Run once after initial migration: npx tsx src/db/seed.ts
 */
import bcrypt from 'bcryptjs';
import { db } from './index.js';
import { organizations, users, quotas } from './schema.js';
import { config } from '../config.js';

async function seed() {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    console.log('Skipping seed: ADMIN_EMAIL / ADMIN_PASSWORD not set in .env');
    return;
  }

  console.log('Seeding database…');

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Platform Admin', slug: 'platform-admin' })
    .onConflictDoNothing()
    .returning();

  if (!org) {
    console.log('Admin org already exists, skipping.');
    return;
  }

  const passwordHash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);

  await db.insert(users).values({
    orgId: org.id,
    email: config.ADMIN_EMAIL,
    passwordHash,
    role: 'superadmin',
  });

  await db.insert(quotas).values({
    orgId: org.id,
    requestsPerMinute: 10_000,
    requestsPerDay: 10_000_000,
    tokensPerDay: 100_000_000,
  });

  console.log(`✅ Admin user created: ${config.ADMIN_EMAIL}`);
}

seed().catch(console.error);
