/**
 * "⚡ Study it today" — the bump pocket (migration 0106 `study_bumps`,
 * shared/decks/bumps.ts). One row per user + note; clients put the bumped
 * notes' cards first in today's queue, NEW ones over the daily budget, and a
 * bump is done once each bumped card has been reviewed since the bump.
 *
 * The server keeps the rows and writes `done_at` lazily (listActiveBumps) with
 * the same rule over its cached card state and review events, so finished bumps
 * stop travelling to devices. Every client derives the pocket itself, offline.
 */
import {
  bumpedCardsForNote,
  normalizeBumpSource,
  type BumpSource,
  type QueueCardInput,
} from '@shared/decks';
import { normalizeHanzi } from '@shared/import/parse';

export const MAX_BUMPS_PER_REQUEST = 50;

export interface StudyBump {
  id: string;
  note_id: string;
  created_at: string;
  source: BumpSource;
  bumped_by: string | null;
  /** Set when a tutor bumped it ("⚡ from Minghui"); null when the learner did. */
  bumped_by_name: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface BumpInputItem {
  /** Client id (offline outbox); a retry with the same id is a no-op. */
  id?: string;
  note_id: string;
  /** When it was bumped on the device (ISO); default now. */
  created_at?: string;
  source?: string;
}

export interface BumpResult {
  bumps: StudyBump[];
  /** Notes newly put in the pocket (or re-opened). */
  added: Array<{ note_id: string; hanzi: string }>;
  /** Already in the pocket — nothing changed. */
  already: Array<{ note_id: string; hanzi: string }>;
  /** note ids / hanzi that matched none of the user's notes. */
  not_found: string[];
}

interface BumpRow {
  id: string;
  user_id: string;
  note_id: string;
  source: string | null;
  bumped_by: string | null;
  created_at: string;
  done_at: string | null;
  cleared_at: string | null;
}

const isoNow = () => new Date().toISOString();

function validIso(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  // Never in the future (a device clock ahead would hide reviews made right after).
  return new Date(Math.min(ms, Date.now())).toISOString();
}

/** The user's notes with these exact ids. */
async function ownedNotes(db: D1Database, userId: string, noteIds: string[]): Promise<Array<{ id: string; hanzi: string }>> {
  if (noteIds.length === 0) return [];
  const ph = noteIds.map(() => '?').join(',');
  const res = await db
    .prepare(`SELECT n.id, n.hanzi FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ? AND n.id IN (${ph})`)
    .bind(userId, ...noteIds)
    .all<{ id: string; hanzi: string }>();
  return res.results ?? [];
}

/**
 * The user's notes whose hanzi is this word (punctuation / spaces ignored,
 * normalizeHanzi). Every match: the learner may have the word in two decks.
 */
export async function findNotesByHanzi(db: D1Database, userId: string, hanzi: string): Promise<Array<{ id: string; hanzi: string }>> {
  const key = normalizeHanzi(hanzi);
  if (!key) return [];
  const res = await db
    .prepare(
      `SELECT n.id, n.hanzi FROM notes n JOIN decks d ON d.id = n.deck_id
       WHERE d.user_id = ? AND instr(n.hanzi, ?) > 0
       ORDER BY n.updated_at DESC LIMIT 50`
    )
    .bind(userId, key)
    .all<{ id: string; hanzi: string }>();
  return (res.results ?? []).filter((n) => normalizeHanzi(n.hanzi ?? '') === key);
}

/**
 * Put notes in the pocket. `items` carry client ids (offline); `noteIds` / `hanzi`
 * are the agents' form (hanzi looked up in the user's notes). Idempotent: an active
 * bump stays as it is; a done / cleared one is re-opened with a fresh created_at.
 */
export async function addBumps(
  db: D1Database,
  userId: string,
  input: { items?: BumpInputItem[]; noteIds?: string[]; hanzi?: string[]; source?: string; bumpedBy?: string | null }
): Promise<BumpResult> {
  const fallbackSource = normalizeBumpSource(input.source);
  const wanted = new Map<string, BumpInputItem>();
  const notFound: string[] = [];
  const hanziOf = new Map<string, string>();

  const items = (input.items ?? []).filter((i) => i && typeof i.note_id === 'string' && i.note_id);
  const plainIds = (input.noteIds ?? []).filter((id) => typeof id === 'string' && id);
  const owned = await ownedNotes(db, userId, [...new Set([...items.map((i) => i.note_id), ...plainIds])]);
  const ownedIds = new Set(owned.map((n) => n.id));
  for (const n of owned) hanziOf.set(n.id, n.hanzi);
  for (const it of items) {
    if (!ownedIds.has(it.note_id)) notFound.push(it.note_id);
    else if (!wanted.has(it.note_id)) wanted.set(it.note_id, it);
  }
  for (const id of plainIds) {
    if (!ownedIds.has(id)) notFound.push(id);
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

  const existing = new Map<string, BumpRow>();
  const ids = [...wanted.keys()];
  if (ids.length) {
    const res = await db
      .prepare(`SELECT * FROM study_bumps WHERE user_id = ? AND note_id IN (${ids.map(() => '?').join(',')})`)
      .bind(userId, ...ids)
      .all<BumpRow>();
    for (const r of res.results ?? []) existing.set(r.note_id, r);
  }

  const added: BumpResult['added'] = [];
  const already: BumpResult['already'] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const [noteId, it] of wanted) {
    const row = existing.get(noteId);
    const createdAt = validIso(it.created_at) ?? isoNow();
    const source = it.source !== undefined ? normalizeBumpSource(it.source) : fallbackSource;
    const hanzi = hanziOf.get(noteId) ?? '';
    if (row && !row.done_at && !row.cleared_at) {
      already.push({ note_id: noteId, hanzi });
      continue;
    }
    if (row && it.id && row.id === it.id) {
      // A retry of the upload that created this row, after it finished — keep it finished.
      already.push({ note_id: noteId, hanzi });
      continue;
    }
    if (row) {
      stmts.push(
        db
          .prepare(
            `UPDATE study_bumps SET created_at = ?, source = ?, bumped_by = ?, done_at = NULL, cleared_at = NULL, updated_at = datetime('now') WHERE id = ?`
          )
          .bind(createdAt, source, input.bumpedBy ?? userId, row.id)
      );
    } else {
      stmts.push(
        db
          .prepare(
            `INSERT INTO study_bumps (id, user_id, note_id, source, bumped_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, note_id) DO NOTHING`
          )
          .bind(it.id || crypto.randomUUID(), userId, noteId, source, input.bumpedBy ?? userId, createdAt)
      );
    }
    added.push({ note_id: noteId, hanzi });
  }
  if (stmts.length) await db.batch(stmts);
  return { bumps: await listActiveBumps(db, userId), added, already, not_found: notFound };
}

/** Take notes out of the pocket by hand (idempotent). Returns how many were active. */
export async function clearBumps(db: D1Database, userId: string, noteIds: string[]): Promise<number> {
  if (noteIds.length === 0) return 0;
  const res = await db
    .prepare(
      `UPDATE study_bumps SET cleared_at = datetime('now'), updated_at = datetime('now')
       WHERE user_id = ? AND note_id IN (${noteIds.map(() => '?').join(',')}) AND cleared_at IS NULL AND done_at IS NULL`
    )
    .bind(userId, ...noteIds)
    .run();
  return Number(res.meta?.changes ?? 0);
}

interface CardRow {
  id: string;
  note_id: string;
  deck_id: string;
  card_type: string;
  queue: number | null;
  due_timestamp: number | null;
  next_review_at: string | null;
}

function cardInput(c: CardRow): QueueCardInput {
  const queue = c.queue ?? 0;
  let due: number | null = null;
  if (queue === 2) due = c.next_review_at ? Date.parse(c.next_review_at) : null;
  else if (queue === 1 || queue === 3) due = c.due_timestamp ?? (c.next_review_at ? Date.parse(c.next_review_at) : null);
  return { id: c.id, note_id: c.note_id, deck_id: c.deck_id, card_type: c.card_type, queue, due_ms: due !== null && Number.isFinite(due) ? due : null };
}

const sqlMs = (s: string) => Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');

/**
 * The active bumps (not cleared, not done) with each note's text and deck. A bump
 * the server can see is finished (the shared rule over its cached card state and
 * review events) gets done_at now and is left out. `nowMs` / horizon for tests.
 */
export async function listActiveBumps(db: D1Database, userId: string, nowMs = Date.now()): Promise<StudyBump[]> {
  const res = await db
    .prepare(
      `SELECT b.id, b.note_id, b.created_at, b.source, b.bumped_by, u.name AS bumper_name,
              n.hanzi, n.pinyin, n.english, n.deck_id, d.name AS deck_name
       FROM study_bumps b
       JOIN notes n ON n.id = b.note_id
       JOIN decks d ON d.id = n.deck_id AND d.user_id = b.user_id
       LEFT JOIN users u ON u.id = b.bumped_by
       WHERE b.user_id = ? AND b.done_at IS NULL AND b.cleared_at IS NULL
       ORDER BY b.created_at, b.note_id`
    )
    .bind(userId)
    .all<{
      id: string; note_id: string; created_at: string; source: string | null; bumped_by: string | null; bumper_name: string | null;
      hanzi: string; pinyin: string; english: string; deck_id: string; deck_name: string;
    }>();
  const rows = res.results ?? [];
  if (rows.length === 0) return [];

  const noteIds = rows.map((r) => r.note_id);
  const ph = noteIds.map(() => '?').join(',');
  const cards = (
    await db
      .prepare(`SELECT c.id, c.note_id, n.deck_id, c.card_type, c.queue, c.due_timestamp, c.next_review_at FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.note_id IN (${ph})`)
      .bind(...noteIds)
      .all<CardRow>()
  ).results ?? [];
  const reviews = cards.length
    ? (
        await db
          .prepare(
            `SELECT card_id, MIN(reviewed_at) AS first_at, MAX(reviewed_at) AS last_at FROM review_events
             WHERE user_id = ? AND card_id IN (${cards.map(() => '?').join(',')}) GROUP BY card_id`
          )
          .bind(userId, ...cards.map((c) => c.id))
          .all<{ card_id: string; first_at: string; last_at: string }>()
      ).results ?? []
    : [];
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  for (const r of reviews) {
    first.set(r.card_id, sqlMs(r.first_at));
    last.set(r.card_id, sqlMs(r.last_at));
  }
  const byNote = new Map<string, QueueCardInput[]>();
  for (const c of cards) {
    const list = byNote.get(c.note_id) ?? [];
    list.push(cardInput(c));
    byNote.set(c.note_id, list);
  }
  // The server doesn't know the learner's evening: a card due within 12 h counts as due.
  const cutoff = nowMs + 12 * 3_600_000;
  const done: string[] = [];
  const out: StudyBump[] = [];
  for (const r of rows) {
    const noteCards = byNote.get(r.note_id) ?? [];
    const picks = bumpedCardsForNote(noteCards, { note_id: r.note_id, created_ms: sqlMs(r.created_at) }, last, first, cutoff);
    if (noteCards.length > 0 && picks.length === 0) {
      done.push(r.id);
      continue;
    }
    out.push({
      id: r.id,
      note_id: r.note_id,
      created_at: r.created_at,
      source: normalizeBumpSource(r.source),
      bumped_by: r.bumped_by,
      bumped_by_name: r.bumped_by && r.bumped_by !== userId ? r.bumper_name : null,
      hanzi: r.hanzi,
      pinyin: r.pinyin,
      english: r.english,
      deck_id: r.deck_id,
      deck_name: r.deck_name,
    });
  }
  if (done.length) {
    await db
      .prepare(`UPDATE study_bumps SET done_at = datetime('now'), updated_at = datetime('now') WHERE id IN (${done.map(() => '?').join(',')})`)
      .bind(...done)
      .run();
  }
  return out;
}
