/**
 * "Up next" — the account's ordered list of chosen notes (migration 0121 `up_next`,
 * shared/decks/up-next.ts; docs/STUDY_SESSION.md "Up next"). Inside the daily new-card
 * budget the list's notes are introduced first, in order; every client derives that
 * itself from the list (offline). The server keeps the rows, the order and who added
 * what, and writes `done_at` lazily (listUpNext) once every card of a note has a review,
 * so finished entries stop travelling to devices. Removing never touches the note.
 */
import {
  MAX_UP_NEXT_PER_REQUEST,
  UP_NEXT_MAX,
  insertIntoOrder,
  normalizeUpNextSource,
  reorderUpNext,
  upNextIndex,
  upNextStatus,
  type UpNextSource,
} from '@shared/decks';
import { findNotesByHanzi } from './study-bumps';

export { MAX_UP_NEXT_PER_REQUEST };

export interface UpNextEntry {
  /** The row id (the client id of the add that made it). */
  id: string;
  note_id: string;
  /** 0-based place in the list. */
  position: number;
  created_at: string;
  source: UpNextSource;
  added_by: string | null;
  /** Set when someone other than the learner (their tutor) added it; null when the learner did. */
  added_by_name: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  /** 'new' = no card reviewed yet (one blue card when its turn comes); 'started' = purple cards left. */
  status: 'new' | 'started';
  /** Cards of the note never reviewed, and all its cards. */
  new_cards: number;
  total_cards: number;
}

export interface UpNextInputItem {
  /** Client id (offline outbox); a retry with the same id is a no-op. */
  id?: string;
  note_id: string;
  created_at?: string;
}

export interface UpNextAddResult {
  up_next: UpNextEntry[];
  /** Notes put on the list (or re-opened). */
  added: Array<{ note_id: string; hanzi: string }>;
  /** Already on the list (moved when a position was given — see `moved`). */
  already: Array<{ note_id: string; hanzi: string }>;
  moved: Array<{ note_id: string; hanzi: string }>;
  /** Every card already studied — nothing to introduce (⚡ Study it today instead). */
  no_new_cards: Array<{ note_id: string; hanzi: string }>;
  /** note ids / hanzi that matched none of the user's notes. */
  not_found: string[];
  /** Left out because the list is full (UP_NEXT_MAX). */
  over_limit: string[];
}

interface Row {
  id: string;
  note_id: string;
  position: number;
  created_at: string;
  done_at: string | null;
  removed_at: string | null;
}

/** D1 binds at most 100 parameters per statement. */
const CHUNK = 90;
function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function validIso(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.min(ms, Date.now())).toISOString();
}

/** The user's notes with these ids (+ their hanzi). */
async function ownedNotes(db: D1Database, userId: string, noteIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks([...new Set(noteIds)])) {
    const res = await db
      .prepare(`SELECT n.id, n.hanzi FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ? AND n.id IN (${part.map(() => '?').join(',')})`)
      .bind(userId, ...part)
      .all<{ id: string; hanzi: string }>();
    for (const r of res.results ?? []) out.set(r.id, r.hanzi ?? '');
  }
  return out;
}

/** note id → { total cards, cards with no review } (notes without cards are absent). */
export async function cardCounts(db: D1Database, userId: string, noteIds: string[]): Promise<Map<string, { total: number; fresh: number }>> {
  const out = new Map<string, { total: number; fresh: number }>();
  for (const part of chunks([...new Set(noteIds)])) {
    const res = await db
      .prepare(
        `SELECT c.note_id,
                COUNT(*) AS total,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM review_events r WHERE r.card_id = c.id AND r.user_id = ?) THEN 0 ELSE 1 END) AS fresh
         FROM cards c WHERE c.note_id IN (${part.map(() => '?').join(',')}) GROUP BY c.note_id`
      )
      .bind(userId, ...part)
      .all<{ note_id: string; total: number; fresh: number }>();
    for (const r of res.results ?? []) out.set(r.note_id, { total: Number(r.total) || 0, fresh: Number(r.fresh) || 0 });
  }
  return out;
}

const statusOf = (counts: { total: number; fresh: number } | undefined) =>
  upNextStatus(counts ? Array.from({ length: counts.total }, (_, i) => ({ queue: i < counts.fresh ? 0 : 1 })) : []);

/** Every active row (not removed, not done), list order. */
async function activeRows(db: D1Database, userId: string): Promise<Row[]> {
  const res = await db
    .prepare(
      `SELECT id, note_id, position, created_at, done_at, removed_at FROM up_next
       WHERE user_id = ? AND removed_at IS NULL AND done_at IS NULL ORDER BY position, created_at, note_id`
    )
    .bind(userId)
    .all<Row>();
  return res.results ?? [];
}

/** Write positions 0..n-1 for `order` (only rows whose position changed). */
function positionStatements(db: D1Database, userId: string, order: string[], current: Map<string, number>): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  order.forEach((noteId, i) => {
    if (current.get(noteId) === i) return;
    stmts.push(
      db.prepare(`UPDATE up_next SET position = ?, updated_at = datetime('now') WHERE user_id = ? AND note_id = ?`).bind(i, userId, noteId)
    );
  });
  return stmts;
}

/**
 * The active list, in order, with each note's text, deck and card state. Entries whose
 * note is gone are left out; entries whose every card has a review get done_at now.
 */
export async function listUpNext(db: D1Database, userId: string): Promise<UpNextEntry[]> {
  const res = await db
    .prepare(
      `SELECT u.id, u.note_id, u.position, u.created_at, u.source, u.added_by, a.name AS adder_name,
              n.hanzi, n.pinyin, n.english, n.deck_id, d.name AS deck_name
       FROM up_next u
       JOIN notes n ON n.id = u.note_id
       JOIN decks d ON d.id = n.deck_id AND d.user_id = u.user_id
       LEFT JOIN users a ON a.id = u.added_by
       WHERE u.user_id = ? AND u.removed_at IS NULL AND u.done_at IS NULL
       ORDER BY u.position, u.created_at, u.note_id`
    )
    .bind(userId)
    .all<{
      id: string; note_id: string; position: number; created_at: string; source: string | null; added_by: string | null; adder_name: string | null;
      hanzi: string; pinyin: string; english: string; deck_id: string; deck_name: string;
    }>();
  const rows = res.results ?? [];
  if (rows.length === 0) return [];
  const counts = await cardCounts(db, userId, rows.map((r) => r.note_id));
  const done: string[] = [];
  const out: UpNextEntry[] = [];
  for (const r of rows) {
    const c = counts.get(r.note_id);
    const status = statusOf(c);
    if (status === 'done') {
      done.push(r.id);
      continue;
    }
    out.push({
      id: r.id,
      note_id: r.note_id,
      position: out.length,
      created_at: r.created_at,
      source: normalizeUpNextSource(r.source),
      added_by: r.added_by,
      added_by_name: r.added_by && r.added_by !== userId ? r.adder_name : null,
      hanzi: r.hanzi,
      pinyin: r.pinyin,
      english: r.english,
      deck_id: r.deck_id,
      deck_name: r.deck_name,
      status: status === 'started' ? 'started' : 'new',
      new_cards: c?.fresh ?? 0,
      total_cards: c?.total ?? 0,
    });
  }
  if (done.length) {
    await db.batch(
      chunks(done).map((part) =>
        db
          .prepare(`UPDATE up_next SET done_at = datetime('now'), updated_at = datetime('now') WHERE id IN (${part.map(() => '?').join(',')})`)
          .bind(...part)
      )
    );
  }
  return out;
}

/**
 * Put notes on the list. `items` carry client ids (offline); `noteIds` / `hanzi` are the
 * agents' form (hanzi looked up in the user's notes). `position` = 'top' | 'bottom' | a
 * 0-based index (default bottom): where the first of them lands. A note already on the
 * list stays as it is — or MOVES there when a position was given. Notes with no card left
 * to introduce are refused (`no_new_cards`). Idempotent by note.
 */
export async function addUpNext(
  db: D1Database,
  userId: string,
  input: {
    items?: UpNextInputItem[];
    noteIds?: string[];
    hanzi?: string[];
    position?: unknown;
    source?: string;
    addedBy?: string | null;
  }
): Promise<UpNextAddResult> {
  const source = normalizeUpNextSource(input.source);
  const wanted = new Map<string, UpNextInputItem>();
  const notFound: string[] = [];
  const items = (input.items ?? []).filter((i) => i && typeof i.note_id === 'string' && i.note_id);
  const plainIds = (input.noteIds ?? []).filter((id) => typeof id === 'string' && id);
  const hanziOf = await ownedNotes(db, userId, [...items.map((i) => i.note_id), ...plainIds]);
  for (const it of items) {
    if (!hanziOf.has(it.note_id)) notFound.push(it.note_id);
    else if (!wanted.has(it.note_id)) wanted.set(it.note_id, it);
  }
  for (const id of plainIds) {
    if (!hanziOf.has(id)) notFound.push(id);
    else if (!wanted.has(id)) wanted.set(id, { note_id: id });
  }
  for (const h of input.hanzi ?? []) {
    if (typeof h !== 'string' || !h.trim()) continue;
    const matches = await findNotesByHanzi(db, userId, h);
    if (matches.length === 0) notFound.push(h.trim());
    for (const m of matches) {
      hanziOf.set(m.id, m.hanzi);
      if (!wanted.has(m.id)) wanted.set(m.id, { note_id: m.id });
    }
  }

  const counts = await cardCounts(db, userId, [...wanted.keys()]);
  const all = new Map<string, Row>();
  for (const part of chunks([...wanted.keys()])) {
    const res = await db
      .prepare(`SELECT id, note_id, position, created_at, done_at, removed_at FROM up_next WHERE user_id = ? AND note_id IN (${part.map(() => '?').join(',')})`)
      .bind(userId, ...part)
      .all<Row>();
    for (const r of res.results ?? []) all.set(r.note_id, r);
  }
  const active = await activeRows(db, userId);
  const currentOrder = active.map((r) => r.note_id);
  const currentPos = new Map(active.map((r, i) => [r.note_id, r.position === i ? i : -1]));
  const activeSet = new Set(currentOrder);
  const explicit = input.position !== undefined && input.position !== null && input.position !== 'bottom';

  const name = (id: string) => ({ note_id: id, hanzi: hanziOf.get(id) ?? '' });
  const added: UpNextAddResult['added'] = [];
  const already: UpNextAddResult['already'] = [];
  const moved: UpNextAddResult['moved'] = [];
  const noNew: UpNextAddResult['no_new_cards'] = [];
  const overLimit: string[] = [];
  const place: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  let size = activeSet.size;
  for (const [noteId, it] of wanted) {
    const row = all.get(noteId);
    if (activeSet.has(noteId)) {
      if (explicit) {
        moved.push(name(noteId));
        place.push(noteId);
      } else already.push(name(noteId));
      continue;
    }
    if (row && it.id && row.id === it.id) {
      // A retry of the upload that made this row, after it finished / was removed — leave it.
      already.push(name(noteId));
      continue;
    }
    const status = statusOf(counts.get(noteId));
    if (status === 'done' || status === 'missing') {
      noNew.push(name(noteId));
      continue;
    }
    if (size >= UP_NEXT_MAX) {
      overLimit.push(noteId);
      continue;
    }
    size++;
    const createdAt = validIso(it.created_at) ?? new Date().toISOString();
    if (row) {
      stmts.push(
        db
          .prepare(
            `UPDATE up_next SET created_at = ?, source = ?, added_by = ?, done_at = NULL, removed_at = NULL, position = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .bind(createdAt, source, input.addedBy ?? userId, 1_000_000 + size, row.id)
      );
    } else {
      stmts.push(
        db
          .prepare(
            `INSERT INTO up_next (id, user_id, note_id, position, source, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, note_id) DO NOTHING`
          )
          .bind(it.id || crypto.randomUUID(), userId, noteId, 1_000_000 + size, source, input.addedBy ?? userId, createdAt)
      );
    }
    added.push(name(noteId));
    place.push(noteId);
  }
  if (place.length) {
    const order = insertIntoOrder(currentOrder, place, explicit ? upNextIndex(input.position, currentOrder.length) : null);
    if (stmts.length) await db.batch(stmts);
    const positions = positionStatements(db, userId, order, currentPos);
    if (positions.length) await db.batch(positions);
  }
  return { up_next: await listUpNext(db, userId), added, already, moved, no_new_cards: noNew, not_found: notFound, over_limit: overLimit };
}

/**
 * A new order: `noteIds` (on the list) first in that order, every other entry after in
 * its old relative order (shared `reorderUpNext`). Returns the list.
 */
export async function reorderUpNextRows(db: D1Database, userId: string, noteIds: string[]): Promise<UpNextEntry[]> {
  const active = await activeRows(db, userId);
  const order = reorderUpNext(active.map((r) => r.note_id), noteIds);
  const currentPos = new Map(active.map((r, i) => [r.note_id, r.position === i ? i : -1]));
  const stmts = positionStatements(db, userId, order, currentPos);
  if (stmts.length) await db.batch(stmts);
  return listUpNext(db, userId);
}

/** Take notes off the list by hand (idempotent; the notes are never touched). Returns how many were on it. */
export async function removeUpNext(db: D1Database, userId: string, noteIds: string[]): Promise<number> {
  let n = 0;
  for (const part of chunks([...new Set(noteIds)])) {
    if (part.length === 0) continue;
    const res = await db
      .prepare(
        `UPDATE up_next SET removed_at = datetime('now'), updated_at = datetime('now')
         WHERE user_id = ? AND note_id IN (${part.map(() => '?').join(',')}) AND removed_at IS NULL AND done_at IS NULL`
      )
      .bind(userId, ...part)
      .run();
    n += Number(res.meta?.changes ?? 0);
  }
  return n;
}
