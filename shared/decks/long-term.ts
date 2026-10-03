/**
 * "Add to my long-term review" — a learner's per-word choice (notes.long_term on
 * THEIR copy of the note), set on the answer side of a homework pass
 * (docs/HOMEWORK.md §3a):
 *
 *   null  follow the deck: a deck in daily review introduces the word as usual,
 *         a one-off-only homework copy (caps 0 + 0) never does;
 *   1     opted IN: the word is introduced even from a 0 + 0 deck — its deck then
 *         gives it the new-deck default caps (3 + 6), in the deck's queue position;
 *   0     opted OUT: the word never gets NEW cards introduced (not in the primary
 *         or secondary pool, not by "Study 10 more").
 *
 * Opting out only affects words not met yet: once any card of the note has been
 * reviewed the choice is ignored and the word keeps its normal schedule (the
 * toggle shows "already in your reviews" and is disabled).
 *
 * Pure and shared by the web (frontend/src/db/database.ts via study-queue.ts, the
 * pass page) and the Lab app (android-lab/core LongTerm.kt, parity-tested through
 * android-lab/parity/fixtures/long-term.ts).
 */
import { DEFAULT_DECK_SETTINGS } from './defaults';

export type LongTermPref = 0 | 1 | null;

/** A deck is in daily review unless BOTH its caps are 0 (a one-off-only homework copy). */
export function deckInDailyReview(capPrimary: number, capSecondary: number): boolean {
  return capPrimary > 0 || capSecondary > 0;
}

/** Normalise whatever a row / request holds into 0 | 1 | null. */
export function toLongTermPref(v: unknown): LongTermPref {
  if (v === 1 || v === true || v === '1') return 1;
  if (v === 0 || v === false || v === '0') return 0;
  return null;
}

/** Whether the word is (or will be) in daily review: the switch's state. */
export function isLongTerm(pref: LongTermPref | undefined, deckInReview: boolean, noteReviewed = false): boolean {
  if (noteReviewed) return true;
  if (pref === 1) return true;
  if (pref === 0) return false;
  return deckInReview;
}

/**
 * The value to store when the switch is flipped to `on`: back to the deck's own
 * default stores null (so "Add these words to my daily review" on a one-off deck
 * still takes every word the learner did not single out), anything else explicit.
 */
export function prefForToggle(on: boolean, deckInReview: boolean): LongTermPref {
  if (on === deckInReview) return null;
  return on ? 1 : 0;
}

/** Whether the note's NEW cards enter its deck's new-card pool. */
export function admitsNewCards(pref: LongTermPref | undefined, deckInReview: boolean, noteReviewed: boolean): boolean {
  if (pref === 1) return true;
  if (pref === 0 && !noteReviewed) return false;
  return deckInReview;
}

/**
 * The caps a deck's pool gets. A deck out of daily review only holds opted-in
 * words (admitsNewCards), and gives them the new-deck defaults.
 */
export function longTermCaps(capPrimary: number, capSecondary: number): { capPrimary: number; capSecondary: number } {
  if (deckInDailyReview(capPrimary, capSecondary)) return { capPrimary, capSecondary };
  return { capPrimary: DEFAULT_DECK_SETTINGS.new_cards_per_day, capSecondary: DEFAULT_DECK_SETTINGS.secondary_cards_per_day };
}

/** The pass's finish line: "12 words added to daily review · 4 left out". */
export function longTermSummary(
  words: ReadonlyArray<{ pref: LongTermPref | undefined; reviewed: boolean }>,
  deckInReview: boolean
): { added: number; leftOut: number } {
  let added = 0;
  for (const w of words) if (isLongTerm(w.pref, deckInReview, w.reviewed)) added++;
  return { added, leftOut: words.length - added };
}
