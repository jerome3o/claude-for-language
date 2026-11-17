/**
 * The legacy "Done for good" / "Bring back" marks on mini lessons (table revisit_events), still
 * read by the revision rule (shared/study/lessonRevision.ts: a retire = done forever; services/
 * lesson-revision.ts). The "revisit later" schedule and its settings (users.revisit_settings) are
 * gone (Oct 2026); older apps still read the settings, so they get the fixed defaults below.
 */

/**
 * What an older app reads as `revisit_settings` (on /api/auth/me, /api/sync/changes,
 * GET /api/me/revisit and the PUT /api/profile/revisit-settings answer): the old defaults, always.
 * Nothing schedules with them any more; the column users.revisit_settings is no longer read.
 */
export const LEGACY_REVISIT_SETTINGS = Object.freeze({
  hard_days: 2,
  good_days: 14,
  easy_days: 42,
  growth: 2,
  cap_days: 180,
  new_lessons_per_day: 1,
  is_default: true,
});

export type RevisitItemKind = 'lesson' | 'reader';
export type RevisitAction = 'retire' | 'restore';

export interface RevisitEventRow {
  id: string;
  item_kind: RevisitItemKind;
  item_id: string;
  action: RevisitAction;
  created_at: string;
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
