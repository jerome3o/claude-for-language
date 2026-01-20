/**
 * Event-Sourced Card State Computation
 *
 * This module provides a pure, deterministic function to compute card state
 * from a sequence of review events. This is the source of truth for card
 * scheduling - the same inputs will always produce the same outputs.
 *
 * Used by both frontend (offline study) and worker (server-side validation).
 */

// ============ Types ============

export type Rating = 0 | 1 | 2 | 3; // 0=again, 1=hard, 2=good, 3=easy

export enum CardQueue {
  NEW = 0,
  LEARNING = 1,
  REVIEW = 2,
  RELEARNING = 3,
}

export interface ReviewEvent {
  id: string;
  card_id: string;
  rating: Rating;
  reviewed_at: string; // ISO timestamp
}

export interface DeckSettings {
  learning_steps: number[];       // minutes
  graduating_interval: number;    // days
  easy_interval: number;          // days
  relearning_steps: number[];     // minutes
  starting_ease: number;          // e.g., 2.5
  minimum_ease: number;           // e.g., 1.3
  maximum_ease: number;           // e.g., 3.0
  interval_modifier: number;      // e.g., 1.0
  hard_multiplier: number;        // e.g., 1.2
  easy_bonus: number;             // e.g., 1.3
}

export interface ComputedCardState {
  queue: CardQueue;
  learning_step: number;
  ease_factor: number;
  interval: number;          // days (0 for learning/relearning)
  repetitions: number;
  next_review_at: string | null;    // ISO string for review cards
  due_timestamp: number | null;     // Unix ms for learning/relearning cards
}

export interface CardCheckpoint {
  card_id: string;
  checkpoint_at: string;        // ISO timestamp of last event included
  event_count: number;          // Number of events processed
  state: ComputedCardState;
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
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

// ============ Initial State ============

/**
 * Creates the initial state for a new card (never reviewed).
 */
export function initialCardState(settings: DeckSettings = DEFAULT_DECK_SETTINGS): ComputedCardState {
  return {
    queue: CardQueue.NEW,
    learning_step: 0,
    ease_factor: settings.starting_ease,
    interval: 0,
    repetitions: 0,
    next_review_at: null,
    due_timestamp: null,
  };
}

// ============ State Application ============

/**
 * Apply a single review to the current state.
 * This is deterministic - same inputs always produce same outputs.
 *
 * @param state Current card state
 * @param rating User's rating (0-3)
 * @param settings Deck settings
 * @param reviewedAt When the review occurred (ISO string)
 * @returns New card state after the review
 */
export function applyReview(
  state: ComputedCardState,
  rating: Rating,
  settings: DeckSettings,
  reviewedAt: string
): ComputedCardState {
  const reviewTime = new Date(reviewedAt).getTime();

  switch (state.queue) {
    case CardQueue.NEW:
    case CardQueue.LEARNING:
      return applyLearningReview(state, rating, settings, reviewTime);

    case CardQueue.REVIEW:
      return applyReviewReview(state, rating, settings, reviewTime);

    case CardQueue.RELEARNING:
      return applyRelearningReview(state, rating, settings, reviewTime);

    default:
      throw new Error(`Invalid queue: ${state.queue}`);
  }
}

/**
 * Apply review to NEW or LEARNING card.
 */
function applyLearningReview(
  state: ComputedCardState,
  rating: Rating,
  settings: DeckSettings,
  reviewTime: number
): ComputedCardState {
  const learningSteps = settings.learning_steps;
  const currentStep = state.learning_step;

  switch (rating) {
    case 0: // Again - go back to first step
      return {
        queue: CardQueue.LEARNING,
        learning_step: 0,
        ease_factor: state.ease_factor,
        interval: 0,
        repetitions: 0,
        due_timestamp: reviewTime + learningSteps[0] * 60 * 1000,
        next_review_at: null,
      };

    case 1: // Hard - stay at current step, slightly longer delay
      const hardDelay = currentStep < learningSteps.length
        ? Math.round((learningSteps[currentStep] + (learningSteps[Math.min(currentStep + 1, learningSteps.length - 1)])) / 2)
        : learningSteps[learningSteps.length - 1];
      return {
        queue: CardQueue.LEARNING,
        learning_step: currentStep,
        ease_factor: state.ease_factor,
        interval: 0,
        repetitions: 0,
        due_timestamp: reviewTime + hardDelay * 60 * 1000,
        next_review_at: null,
      };

    case 2: // Good - advance to next step or graduate
      const nextStep = currentStep + 1;
      if (nextStep >= learningSteps.length) {
        // Graduate to review queue
        const nextReviewDate = new Date(reviewTime);
        nextReviewDate.setDate(nextReviewDate.getDate() + settings.graduating_interval);
        return {
          queue: CardQueue.REVIEW,
          learning_step: 0,
          ease_factor: state.ease_factor,
          interval: settings.graduating_interval,
          repetitions: 1,
          due_timestamp: null,
          next_review_at: nextReviewDate.toISOString(),
        };
      } else {
        // Move to next learning step
        return {
          queue: CardQueue.LEARNING,
          learning_step: nextStep,
          ease_factor: state.ease_factor,
          interval: 0,
          repetitions: 0,
          due_timestamp: reviewTime + learningSteps[nextStep] * 60 * 1000,
          next_review_at: null,
        };
      }

    case 3: // Easy - graduate immediately with easy interval
      const easyReviewDate = new Date(reviewTime);
      easyReviewDate.setDate(easyReviewDate.getDate() + settings.easy_interval);
      return {
        queue: CardQueue.REVIEW,
        learning_step: 0,
        ease_factor: clampEase(state.ease_factor + 0.15, settings),
        interval: settings.easy_interval,
        repetitions: 1,
        due_timestamp: null,
        next_review_at: easyReviewDate.toISOString(),
      };

    default:
      throw new Error(`Invalid rating: ${rating}`);
  }
}

/**
 * Apply review to REVIEW card.
 */
function applyReviewReview(
  state: ComputedCardState,
  rating: Rating,
  settings: DeckSettings,
  reviewTime: number
): ComputedCardState {
  let easeFactor = state.ease_factor;
  let interval: number;
  let repetitions = state.repetitions;

  const applyModifier = (days: number) => Math.max(1, Math.round(days * settings.interval_modifier));

  switch (rating) {
    case 0: // Again - enter relearning queue
      easeFactor = clampEase(easeFactor - 0.2, settings);
      const relearningSteps = settings.relearning_steps;
      return {
        queue: CardQueue.RELEARNING,
        learning_step: 0,
        ease_factor: easeFactor,
        interval: 1, // Reset to 1 day like Anki's default
        repetitions: 0,
        due_timestamp: reviewTime + relearningSteps[0] * 60 * 1000,
        next_review_at: null,
      };

    case 1: // Hard - interval * hard_multiplier, ease -15%
      easeFactor = clampEase(easeFactor - 0.15, settings);
      interval = applyModifier(Math.round(state.interval * settings.hard_multiplier));
      repetitions += 1;
      break;

    case 2: // Good - interval * easeFactor
      interval = applyModifier(Math.round(state.interval * easeFactor));
      repetitions += 1;
      break;

    case 3: // Easy - interval * easeFactor * easy_bonus, ease +15%
      easeFactor = clampEase(easeFactor + 0.15, settings);
      interval = applyModifier(Math.round(state.interval * easeFactor * settings.easy_bonus));
      repetitions += 1;
      break;

    default:
      throw new Error(`Invalid rating: ${rating}`);
  }

  const nextReviewDate = new Date(reviewTime);
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  return {
    queue: CardQueue.REVIEW,
    learning_step: 0,
    ease_factor: easeFactor,
    interval,
    repetitions,
    due_timestamp: null,
    next_review_at: nextReviewDate.toISOString(),
  };
}

/**
 * Apply review to RELEARNING card.
 */
function applyRelearningReview(
  state: ComputedCardState,
  rating: Rating,
  settings: DeckSettings,
  reviewTime: number
): ComputedCardState {
  const relearningSteps = settings.relearning_steps;
  const currentStep = state.learning_step;

  switch (rating) {
    case 0: // Again - back to first relearning step
      return {
        queue: CardQueue.RELEARNING,
        learning_step: 0,
        ease_factor: state.ease_factor,
        interval: state.interval,
        repetitions: 0,
        due_timestamp: reviewTime + relearningSteps[0] * 60 * 1000,
        next_review_at: null,
      };

    case 1: // Hard - stay at current step
      const hardDelay = currentStep < relearningSteps.length
        ? relearningSteps[currentStep]
        : relearningSteps[relearningSteps.length - 1];
      return {
        queue: CardQueue.RELEARNING,
        learning_step: currentStep,
        ease_factor: state.ease_factor,
        interval: state.interval,
        repetitions: 0,
        due_timestamp: reviewTime + hardDelay * 60 * 1000,
        next_review_at: null,
      };

    case 2: // Good - advance or graduate back to review
    case 3: // Easy - same as good for relearning
      const nextStep = currentStep + 1;
      if (nextStep >= relearningSteps.length) {
        // Graduate back to review queue
        const nextReviewDate = new Date(reviewTime);
        nextReviewDate.setDate(nextReviewDate.getDate() + state.interval);
        return {
          queue: CardQueue.REVIEW,
          learning_step: 0,
          ease_factor: state.ease_factor,
          interval: state.interval,
          repetitions: 1,
          due_timestamp: null,
          next_review_at: nextReviewDate.toISOString(),
        };
      } else {
        return {
          queue: CardQueue.RELEARNING,
          learning_step: nextStep,
          ease_factor: state.ease_factor,
          interval: state.interval,
          repetitions: 0,
          due_timestamp: reviewTime + relearningSteps[nextStep] * 60 * 1000,
          next_review_at: null,
        };
      }

    default:
      throw new Error(`Invalid rating: ${rating}`);
  }
}

// ============ Helper Functions ============

/**
 * Clamp ease factor within settings bounds.
 */
function clampEase(ease: number, settings: DeckSettings): number {
  return Math.max(settings.minimum_ease, Math.min(settings.maximum_ease, ease));
}

// ============ Main Computation ============

/**
 * Compute the current card state from a sequence of review events.
 *
 * This is the MAIN function for event-sourced state computation.
 * It is DETERMINISTIC - the same events will always produce the same state.
 *
 * @param events Review events sorted by reviewed_at (ascending)
 * @param settings Deck settings
 * @param checkpoint Optional checkpoint to start from (for performance)
 * @returns Computed card state
 */
export function computeCardState(
  events: ReviewEvent[],
  settings: DeckSettings = DEFAULT_DECK_SETTINGS,
  checkpoint?: CardCheckpoint
): ComputedCardState {
  // Start from checkpoint or initial NEW state
  let state = checkpoint?.state ?? initialCardState(settings);

  // Find the starting index - events after checkpoint
  let startIdx = 0;
  if (checkpoint) {
    startIdx = events.findIndex(e => e.reviewed_at > checkpoint.checkpoint_at);
    if (startIdx === -1) {
      // All events are before or at checkpoint, state is current
      return state;
    }
  }

  // Replay each event to compute final state
  for (let i = startIdx; i < events.length; i++) {
    const event = events[i];
    state = applyReview(state, event.rating, settings, event.reviewed_at);
  }

  return state;
}

/**
 * Create a checkpoint from the current state.
 * Checkpoints allow efficient incremental computation.
 */
export function createCheckpoint(
  cardId: string,
  state: ComputedCardState,
  lastEvent: ReviewEvent,
  eventCount: number
): CardCheckpoint {
  return {
    card_id: cardId,
    checkpoint_at: lastEvent.reviewed_at,
    event_count: eventCount,
    state: { ...state },
  };
}

/**
 * Check if a checkpoint is stale (has new events since checkpoint).
 */
export function isCheckpointStale(
  checkpoint: CardCheckpoint,
  latestEventAt: string | null
): boolean {
  if (!latestEventAt) return false; // No events, checkpoint is current
  return latestEventAt > checkpoint.checkpoint_at;
}

// ============ Utility Functions ============

/**
 * Parse learning steps from space-separated string (DB format).
 */
export function parseLearningSteps(stepsStr: string): number[] {
  return stepsStr.split(' ').map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
}

/**
 * Convert DB deck settings (percentages) to scheduler format (decimals).
 */
export function deckSettingsFromDb(deck: {
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
 * Format interval for display.
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
