/**
 * The character dictionary on the device (docs/STUDY_SESSION.md "Character sheet";
 * shared/chars, GET /api/chars). Card-independent: one record per character, cached in
 * IndexedDB (`charDict`) the first time it is looked at and for the upcoming study queue
 * during sync, so the card back's character sheet works offline.
 */
import { CHAR_BATCH_MAX, CHAR_DICT_VERSION, charWordRows, type CharRecord, type CharWord, type CharWordRow } from '@shared/chars';
import { isHanCodePoint, noteKey } from '@shared/progress/known';
import { apiErrorStatus, fetchCharExplanation, fetchCharRecord, fetchCharRecords } from '../api/client';
import { db } from '../db/database';

/** A character the dictionary lacked is asked about again after a week (a new build may have it). */
const MISSING_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const PREFETCH_KEY = 'char-dict-prefetch-at';
const PREFETCH_EVERY_MS = 60 * 60 * 1000;

export function isLookupChar(ch: string): boolean {
  const cp = ch.codePointAt(0);
  return cp !== undefined && [...ch].length === 1 && isHanCodePoint(cp);
}

export type CharLookup =
  | { status: 'ok'; record: CharRecord; offline: boolean }
  | { status: 'missing' }
  | { status: 'offline' }
  | { status: 'error'; message: string };

async function cached(char: string) {
  try {
    const row = await db.charDict.get(char);
    if (!row || row.version !== CHAR_DICT_VERSION) return undefined;
    return row;
  } catch {
    return undefined;
  }
}

/** Device cache first; the network only for a character this device hasn't seen. */
export async function lookupChar(char: string): Promise<CharLookup> {
  const row = await cached(char);
  if (row?.record) return { status: 'ok', record: row.record, offline: false };
  if (row && Date.now() - row.cached_at < MISSING_RETRY_MS) return { status: 'missing' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { status: 'offline' };
  try {
    const { record } = await fetchCharRecord(char);
    await db.charDict.put({ char, record, version: CHAR_DICT_VERSION, cached_at: Date.now() }).catch(() => {});
    return { status: 'ok', record, offline: false };
  } catch (err) {
    const status = apiErrorStatus(err);
    if (status === 404) {
      await db.charDict.put({ char, record: null, version: CHAR_DICT_VERSION, cached_at: Date.now() }).catch(() => {});
      return { status: 'missing' };
    }
    if (status === undefined) return { status: 'offline' };
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Fetches the records of `chars` this device doesn't have yet, CHAR_BATCH_MAX per call. */
export async function prefetchChars(chars: Iterable<string>): Promise<number> {
  const wanted = [...new Set([...chars].filter(isLookupChar))];
  if (wanted.length === 0) return 0;
  const have = await db.charDict.bulkGet(wanted);
  const todo = wanted.filter((_, i) => {
    const row = have[i];
    return !row || row.version !== CHAR_DICT_VERSION || (!row.record && Date.now() - row.cached_at >= MISSING_RETRY_MS);
  });
  let fetched = 0;
  for (let i = 0; i < todo.length; i += CHAR_BATCH_MAX) {
    const batch = todo.slice(i, i + CHAR_BATCH_MAX);
    const { records, missing } = await fetchCharRecords(batch.join(''));
    const now = Date.now();
    await db.charDict.bulkPut([
      ...Object.values(records).map((record) => ({ char: record.char, record, version: CHAR_DICT_VERSION, cached_at: now })),
      ...missing.map((char) => ({ char, record: null, version: CHAR_DICT_VERSION, cached_at: now })),
    ]);
    fetched += Object.keys(records).length;
  }
  return fetched;
}

/**
 * During sync (hourly): the characters of the cards coming up soonest — due / learning and
 * the next new ones — so tapping a character on the card back never needs the network.
 */
export async function prefetchQueueCharsIfDue(limitNotes = 150): Promise<number | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  let last = 0;
  try {
    last = Number(localStorage.getItem(PREFETCH_KEY) || 0);
  } catch {
    // private mode: prefetch every time, it is cheap once cached
  }
  if (Date.now() - last < PREFETCH_EVERY_MS) return null;
  const soon = Date.now() + 24 * 60 * 60 * 1000;
  const due = await db.cards.where('due_timestamp').belowOrEqual(soon).limit(limitNotes * 3).toArray();
  const fresh = await db.cards.where('queue').equals(0).limit(limitNotes * 2).toArray();
  const noteIds: string[] = [];
  for (const c of [...due, ...fresh]) {
    if (!noteIds.includes(c.note_id)) noteIds.push(c.note_id);
    if (noteIds.length >= limitNotes) break;
  }
  const notes = await db.notes.bulkGet(noteIds);
  const chars = new Set<string>();
  for (const n of notes) for (const ch of n?.hanzi ?? '') if (isLookupChar(ch)) chars.add(ch);
  const fetched = await prefetchChars(chars);
  try {
    localStorage.setItem(PREFETCH_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  return fetched;
}

/** Status of each word from this device's notes + cards (shared/chars/status.ts). */
export async function charWordStatuses(words: readonly CharWord[], cardHanzi?: string | null): Promise<CharWordRow<CharWord>[]> {
  const wanted = new Set(words.map((w) => noteKey(w.hanzi)));
  const decks = new Set((await db.decks.toArray()).map((d) => d.id));
  const notes = await db.notes.filter((n) => decks.has(n.deck_id) && wanted.has(noteKey(n.hanzi ?? ''))).toArray();
  const cards = notes.length ? await db.cards.where('note_id').anyOf(notes.map((n) => n.id)).toArray() : [];
  return charWordRows(
    words,
    notes.map((n) => ({ id: n.id, hanzi: n.hanzi })),
    cards.map((c) => ({ note_id: c.note_id, queue: c.queue, stability: c.stability ?? 0 })),
    cardHanzi,
  );
}

export type ExplainResult = { status: 'ok'; text: string } | { status: 'offline' } | { status: 'error'; message: string };

/** "More about 字": device cache, else the server (one answer per character for everyone). */
export async function explainChar(char: string): Promise<ExplainResult> {
  const hit = await db.charExplanations.get(char).catch(() => undefined);
  if (hit) return { status: 'ok', text: hit.explanation };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { status: 'offline' };
  try {
    const out = await fetchCharExplanation(char);
    await db.charExplanations.put({ char, explanation: out.explanation, cached_at: Date.now() }).catch(() => {});
    return { status: 'ok', text: out.explanation };
  } catch (err) {
    if (apiErrorStatus(err) === undefined) return { status: 'offline' };
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
