import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://aigateway:secret@localhost:5432/aigateway' });
await client.connect();

// Delete user.info_updated and department.info_updated where before === after (no real change)
const r1 = await client.query(`
  DELETE FROM audit_logs
  WHERE action IN ('user.info_updated', 'department.info_updated')
    AND diff IS NOT NULL
    AND diff->'before' = diff->'after'
`);
console.log(`Deleted no-op info_updated records: ${r1.rowCount}`);

// Delete user.policy_updated and department.policy_updated where modelSettings didn't change
// We check if the jsonb values are equal
const r2 = await client.query(`
  DELETE FROM audit_logs
  WHERE action IN ('user.policy_updated', 'department.policy_updated')
    AND diff IS NOT NULL
    AND diff->'before'->'modelSettings' = diff->'after'->'modelSettings'
`);
console.log(`Deleted no-op policy_updated records: ${r2.rowCount}`);

await client.end();
console.log('Done.');
