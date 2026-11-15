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
 * What one ⚡ tap bumps is ONE rule from everywhere (`bumpNotes` → shared/decks/study-today.ts):
 * an unstarted word's listening card (else its lead card), a started word's listening card, the
 * whole note only without one — stored as a CARD-LEVEL bump (`card_types`) marked `planned`.
 * `bumpCardTypes` is the study card's "Practise this word other ways…" (an explicit choice):
 * only those card types of the note go in the pocket. A row that changes
 * gets a NEW client id, so an upload already on its way never marks the newer row sent.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import {
  allCharactersKnown, bumpedCardsForNote, deckInDailyReview, DEFAULT_DECK_SETTINGS, knownCharactersFrom, knownNoteIdsFrom,
  mergeBumpCardTypes, normalizeBumpCardTypes, normalizeBumpSource, studyTodayKindOfRow, studyTodayMessage, studyTodayPlan,
  toLongTermPref, type BumpSource, type LongTermPref, type StudyTodayKind, type StudyTodayPlan,
} from '@shared/decks';
import { normalizeHanzi } from '@shared/import/parse';
import { db, bumpTimeMs, getStudyCutoff, queueInput, type LocalCard, type LocalNote, type LocalStudyBump } from '../db/database';
import { CardQueue } from '../types';
import { setNoteLongTerm } from './longTerm';
import { readNewCardOrder } from './newCardOrder';
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

export interface StudyTodayNoteResult {
  noteId: string;
  /** What the tap put in today (shared/decks/study-today.ts). */
  kind: StudyTodayKind;
  /** The bump's card types afterwards (null = the whole note). */
  cardTypes: string[] | null;
  /** False = it was already in today's pocket. */
  added: boolean;
  /** The long-term choice the tap replaced (undefined = unchanged), so a second tap can put it back. */
  longTermBefore?: LongTermPref;
}

export interface BumpOutcome {
  added: string[];
  already: string[];
  message: string;
  results: StudyTodayNoteResult[];
}

/** The characters he knows (every Han character of a note with a mature card, lead-card.ts); empty with "English → Chinese" off. */
async function knownCharacters(): Promise<Set<string>> {
  if (!readNewCardOrder().known_characters_english_first) return new Set();
  const known = knownNoteIdsFrom(await db.cards.toArray());
  if (known.size === 0) return new Set();
  const notes = await db.notes.bulkGet([...known]);
  return knownCharactersFrom(notes.map((n) => n?.hanzi ?? ''));
}

/** "English → Chinese" applies to this word: the setting is on and he knows every character (lead-card.ts). */
export async function knownCharactersLead(hanzi: string): Promise<boolean> {
  return allCharactersKnown(hanzi, await knownCharacters());
}

/**
 * The "⚡ Study it today" plan of one note on this device (shared/decks/study-today.ts). `known` = the known
 * characters, shared across one call's notes (read only when a plan needs it).
 */
export async function studyTodayPlanFor(
  note: LocalNote,
  cards?: ReadonlyArray<LocalCard>,
  known: () => Promise<Set<string>> = knownCharacters,
): Promise<StudyTodayPlan> {
  const noteCards = cards ?? (await db.cards.where('note_id').equals(note.id).toArray());
  const deck = await db.decks.get(note.deck_id);
  const base = {
    cards: noteCards,
    started: noteCards.some((c) => c.queue !== CardQueue.NEW),
    hasAudio: !!note.audio_url,
    longTermPref: toLongTermPref(note.long_term),
    deckInReview: deck ? deckInDailyReview(deck.new_cards_per_day, deck.secondary_cards_per_day ?? DEFAULT_DECK_SETTINGS.secondary_cards_per_day) : true,
  };
  const first = studyTodayPlan(base);
  if (first.kind !== 'lead') return first;
  const lead = allCharactersKnown(note.hanzi ?? '', await known());
  return studyTodayPlan({ ...base, knownCharactersLead: () => lead });
}

/** A whole-note bump row (an active one already covers the note). `planned` = the device chose it. */
async function putWholeBump(noteId: string, source: BumpSource, now: string, planned: boolean): Promise<boolean> {
  let added = false;
  await db.transaction('rw', db.studyBumps, async () => {
    const row = await db.studyBumps.where('note_id').equals(noteId).first();
    // A card-level bump of the word becomes a whole-note bump (mergeBumpCardTypes).
    if (row && row.pending !== 'clear' && !normalizeBumpCardTypes(row.card_types)) return;
    if (row) await db.studyBumps.delete(row.id);
    await db.studyBumps.put({
      id: crypto.randomUUID(), note_id: noteId, created_at: now, source, bumped_by_name: null, pending: 'add', ...(planned ? { planned: true } : {}),
    });
    added = true;
  });
  return added;
}

/**
 * "⚡ Study it today" — the ONE device entry point every ⚡ goes through (the explorer, the add-card sheets,
 * word sheets, Make flashcards / Paste a list, the deck page, the card hub, Up next, the homework pass, the
 * reader recap, clips): each note follows shared/decks/study-today.ts — an unstarted word puts ONLY its
 * listening card in today (else its lead card) and goes into long-term review; a started word its listening
 * card; a word with no listening card (or no audio) the whole note. Local at once, uploaded when online.
 * A note not on this device is sent as a whole-note row without a plan: the server applies the rule.
 * Returns the toast line. `hanziById` names words not on the device.
 */
export async function bumpNotes(noteIds: string[], source: BumpSource, hanziById?: Map<string, string>): Promise<BumpOutcome> {
  const ids = [...new Set(noteIds.filter(Boolean))];
  const now = new Date().toISOString();
  const notes = await db.notes.bulkGet(ids);
  const results: StudyTodayNoteResult[] = [];
  let knownOnce: Promise<Set<string>> | null = null;
  const known = () => (knownOnce ??= knownCharacters());
  for (let i = 0; i < ids.length; i++) {
    const noteId = ids[i];
    const note = notes[i];
    if (!note) {
      results.push({ noteId, kind: 'whole', cardTypes: null, added: await putWholeBump(noteId, source, now, false) });
      continue;
    }
    const plan = await studyTodayPlanFor(note, undefined, known);
    let res: StudyTodayNoteResult;
    if (plan.cardTypes) {
      const r = await putCardTypesBump(noteId, plan.cardTypes, source);
      res = { noteId, kind: studyTodayKindOfRow(r.cardTypes), cardTypes: r.cardTypes, added: r.added };
    } else {
      res = { noteId, kind: 'whole', cardTypes: null, added: await putWholeBump(noteId, source, now, true) };
    }
    if (res.added && plan.longTerm !== undefined) {
      res.longTermBefore = toLongTermPref(note.long_term);
      await setNoteLongTerm(noteId, plan.longTerm);
    }
    results.push(res);
  }
  const added = results.filter((r) => r.added).map((r) => r.noteId);
  const already = results.filter((r) => !r.added).map((r) => r.noteId);
  const shown = results
    .map((r, i) => ({ r, hanzi: hanziById?.get(r.noteId) ?? notes[i]?.hanzi ?? '' }))
    .filter((x) => x.r.added && x.hanzi);
  const cardLevel = results.filter((r) => r.added && r.cardTypes).length;
  track('study.bump_added', { source, count: added.length, already: already.length, card_types: cardLevel });
  if (added.length && online()) void flushPendingBumps().catch(() => undefined);
  return { added, already, results, message: studyTodayMessage(shown.map((x) => ({ hanzi: x.hanzi, kind: x.r.kind })), already.length) };
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
 * A card-level bump of one note, local at once (not tracked, not flushed): an open card-level bump of the
 * note keeps its types still to review and gains these (re-dated now); a finished one starts afresh; a
 * whole-note bump already covers them.
 */
async function putCardTypesBump(noteId: string, cardTypes: string[], source: BumpSource): Promise<CardTypesBumpOutcome> {
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
      id: crypto.randomUUID(), note_id: noteId, created_at: now, source, bumped_by_name: null, card_types: merge.card_types, planned: true, pending: 'add',
    });
    outcome = { added: true, cardTypes: merge.card_types };
  });
  return outcome;
}

/**
 * "Practise this word other ways…" (shared/decks/other-card-types.ts): put these card types of one note in
 * today's ⚡ pocket — an explicit choice, so the "Study it today" rule doesn't apply. Local at once,
 * uploaded when online.
 */
export async function bumpCardTypes(noteId: string, cardTypes: string[], source: BumpSource = 'study_card'): Promise<CardTypesBumpOutcome> {
  const want = normalizeBumpCardTypes(cardTypes);
  if (!want) return { added: false, cardTypes: null };
  const outcome = await putCardTypesBump(noteId, want, source);
  track('study.bump_added', { source, count: outcome.added ? 1 : 0, already: outcome.added ? 0 : 1, card_types: want.length });
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
    const r = await addBumpsApi(adds.map((b) => ({ id: b.id, note_id: b.note_id, created_at: b.created_at, source: b.source, card_types: b.card_types ?? null, ...(b.planned ? { planned: true } : {}) })));
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

