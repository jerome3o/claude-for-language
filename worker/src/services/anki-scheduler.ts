import { Rating } from '../types';

/**
 * Anki-style Spaced Repetition Scheduler
 *
 * Implements learning steps for new cards and proper interval scheduling
 * based on Anki's algorithm.
 */

export enum CardQueue {
  NEW = 0,
  LEARNING = 1,
  REVIEW = 2,
  RELEARNING = 3,
}

export interface DeckSettings {
  new_cards_per_day: number;
  learning_steps: number[];      // minutes
  graduating_interval: number;   // days
  easy_interval: number;         // days
  relearning_steps: number[];    // minutes (default: [10])
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  new_cards_per_day: 20,
  learning_steps: [1, 10],       // 1 min, 10 min
  graduating_interval: 1,        // 1 day
  easy_interval: 4,              // 4 days
  relearning_steps: [10],        // 10 min
};

export interface SchedulerResult {
  queue: CardQueue;
  learning_step: number;
  ease_factor: number;
  interval: number;
  repetitions: number;
  due_timestamp: number | null;  // Unix ms for learning cards, null for review cards
  next_review_at: Date | null;   // Date for review cards
}

export interface IntervalPreview {
  intervalText: string;
  queue: CardQueue;
}

/**
 * Parse learning steps from space-separated string
 */
export function parseLearningSteps(stepsStr: string): number[] {
  return stepsStr.split(' ').map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
}

/**
 * Format interval for display
 */
export function formatInterval(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  if (minutes < 1440) { // less than 1 day
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  const days = Math.round(minutes / 1440);
  if (days < 7) {
    return `${days}d`;
  }
  if (days < 30) {
    const weeks = days / 7;
    return weeks === Math.floor(weeks) ? `${weeks}w` : `${weeks.toFixed(1)}w`;
  }
  if (days < 365) {
    const months = days / 30;
    return months === Math.floor(months) ? `${months}mo` : `${months.toFixed(1)}mo`;
  }
  const years = days / 365;
  return years === Math.floor(years) ? `${years}y` : `${years.toFixed(1)}y`;
}

/**
 * Calculate the next scheduling state for a NEW or LEARNING card
 */
export function scheduleNewOrLearningCard(
  rating: Rating,
  currentStep: number,
  currentEaseFactor: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): SchedulerResult {
  const learningSteps = settings.learning_steps;
  const now = Date.now();

  switch (rating) {
    case 0: // Again - go back to first step
      return {
        queue: CardQueue.LEARNING,
        learning_step: 0,
        ease_factor: currentEaseFactor,
        interval: 0,
        repetitions: 0,
        due_timestamp: now + learningSteps[0] * 60 * 1000,
        next_review_at: null,
      };

    case 1: // Hard - stay at current step, slightly longer delay
      const hardDelay = currentStep < learningSteps.length
        ? Math.round((learningSteps[currentStep] + (learningSteps[Math.min(currentStep + 1, learningSteps.length - 1)])) / 2)
        : learningSteps[learningSteps.length - 1];
      return {
        queue: CardQueue.LEARNING,
        learning_step: currentStep,
        ease_factor: currentEaseFactor,
        interval: 0,
        repetitions: 0,
        due_timestamp: now + hardDelay * 60 * 1000,
        next_review_at: null,
      };

    case 2: // Good - advance to next step or graduate
      const nextStep = currentStep + 1;
      if (nextStep >= learningSteps.length) {
        // Graduate to review queue
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + settings.graduating_interval);
        return {
          queue: CardQueue.REVIEW,
          learning_step: 0,
          ease_factor: currentEaseFactor,
          interval: settings.graduating_interval,
          repetitions: 1,
          due_timestamp: null,
          next_review_at: nextReview,
        };
      } else {
        // Move to next learning step
        return {
          queue: CardQueue.LEARNING,
          learning_step: nextStep,
          ease_factor: currentEaseFactor,
          interval: 0,
          repetitions: 0,
          due_timestamp: now + learningSteps[nextStep] * 60 * 1000,
          next_review_at: null,
        };
      }

    case 3: // Easy - graduate immediately with easy interval
      const easyReview = new Date();
      easyReview.setDate(easyReview.getDate() + settings.easy_interval);
      return {
        queue: CardQueue.REVIEW,
        learning_step: 0,
        ease_factor: currentEaseFactor + 0.15, // Bonus ease for easy
        interval: settings.easy_interval,
        repetitions: 1,
        due_timestamp: null,
        next_review_at: easyReview,
      };

    default:
      throw new Error(`Invalid rating: ${rating}`);
  }
}

/**
 * Calculate the next scheduling state for a REVIEW card
 */
export function scheduleReviewCard(
  rating: Rating,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): SchedulerResult {
  const now = Date.now();
  let easeFactor = currentEaseFactor;
  let interval: number;
  let repetitions = currentRepetitions;

  switch (rating) {
    case 0: // Again - enter relearning queue
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      const relearningSteps = settings.relearning_steps;
      return {
        queue: CardQueue.RELEARNING,
        learning_step: 0,
        ease_factor: easeFactor,
        interval: 1, // Reset to 1 day like Anki's default
        repetitions: 0,
        due_timestamp: now + relearningSteps[0] * 60 * 1000,
        next_review_at: null,
      };

    case 1: // Hard - interval * 1.2, ease -15%
      easeFactor = Math.max(1.3, easeFactor - 0.15);
      interval = Math.max(1, Math.round(currentInterval * 1.2));
      repetitions += 1;
      break;

    case 2: // Good - interval * easeFactor
      interval = Math.max(1, Math.round(currentInterval * easeFactor));
      repetitions += 1;
      break;

    case 3: // Easy - interval * easeFactor * 1.3, ease +15%
      easeFactor = Math.min(3.0, easeFactor + 0.15);
      interval = Math.max(1, Math.round(currentInterval * easeFactor * 1.3));
      repetitions += 1;
      break;

    default:
      throw new Error(`Invalid rating: ${rating}`);
  }

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  return {
    queue: CardQueue.REVIEW,
    learning_step: 0,
    ease_factor: easeFactor,
    interval,
    repetitions,
    due_timestamp: null,
    next_review_at: nextReview,
  };
}

/**
 * Calculate the next scheduling state for a RELEARNING card
 */
export function scheduleRelearningCard(
  rating: Rating,
  currentStep: number,
  currentEaseFactor: number,
  currentInterval: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): SchedulerResult {
  const now = Date.now();
  const relearningSteps = settings.relearning_steps;

  switch (rating) {
    case 0: // Again - back to first relearning step
      return {
        queue: CardQueue.RELEARNING,
        learning_step: 0,
        ease_factor: currentEaseFactor,
        interval: currentInterval,
        repetitions: 0,
        due_timestamp: now + relearningSteps[0] * 60 * 1000,
        next_review_at: null,
      };

    case 1: // Hard - stay at current step
      const hardDelay = currentStep < relearningSteps.length
        ? relearningSteps[currentStep]
        : relearningSteps[relearningSteps.length - 1];
      return {
        queue: CardQueue.RELEARNING,
        learning_step: currentStep,
        ease_factor: currentEaseFactor,
        interval: currentInterval,
        repetitions: 0,
        due_timestamp: now + hardDelay * 60 * 1000,
        next_review_at: null,
      };

    case 2: // Good - advance or graduate back to review
    case 3: // Easy - same as good for relearning
      const nextStep = currentStep + 1;
      if (nextStep >= relearningSteps.length) {
        // Graduate back to review queue
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + currentInterval);
        return {
          queue: CardQueue.REVIEW,
          learning_step: 0,
          ease_factor: currentEaseFactor,
          interval: currentInterval,
          repetitions: 1,
          due_timestamp: null,
          next_review_at: nextReview,
        };
      } else {
        return {
          queue: CardQueue.RELEARNING,
          learning_step: nextStep,
          ease_factor: currentEaseFactor,
          interval: currentInterval,
          repetitions: 0,
          due_timestamp: now + relearningSteps[nextStep] * 60 * 1000,
          next_review_at: null,
        };
      }

    default:
      throw new Error(`Invalid rating: ${rating}`);
  }
}

/**
 * Main scheduling function - dispatches to the appropriate scheduler based on queue
 */
export function scheduleCard(
  rating: Rating,
  currentQueue: CardQueue,
  currentStep: number,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): SchedulerResult {
  switch (currentQueue) {
    case CardQueue.NEW:
    case CardQueue.LEARNING:
      return scheduleNewOrLearningCard(rating, currentStep, currentEaseFactor, settings);

    case CardQueue.REVIEW:
      return scheduleReviewCard(rating, currentEaseFactor, currentInterval, currentRepetitions, settings);

    case CardQueue.RELEARNING:
      return scheduleRelearningCard(rating, currentStep, currentEaseFactor, currentInterval, settings);

    default:
      throw new Error(`Invalid queue: ${currentQueue}`);
  }
}

/**
 * Get interval preview for display on rating buttons
 */
export function getIntervalPreview(
  rating: Rating,
  currentQueue: CardQueue,
  currentStep: number,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): IntervalPreview {
  // For new/learning cards, show the learning step times
  if (currentQueue === CardQueue.NEW || currentQueue === CardQueue.LEARNING) {
    const learningSteps = settings.learning_steps;

    switch (rating) {
      case 0: // Again
        return { intervalText: `${learningSteps[0]}m`, queue: CardQueue.LEARNING };
      case 1: // Hard
        const hardDelay = currentStep < learningSteps.length
          ? Math.round((learningSteps[currentStep] + (learningSteps[Math.min(currentStep + 1, learningSteps.length - 1)])) / 2)
          : learningSteps[learningSteps.length - 1];
        return { intervalText: `${hardDelay}m`, queue: CardQueue.LEARNING };
      case 2: // Good
        const nextStep = currentStep + 1;
        if (nextStep >= learningSteps.length) {
          return { intervalText: `${settings.graduating_interval}d`, queue: CardQueue.REVIEW };
        }
        return { intervalText: `${learningSteps[nextStep]}m`, queue: CardQueue.LEARNING };
      case 3: // Easy
        return { intervalText: `${settings.easy_interval}d`, queue: CardQueue.REVIEW };
    }
  }

  // For review cards
  if (currentQueue === CardQueue.REVIEW) {
    switch (rating) {
      case 0: // Again
        return { intervalText: `${settings.relearning_steps[0]}m`, queue: CardQueue.RELEARNING };
      case 1: // Hard
        const hardInterval = Math.max(1, Math.round(currentInterval * 1.2));
        return { intervalText: formatInterval(hardInterval * 1440), queue: CardQueue.REVIEW };
      case 2: // Good
        const goodInterval = Math.max(1, Math.round(currentInterval * currentEaseFactor));
        return { intervalText: formatInterval(goodInterval * 1440), queue: CardQueue.REVIEW };
      case 3: // Easy
        const easyInterval = Math.max(1, Math.round(currentInterval * currentEaseFactor * 1.3));
        return { intervalText: formatInterval(easyInterval * 1440), queue: CardQueue.REVIEW };
    }
  }

  // For relearning cards
  if (currentQueue === CardQueue.RELEARNING) {
    const relearningSteps = settings.relearning_steps;

    switch (rating) {
      case 0: // Again
        return { intervalText: `${relearningSteps[0]}m`, queue: CardQueue.RELEARNING };
      case 1: // Hard
        const hardDelay = relearningSteps[Math.min(currentStep, relearningSteps.length - 1)];
        return { intervalText: `${hardDelay}m`, queue: CardQueue.RELEARNING };
      case 2: // Good
      case 3: // Easy
        const nextStep = currentStep + 1;
        if (nextStep >= relearningSteps.length) {
          return { intervalText: formatInterval(currentInterval * 1440), queue: CardQueue.REVIEW };
        }
        return { intervalText: `${relearningSteps[nextStep]}m`, queue: CardQueue.RELEARNING };
    }
  }

  // Fallback
  return { intervalText: '?', queue: currentQueue };
}
