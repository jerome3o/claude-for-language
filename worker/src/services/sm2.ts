import { Rating } from '../types';

export interface SM2Result {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: Date;
}

/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Based on the SuperMemo 2 algorithm used by Anki and other SRS systems.
 *
 * @param rating - User's rating (0=again, 1=hard, 2=good, 3=easy)
 * @param currentEaseFactor - Current ease factor (starts at 2.5)
 * @param currentInterval - Current interval in days
 * @param currentRepetitions - Number of successful repetitions
 * @returns New SM-2 values
 */
export function calculateSM2(
  rating: Rating,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number
): SM2Result {
  let easeFactor = currentEaseFactor;
  let interval: number;
  let repetitions: number;

  if (rating < 2) {
    // Failed (again or hard) - reset to beginning
    repetitions = 0;
    interval = 1;
  } else {
    // Passed (good or easy)
    repetitions = currentRepetitions + 1;

    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.round(currentInterval * easeFactor);
    }

    // Easy gives a bonus
    if (rating === 3) {
      interval = Math.round(interval * 1.3);
    }
  }

  // Adjust ease factor based on rating
  // Formula: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
  // Where q is rating mapped to 0-5 scale (we use 0-3, so adjust)
  const q = rating + 1; // Map 0-3 to 1-4 for calculation
  easeFactor = easeFactor + (0.1 - (4 - q) * (0.08 + (4 - q) * 0.02));

  // Minimum ease factor is 1.3
  easeFactor = Math.max(1.3, easeFactor);

  // Calculate next review date
  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  return {
    easeFactor,
    interval,
    repetitions,
    nextReviewAt,
  };
}

/**
 * Get cards that are due for review
 * A card is due if next_review_at is null (new) or <= now
 */
export function isDue(nextReviewAt: string | null): boolean {
  if (!nextReviewAt) {
    return true; // New card
  }
  return new Date(nextReviewAt) <= new Date();
}

/**
 * Get the rating name for display
 */
export function getRatingName(rating: Rating): string {
  const names: Record<Rating, string> = {
    0: 'Again',
    1: 'Hard',
    2: 'Good',
    3: 'Easy',
  };
  return names[rating];
}
