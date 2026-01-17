import { Rating } from '../types';

/**
 * SM-2 Spaced Repetition Algorithm (Frontend version for interval preview)
 *
 * Based on the SuperMemo 2 algorithm used by Anki and other SRS systems.
 */

export interface SM2Preview {
  interval: number; // Days until next review
  intervalText: string; // Human-readable interval (e.g., "1.2mo")
}

/**
 * Calculate what the new interval would be for a given rating
 * Used to preview intervals on rating buttons (Anki-style)
 */
export function previewSM2Interval(
  rating: Rating,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number
): SM2Preview {
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

  // For "Again" (rating 0), show a shorter interval like Anki does
  // Anki typically shows "< 10 min" for Again
  if (rating === 0) {
    return {
      interval: 0, // Same session
      intervalText: '< 10m',
    };
  }

  // For "Hard" (rating 1), typically shows 1 day or keeps it short
  if (rating === 1) {
    return {
      interval: 1,
      intervalText: '1d',
    };
  }

  return {
    interval,
    intervalText: formatInterval(interval),
  };
}

/**
 * Format interval in days to human-readable string
 * Similar to Anki's interval display
 */
export function formatInterval(days: number): string {
  if (days < 1) {
    return '< 1d';
  }

  if (days === 1) {
    return '1d';
  }

  if (days < 7) {
    return `${days}d`;
  }

  if (days < 30) {
    const weeks = days / 7;
    if (weeks === Math.floor(weeks)) {
      return `${weeks}w`;
    }
    return `${weeks.toFixed(1)}w`;
  }

  if (days < 365) {
    const months = days / 30;
    if (months === Math.floor(months)) {
      return `${months}mo`;
    }
    return `${months.toFixed(1)}mo`;
  }

  const years = days / 365;
  if (years === Math.floor(years)) {
    return `${years}y`;
  }
  return `${years.toFixed(1)}y`;
}

/**
 * Get all interval previews for a card
 * Returns previews for all 4 ratings
 */
export function getAllIntervalPreviews(
  easeFactor: number,
  interval: number,
  repetitions: number
): Record<Rating, SM2Preview> {
  return {
    0: previewSM2Interval(0, easeFactor, interval, repetitions),
    1: previewSM2Interval(1, easeFactor, interval, repetitions),
    2: previewSM2Interval(2, easeFactor, interval, repetitions),
    3: previewSM2Interval(3, easeFactor, interval, repetitions),
  };
}
