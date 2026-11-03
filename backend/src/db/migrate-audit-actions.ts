import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://aigateway:secret@localhost:5432/aigateway' });

await client.connect();

const r1 = await client.query(`
  UPDATE audit_logs
  SET action = 'user.policy_updated'
  WHERE action = 'user.updated'
    AND (diff->'after' ? 'modelSettings' OR diff->'before' ? 'modelSettings')
`);
console.log(`user.updated → user.policy_updated: ${r1.rowCount} rows`);

const r2 = await client.query(`
  UPDATE audit_logs SET action = 'user.info_updated' WHERE action = 'user.updated'
`);
console.log(`user.updated → user.info_updated: ${r2.rowCount} rows`);

const r3 = await client.query(`
  UPDATE audit_logs
  SET action = 'department.policy_updated'
  WHERE action = 'department.updated'
    AND (diff->'after' ? 'modelSettings' OR diff->'before' ? 'modelSettings')
`);
console.log(`department.updated → department.policy_updated: ${r3.rowCount} rows`);

const r4 = await client.query(`
  UPDATE audit_logs SET action = 'department.info_updated' WHERE action = 'department.updated'
`);
console.log(`department.updated → department.info_updated: ${r4.rowCount} rows`);

await client.end();
console.log('Done.');
