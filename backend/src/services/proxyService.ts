import { db } from '../db/index.js';
import { providers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '../utils/encrypt.js';

export interface ProxyTarget {
  id: string;
  baseUrl: string;
  authHeaderName: string;
  authHeaderPrefix: string | null;
  apiKey: string | null;
}

/**
 * Resolve an upstream provider by name (case-insensitive slug).
 */
export async function resolveProvider(providerName: string): Promise<ProxyTarget | null> {
  const rows = await db
    .select()
    .from(providers)
    .where(and(eq(providers.name, providerName.toLowerCase()), eq(providers.isActive, true)))
    .limit(1);

  if (!rows.length) return null;

  const p = rows[0];
  let apiKey: string | null = null;
  if (p.apiKey) {
    try { apiKey = decrypt(p.apiKey); } catch { apiKey = null; }
  }
  return {
    id: p.id,
    baseUrl: p.baseUrl.replace(/\/$/, ''), // strip trailing slash
    authHeaderName: p.authHeaderName,
    authHeaderPrefix: p.authHeaderPrefix,
    apiKey,
  };
}

/**
 * Forward a request to the upstream provider and return the raw Response.
 *
 * @param target      - Resolved provider target
 * @param upstreamPath - Path to append to the provider's base URL
 * @param method      - HTTP method
 * @param headers     - Incoming request headers (sanitized)
 * @param body        - Request body as string (or undefined for GET)
 */
export async function forwardRequest(
  target: ProxyTarget,
  upstreamPath: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<Response> {
  const url = `${target.baseUrl}/${upstreamPath.replace(/^\//, '')}`;

  const forwardHeaders: Record<string, string> = {
    'content-type': headers['content-type'] ?? 'application/json',
    accept: headers['accept'] ?? 'application/json',
  };

  // Set upstream auth
  if (target.apiKey) {
    const prefix = target.authHeaderPrefix ? `${target.authHeaderPrefix} ` : '';
    forwardHeaders[target.authHeaderName.toLowerCase()] = `${prefix}${target.apiKey}`;
  }

  // Forward some safe passthrough headers
  for (const h of ['x-request-id', 'accept-encoding', 'accept-language']) {
    if (headers[h]) forwardHeaders[h] = headers[h];
  }

  return fetch(url, {
    method,
    headers: forwardHeaders,
    body: body ?? null,
    duplex: 'half',
  });
}
