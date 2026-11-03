import { db } from './index.js';
import { sql } from 'drizzle-orm';

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS image_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    data text NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL
  )
`);

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS image_generations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    prompt text NOT NULL,
    model varchar(255) NOT NULL,
    size varchar(50),
    quality varchar(50),
    n integer NOT NULL DEFAULT 1,
    images jsonb NOT NULL DEFAULT '[]',
    created_at timestamp DEFAULT now() NOT NULL
  )
`);

await db.execute(sql`CREATE INDEX IF NOT EXISTS image_files_org_idx ON image_files(org_id)`);
await db.execute(sql`CREATE INDEX IF NOT EXISTS image_gen_user_idx ON image_generations(user_id)`);
await db.execute(sql`CREATE INDEX IF NOT EXISTS image_gen_org_created_idx ON image_generations(org_id, created_at)`);

console.log('Image storage migration done.');
process.exit(0);
