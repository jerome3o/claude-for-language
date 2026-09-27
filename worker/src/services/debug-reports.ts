/**
 * Study-state debug reports: storage (R2 + a D1 index row), listing, section
 * views and the server-side comparison. The report shape and the pure diff
 * live in shared/debug (the web app and the Lab app build the same shape).
 *
 *   JSON  → R2 `debug/<userId>/<id>.json`   (a report can be a few MB)
 *   index → D1 `debug_reports`               (id, client, version, summary)
 *
 * Only the newest KEEP_PER_CLIENT reports per user + client are kept.
 */

import type { Env } from '../types';
import {
  compareDebugReports,
  serverTruthFromRows,
  summarizeDebugReport,
  validateDebugReport,
  DEBUG_CARD_COLUMNS,
  type DebugClient,
  type DebugComparison,
  type DebugReport,
  type DebugReportSummary,
} from '@shared/debug';

export const KEEP_PER_CLIENT = 20;
/** Largest report accepted (decompressed). 9k cards + 40k event hashes is ~2 MB. */
export const MAX_REPORT_BYTES = 16 * 1024 * 1024;

export class DebugReportError extends Error {
  constructor(public status: 400 | 404 | 413, message: string, public problems?: string[]) {
    super(message);
  }
}

export interface DebugReportRow {
  id: string;
  client: DebugClient;
  app_version: string | null;
  install_kind: string | null;
  size_bytes: number;
  created_at: string;
  summary: DebugReportSummary | null;
}

interface RawRow extends Omit<DebugReportRow, 'summary'> {
  summary: string | null;
  r2_key: string;
}

function parseRow(r: RawRow): DebugReportRow {
  let summary: DebugReportSummary | null = null;
  try {
    summary = r.summary ? (JSON.parse(r.summary) as DebugReportSummary) : null;
  } catch {
    summary = null;
  }
  return {
    id: r.id,
    client: r.client,
    app_version: r.app_version,
    install_kind: r.install_kind,
    size_bytes: r.size_bytes,
    created_at: r.created_at,
    summary,
  };
}

export const r2KeyFor = (userId: string, id: string) => `debug/${userId}/${id}.json`;

export interface UploadBody {
  client?: unknown;
  app_version?: unknown;
  install_kind?: unknown;
  report?: unknown;
}

/** Validate, store in R2, index in D1, prune old ones. Returns the index row. */
export async function storeDebugReport(env: Env, userId: string, body: UploadBody, sizeBytes: number): Promise<DebugReportRow> {
  if (sizeBytes > MAX_REPORT_BYTES) throw new DebugReportError(413, `Report too large (${sizeBytes} bytes)`);
  const client = body.client;
  if (client !== 'lab' && client !== 'web') throw new DebugReportError(400, 'client must be "lab" or "web"');
  const problems = validateDebugReport(body.report);
  if (problems.length) throw new DebugReportError(400, 'Invalid report', problems);
  const report = body.report as DebugReport;
  if (report.client !== client) throw new DebugReportError(400, 'report.client does not match client');
  const appVersion = typeof body.app_version === 'string' ? body.app_version.slice(0, 100) : report.app_version ?? null;
  const installKind = typeof body.install_kind === 'string' ? body.install_kind.slice(0, 40) : null;

  const id = crypto.randomUUID();
  const key = r2KeyFor(userId, id);
  const text = JSON.stringify(report);
  await env.AUDIO_BUCKET.put(key, text, { httpMetadata: { contentType: 'application/json' } });
  const summary = summarizeDebugReport(report);
  await env.DB.prepare(
    `INSERT INTO debug_reports (id, user_id, client, app_version, install_kind, r2_key, size_bytes, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, client, appVersion, installKind, key, text.length, JSON.stringify(summary))
    .run();
  await pruneDebugReports(env, userId, client);
  const row = await env.DB.prepare(
    'SELECT id, client, app_version, install_kind, size_bytes, created_at, summary, r2_key FROM debug_reports WHERE id = ?'
  )
    .bind(id)
    .first<RawRow>();
  return row ? parseRow(row) : { id, client, app_version: appVersion, install_kind: installKind, size_bytes: text.length, created_at: new Date().toISOString(), summary };
}

export async function pruneDebugReports(env: Env, userId: string, client: DebugClient, keep = KEEP_PER_CLIENT): Promise<number> {
  const old = await env.DB.prepare(
    `SELECT id, r2_key FROM debug_reports WHERE user_id = ? AND client = ?
     ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?`
  )
    .bind(userId, client, keep)
    .all<{ id: string; r2_key: string }>();
  const rows = old.results ?? [];
  if (!rows.length) return 0;
  await env.AUDIO_BUCKET.delete(rows.map(r => r.r2_key));
  for (const r of rows) await env.DB.prepare('DELETE FROM debug_reports WHERE id = ?').bind(r.id).run();
  return rows.length;
}

export async function listDebugReports(db: D1Database, userId: string, client?: string | null, limit = 20): Promise<DebugReportRow[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit) || 20));
  const stmt = client === 'lab' || client === 'web'
    ? db.prepare(
        `SELECT id, client, app_version, install_kind, size_bytes, created_at, summary, r2_key FROM debug_reports
         WHERE user_id = ? AND client = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`
      ).bind(userId, client, n)
    : db.prepare(
        `SELECT id, client, app_version, install_kind, size_bytes, created_at, summary, r2_key FROM debug_reports
         WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`
      ).bind(userId, n);
  const res = await stmt.all<RawRow>();
  return (res.results ?? []).map(parseRow);
}

export async function loadDebugReport(env: Env, userId: string, id: string): Promise<{ row: DebugReportRow; report: DebugReport }> {
  const row = await env.DB.prepare(
    'SELECT id, client, app_version, install_kind, size_bytes, created_at, summary, r2_key FROM debug_reports WHERE id = ? AND user_id = ?'
  )
    .bind(id, userId)
    .first<RawRow>();
  if (!row) throw new DebugReportError(404, 'Debug report not found');
  const obj = await env.AUDIO_BUCKET.get(row.r2_key);
  if (!obj) throw new DebugReportError(404, 'Debug report file is gone');
  return { row: parseRow(row), report: (await obj.json()) as DebugReport };
}

async function latestId(db: D1Database, userId: string, client: DebugClient): Promise<string | null> {
  const r = await db.prepare(
    'SELECT id FROM debug_reports WHERE user_id = ? AND client = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
  )
    .bind(userId, client)
    .first<{ id: string }>();
  return r?.id ?? null;
}

export type ReportSection = 'overview' | 'decks' | 'cards' | 'events' | 'full';

export interface SectionQuery {
  section?: string | null;
  offset?: number;
  limit?: number;
  deck_id?: string | null;
  /** Only cards in (1) / out of (0) the due queue. */
  in_due_queue?: string | null;
  queue?: string | null;
  card_id?: string | null;
}

/**
 * A slice of a report small enough for a chat: `overview` (default) is
 * everything but the per-card rows and event hashes; `cards` / `events` page
 * (offset / limit, cards filterable by deck, queue, in_due_queue or card id).
 */
export function sliceDebugReport(report: DebugReport, q: SectionQuery): Record<string, unknown> {
  const section = (q.section || 'overview') as ReportSection;
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const limit = Math.max(1, Math.min(2000, Math.floor(q.limit ?? 100)));
  if (section === 'full') return report as unknown as Record<string, unknown>;
  if (section === 'decks') return { section, decks: report.decks };
  if (section === 'cards') {
    let rows = report.cards;
    if (q.card_id) rows = rows.filter(c => c[0] === q.card_id || c[1] === q.card_id);
    if (q.deck_id) rows = rows.filter(c => c[2] === q.deck_id);
    if (q.queue != null && q.queue !== '') rows = rows.filter(c => String(c[4]) === q.queue);
    if (q.in_due_queue === '1' || q.in_due_queue === '0') rows = rows.filter(c => String(c[9]) === q.in_due_queue);
    return {
      section,
      columns: report.card_columns ?? DEBUG_CARD_COLUMNS,
      total: rows.length,
      offset,
      cards: rows.slice(offset, offset + limit),
    };
  }
  if (section === 'events') {
    return { section, total: report.event_hashes.length, offset, event_hashes: report.event_hashes.slice(offset, offset + limit) };
  }
  // overview
  const { cards, event_hashes, decks, ...rest } = report;
  return {
    section: 'overview',
    ...rest,
    decks: decks.map(d => ({ id: d.id, name: d.name, priority: d.priority, counts: d.counts, introduced_today: d.introduced_today, allocation: d.allocation })),
    card_rows: cards.length,
    event_hash_count: event_hashes.length,
  };
}

/** The server's own events + card ids for the "truth" columns of a comparison. */
export async function loadServerTruth(db: D1Database, userId: string) {
  const [events, cards] = await Promise.all([
    db.prepare('SELECT id, card_id, reviewed_at FROM review_events WHERE user_id = ?')
      .bind(userId)
      .all<{ id: string; card_id: string; reviewed_at: string }>(),
    db.prepare(
      `SELECT c.id FROM cards c JOIN notes n ON n.id = c.note_id JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ?`
    )
      .bind(userId)
      .all<{ id: string }>(),
  ]);
  return serverTruthFromRows(events.results ?? [], (cards.results ?? []).map(c => c.id));
}

/**
 * Compare two stored reports. Defaults: `a` = the newest Lab report, `b` = the
 * newest web report. The server's events are included as the truth column.
 */
export async function compareStoredReports(
  env: Env,
  userId: string,
  opts: { a?: string | null; b?: string | null; maxCards?: number; withServer?: boolean }
): Promise<DebugComparison> {
  const aId = opts.a || (await latestId(env.DB, userId, 'lab'));
  const bId = opts.b || (await latestId(env.DB, userId, 'web'));
  if (!aId || !bId) {
    throw new DebugReportError(404, `Need two reports to compare (latest lab: ${aId ?? 'none'}, latest web: ${bId ?? 'none'})`);
  }
  const [A, B] = await Promise.all([loadDebugReport(env, userId, aId), loadDebugReport(env, userId, bId)]);
  const server = opts.withServer === false ? undefined : await loadServerTruth(env.DB, userId);
  return compareDebugReports(A.report, B.report, { server, maxCards: opts.maxCards, ids: { a: aId, b: bId } });
}

/** Read an upload body: JSON, or gzip-compressed JSON (Content-Type application/gzip). */
export async function readUploadBody(req: Request): Promise<{ body: UploadBody; size: number }> {
  const type = req.headers.get('Content-Type') || '';
  let text: string;
  if (type.includes('gzip')) {
    if (!req.body) throw new DebugReportError(400, 'Empty body');
    const stream = req.body.pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = await req.text();
  }
  if (text.length > MAX_REPORT_BYTES) throw new DebugReportError(413, `Report too large (${text.length} bytes)`);
  try {
    return { body: JSON.parse(text) as UploadBody, size: text.length };
  } catch {
    throw new DebugReportError(400, 'Body is not valid JSON');
  }
}
