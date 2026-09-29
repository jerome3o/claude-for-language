/**
 * Study has no "sessions" any more: today's queue IS the session (it is always rebuilt from
 * today's review events), so leaving Study never ends anything. What leaving must not lose is
 * the card that was on screen — possibly already revealed, with a typed answer or a recording
 * on it. The study screen saves a resume point whenever that card's state changes and, when
 * Study opens again, shows that card first (still revealed, same answer) — as long as it is
 * the same day, the same deck scope, and the card is still due in today's queue (a sync may
 * have brought in its review from another device, or the day rolled over).
 *
 * Pure; the Lab app's port (core/StudyResume.kt) is parity-tested against it. docs/STUDY_SESSION.md.
 */

export interface StudyResumePoint {
  /** Local date (YYYY-MM-DD) the point was saved on. */
  day: string;
  /** The deck the study screen was opened for, or 'all'. */
  scope: string;
  card_id: string;
  /** The answer side had been shown (the ratings were up). */
  revealed: boolean;
  /** What was typed ('' = nothing). */
  answer: string;
  /** Time spent on the card before leaving (the review's time_spent_ms continues from it). */
  elapsed_ms: number;
}

/** The scope key for a deck id (undefined / null = all decks). */
export function studyScope(deckId: string | null | undefined): string {
  return deckId ? deckId : 'all';
}

/**
 * The card to show first when Study opens: the saved card if it is still due today in this
 * scope, else null (pick as usual).
 */
export function resumeCardId(
  point: StudyResumePoint | null | undefined,
  day: string,
  scope: string,
  queueCardIds: readonly string[],
): string | null {
  if (!point || point.day !== day || point.scope !== scope) return null;
  return queueCardIds.includes(point.card_id) ? point.card_id : null;
}

/** Elapsed time to carry over (never negative, never more than an hour — a card left open all day isn't 8 h of work). */
export const RESUME_MAX_ELAPSED_MS = 3_600_000;
export function resumeElapsedMs(point: StudyResumePoint | null | undefined): number {
  const ms = point?.elapsed_ms ?? 0;
  if (!(ms > 0)) return 0;
  return Math.min(Math.round(ms), RESUME_MAX_ELAPSED_MS);
}
