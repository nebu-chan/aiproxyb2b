import { db } from '../db/index.js';
import { auditLogs, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface AuditParams {
  orgId: string;
  actorId: string;
  actorEmail?: string; // looked up from DB if omitted
  action: string;
  targetType: string;
  targetId: string;
  targetLabel?: string;
  diff?: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  ip?: string;
}

/**
 * Write an audit log entry. Fire-and-forget — never throws or blocks the caller.
 * Actor email is resolved from DB if not provided.
 */
export function logAudit(params: AuditParams): void {
  const run = async () => {
    let { actorEmail } = params;
    if (!actorEmail) {
      const [actor] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, params.actorId))
        .limit(1);
      actorEmail = actor?.email ?? 'unknown';
    }
    await db.insert(auditLogs).values({
      orgId: params.orgId,
      actorId: params.actorId,
      actorEmail,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      targetLabel: params.targetLabel,
      diff: params.diff ?? undefined,
      ip: params.ip,
    });
  };
  run().catch((e) => console.error('[audit] Failed to write log:', e));
}

type ModelSetting = { allowed: boolean } | undefined;
type ModelSettingsMap = Record<string, { allowed: boolean }> | null | undefined;

function normalizeSetting(s: ModelSetting) {
  return { allowed: s?.allowed ?? false };
}

/** Returns true only if modelSettings objects differ after normalization. */
export function modelSettingsChanged(before: ModelSettingsMap, after: ModelSettingsMap): boolean {
  const allModels = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const m of allModels) {
    const nb = normalizeSetting((before ?? {})[m]);
    const na = normalizeSetting((after  ?? {})[m]);
    if (nb.allowed !== na.allowed) return true;
  }
  return false;
}

/** Pick only the keys that are present and not undefined from an object. */
export function pickFields(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((k) => k in obj && obj[k] !== undefined).map((k) => [k, obj[k]]),
  );
}
