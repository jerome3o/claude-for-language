/**
 * The finish is still celebrated (confetti, fanfare, haptics) — but for emptying TODAY's
 * queue, not for "ending a session". Once per day: opening Study again later with nothing
 * due shows the quiet "All done" screen. If more cards become due later that day (learning
 * steps, a tutor's homework, Study more) and those are cleared too, that is a new finish and
 * it is celebrated again — detected by today's review count having grown since the last
 * celebration (so an Undo followed by the same rating doesn't count twice).
 *
 * Pure; the Lab app's port (core/Celebration.kt) is parity-tested against it. docs/STUDY_SESSION.md.
 */

export interface CelebrationMark {
  /** Local date (YYYY-MM-DD) of the last celebration. */
  day: string;
  /** Today's review count at that moment. */
  reviews: number;
}

export function shouldCelebrate(
  mark: CelebrationMark | null | undefined,
  day: string,
  reviewsToday: number,
  queueEmpty: boolean,
): boolean {
  if (!queueEmpty || !(reviewsToday > 0)) return false;
  if (!mark || mark.day !== day) return true;
  return reviewsToday > mark.reviews;
}

export function celebrationMark(day: string, reviewsToday: number): CelebrationMark {
  return { day, reviews: reviewsToday };
}
