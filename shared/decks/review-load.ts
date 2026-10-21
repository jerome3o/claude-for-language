/**
 * "Pause new cards on heavy days" — a review-load cap on the ONE daily new-card
 * budget (budget.ts). A learner who already has plenty to review sets a limit
 * ("when more than 100 reviews are due"); on a day whose review load is over it,
 * today's budget is 0 new words + 0 extra cards — only the reviews. The next day,
 * with fewer due, the configured budget comes back.
 *
 * Today's review load = cards past NEW (learning / review / relearning) due by the
 * cutoff — the "due today" definition of study-queue.ts — PLUS the cards already
 * reviewed today, so the number does NOT fall as he works through them: a card
 * that was due this morning and is now scheduled for next week still counts. A card
 * whose first-ever review is today never counts (a new card's learning steps are
 * not reviews). An early review of a card that was not due (a ⚡ bump's early
 * review) counts from then on, like any card reviewed today.
 *
 * Unaffected by the pause: ⚡ bumps (outside the budget), homework passes, lessons /
 * readers, learning / review cards, and the new cards already introduced today (their
 * learning steps go on). "Up next" draws from the budget, so it waits too. "Study
 * more" (+10 bonus) still adds new cards — the manual override.
 *
 * Pure; the web app (frontend/src/db/database.ts loadStudyInputs) and the Lab app
 * (core/…/ReviewLoad.kt, parity-tested by android-lab/parity/fixtures/review-load.ts)
 * feed it their local cards + review events. The tutor's student card computes the
 * same rule over the server's card rows (worker services/review-load.ts).
 */
import type { StudyBudget } from './budget';

/** CardQueue NEW (shared/scheduler). */
const QUEUE_NEW = 0;

/** The setting's range ("when more than [100] reviews are due"); null = off. */
export const REVIEW_LOAD_CAP_MIN = 10;
export const REVIEW_LOAD_CAP_MAX = 1000;
/** What the field offers when the switch goes on (Jerome asked for "over 100"). */
export const REVIEW_LOAD_CAP_SUGGESTED = 100;

export interface ReviewLoadCard {
  id: string;
  queue: number;
  /** As QueueCardInput.due_ms: when the card is due (epoch ms); null = due now. Ignored for NEW cards. */
  due_ms: number | null;
}

/**
 * Today's review load (see the file comment). `reviewedToday`: ids of cards with a
 * review at / after `dayStartMs`; `firstReviewAt`: each card's first-ever review (only
 * the cards in `reviewedToday` are read — a card due but not reviewed today was first
 * reviewed before today, or has no events and counts).
 */
export function reviewLoadToday(
  cards: Iterable<ReviewLoadCard>,
  reviewedToday: ReadonlySet<string>,
  firstReviewAt: ReadonlyMap<string, number>,
  dayStartMs: number,
  cutoffMs: number
): number {
  let load = 0;
  for (const c of cards) {
    if (c.queue === QUEUE_NEW) continue;
    const reviewed = reviewedToday.has(c.id);
    if (reviewed) {
      const first = firstReviewAt.get(c.id);
      if (first !== undefined && first >= dayStartMs) continue; // introduced today: learning steps
      load++;
    } else if (c.due_ms === null || c.due_ms <= cutoffMs) {
      load++;
    }
  }
  return load;
}

export interface ReviewLoadState {
  /** Today's review load (reviewLoadToday). */
  load: number;
  /** The account's limit (pause_new_when_reviews_over); null = off. */
  threshold: number | null;
  /** load > threshold: today's new-card budget is 0 + 0. */
  paused: boolean;
}

/** The state for a load and a limit: paused only when the limit is on and the load is OVER it. */
export function reviewLoadState(load: number, threshold: number | null | undefined): ReviewLoadState {
  const t = typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : null;
  return { load, threshold: t, paused: t !== null && load > t };
}

/** Today's budget: 0 new words + 0 extra cards while paused, else the configured one. */
export function budgetForToday(budget: StudyBudget, state: Pick<ReviewLoadState, 'paused'> | null | undefined): StudyBudget {
  return state?.paused ? { new_cards_per_day: 0, secondary_cards_per_day: 0 } : budget;
}

/** Home's line while paused: "New cards paused — 124 reviews due today (limit 100)"; null otherwise. */
export function pausedNewCardsLabel(state: ReviewLoadState | null | undefined): string | null {
  if (!state?.paused || state.threshold === null) return null;
  return `New cards paused — ${state.load} ${state.load === 1 ? 'review' : 'reviews'} due today (limit ${state.threshold})`;
}

/** The Up next page while paused: "Up next waits — new cards are paused today (124 reviews due, limit 100)."; null otherwise. */
export function upNextPausedLabel(state: ReviewLoadState | null | undefined): string | null {
  if (!state?.paused || state.threshold === null) return null;
  return `Up next waits — new cards are paused today (${state.load} ${state.load === 1 ? 'review' : 'reviews'} due, limit ${state.threshold}).`;
}

/** The line under it: what else waits and the way round it. */
export const PAUSED_NEW_CARDS_DETAIL = 'Up next waits too. ⚡ bumps and homework still come; Study 10 more adds new cards anyway.';

/** The tutor's line about the student's setting: "Pauses new cards on days with more than 100 reviews due"; null = off. */
export function reviewLoadCapSummary(threshold: number | null | undefined): string | null {
  if (typeof threshold !== 'number') return null;
  return `Pauses new cards on days with more than ${threshold} reviews due`;
}

/** The tutor's dashboard / student page while paused: "⏸ New cards paused today · 124 reviews due"; null otherwise. */
export function tutorPausedLabel(state: ReviewLoadState | null | undefined): string | null {
  if (!state?.paused) return null;
  return `⏸ New cards paused today · ${state.load} ${state.load === 1 ? 'review' : 'reviews'} due`;
}

/**
 * Validate the setting from an untrusted value: a whole number REVIEW_LOAD_CAP_MIN–MAX,
 * `null` = off. `undefined` (key absent) = leave it. Numeric strings are accepted like the budget's.
 */
export function pickReviewLoadCap(v: unknown): { value?: number | null; problem?: string } {
  if (v === undefined) return {};
  if (v === null) return { value: null };
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < REVIEW_LOAD_CAP_MIN || n > REVIEW_LOAD_CAP_MAX) {
    return { problem: `pause_new_when_reviews_over must be a whole number between ${REVIEW_LOAD_CAP_MIN} and ${REVIEW_LOAD_CAP_MAX}, or null (off)` };
  }
  return { value: n };
}
