/**
 * "⚡ Study it today" on the device (shared/decks/bumps.ts; CLAUDE.md "Study it today").
 *
 * A learner who tries to add a word they already have bumps it instead: the note's
 * cards come first in today's session (the shared queue rule). Offline-first:
 *   - a bump / clear is written to IndexedDB (`studyBumps`) at once with `pending`,
 *     so the queue and Home see it immediately, offline too;
 *   - it goes up straight away when online (POST /api/me/bumps with a client id,
 *     DELETE /api/me/bumps/:noteId — both idempotent), else in the next sync;
 *   - every sync replaces the server's rows whole (`bumps` on /api/sync/changes),
 *     keeping this device's pending rows on top.
 * Which cards are in the pocket and whether a bump is done is derived from the
 * local review events every time (never stored).
 *
 * A CARD-LEVEL bump (`card_types`, bumpCardTypes) is the study card's "Practise this word
 * other ways…": only those card types of the note go in the pocket. A row that changes
 * gets a NEW client id, so an upload already on its way never marks the newer row sent.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import {
  bumpedCardsForNote, bumpedMessage, mergeBumpCardTypes, normalizeBumpCardTypes, normalizeBumpSource, sentenceBumps,
  type BumpSource, type SentenceBumps,
} from '@shared/decks';
import { normalizeHanzi } from '@shared/import/parse';
import { db, bumpTimeMs, getStudyCutoff, queueInput, type LocalNote, type LocalStudyBump } from '../db/database';
export { bumpTimeMs, loadQueueBumps } from '../db/database';
import { addBumpsApi, clearBumpApi, listBumpsApi, type ApiStudyBump } from '../api/bumps';
import { track } from './analytics';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** Rows the queue counts (not waiting to be cleared). */
async function activeRows(): Promise<LocalStudyBump[]> {
  return (await db.studyBumps.toArray()).filter((b) => b.pending !== 'clear');
}

/** note id → its bump row (pending clears left out), live. */
export function useBumps(): Map<string, LocalStudyBump> {
  const rows = useLiveQuery(() => activeRows(), []) ?? [];
  return new Map(rows.map((r) => [r.note_id, r]));
}

/** The user's notes with this hanzi (punctuation / spaces ignored), every deck, with the deck name. */
export async function findExistingNotes(hanzi: string): Promise<Array<{ note: LocalNote; deckName: string }>> {
  const key = normalizeHanzi(hanzi);
  if (!key) return [];
  const notes = await db.notes.filter((n) => normalizeHanzi(n.hanzi ?? '') === key).toArray();
  if (notes.length === 0) return [];
  const decks = await db.decks.bulkGet([...new Set(notes.map((n) => n.deck_id))]);
  const names = new Map(decks.filter(Boolean).map((d) => [d!.id, d!.name]));
  return notes.filter((n) => names.has(n.deck_id)).map((note) => ({ note, deckName: names.get(note.deck_id)! }));
}

export interface BumpOutcome {
  added: string[];
  already: string[];
  message: string;
}

/**
 * Bump notes now (local at once, uploaded when online). Returns the toast line.
 * `hanziById` lets callers name words they already have in hand.
 */
export async function bumpNotes(noteIds: string[], source: BumpSource, hanziById?: Map<string, string>): Promise<BumpOutcome> {
  const ids = [...new Set(noteIds.filter(Boolean))];
  const now = new Date().toISOString();
  const added: string[] = [];
  const already: string[] = [];
  await db.transaction('rw', db.studyBumps, async () => {
    for (const noteId of ids) {
      const row = await db.studyBumps.where('note_id').equals(noteId).first();
      // A card-level bump of the word becomes a whole-note bump (mergeBumpCardTypes).
      if (row && row.pending !== 'clear' && !normalizeBumpCardTypes(row.card_types)) {
        already.push(noteId);
        continue;
      }
      if (row) await db.studyBumps.delete(row.id);
      await db.studyBumps.put({ id: crypto.randomUUID(), note_id: noteId, created_at: now, source, bumped_by_name: null, pending: 'add' });
      added.push(noteId);
    }
  });
  const names = async (list: string[]) => {
    const notes = await db.notes.bulkGet(list);
    return list.map((id, i) => hanziById?.get(id) ?? notes[i]?.hanzi ?? '').filter(Boolean);
  };
  track('study.bump_added', { source, count: added.length, already: already.length });
  if (added.length && online()) void flushPendingBumps().catch(() => undefined);
  return { added, already, message: bumpedMessage(await names(added), already.length) };
}

/** Card review times of one note (local events; refused ones left out). */
async function noteReviewSpans(cardIds: string[]): Promise<{ last: Map<string, number>; first: Map<string, number> }> {
  const last = new Map<string, number>();
  const first = new Map<string, number>();
  if (cardIds.length === 0) return { last, first };
  await db.reviewEvents.where('card_id').anyOf(cardIds).each((e) => {
    if ((e as { _synced?: number })._synced === -1) return;
    const ms = Date.parse(e.reviewed_at);
    if (!Number.isFinite(ms)) return;
    if (ms > (last.get(e.card_id) ?? -Infinity)) last.set(e.card_id, ms);
    if (ms < (first.get(e.card_id) ?? Infinity)) first.set(e.card_id, ms);
  });
  return { last, first };
}

export interface CardTypesBumpOutcome {
  /** True when the pocket changed (false = these cards were already in today's study). */
  added: boolean;
  /** The bump's card types afterwards (null = the whole note is bumped). */
  cardTypes: string[] | null;
}

/**
 * "Practise this word other ways…" (shared/decks/other-card-types.ts): put these card types
 * of one note in today's ⚡ pocket — a card-level bump, local at once, uploaded when online.
 * An open card-level bump of the note keeps its types still to review and gains these (re-dated
 * now); a finished one starts afresh; a whole-note bump already covers them.
 */
export async function bumpCardTypes(noteId: string, cardTypes: string[], source: BumpSource = 'study_card'): Promise<CardTypesBumpOutcome> {
  const want = normalizeBumpCardTypes(cardTypes);
  if (!want) return { added: false, cardTypes: null };
  const cards = await db.cards.where('note_id').equals(noteId).toArray();
  const { last, first } = await noteReviewSpans(cards.map((c) => c.id));
  const cutoff = getStudyCutoff().ts;
  const now = new Date().toISOString();
  let outcome: CardTypesBumpOutcome = { added: false, cardTypes: want };
  await db.transaction('rw', db.studyBumps, async () => {
    const row = await db.studyBumps.where('note_id').equals(noteId).first();
    let existing: string[] | null | undefined;
    let stillOpen: string[] = [];
    if (row && row.pending !== 'clear') {
      const open = bumpedCardsForNote(cards.map(queueInput), { note_id: noteId, created_ms: bumpTimeMs(row.created_at), card_types: row.card_types ?? null }, last, first, cutoff);
      // A bump whose cards were all reviewed is finished: start afresh.
      if (open.length > 0) {
        existing = normalizeBumpCardTypes(row.card_types);
        stillOpen = open.map((c) => c.card_type);
      }
    }
    const merge = mergeBumpCardTypes(existing, stillOpen, want);
    if (merge.action === 'already') {
      outcome = { added: false, cardTypes: merge.card_types };
      return;
    }
    if (row) await db.studyBumps.delete(row.id);
    await db.studyBumps.put({
      id: crypto.randomUUID(), note_id: noteId, created_at: now, source, bumped_by_name: null, card_types: merge.card_types, pending: 'add',
    });
    outcome = { added: true, cardTypes: merge.card_types };
  });
  track('study.bump_added', { source, count: outcome.added ? 1 : 0, already: outcome.added ? 0 : 1 });
  if (outcome.added && online()) void flushPendingBumps().catch(() => undefined);
  return outcome;
}

/** Take a note out of today's pocket (local at once). */
export async function clearBump(noteId: string, source: BumpSource = 'other'): Promise<void> {
  await db.transaction('rw', db.studyBumps, async () => {
    const rows = await db.studyBumps.where('note_id').equals(noteId).toArray();
    for (const r of rows) {
      // A pending add not on its way yet is just dropped. One being sent right now (a quick
      // on → off, e.g. the homework pass's ⚡ toggle) becomes a clear: else the server's list
      // that answers the add would bring the bump back with nothing left to take it out.
      if (r.pending === 'add' && !flushing) await db.studyBumps.delete(r.id);
      else await db.studyBumps.update(r.id, { pending: 'clear' });
    }
  });
  track('study.bump_cleared', { source: normalizeBumpSource(source) });
  if (online()) void flushPendingBumps().catch(() => undefined);
}

let flushing: Promise<void> | null = null;
/** A bump / clear was written while a flush was on its way: one more round after it. */
let flushAgain = false;

/** Send every pending add / clear; then take the server's list. Single-flight; a change made meanwhile gets its own round. */
export function flushPendingBumps(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    do {
      flushAgain = false;
      await doFlush();
    } while (flushAgain);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(): Promise<void> {
  const pending = (await db.studyBumps.toArray()).filter((b) => b.pending);
  if (pending.length === 0) return;
  let latest: ApiStudyBump[] | null = null;
  const adds = pending.filter((b) => b.pending === 'add');
  if (adds.length) {
    const r = await addBumpsApi(adds.map((b) => ({ id: b.id, note_id: b.note_id, created_at: b.created_at, source: b.source, card_types: b.card_types ?? null })));
    latest = r.bumps ?? null;
    await db.transaction('rw', db.studyBumps, async () => {
      for (const b of adds) {
        const now = await db.studyBumps.get(b.id);
        if (now?.pending === 'add') await db.studyBumps.update(b.id, { pending: null });
      }
    });
  }
  for (const b of pending.filter((x) => x.pending === 'clear')) {
    const r = await clearBumpApi(b.note_id);
    latest = r.bumps ?? latest;
    const now = await db.studyBumps.get(b.id);
    if (now?.pending === 'clear') await db.studyBumps.delete(b.id);
  }
  if (latest) await replaceLocalBumps(latest);
}

/** The server's active list replaces the synced rows; this device's pending rows win. */
export async function replaceLocalBumps(server: ApiStudyBump[]): Promise<void> {
  await db.transaction('rw', db.studyBumps, async () => {
    const local = await db.studyBumps.toArray();
    const pendingNotes = new Set(local.filter((b) => b.pending).map((b) => b.note_id));
    const stale = local.filter((b) => !b.pending).map((b) => b.id);
    if (stale.length) await db.studyBumps.bulkDelete(stale);
    const rows: LocalStudyBump[] = server
      .filter((b) => !pendingNotes.has(b.note_id))
      .map((b) => ({
        id: b.id, note_id: b.note_id, created_at: b.created_at, source: b.source, bumped_by_name: b.bumped_by_name ?? null,
        card_types: normalizeBumpCardTypes(b.card_types), pending: null,
      }));
    if (rows.length) await db.studyBumps.bulkPut(rows);
  });
}

/** Sync: upload what's pending (never throws). The list itself comes with /sync/changes. */
export async function uploadPendingBumps(): Promise<void> {
  try {
    await flushPendingBumps();
  } catch (err) {
    console.error('[Bumps] upload failed:', err);
  }
}

/** Full sync: pending up, then the whole list down (never throws). */
export async function syncBumps(): Promise<void> {
  await uploadPendingBumps();
  try {
    const { bumps } = await listBumpsApi();
    if (Array.isArray(bumps)) await replaceLocalBumps(bumps);
  } catch (err) {
    console.error('[Bumps] sync failed:', err);
  }
}

/**
 * The Coach's "⚡ Study … today" chip (shared/decks/sentence-bumps.ts): the note the
 * whole sentence is, else the notes found inside it in picker order. Live decks only.
 */
export async function findSentenceBumps(text: string): Promise<SentenceBumps<LocalNote>> {
  if (!normalizeHanzi(text)) return { exact: null, words: [] };
  const live = new Set((await db.decks.toArray()).map((d) => d.id));
  const notes = (await db.notes.toArray()).filter((n) => live.has(n.deck_id) && !!n.hanzi);
  return sentenceBumps(text, notes);
}
