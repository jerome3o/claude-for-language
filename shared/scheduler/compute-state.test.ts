/**
 * Tests for Event-Sourced Card State Computation
 *
 * These tests verify the deterministic behavior of the scheduler.
 * The same sequence of events should always produce the same state.
 */

import { describe, it, expect } from 'vitest';
import {
  initialCardState,
  applyReview,
  computeCardState,
  createCheckpoint,
  isCheckpointStale,
  parseLearningSteps,
  deckSettingsFromDb,
  CardQueue,
  DeckSettings,
  ComputedCardState,
  ReviewEvent,
  DEFAULT_DECK_SETTINGS,
} from './compute-state';

// Test helpers
const createEvent = (
  cardId: string,
  rating: 0 | 1 | 2 | 3,
  reviewedAt: string
): ReviewEvent => ({
  id: `event-${Date.now()}-${Math.random()}`,
  card_id: cardId,
  rating,
  reviewed_at: reviewedAt,
});

const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60 * 1000);
};

const addDays = (date: Date, days: number): Date => {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
};

describe('initialCardState', () => {
  it('creates a new card in NEW queue', () => {
    const state = initialCardState();
    expect(state.queue).toBe(CardQueue.NEW);
    expect(state.learning_step).toBe(0);
    expect(state.ease_factor).toBe(2.5);
    expect(state.interval).toBe(0);
    expect(state.repetitions).toBe(0);
    expect(state.next_review_at).toBeNull();
    expect(state.due_timestamp).toBeNull();
  });

  it('uses custom starting ease from settings', () => {
    const settings: DeckSettings = {
      ...DEFAULT_DECK_SETTINGS,
      starting_ease: 2.8,
    };
    const state = initialCardState(settings);
    expect(state.ease_factor).toBe(2.8);
  });
});

describe('applyReview - NEW cards', () => {
  const baseTime = '2024-01-15T10:00:00.000Z';
  const settings = DEFAULT_DECK_SETTINGS; // learning_steps: [1, 10]

  it('rating 0 (Again) moves to LEARNING step 0', () => {
    const state = initialCardState(settings);
    const newState = applyReview(state, 0, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.LEARNING);
    expect(newState.learning_step).toBe(0);
    expect(newState.interval).toBe(0);
    expect(newState.repetitions).toBe(0);
    // Should be due in 1 minute
    const expectedDue = addMinutes(new Date(baseTime), 1).getTime();
    expect(newState.due_timestamp).toBe(expectedDue);
  });

  it('rating 1 (Hard) stays at step 0 with intermediate delay', () => {
    const state = initialCardState(settings);
    const newState = applyReview(state, 1, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.LEARNING);
    expect(newState.learning_step).toBe(0);
    // Hard on step 0 should give ~5.5 min ((1+10)/2) delay
    // Should be greater than the first step (1 min)
    expect(newState.due_timestamp).toBeGreaterThan(addMinutes(new Date(baseTime), 1).getTime());
  });

  it('rating 2 (Good) advances to step 1', () => {
    const state = initialCardState(settings);
    const newState = applyReview(state, 2, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.LEARNING);
    expect(newState.learning_step).toBe(1);
    // Should be due in 10 minutes (next learning step)
    const expectedDue = addMinutes(new Date(baseTime), 10).getTime();
    expect(newState.due_timestamp).toBe(expectedDue);
  });

  it('rating 3 (Easy) graduates immediately with easy interval', () => {
    const state = initialCardState(settings);
    const newState = applyReview(state, 3, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.REVIEW);
    expect(newState.learning_step).toBe(0);
    expect(newState.interval).toBe(settings.easy_interval); // 4 days
    expect(newState.repetitions).toBe(1);
    // Ease should increase by 0.15
    expect(newState.ease_factor).toBe(2.65);
    expect(newState.due_timestamp).toBeNull();
    expect(newState.next_review_at).not.toBeNull();

    // Should be due in 4 days
    const expectedDate = addDays(new Date(baseTime), 4);
    expect(new Date(newState.next_review_at!).getDate()).toBe(expectedDate.getDate());
  });
});

describe('applyReview - LEARNING cards', () => {
  const baseTime = '2024-01-15T10:00:00.000Z';
  const settings = DEFAULT_DECK_SETTINGS;

  it('Good on last learning step graduates to REVIEW', () => {
    // Start at step 1 (last step)
    const state: ComputedCardState = {
      queue: CardQueue.LEARNING,
      learning_step: 1,
      ease_factor: 2.5,
      interval: 0,
      repetitions: 0,
      next_review_at: null,
      due_timestamp: null,
    };

    const newState = applyReview(state, 2, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.REVIEW);
    expect(newState.interval).toBe(settings.graduating_interval); // 1 day
    expect(newState.repetitions).toBe(1);
    expect(newState.next_review_at).not.toBeNull();
  });

  it('Again on LEARNING resets to step 0', () => {
    const state: ComputedCardState = {
      queue: CardQueue.LEARNING,
      learning_step: 1,
      ease_factor: 2.5,
      interval: 0,
      repetitions: 0,
      next_review_at: null,
      due_timestamp: null,
    };

    const newState = applyReview(state, 0, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.LEARNING);
    expect(newState.learning_step).toBe(0);
    // Due in 1 minute
    expect(newState.due_timestamp).toBe(addMinutes(new Date(baseTime), 1).getTime());
  });
});

describe('applyReview - REVIEW cards', () => {
  const baseTime = '2024-01-15T10:00:00.000Z';
  const settings = DEFAULT_DECK_SETTINGS;

  const reviewCardState: ComputedCardState = {
    queue: CardQueue.REVIEW,
    learning_step: 0,
    ease_factor: 2.5,
    interval: 10, // 10 days
    repetitions: 3,
    next_review_at: baseTime,
    due_timestamp: null,
  };

  it('Again on REVIEW moves to RELEARNING', () => {
    const newState = applyReview(reviewCardState, 0, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.RELEARNING);
    expect(newState.learning_step).toBe(0);
    // Ease decreases by 0.2
    expect(newState.ease_factor).toBe(2.3);
    // Interval resets to 1 day
    expect(newState.interval).toBe(1);
    expect(newState.repetitions).toBe(0);
    // Due in 10 minutes (first relearning step)
    expect(newState.due_timestamp).toBe(addMinutes(new Date(baseTime), 10).getTime());
  });

  it('Hard on REVIEW increases interval with hard_multiplier', () => {
    const newState = applyReview(reviewCardState, 1, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.REVIEW);
    // Ease decreases by 0.15
    expect(newState.ease_factor).toBe(2.35);
    // Interval = 10 * 1.2 (hard_multiplier) = 12
    expect(newState.interval).toBe(12);
    expect(newState.repetitions).toBe(4);
    expect(newState.next_review_at).not.toBeNull();
  });

  it('Good on REVIEW increases interval by ease_factor', () => {
    const newState = applyReview(reviewCardState, 2, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.REVIEW);
    // Ease stays the same
    expect(newState.ease_factor).toBe(2.5);
    // Interval = 10 * 2.5 = 25
    expect(newState.interval).toBe(25);
    expect(newState.repetitions).toBe(4);
  });

  it('Easy on REVIEW gives maximum interval increase', () => {
    const newState = applyReview(reviewCardState, 3, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.REVIEW);
    // Ease increases by 0.15
    expect(newState.ease_factor).toBe(2.65);
    // Interval = 10 * 2.65 (new ease) * 1.3 (easy_bonus) = 34.45 -> 34
    expect(newState.interval).toBe(34);
    expect(newState.repetitions).toBe(4);
  });

  it('respects minimum ease bound', () => {
    const lowEaseState: ComputedCardState = {
      ...reviewCardState,
      ease_factor: 1.4, // Close to minimum
    };

    // Multiple Again ratings
    let state = applyReview(lowEaseState, 0, settings, baseTime);
    state = applyReview(state, 0, settings, addMinutes(new Date(baseTime), 10).toISOString());

    expect(state.ease_factor).toBeGreaterThanOrEqual(settings.minimum_ease);
  });

  it('respects maximum ease bound', () => {
    const highEaseState: ComputedCardState = {
      ...reviewCardState,
      ease_factor: 2.95, // Close to maximum
    };

    const state = applyReview(highEaseState, 3, settings, baseTime);

    expect(state.ease_factor).toBeLessThanOrEqual(settings.maximum_ease);
  });
});

describe('applyReview - RELEARNING cards', () => {
  const baseTime = '2024-01-15T10:00:00.000Z';
  const settings = DEFAULT_DECK_SETTINGS; // relearning_steps: [10]

  const relearningState: ComputedCardState = {
    queue: CardQueue.RELEARNING,
    learning_step: 0,
    ease_factor: 2.3,
    interval: 1,
    repetitions: 0,
    next_review_at: null,
    due_timestamp: addMinutes(new Date(baseTime), 10).getTime(),
  };

  it('Good on last relearning step returns to REVIEW', () => {
    const newState = applyReview(relearningState, 2, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.REVIEW);
    expect(newState.interval).toBe(1); // Preserved from relearning
    expect(newState.repetitions).toBe(1);
    expect(newState.next_review_at).not.toBeNull();
  });

  it('Again on RELEARNING stays at step 0', () => {
    const newState = applyReview(relearningState, 0, settings, baseTime);

    expect(newState.queue).toBe(CardQueue.RELEARNING);
    expect(newState.learning_step).toBe(0);
    expect(newState.due_timestamp).toBe(addMinutes(new Date(baseTime), 10).getTime());
  });
});

describe('computeCardState - multiple events', () => {
  const settings = DEFAULT_DECK_SETTINGS;
  const cardId = 'test-card-1';

  it('computes state from sequence of events', () => {
    const startTime = new Date('2024-01-15T10:00:00.000Z');

    const events: ReviewEvent[] = [
      createEvent(cardId, 2, startTime.toISOString()), // Good: NEW -> LEARNING step 1
      createEvent(cardId, 2, addMinutes(startTime, 10).toISOString()), // Good: LEARNING -> REVIEW
    ];

    const state = computeCardState(events, settings);

    expect(state.queue).toBe(CardQueue.REVIEW);
    expect(state.interval).toBe(settings.graduating_interval);
    expect(state.repetitions).toBe(1);
  });

  it('handles a full study session', () => {
    const startTime = new Date('2024-01-15T10:00:00.000Z');

    // Simulate: NEW -> LEARNING -> REVIEW -> (lapse) -> RELEARNING -> REVIEW
    const events: ReviewEvent[] = [
      createEvent(cardId, 2, startTime.toISOString()), // Good: NEW -> LEARNING
      createEvent(cardId, 2, addMinutes(startTime, 10).toISOString()), // Good: Graduate to REVIEW
      createEvent(cardId, 2, addDays(startTime, 1).toISOString()), // Good: interval grows
      createEvent(cardId, 0, addDays(startTime, 3).toISOString()), // Again: REVIEW -> RELEARNING
      createEvent(cardId, 2, addDays(startTime, 3).toISOString()), // Good: RELEARNING -> REVIEW
    ];

    const state = computeCardState(events, settings);

    expect(state.queue).toBe(CardQueue.REVIEW);
    expect(state.ease_factor).toBeLessThan(2.5); // Decreased from lapse
    expect(state.repetitions).toBe(1); // Reset from relearning graduation
  });

  it('is deterministic - same events produce same state', () => {
    const startTime = new Date('2024-01-15T10:00:00.000Z');

    const events: ReviewEvent[] = [
      createEvent(cardId, 2, startTime.toISOString()),
      createEvent(cardId, 3, addMinutes(startTime, 10).toISOString()),
      createEvent(cardId, 2, addDays(startTime, 4).toISOString()),
    ];

    const state1 = computeCardState(events, settings);
    const state2 = computeCardState(events, settings);

    expect(state1).toEqual(state2);
  });

  it('handles empty events (returns initial state)', () => {
    const state = computeCardState([], settings);

    expect(state.queue).toBe(CardQueue.NEW);
    expect(state.ease_factor).toBe(settings.starting_ease);
  });
});

describe('computeCardState - with checkpoints', () => {
  const settings = DEFAULT_DECK_SETTINGS;
  const cardId = 'test-card-1';
  const startTime = new Date('2024-01-15T10:00:00.000Z');

  it('uses checkpoint as starting point', () => {
    // Create events
    const events: ReviewEvent[] = [
      createEvent(cardId, 2, startTime.toISOString()),
      createEvent(cardId, 2, addMinutes(startTime, 10).toISOString()),
      createEvent(cardId, 2, addDays(startTime, 1).toISOString()),
    ];

    // Compute state from all events
    const fullState = computeCardState(events, settings);

    // Create checkpoint after first 2 events
    const intermediateState = computeCardState(events.slice(0, 2), settings);
    const checkpoint = createCheckpoint(
      cardId,
      intermediateState,
      events[1],
      2
    );

    // Compute from checkpoint
    const checkpointState = computeCardState(events, settings, checkpoint);

    // Should produce same result
    expect(checkpointState).toEqual(fullState);
  });

  it('handles checkpoint with no new events', () => {
    const events: ReviewEvent[] = [
      createEvent(cardId, 2, startTime.toISOString()),
    ];

    const state = computeCardState(events, settings);
    const checkpoint = createCheckpoint(cardId, state, events[0], 1);

    // No new events after checkpoint
    const result = computeCardState(events, settings, checkpoint);

    expect(result).toEqual(state);
  });
});

describe('isCheckpointStale', () => {
  const cardId = 'test-card-1';
  const checkpointTime = '2024-01-15T10:00:00.000Z';

  const checkpoint = {
    card_id: cardId,
    checkpoint_at: checkpointTime,
    event_count: 5,
    state: initialCardState(),
  };

  it('returns false when no new events', () => {
    expect(isCheckpointStale(checkpoint, null)).toBe(false);
  });

  it('returns false when latest event is at checkpoint', () => {
    expect(isCheckpointStale(checkpoint, checkpointTime)).toBe(false);
  });

  it('returns true when new event after checkpoint', () => {
    const laterTime = '2024-01-15T11:00:00.000Z';
    expect(isCheckpointStale(checkpoint, laterTime)).toBe(true);
  });
});

describe('parseLearningSteps', () => {
  it('parses space-separated steps', () => {
    expect(parseLearningSteps('1 10')).toEqual([1, 10]);
    expect(parseLearningSteps('1 10 60 1440')).toEqual([1, 10, 60, 1440]);
  });

  it('filters invalid values', () => {
    expect(parseLearningSteps('1 foo 10')).toEqual([1, 10]);
    expect(parseLearningSteps('0 1 -5 10')).toEqual([1, 10]);
  });

  it('handles empty string', () => {
    expect(parseLearningSteps('')).toEqual([]);
  });
});

describe('deckSettingsFromDb', () => {
  it('converts percentage values to decimals', () => {
    const dbDeck = {
      learning_steps: '1 10',
      graduating_interval: 1,
      easy_interval: 4,
      relearning_steps: '10',
      starting_ease: 250, // 2.5
      minimum_ease: 130, // 1.3
      maximum_ease: 300, // 3.0
      interval_modifier: 100, // 1.0
      hard_multiplier: 120, // 1.2
      easy_bonus: 130, // 1.3
    };

    const settings = deckSettingsFromDb(dbDeck);

    expect(settings.starting_ease).toBe(2.5);
    expect(settings.minimum_ease).toBe(1.3);
    expect(settings.maximum_ease).toBe(3.0);
    expect(settings.interval_modifier).toBe(1.0);
    expect(settings.hard_multiplier).toBe(1.2);
    expect(settings.easy_bonus).toBe(1.3);
    expect(settings.learning_steps).toEqual([1, 10]);
    expect(settings.relearning_steps).toEqual([10]);
  });
});

describe('interval_modifier', () => {
  it('applies interval modifier to review intervals', () => {
    const settings: DeckSettings = {
      ...DEFAULT_DECK_SETTINGS,
      interval_modifier: 0.8, // 80%
    };

    const reviewState: ComputedCardState = {
      queue: CardQueue.REVIEW,
      learning_step: 0,
      ease_factor: 2.5,
      interval: 10,
      repetitions: 3,
      next_review_at: '2024-01-15T10:00:00.000Z',
      due_timestamp: null,
    };

    const newState = applyReview(reviewState, 2, settings, '2024-01-15T10:00:00.000Z');

    // Normal: 10 * 2.5 = 25
    // With modifier: 25 * 0.8 = 20
    expect(newState.interval).toBe(20);
  });
});

describe('edge cases', () => {
  const settings = DEFAULT_DECK_SETTINGS;

  it('handles single learning step', () => {
    const singleStepSettings: DeckSettings = {
      ...settings,
      learning_steps: [1],
    };

    const state = initialCardState(singleStepSettings);
    const afterGood = applyReview(state, 2, singleStepSettings, '2024-01-15T10:00:00.000Z');

    // Should graduate immediately on Good
    expect(afterGood.queue).toBe(CardQueue.REVIEW);
  });

  it('handles very long intervals', () => {
    const longIntervalState: ComputedCardState = {
      queue: CardQueue.REVIEW,
      learning_step: 0,
      ease_factor: 2.5,
      interval: 365, // 1 year
      repetitions: 10,
      next_review_at: '2024-01-15T10:00:00.000Z',
      due_timestamp: null,
    };

    const newState = applyReview(longIntervalState, 2, settings, '2024-01-15T10:00:00.000Z');

    // Should calculate correctly
    expect(newState.interval).toBe(913); // 365 * 2.5 = 912.5 -> 913
  });
});
