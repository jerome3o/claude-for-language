/**
 * Practice per example sentence (migration 0138 `sentence_practice_events`, shared/study/sentenceHistory.ts;
 * docs/STUDY_SESSION.md "Sentence practice history"): 🎤 attempts on a sentence + hide / unhide, as events.
 * Idempotent by client id; only notes in the user's own decks; events after the cursor come back to every
 * device, which folds them with `sentenceStats`. Pure-ish D1; no model calls.
 */
import { SENTENCE_HIDE_REASONS, type SentencePracticeEvent } from '../../../shared/study/sentenceHistory';

export const MAX_SENTENCE_EVENTS_PER_REQUEST = 200;
export const SENTENCE_EVENTS_PAGE = 1000;

export interface StoredSentenceEvent extends SentencePracticeEvent {
  received_at: string;
}

function chunks<T>(xs: T[], n = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** A device time as ISO, never in the future. */
function eventTime(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.min(ms, Date.now())).toISOString();
}

/** One uploaded event, checked; null = refused (bad shape). */
export function cleanSentenceEvent(raw: unknown): SentencePracticeEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const str = (v: unknown, max = 128) => (typeof v === 'string' && v.trim() && v.length <= max ? v : null);
  const id = str(e.id);
  const note_id = str(e.note_id);
  const sentence_key = str(e.sentence_key);
  const at = eventTime(e.at);
  if (!id || !note_id || !sentence_key || !at) return null;
  if (e.kind === 'attempt') {
    if (e.mode !== 'read' && e.mode !== 'translate') return null;
    if (e.result !== 'right' && e.result !== 'close' && e.result !== 'wrong') return null;
    return { id, note_id, sentence_key, kind: 'attempt', mode: e.mode, result: e.result, reason: null, at };
  }
  if (e.kind === 'hide') {
    const reason = (SENTENCE_HIDE_REASONS as readonly string[]).includes(e.reason as string) ? (e.reason as SentencePracticeEvent['reason']) : null;
    return { id, note_id, sentence_key, kind: 'hide', mode: null, result: null, reason, at };
  }
  if (e.kind === 'unhide') return { id, note_id, sentence_key, kind: 'unhide', mode: null, result: null, reason: null, at };
  return null;
}

/** Which of these notes are in the user's own decks. */
async function ownedNoteIds(db: D1Database, userId: string, noteIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks([...new Set(noteIds)])) {
    const res = await db
      .prepare(`SELECT n.id FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ? AND n.id IN (${part.map(() => '?').join(',')})`)
      .bind(userId, ...part)
      .all<{ id: string }>();
    for (const r of res.results ?? []) out.add(r.id);
  }
  return out;
}

export interface AddSentenceEventsResult {
  /** Ids stored now or already stored (the client may mark them uploaded). */
  accepted: string[];
  /** Newly stored. */
  stored: number;
  /** Bad shape or not the user's note (never retried). */
  rejected: string[];
}

export async function addSentenceEvents(db: D1Database, userId: string, raw: unknown[]): Promise<AddSentenceEventsResult> {
  const rejected: string[] = [];
  const clean: SentencePracticeEvent[] = [];
  for (const r of raw) {
    const e = cleanSentenceEvent(r);
    if (e) clean.push(e);
    else if (r && typeof (r as { id?: unknown }).id === 'string') rejected.push((r as { id: string }).id);
  }
  const owned = await ownedNoteIds(db, userId, clean.map((e) => e.note_id));
  const mine = clean.filter((e) => {
    if (owned.has(e.note_id)) return true;
    rejected.push(e.id);
    return false;
  });
  let stored = 0;
  for (const part of chunks(mine, 40)) {
    const results = await db.batch(part.map((e) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO sentence_practice_events (id, user_id, note_id, sentence_key, kind, mode, result, reason, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(e.id, userId, e.note_id, e.sentence_key, e.kind, e.mode ?? null, e.result ?? null, e.reason ?? null, e.at),
    ));
    for (const r of results) stored += r.meta?.changes ?? 0;
  }
  return { accepted: mine.map((e) => e.id), stored, rejected };
}

/** The user's events received after `since` (server time), oldest first; `cursor` = the last one's received_at. */
export async function listSentenceEvents(
  db: D1Database,
  userId: string,
  since: string | null,
  noteId?: string | null,
): Promise<{ events: StoredSentenceEvent[]; cursor: string | null; more: boolean }> {
  const where = ['user_id = ?'];
  const binds: unknown[] = [userId];
  if (since) { where.push('received_at > ?'); binds.push(since); }
  if (noteId) { where.push('note_id = ?'); binds.push(noteId); }
  const res = await db
    .prepare(
      `SELECT id, note_id, sentence_key, kind, mode, result, reason, at, received_at FROM sentence_practice_events
       WHERE ${where.join(' AND ')} ORDER BY received_at ASC, id ASC LIMIT ?`,
    )
    .bind(...binds, SENTENCE_EVENTS_PAGE + 1)
    .all<StoredSentenceEvent>();
  const rows = res.results ?? [];
  const more = rows.length > SENTENCE_EVENTS_PAGE;
  const events = rows.slice(0, SENTENCE_EVENTS_PAGE);
  return { events, cursor: events.length ? events[events.length - 1].received_at : since, more };
}

/** Sentence keys of a note the user has hidden (the top-up counts only the ones left in rotation). */
export async function hiddenSentenceKeys(db: D1Database, userId: string, noteIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const part of chunks([...new Set(noteIds)])) {
    const res = await db
      .prepare(
        `SELECT note_id, sentence_key, kind FROM sentence_practice_events
         WHERE user_id = ? AND kind IN ('hide', 'unhide') AND note_id IN (${part.map(() => '?').join(',')})
         ORDER BY at ASC, id ASC`,
      )
      .bind(userId, ...part)
      .all<{ note_id: string; sentence_key: string; kind: string }>();
    for (const r of res.results ?? []) {
      let set = out.get(r.note_id);
      if (!set) out.set(r.note_id, (set = new Set()));
      if (r.kind === 'hide') set.add(r.sentence_key);
      else set.delete(r.sentence_key);
    }
  }
  return out;
}
