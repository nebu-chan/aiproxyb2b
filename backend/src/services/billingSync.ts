/**
 * Billing sync service.
 *
 * Periodically fetches /api/usage_billed from AI Mediator for each active key,
 * matches records by request_id, and writes the exact ruble cost into usage_logs.
 */

import { db } from '../db/index.js';
import { aiMediatorKeys, usageLogs, billingSyncLog } from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { decrypt } from '../utils/encrypt.js';

const BILLING_API = 'https://app.ai-mediator.ru/api/usage_billed';
const FETCH_TIMEOUT_MS = 30_000;

interface BilledRecord {
  request_id: string;
  aimediator_billed_amt_rub: number;
  startTime: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function fetchBilledRecords(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<BilledRecord[]> {
  const url = `${BILLING_API}?startDate=${startDate}&endDate=${endDate}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AI Mediator billing API returned ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return []; // empty body = no records

  // The API may return a JSON array OR newline-delimited JSON (NDJSON)
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as BilledRecord[];
  }
  // NDJSON: one JSON object per line
  return trimmed
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as BilledRecord);
}

export async function runBillingSync(): Promise<void> {
  // Fetch all active AI Mediator keys with their org
  const keys = await db
    .select({
      id: aiMediatorKeys.id,
      orgId: aiMediatorKeys.orgId,
      encryptedKey: aiMediatorKeys.encryptedKey,
    })
    .from(aiMediatorKeys)
    .where(eq(aiMediatorKeys.isActive, true));

  for (const keyRow of keys) {
    let apiKey: string;
    try {
      apiKey = decrypt(keyRow.encryptedKey);
    } catch {
      continue; // skip keys that fail to decrypt
    }

    // Determine sync window: from last synced date (or 7 days ago) through yesterday
    const [syncState] = await db
      .select({ syncedThrough: billingSyncLog.syncedThrough })
      .from(billingSyncLog)
      .where(eq(billingSyncLog.aiMediatorKeyId, keyRow.id))
      .limit(1);

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    let startDate: Date;
    if (syncState?.syncedThrough) {
      // Re-sync from the last synced day to catch any late-arriving records
      startDate = new Date(syncState.syncedThrough);
    } else {
      // First sync: go back 7 days
      startDate = new Date(now);
      startDate.setUTCDate(startDate.getUTCDate() - 7);
    }

    // Also sync today to catch real-time usage
    const endDate = now;

    const startStr = toDateStr(startDate);
    const endStr = toDateStr(endDate);

    let records: BilledRecord[];
    try {
      records = await fetchBilledRecords(apiKey, startStr, endStr);
    } catch (err) {
      console.error(`[billingSync] Failed to fetch for key ${keyRow.id}:`, err);
      continue;
    }

    if (records.length === 0) {
      // Update sync timestamp even if no records
      await upsertSyncLog(keyRow.id, keyRow.orgId, endDate, 0);
      continue;
    }

    // Match by request_id and update cost_rub
    const requestIds = records.map((r) => r.request_id).filter(Boolean);
    if (requestIds.length === 0) {
      await upsertSyncLog(keyRow.id, keyRow.orgId, endDate, 0);
      continue;
    }

    // Fetch matching usage_log rows
    const existingLogs = await db
      .select({ id: usageLogs.id, requestId: usageLogs.requestId })
      .from(usageLogs)
      .where(inArray(usageLogs.requestId, requestIds));

    const logIdByRequestId = new Map(existingLogs.map((l) => [l.requestId, l.id]));

    let synced = 0;
    for (const record of records) {
      const logId = logIdByRequestId.get(record.request_id);
      if (!logId) continue;
      const cost = Number(record.aimediator_billed_amt_rub);
      if (!isFinite(cost)) continue;

      await db
        .update(usageLogs)
        .set({ costRub: String(cost) })
        .where(eq(usageLogs.id, logId));
      synced++;
    }

    await upsertSyncLog(keyRow.id, keyRow.orgId, endDate, synced);
    console.log(`[billingSync] Key ${keyRow.id.slice(0, 8)}: synced ${synced}/${records.length} records`);
  }
}

async function upsertSyncLog(
  keyId: string,
  orgId: string,
  syncedThrough: Date,
  recordsSynced: number,
): Promise<void> {
  await db
    .insert(billingSyncLog)
    .values({
      aiMediatorKeyId: keyId,
      orgId,
      syncedThrough,
      recordsSynced,
      lastSyncAt: new Date(),
    })
    .onConflictDoUpdate({
      target: billingSyncLog.aiMediatorKeyId,
      set: {
        syncedThrough,
        recordsSynced: sql`${billingSyncLog.recordsSynced} + ${recordsSynced}`,
        lastSyncAt: new Date(),
      },
    });
}
