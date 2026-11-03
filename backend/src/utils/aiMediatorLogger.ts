import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR  = join(__dirname, '..', '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'ai-mediator.json');

export interface AiMediatorLogEntry {
  timestamp: string;
  orgId: string;
  userId?: string | null;
  departmentId?: string | null;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
  };
  durationMs: number;
}

let dirReady = false;

async function ensureDir() {
  if (dirReady) return;
  await mkdir(LOG_DIR, { recursive: true });
  dirReady = true;
}

export async function logAiMediatorCall(entry: AiMediatorLogEntry): Promise<void> {
  try {
    await ensureDir();

    let entries: AiMediatorLogEntry[] = [];
    if (existsSync(LOG_FILE)) {
      try {
        const raw = await readFile(LOG_FILE, 'utf8');
        entries = JSON.parse(raw);
      } catch {
        // File corrupted or empty — start fresh
        entries = [];
      }
    }

    entries.push(entry);
    await writeFile(LOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
  } catch (err) {
    console.error('[aiMediatorLogger] Failed to write log:', err);
  }
}
