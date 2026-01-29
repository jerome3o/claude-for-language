import { Rating, CardQueue } from '../types';

/**
 * Anki-style Spaced Repetition Scheduler
 *
 * Implements learning steps for new cards and proper interval scheduling
 * based on Anki's algorithm. This is a port of worker/src/services/anki-scheduler.ts
 * to run client-side for offline study support.
 */

export interface DeckSettings {
  new_cards_per_day: number;
  learning_steps: number[];      // minutes
  graduating_interval: number;   // days
  easy_interval: number;         // days
  relearning_steps: number[];    // minutes
  starting_ease: number;         // e.g., 2.5 (stored as 250 in DB)
  minimum_ease: number;          // e.g., 1.3 (stored as 130 in DB)
  maximum_ease: number;          // e.g., 3.0 (stored as 300 in DB)
  interval_modifier: number;     // e.g., 1.0 (stored as 100 in DB)
  hard_multiplier: number;       // e.g., 1.2 (stored as 120 in DB)
  easy_bonus: number;            // e.g., 1.3 (stored as 130 in DB)
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  new_cards_per_day: 30,
  learning_steps: [1, 10],       // 1 min, 10 min
  graduating_interval: 1,        // 1 day
  easy_interval: 4,              // 4 days
  relearning_steps: [1],         // 1 min
  starting_ease: 2.5,            // 250%
  minimum_ease: 1.3,             // 130%
  maximum_ease: 3.0,             // 300%
  interval_modifier: 1.0,        // 100%
  hard_multiplier: 1.2,          // 120%
  easy_bonus: 1.3,               // 130%
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
 * Convert DB deck settings (percentages) to scheduler format (decimals)
 */
export function deckSettingsFromDb(deck: {
  new_cards_per_day: number;
  learning_steps: string;
  graduating_interval: number;
  easy_interval: number;
  relearning_steps: string;
  starting_ease: number;
  minimum_ease: number;
  maximum_ease: number;
  interval_modifier: number;
  hard_multiplier: number;
  easy_bonus: number;
}): DeckSettings {
  return {
    new_cards_per_day: deck.new_cards_per_day,
    learning_steps: parseLearningSteps(deck.learning_steps),
    graduating_interval: deck.graduating_interval,
    easy_interval: deck.easy_interval,
    relearning_steps: parseLearningSteps(deck.relearning_steps),
    starting_ease: deck.starting_ease / 100,
    minimum_ease: deck.minimum_ease / 100,
    maximum_ease: deck.maximum_ease / 100,
    interval_modifier: deck.interval_modifier / 100,
    hard_multiplier: deck.hard_multiplier / 100,
    easy_bonus: deck.easy_bonus / 100,
  };
}

/**
 * Format interval for display
 * @param minutes - interval in minutes
 * @param useLessThan - if true, show "<10m" style for short intervals (like Anki)
 */
export function formatInterval(minutes: number, useLessThan: boolean = false): string {
  // For learning cards, Anki shows "<10m" style
  if (useLessThan && minutes < 10) {
    return '<10m';
  }
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
        ease_factor: Math.min(settings.maximum_ease, currentEaseFactor + 0.15), // Bonus ease for easy
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
 *
 * Key improvement: Ensures minimum separation between Hard/Good/Easy intervals
 * to avoid the situation where rounding causes identical intervals.
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

  // Helper to clamp ease factor within bounds
  const clampEase = (ease: number) => Math.max(settings.minimum_ease, Math.min(settings.maximum_ease, ease));

  // Helper to apply interval modifier
  const applyModifier = (days: number) => Math.max(1, Math.round(days * settings.interval_modifier));

  switch (rating) {
    case 0: // Again - enter relearning queue
      easeFactor = clampEase(easeFactor - 0.2);
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

    case 1: // Hard - interval * hard_multiplier, ease -15%
      easeFactor = clampEase(easeFactor - 0.15);
      interval = applyModifier(Math.round(currentInterval * settings.hard_multiplier));
      // Hard should be at least current interval + 1 day
      if (interval <= currentInterval) {
        interval = currentInterval + 1;
      }
      repetitions += 1;
      break;

    case 2: { // Good - interval * easeFactor
      // Calculate what Hard would be
      const hardInterval = Math.max(
        applyModifier(Math.round(currentInterval * settings.hard_multiplier)),
        currentInterval + 1
      );
      interval = applyModifier(Math.round(currentInterval * easeFactor));
      // Good should be at least Hard + 1 day
      if (interval <= hardInterval) {
        interval = hardInterval + 1;
      }
      repetitions += 1;
      break;
    }

    case 3: { // Easy - interval * easeFactor * easy_bonus, ease +15%
      easeFactor = clampEase(easeFactor + 0.15);
      // Calculate what Good would be (before ease bonus)
      const hardInterval = Math.max(
        applyModifier(Math.round(currentInterval * settings.hard_multiplier)),
        currentInterval + 1
      );
      const goodInterval = Math.max(
        applyModifier(Math.round(currentInterval * currentEaseFactor)), // use original ease
        hardInterval + 1
      );
      interval = applyModifier(Math.round(currentInterval * easeFactor * settings.easy_bonus));
      // Easy should be at least Good + 1 day
      if (interval <= goodInterval) {
        interval = goodInterval + 1;
      }
      repetitions += 1;
      break;
    }

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
 *
 * Key improvements over basic SM-2:
 * 1. "Again" shows "<10m" like Anki for friendlier UX
 * 2. Ensures minimum gap between Hard/Good/Easy to avoid identical intervals
 * 3. Hard interval accounts for current interval more reasonably
 */
export function getIntervalPreview(
  rating: Rating,
  currentQueue: CardQueue,
  currentStep: number,
  currentEaseFactor: number,
  currentInterval: number,
  _currentRepetitions: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): IntervalPreview {
  // For new/learning cards, show the learning step times
  if (currentQueue === CardQueue.NEW || currentQueue === CardQueue.LEARNING) {
    const learningSteps = settings.learning_steps;

    switch (rating) {
      case 0: // Again - show <10m like Anki
        return { intervalText: '<10m', queue: CardQueue.LEARNING };
      case 1: // Hard
        const hardDelay = currentStep < learningSteps.length
          ? Math.round((learningSteps[currentStep] + (learningSteps[Math.min(currentStep + 1, learningSteps.length - 1)])) / 2)
          : learningSteps[learningSteps.length - 1];
        return { intervalText: formatInterval(hardDelay, true), queue: CardQueue.LEARNING };
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

  // For review cards - compute intervals with proper spacing
  if (currentQueue === CardQueue.REVIEW) {
    const applyModifier = (days: number) => Math.max(1, Math.round(days * settings.interval_modifier));

    // Calculate raw intervals
    const hardIntervalRaw = currentInterval * settings.hard_multiplier;
    const goodIntervalRaw = currentInterval * currentEaseFactor;
    const easyIntervalRaw = currentInterval * currentEaseFactor * settings.easy_bonus;

    // Apply modifier and round
    let hardInterval = applyModifier(Math.round(hardIntervalRaw));
    let goodInterval = applyModifier(Math.round(goodIntervalRaw));
    let easyInterval = applyModifier(Math.round(easyIntervalRaw));

    // Ensure minimum separation between intervals (like Anki)
    // Hard should be at least current interval (or 1 day more if same)
    if (hardInterval <= currentInterval) {
      hardInterval = currentInterval + 1;
    }
    // Good should be at least 1 day more than Hard
    if (goodInterval <= hardInterval) {
      goodInterval = hardInterval + 1;
    }
    // Easy should be at least 1 day more than Good
    if (easyInterval <= goodInterval) {
      easyInterval = goodInterval + 1;
    }

    switch (rating) {
      case 0: // Again - show <10m like Anki
        return { intervalText: '<10m', queue: CardQueue.RELEARNING };
      case 1: // Hard
        return { intervalText: formatInterval(hardInterval * 1440), queue: CardQueue.REVIEW };
      case 2: // Good
        return { intervalText: formatInterval(goodInterval * 1440), queue: CardQueue.REVIEW };
      case 3: // Easy
        return { intervalText: formatInterval(easyInterval * 1440), queue: CardQueue.REVIEW };
    }
  }

  // For relearning cards
  if (currentQueue === CardQueue.RELEARNING) {
    const relearningSteps = settings.relearning_steps;

    switch (rating) {
      case 0: // Again - show <10m like Anki
        return { intervalText: '<10m', queue: CardQueue.RELEARNING };
      case 1: // Hard
        const hardDelay = relearningSteps[Math.min(currentStep, relearningSteps.length - 1)];
        return { intervalText: formatInterval(hardDelay, true), queue: CardQueue.RELEARNING };
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
