import { db } from '../db/index.js';
import { usageLogs } from '../db/schema.js';

export interface UsageRecord {
  orgId: string;
  userId?: string | null;
  apiKeyId: string | null;
  providerId: string | null;
  model: string | null;
  endpoint: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestDurationMs: number;
  statusCode: number;
  errorMessage?: string | null;
  requestId?: string | null;
  departmentId?: string | null;
  costRub?: string | null;
}

/**
 * Persist a usage log entry. Fire-and-forget safe — errors are caught and logged.
 */
export async function trackUsage(record: UsageRecord): Promise<void> {
  try {
    await db.insert(usageLogs).values(record);
  } catch (err) {
    console.error('[usageTracker] Failed to insert usage log:', err);
  }
}

/**
 * AI Mediator returns the exact billed cost (in RUB) on every response via this
 * header, so cost can be recorded synchronously instead of relying solely on
 * the async billingSync reconciliation job.
 */
export function extractCostRub(headers: Record<string, string> | Headers): string | null {
  const raw = headers instanceof Headers
    ? headers.get('x-aimediator-response-cost')
    : headers['x-aimediator-response-cost'];
  if (!raw) return null;
  return Number.isFinite(Number(raw)) ? raw : null;
}

/**
 * Extract token counts from a typical OpenAI-compatible API response body.
 * Returns zeros if the body doesn't contain usage data.
 */
export function extractTokensFromResponse(body: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string | null;
} {
  if (typeof body !== 'object' || body === null) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, model: null };
  }

  const b = body as Record<string, unknown>;
  const usage = b['usage'] as Record<string, unknown> | undefined;

  return {
    promptTokens: (usage?.['prompt_tokens'] as number) ?? 0,
    completionTokens: (usage?.['completion_tokens'] as number) ?? 0,
    totalTokens: (usage?.['total_tokens'] as number) ?? 0,
    model: (b['model'] as string) ?? null,
  };
}
