/**
 * Leeches and "Forget this card" (docs/STUDY_SESSION.md "Leeches" / "Forget").
 *
 * A LEECH is a card you keep forgetting after you had learned it. The count is Anki's: a
 * **lapse** = pressing Again on a card that was in Review (graduated), which is exactly FSRS's
 * `lapses` (ts-fsrs adds one only for Again in the Review state). Again on a NEW / learning card
 * is not a lapse: it was never learned yet. Anki flags a card as a leech at 8 lapses (its default
 * leech threshold) and we do the same — but never suspend it automatically: the answer side shows
 * a "⚠️ Missed 8×" pill and the sheet offers what helps (a better card, a memory hook, a rest).
 * After "Forget this card" the count starts again from 0 (FSRS's lapses restart with the card).
 *
 * Lab: core/…/Leech.kt (parity/fixtures/card-forget.ts).
 */
import { CardQueue, computeCardTimeline, isForgetEvent, type ReviewEvent } from '../scheduler/compute-state';

/** Anki's default leech threshold: 8 lapses. */
export const LEECH_THRESHOLD = 8;

/** How many recent ratings the leech sheet lists. */
export const LEECH_RECENT_LIMIT = 10;

export function isLeech(lapses: number | null | undefined): boolean {
  return typeof lapses === 'number' && lapses >= LEECH_THRESHOLD;
}

/** The answer-side pill: an icon AND words (never colour alone). Null below the threshold. */
export function leechPill(lapses: number | null | undefined): { icon: string; text: string } | null {
  if (!isLeech(lapses)) return null;
  return { icon: '⚠️', text: `Missed ${lapses}×` };
}

export interface LeechInfo {
  /** Lapses since the card was last forgotten (= the card's FSRS `lapses`). */
  lapses: number;
  is_leech: boolean;
  /** When each lapse happened (ISO), oldest first. */
  lapse_dates: string[];
  /** Reviews since the last forget. */
  reviews: number;
  /** The newest ratings since the last forget, newest first (≤ LEECH_RECENT_LIMIT). */
  recent: Array<{ reviewed_at: string; rating: number; lapse: boolean }>;
  /** When the card was last forgotten (ISO), or null. */
  forgotten_at: string | null;
}

/**
 * What the leech sheet shows, from the card's events (reviews + forgets, sorted by time —
 * `withForgetEvents`). The lapse count always equals `computeCardState(events).lapses`.
 */
export function leechInfo(events: readonly ReviewEvent[]): LeechInfo {
  const timeline = computeCardTimeline(events);
  let before: CardQueue = CardQueue.NEW;
  let lapseDates: string[] = [];
  let reviews: Array<{ reviewed_at: string; rating: number; lapse: boolean }> = [];
  let forgottenAt: string | null = null;
  events.forEach((e, i) => {
    const after = timeline[i].queue;
    if (isForgetEvent(e)) {
      lapseDates = [];
      reviews = [];
      forgottenAt = e.reviewed_at;
    } else {
      const lapse = e.rating === 0 && before === CardQueue.REVIEW;
      if (lapse) lapseDates.push(e.reviewed_at);
      reviews.push({ reviewed_at: e.reviewed_at, rating: e.rating, lapse });
    }
    before = after;
  });
  return {
    lapses: lapseDates.length,
    is_leech: isLeech(lapseDates.length),
    lapse_dates: lapseDates,
    reviews: reviews.length,
    recent: reviews.slice(-LEECH_RECENT_LIMIT).reverse(),
    forgotten_at: forgottenAt,
  };
}

/** The sheet's headline under the pill. */
export function leechHeadline(lapses: number): string {
  return `You've missed this card ${lapses} ${lapses === 1 ? 'time' : 'times'} after learning it.`;
}

/** Why it matters, in plain words. */
export const LEECH_EXPLANATION =
  'A card you keep forgetting is called a leech. More reviews alone rarely fix it — a clearer card, a memory hook or a short rest usually does. Nothing changes unless you choose one.';

/** The prepared question "Ask Claude for a memory hook" sends. */
export function memoryHookQuestion(hanzi: string, english: string, lapses: number): string {
  return `I keep forgetting this card (missed ${lapses} times): ${hanzi} — ${english}. Can you give me a memorable memory hook or mnemonic for it, and tell me what I'm probably mixing it up with?`;
}

export const RATING_LABELS = ['Again', 'Hard', 'Good', 'Easy'] as const;

/** A rating with an icon so it never depends on colour: ✗ Again, ~ Hard, ✓ Good, ✓✓ Easy. */
export function ratingTag(rating: number): string {
  switch (rating) {
    case 0: return '✗ Again';
    case 1: return '~ Hard';
    case 2: return '✓ Good';
    case 3: return '✓✓ Easy';
    default: return '?';
  }
}

// ---- Forget this card ----

export type ForgetScope = 'card' | 'note';

/** The warning shown BEFORE anything happens (word for word what Jerome asked for). */
export const FORGET_WARNING =
  "This card goes back to New: its schedule restarts from scratch and it re-enters your new-card queue. Its review history is kept but no longer counts toward scheduling. Can't be undone except by Undo right now.";

/** FORGET_WARNING, or its plural when several cards are about to be forgotten. */
export function forgetWarning(count: number): string {
  if (count <= 1) return FORGET_WARNING;
  return `These ${count} cards go back to New: their schedules restart from scratch and they re-enter your new-card queue. Their review history is kept but no longer counts toward scheduling. Can't be undone except by Undo right now.`;
}

export function forgetTitle(scope: ForgetScope, count: number): string {
  if (scope === 'card' || count <= 1) return 'Forget this card?';
  return `Forget all ${count} cards of this word?`;
}

export function forgetButton(count: number): string {
  return count <= 1 ? '↺ Forget card' : `↺ Forget ${count} cards`;
}

/** The toast after forgetting (with an Undo button beside it). */
export function forgetMessage(count: number): string {
  return count <= 1 ? 'Card reset to New.' : `${count} cards reset to New.`;
}

export function undoForgetMessage(count: number): string {
  return count <= 1 ? 'Forget undone — the card is back as it was.' : `Forget undone — ${count} cards are back as they were.`;
}

/** How a forget shows in the note's history. */
export const FORGET_HISTORY_LABEL = '↺ Forgotten — back to New';
