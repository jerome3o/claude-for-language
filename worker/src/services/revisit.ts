/**
 * "Revisit later" for mini lessons and graded readers (shared/study/revisit.ts):
 * the account's gap settings (users.revisit_settings) and the retire / restore
 * events ("Done for good" / "Bring back", table revisit_events). The ratings
 * themselves stay where they were (custom_lesson_completions.rating,
 * reader_review_events.rating); every device derives the schedule from both.
 */
import {
  applyRevisitSettingsUpdate,
  computeRevisitState,
  parseRevisitSettings,
  revisitSettingsInfo,
  type RevisitEvent,
  type RevisitSettings,
  type RevisitSettingsInfo,
  type RevisitSettingsUpdate,
} from '@shared/study/revisit';

export type RevisitItemKind = 'lesson' | 'reader';
export type RevisitAction = 'retire' | 'restore';

export interface RevisitEventRow {
  id: string;
  item_kind: RevisitItemKind;
  item_id: string;
  action: RevisitAction;
  created_at: string;
}

export async function getRevisitSettings(db: D1Database, userId: string): Promise<RevisitSettings> {
  const row = await db.prepare('SELECT revisit_settings FROM users WHERE id = ?').bind(userId).first<{ revisit_settings: string | null }>();
  return parseRevisitSettings(row?.revisit_settings ?? null);
}

export async function getRevisitSettingsInfo(db: D1Database, userId: string): Promise<RevisitSettingsInfo> {
  return revisitSettingsInfo(await getRevisitSettings(db, userId));
}

/** Apply a validated update; stores NULL when the result is the defaults. */
export async function setRevisitSettings(db: D1Database, userId: string, update: RevisitSettingsUpdate): Promise<RevisitSettingsInfo> {
  const next = applyRevisitSettingsUpdate(await getRevisitSettings(db, userId), update);
  const info = revisitSettingsInfo(next);
  const { is_default: _isDefault, ...stored } = info;
  await db
    .prepare('UPDATE users SET revisit_settings = ? WHERE id = ?')
    .bind(info.is_default ? null : JSON.stringify(stored), userId)
    .run();
  return info;
}

export async function listRevisitEvents(db: D1Database, userId: string): Promise<RevisitEventRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, item_kind, item_id, action, created_at FROM revisit_events
       WHERE user_id = ? ORDER BY created_at, id`
    )
    .bind(userId)
    .all<RevisitEventRow>();
  return rows.results ?? [];
}

export interface RevisitEventInput {
  id?: unknown;
  item_kind?: unknown;
  item_id?: unknown;
  action?: unknown;
  created_at?: unknown;
}

export const MAX_REVISIT_EVENTS_PER_REQUEST = 200;

/**
 * Store retire / restore events (idempotent by id). Events for items that are
 * not the caller's are skipped (`orphans`), never an error, so a device that
 * deleted something offline can still upload the rest.
 */
export async function addRevisitEvents(
  db: D1Database,
  userId: string,
  input: RevisitEventInput[],
): Promise<{ accepted: string[]; orphans: string[]; invalid: number }> {
  const valid: RevisitEventRow[] = [];
  let invalid = 0;
  for (const e of input) {
    const kind = e.item_kind === 'lesson' || e.item_kind === 'reader' ? e.item_kind : null;
    const action = e.action === 'retire' || e.action === 'restore' ? e.action : null;
    const id = typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 100 ? e.id : null;
    const itemId = typeof e.item_id === 'string' && e.item_id ? e.item_id : null;
    const created = typeof e.created_at === 'string' && Number.isFinite(Date.parse(e.created_at)) ? new Date(e.created_at).toISOString() : null;
    if (!kind || !action || !id || !itemId || !created) { invalid++; continue; }
    valid.push({ id, item_kind: kind, item_id: itemId, action, created_at: created });
  }

  const owned = new Set<string>();
  for (const kind of ['lesson', 'reader'] as const) {
    const ids = [...new Set(valid.filter(v => v.item_kind === kind).map(v => v.item_id))];
    const table = kind === 'lesson' ? 'custom_lessons' : 'graded_readers';
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const rows = await db
        .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})`)
        .bind(userId, ...chunk)
        .all<{ id: string }>();
      for (const r of rows.results ?? []) owned.add(`${kind}:${r.id}`);
    }
  }

  const accepted: string[] = [];
  const orphans: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const v of valid) {
    if (!owned.has(`${v.item_kind}:${v.item_id}`)) { orphans.push(v.id); continue; }
    accepted.push(v.id);
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO revisit_events (id, user_id, item_kind, item_id, action, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(v.id, userId, v.item_kind, v.item_id, v.action, v.created_at)
    );
  }
  if (stmts.length) await db.batch(stmts);
  return { accepted, orphans, invalid };
}

/**
 * The schedule of some of a user's items, server-side (the tutor's views show
 * "next revisit <date>"). `ratings` = per item its finishes (rating + when).
 */
export async function revisitStatesFor(
  db: D1Database,
  userId: string,
  kind: RevisitItemKind,
  ratings: Map<string, Array<{ id: string; at: string; rating: number | null }>>,
): Promise<Map<string, ReturnType<typeof computeRevisitState>>> {
  const out = new Map<string, ReturnType<typeof computeRevisitState>>();
  if (ratings.size === 0) return out;
  const [settings, events] = await Promise.all([getRevisitSettings(db, userId), listRevisitEvents(db, userId)]);
  for (const [itemId, finishes] of ratings) {
    const history: RevisitEvent[] = finishes.map(f => ({ id: f.id, at: f.at, kind: 'rating' as const, rating: f.rating }));
    for (const e of events) {
      if (e.item_kind === kind && e.item_id === itemId) history.push({ id: e.id, at: e.created_at, kind: e.action });
    }
    out.set(itemId, computeRevisitState(history, settings));
  }
  return out;
}

export interface RevisitSummary {
  /** When it comes back (ISO); null when never finished or done for good. */
  next_revisit_at: string | null;
  /** "Done for good": never scheduled again. */
  retired: boolean;
}

/** next_revisit_at / retired for some of a user's lessons or readers (their own settings + history). */
export async function revisitSummaries(
  db: D1Database,
  userId: string,
  kind: RevisitItemKind,
  itemIds: string[],
): Promise<Map<string, RevisitSummary>> {
  const out = new Map<string, RevisitSummary>();
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return out;
  const finishes = new Map<string, Array<{ id: string; at: string; rating: number | null }>>();
  for (const id of ids) finishes.set(id, []);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const marks = chunk.map(() => '?').join(',');
    const sql = kind === 'lesson'
      ? `SELECT id, lesson_id AS item_id, completed_at AS at, rating FROM custom_lesson_completions WHERE lesson_id IN (${marks})`
      : `SELECT id, reader_id AS item_id, reviewed_at AS at, rating FROM reader_review_events WHERE reader_id IN (${marks})`;
    const rows = await db.prepare(sql).bind(...chunk).all<{ id: string; item_id: string; at: string; rating: number | null }>();
    for (const r of rows.results ?? []) finishes.get(r.item_id)?.push({ id: r.id, at: r.at, rating: r.rating });
  }
  const states = await revisitStatesFor(db, userId, kind, finishes);
  for (const [id, s] of states) {
    out.set(id, {
      next_revisit_at: s.status === 'scheduled' && s.due_ms !== null ? new Date(s.due_ms).toISOString() : null,
      retired: s.status === 'retired',
    });
  }
  return out;
}
