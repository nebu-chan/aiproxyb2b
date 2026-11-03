/**
 * Seeds Monsters Inc organization with departments, users, and usage logs.
 * Run: npx tsx src/db/seed-monsters.ts
 */
import bcrypt from 'bcryptjs';
import { db } from './index.js';
import { organizations, departments, users, quotas, usageLogs } from './schema.js';

const MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307',
];

const ENDPOINTS = ['/v1/chat/completions', '/v1/completions'];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgo: number): Date {
  const now = Date.now();
  const from = now - daysAgo * 86_400_000;
  return new Date(from + Math.random() * (now - from));
}

async function seed() {
  console.log('Seeding Monsters Inc…');

  // ── Organization ─────────────────────────────────────────────────────────────
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Monsters Inc', slug: 'monsters-inc' })
    .onConflictDoNothing()
    .returning();

  if (!org) {
    console.log('Monsters Inc already exists, aborting.');
    return;
  }

  // ── Quota ────────────────────────────────────────────────────────────────────
  await db.insert(quotas).values({
    orgId: org.id,
    requestsPerMinute: 120,
    requestsPerDay: 5_000,
  });

  // ── Departments ───────────────────────────────────────────────────────────────
  const deptNames = ['Scaring Floor', 'Research & Development', 'Human Resources'];
  const insertedDepts = await db
    .insert(departments)
    .values(deptNames.map((name) => ({ orgId: org.id, name })))
    .returning();

  console.log(`Created ${insertedDepts.length} departments`);

  // ── Users ─────────────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('monsters123', 12);
  const memberHash = await bcrypt.hash('password123', 12);

  const firstNames = [
    'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
    'William', 'Barbara', 'David', 'Susan', 'Richard', 'Jessica', 'Joseph', 'Sarah',
    'Thomas', 'Karen', 'Charles', 'Lisa', 'Christopher', 'Nancy', 'Daniel', 'Betty',
    'Matthew', 'Margaret', 'Anthony', 'Sandra',
  ];
  const lastNames = [
    'Sullivan', 'Wazowski', 'Randall', 'Roz', 'Celia', 'Needleman', 'Smitty',
    'Fungus', 'Waternoose', 'Bile', 'Peterson', 'Johnson', 'Williams', 'Brown',
    'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Taylor', 'Anderson', 'Thomas',
    'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Lee',
  ];

  const userCount = rand(22, 28);
  const userValues: {
    orgId: string;
    departmentId: string;
    email: string;
    passwordHash: string;
    name: string;
    surname: string;
    role: string;
  }[] = [];

  // Admin user first
  userValues.push({
    orgId: org.id,
    departmentId: insertedDepts[0].id,
    email: 'admin@monsters-inc.com',
    passwordHash: adminHash,
    name: 'James',
    surname: 'Sullivan',
    role: 'admin',
  });

  for (let i = 1; i < userCount; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    const dept = insertedDepts[i % insertedDepts.length];
    userValues.push({
      orgId: org.id,
      departmentId: dept.id,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@monsters-inc.com`,
      passwordHash: memberHash,
      name: firstName,
      surname: lastName,
      role: 'member',
    });
  }

  const insertedUsers = await db.insert(users).values(userValues).returning();
  console.log(`Created ${insertedUsers.length} users`);

  // ── Usage Logs ────────────────────────────────────────────────────────────────
  const logCount = rand(52, 58);
  const logValues = Array.from({ length: logCount }, () => {
    const user = insertedUsers[rand(0, insertedUsers.length - 1)];
    const model = MODELS[rand(0, MODELS.length - 1)];
    const promptTokens = rand(100, 2000);
    const completionTokens = rand(50, 800);
    const statusCode = Math.random() < 0.1 ? (Math.random() < 0.5 ? 429 : 500) : 200;
    return {
      orgId: org.id,
      userId: user.id,
      model,
      endpoint: ENDPOINTS[rand(0, ENDPOINTS.length - 1)],
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      requestDurationMs: rand(200, 8000),
      statusCode,
      errorMessage: statusCode !== 200 ? 'Upstream error' : null,
      createdAt: randomDate(30),
    };
  });

  await db.insert(usageLogs).values(logValues);
  console.log(`Created ${logCount} usage log entries`);

  console.log('✅ Monsters Inc seeded successfully!');
  console.log('   Admin: admin@monsters-inc.com / monsters123');
}

seed().catch(console.error).finally(() => process.exit(0));
