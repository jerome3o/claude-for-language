/**
 * Crash / freeze reports sent the moment they happen (Lab: data/CrashLog.kt POSTs from the
 * uncaught-exception handler, from its main-thread freeze watchdog, and at start-up with the
 * system's exit records — ANR thread dumps included). Unlike debug reports these never wait
 * for a sync, so a crash at launch still reaches us. D1 `crash_reports` (migration 0088);
 * idempotent by (user_id, id); the newest KEEP_CRASHES per user are kept.
 */

export const KEEP_CRASHES = 200;
export const MAX_CRASHES_PER_UPLOAD = 20;
export const MAX_TRACE_CHARS = 20_000;

export interface CrashInput {
  id: string;
  source: string;
  at: string | null;
  reason: string | null;
  thread: string | null;
  description: string | null;
  trace: string | null;
  app_version: string | null;
}

export interface CrashRow extends CrashInput {
  client: string;
  device: string | null;
  created_at: string;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length ? v.slice(0, max) : typeof v === 'number' ? String(v) : null;

/** Validates and trims an upload body `{ client?, app_version?, device?, crashes: [...] }`. Pure. */
export function parseCrashUpload(body: unknown): { client: string; appVersion: string | null; device: string | null; crashes: CrashInput[] } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Expected a JSON object' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.crashes) || b.crashes.length === 0) return { error: '`crashes` must be a non-empty array' };
  const client = b.client === 'web' ? 'web' : 'lab';
  const appVersion = str(b.app_version, 40);
  const crashes: CrashInput[] = [];
  for (const raw of b.crashes.slice(0, MAX_CRASHES_PER_UPLOAD)) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const trace = str(c.trace, MAX_TRACE_CHARS);
    const description = str(c.description, 2000);
    const at = str(c.at, 40);
    const source = str(c.source, 40) ?? 'unknown';
    const id = str(c.id, 120) ?? `${source}-${at ?? ''}-${(trace ?? description ?? '').length}`;
    crashes.push({ id, source, at, reason: str(c.reason, 40), thread: str(c.thread, 200), description, trace, app_version: str(c.app_version, 40) ?? appVersion });
  }
  if (!crashes.length) return { error: 'No valid crash entries' };
  return { client, appVersion, device: str(b.device, 200), crashes };
}

export async function storeCrashes(db: D1Database, userId: string, body: unknown): Promise<{ stored: number } | { error: string }> {
  const parsed = parseCrashUpload(body);
  if ('error' in parsed) return parsed;
  const stmts = parsed.crashes.map((c) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO crash_reports (id, user_id, client, app_version, device, source, reason, thread, description, trace, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(c.id, userId, parsed.client, c.app_version, parsed.device, c.source, c.reason, c.thread, c.description, c.trace, c.at)
  );
  const results = await db.batch(stmts);
  const stored = results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  await db
    .prepare(
      `DELETE FROM crash_reports WHERE user_id = ? AND rowid NOT IN
         (SELECT rowid FROM crash_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`
    )
    .bind(userId, userId, KEEP_CRASHES)
    .run();
  return { stored };
}

export async function listCrashes(db: D1Database, userId: string, opts: { client?: string | null; limit?: number; traceChars?: number }): Promise<CrashRow[]> {
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 20));
  const traceChars = Math.max(0, Math.min(MAX_TRACE_CHARS, opts.traceChars ?? 6000));
  const where = opts.client ? 'WHERE user_id = ? AND client = ?' : 'WHERE user_id = ?';
  const binds: unknown[] = opts.client ? [userId, opts.client] : [userId];
  const { results } = await db
    .prepare(
      `SELECT id, client, app_version, device, source, reason, thread, description, trace, occurred_at AS at, created_at
       FROM crash_reports ${where} ORDER BY created_at DESC, occurred_at DESC LIMIT ?`
    )
    .bind(...binds, limit)
    .all<CrashRow>();
  return (results ?? []).map((r) => ({ ...r, trace: r.trace ? r.trace.slice(0, traceChars) : r.trace }));
}
