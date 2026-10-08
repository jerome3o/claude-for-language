/**
 * "Study it today" — the bump pocket (study_bumps). A learner (or Claude, for
 * them) bumps a note they already have; its cards come FIRST in today's session.
 * Shared by the web app (frontend/src/db/database.ts → selectStudyQueue) and the
 * native Lab app (android-lab/core Bumps.kt, parity-tested through
 * android-lab/parity/fixtures/study-queue.ts). Pure: callers feed it rows.
 *
 * Which cards of a bumped note (`bumpPocket`), cards never reviewed since the bump:
 *   - every NEW card — introduced today even when the daily budget is spent (an
 *     explicit request: it never takes from, nor is blocked by, the deck queue's
 *     budget; once reviewed it counts toward introduced-today like any new card);
 *   - every card already due by the cutoff — just moved to the front;
 *   - plus ONE early review — the most important card that is not due yet
 *     (hanzi_to_meaning, then meaning_to_hanzi, then audio_to_hanzi) — unless the
 *     note already has a due card in the pocket, or a card that was in circulation
 *     before the bump (first review earlier than the bump) has been reviewed since.
 *     ts-fsrs schedules an early review from the real elapsed time, so the rating
 *     counts normally;
 *   - at most MAX_BUMPED_CARDS_PER_NOTE, in card-type order.
 * A bump is DONE when its pocket is empty (each bumped card reviewed since the bump);
 * an unfinished bump carries over to the next day.
 */

import type { QueueCardInput } from './study-queue';

export const MAX_BUMPED_CARDS_PER_NOTE = 3;

/** Card types in the order the pocket prefers them. */
export const BUMP_CARD_TYPE_ORDER = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

/** Where a bump came from (analytics + the API's `source`). */
export const BUMP_SOURCES = [
  'coach',
  'coach_chat',
  'ask_claude',
  'chat',
  'chat_discuss',
  'reader',
  'picture_hunt',
  'paste_list',
  'breakdown',
  'card_hub',
  'char_sheet',
  'explorer',
  'idioms',
  'deck',
  'mcp',
  'tutor',
  'other',
] as const;
export type BumpSource = (typeof BUMP_SOURCES)[number];

export function normalizeBumpSource(s: unknown): BumpSource {
  return typeof s === 'string' && (BUMP_SOURCES as readonly string[]).includes(s) ? (s as BumpSource) : 'other';
}

/** An active bump (not cleared by hand). */
export interface QueueBump {
  note_id: string;
  /** When it was bumped (epoch ms). Reviews at or after this cover a card. */
  created_ms: number;
}

export interface QueueBumps {
  bumps: ReadonlyArray<QueueBump>;
  /** card id → its latest review (epoch ms); absent = never reviewed. Only the bumped notes' cards are needed. */
  lastReviewMs: ReadonlyMap<string, number>;
  /** card id → its first-ever review (epoch ms); absent = never reviewed. */
  firstReviewMs: ReadonlyMap<string, number>;
}

export interface BumpPocket<C extends QueueCardInput> {
  /** The pocket's cards, bumps oldest first, card-type order within a note. */
  cards: C[];
  /** Bumped notes that still have cards in the pocket (oldest bump first). */
  activeNoteIds: string[];
  /** Bumped notes whose every bumped card has been reviewed since the bump. */
  doneNoteIds: string[];
}

const typeRank = (t: string) => {
  const i = (BUMP_CARD_TYPE_ORDER as readonly string[]).indexOf(t);
  return i < 0 ? BUMP_CARD_TYPE_ORDER.length : i;
};
const byType = (a: QueueCardInput, b: QueueCardInput) =>
  typeRank(a.card_type) - typeRank(b.card_type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const isDue = (c: QueueCardInput, cutoffMs: number) => c.queue !== 0 && (c.due_ms === null || c.due_ms <= cutoffMs);

/** The cards one bumped note puts in the pocket (empty = done). `noteCards` = every card of the note. */
export function bumpedCardsForNote<C extends QueueCardInput>(
  noteCards: ReadonlyArray<C>,
  bump: QueueBump,
  lastReviewMs: ReadonlyMap<string, number>,
  firstReviewMs: ReadonlyMap<string, number>,
  cutoffMs: number
): C[] {
  const sorted = [...noteCards].sort(byType);
  const reviewedSince = (c: C) => {
    const last = lastReviewMs.get(c.id);
    return last !== undefined && last >= bump.created_ms;
  };
  const open = sorted.filter(c => !reviewedSince(c));
  const picks = open.filter(c => c.queue === 0 || isDue(c, cutoffMs));
  const earlyUsed =
    picks.some(c => c.queue !== 0) ||
    sorted.some(c => {
      if (!reviewedSince(c)) return false;
      const first = firstReviewMs.get(c.id);
      return first !== undefined && first < bump.created_ms;
    });
  if (!earlyUsed) {
    const early = open.find(c => c.queue !== 0 && !isDue(c, cutoffMs));
    if (early) picks.push(early);
  }
  return picks.sort(byType).slice(0, MAX_BUMPED_CARDS_PER_NOTE);
}

/**
 * The pocket over a card list (callers pass the cards in scope — a one-deck
 * session passes that deck's). A bump whose note has no card in `cards` is
 * neither active nor done here (its deck is out of scope or not on the device).
 */
export function bumpPocket<C extends QueueCardInput>(
  cards: ReadonlyArray<C>,
  bumps: QueueBumps | null | undefined,
  cutoffMs: number
): BumpPocket<C> {
  const out: BumpPocket<C> = { cards: [], activeNoteIds: [], doneNoteIds: [] };
  if (!bumps || bumps.bumps.length === 0) return out;
  const wanted = new Set(bumps.bumps.map(b => b.note_id));
  const byNote = new Map<string, C[]>();
  for (const c of cards) {
    if (!wanted.has(c.note_id)) continue;
    const list = byNote.get(c.note_id);
    if (list) list.push(c);
    else byNote.set(c.note_id, [c]);
  }
  const order = [...bumps.bumps].sort(
    (a, b) => a.created_ms - b.created_ms || (a.note_id < b.note_id ? -1 : a.note_id > b.note_id ? 1 : 0)
  );
  const seen = new Set<string>();
  for (const bump of order) {
    if (seen.has(bump.note_id)) continue;
    seen.add(bump.note_id);
    const noteCards = byNote.get(bump.note_id);
    if (!noteCards || noteCards.length === 0) continue;
    const picks = bumpedCardsForNote(noteCards, bump, bumps.lastReviewMs, bumps.firstReviewMs, cutoffMs);
    if (picks.length === 0) out.doneNoteIds.push(bump.note_id);
    else {
      out.activeNoteIds.push(bump.note_id);
      out.cards.push(...picks);
    }
  }
  return out;
}

/** Home's line: "⚡ 2 bumped for today" ('' when none). */
export function bumpedLabel(count: number): string {
  return count > 0 ? `⚡ ${count} bumped for today` : '';
}

/** Toast / reply after bumping. */
export function bumpedMessage(hanzi: string[], alreadyBumped = 0): string {
  const n = hanzi.length;
  if (n === 0) return alreadyBumped > 0 ? 'Already in today’s pocket ⚡' : 'Nothing to bump';
  const shown = n === 1 ? hanzi[0] : n === 2 ? `${hanzi[0]} and ${hanzi[1]}` : `${hanzi[0]}, ${hanzi[1]} and ${n - 2} more`;
  return `⚡ ${shown} will come first in today’s study`;
}
