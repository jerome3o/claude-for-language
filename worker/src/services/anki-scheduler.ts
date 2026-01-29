/**
 * FSRS-based Spaced Repetition Scheduler
 *
 * This module wraps the shared FSRS scheduler for use in the worker.
 * All scheduling logic is in @chinese-learning/shared/scheduler.
 */

import {
  CardQueue,
  type Rating,
  type DeckSettings,
  type ComputedCardState,
  DEFAULT_DECK_SETTINGS,
  initialCardState,
  applyReview,
  getIntervalPreviews,
  formatInterval,
} from '@chinese-learning/shared/scheduler';

// Re-export types and constants
export { CardQueue, DEFAULT_DECK_SETTINGS };
export type { Rating, DeckSettings, ComputedCardState };

// Legacy interface for backward compatibility
export interface SchedulerResult {
  queue: CardQueue;
  learning_step: number;
  ease_factor: number;
  interval: number;
  repetitions: number;
  due_timestamp: number | null;
  next_review_at: Date | null;
  // FSRS fields
  stability: number;
  difficulty: number;
  lapses: number;
}

export interface IntervalPreview {
  intervalText: string;
  queue: CardQueue;
}

/**
 * Parse learning steps from space-separated string.
 * @deprecated Not used by FSRS - learning steps are computed dynamically.
 */
export function parseLearningSteps(stepsStr: string): number[] {
  return stepsStr.split(' ').map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
}

/**
 * Format interval for display.
 */
export { formatInterval };

/**
 * Schedule a card based on rating using FSRS algorithm.
 *
 * This is the main entry point for scheduling in the worker.
 */
export function scheduleCard(
  rating: Rating,
  currentQueue: CardQueue,
  _currentStep: number,        // Ignored - FSRS doesn't use fixed steps
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number,
  _settings: DeckSettings = DEFAULT_DECK_SETTINGS,
  // FSRS-specific fields
  currentStability: number = 0,
  currentDifficulty: number = 0,
  currentLapses: number = 0,
): SchedulerResult {
  const now = new Date();
  const nowIso = now.toISOString();

  // Build current state from inputs
  const currentState: ComputedCardState = {
    queue: currentQueue,
    stability: currentStability || currentInterval || 1, // Fallback for migrated cards
    difficulty: currentDifficulty || 5, // Default difficulty
    scheduled_days: currentInterval,
    reps: currentRepetitions,
    lapses: currentLapses,
    next_review_at: null,
    due_timestamp: null,
    last_reviewed_at: null, // Not available in this context
    ease_factor: currentEaseFactor,
    interval: currentInterval,
    repetitions: currentRepetitions,
    learning_step: 0,
  };

  // Apply the review using FSRS
  const newState = applyReview(currentState, rating, DEFAULT_DECK_SETTINGS, nowIso);

  // Convert back to SchedulerResult format
  return {
    queue: newState.queue,
    learning_step: 0,
    ease_factor: newState.ease_factor,
    interval: newState.interval,
    repetitions: newState.repetitions,
    due_timestamp: newState.due_timestamp,
    next_review_at: newState.next_review_at ? new Date(newState.next_review_at) : null,
    stability: newState.stability,
    difficulty: newState.difficulty,
    lapses: newState.lapses,
  };
}

/**
 * Get interval preview for display on rating buttons.
 */
export function getIntervalPreview(
  rating: Rating,
  currentQueue: CardQueue,
  _currentStep: number,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number,
  _settings: DeckSettings = DEFAULT_DECK_SETTINGS,
  currentStability: number = 0,
  currentDifficulty: number = 0,
  currentLapses: number = 0,
): IntervalPreview {
  const now = new Date();

  // Build current state
  const currentState: ComputedCardState = {
    queue: currentQueue,
    stability: currentStability || currentInterval || 1,
    difficulty: currentDifficulty || 5,
    scheduled_days: currentInterval,
    reps: currentRepetitions,
    lapses: currentLapses,
    next_review_at: null,
    due_timestamp: null,
    last_reviewed_at: null, // Not available in this context
    ease_factor: currentEaseFactor,
    interval: currentInterval,
    repetitions: currentRepetitions,
    learning_step: 0,
  };

  // Get all previews
  const previews = getIntervalPreviews(currentState, DEFAULT_DECK_SETTINGS, now);

  // Find the preview for the requested rating
  const preview = previews.find(p => p.rating === rating);

  if (!preview) {
    return { intervalText: '?', queue: currentQueue };
  }

  return {
    intervalText: preview.intervalText,
    queue: preview.nextState,
  };
}

// Legacy functions - these are now handled by FSRS

/**
 * @deprecated Use scheduleCard instead.
 */
export function scheduleNewOrLearningCard(
  rating: Rating,
  currentStep: number,
  currentEaseFactor: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): SchedulerResult {
  return scheduleCard(rating, CardQueue.LEARNING, currentStep, currentEaseFactor, 0, 0, settings);
}

/**
 * @deprecated Use scheduleCard instead.
 */
export function scheduleReviewCard(
  rating: Rating,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): SchedulerResult {
  return scheduleCard(rating, CardQueue.REVIEW, 0, currentEaseFactor, currentInterval, currentRepetitions, settings);
}

/**
 * @deprecated Use scheduleCard instead.
 */
export function scheduleRelearningCard(
  rating: Rating,
  currentStep: number,
  currentEaseFactor: number,
  currentInterval: number,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): SchedulerResult {
  return scheduleCard(rating, CardQueue.RELEARNING, currentStep, currentEaseFactor, currentInterval, 0, settings);
}
