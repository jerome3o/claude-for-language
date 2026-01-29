/**
 * Tests for Event-Sourced Card State Computation using FSRS
 *
 * These tests verify the deterministic behavior of the FSRS scheduler.
 * The same sequence of events should always produce the same state.
 */

import { describe, it, expect } from 'vitest';
import {
  initialCardState,
  applyReview,
  computeCardState,
  createCheckpoint,
  isCheckpointStale,
  formatInterval,
  getIntervalPreviews,
  getRetrievability,
  CardQueue,
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

const addDays = (date: Date, days: number): Date => {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
};

describe('initialCardState', () => {
  it('creates a new card in NEW queue with FSRS defaults', () => {
    const state = initialCardState();
    expect(state.queue).toBe(CardQueue.NEW);
    expect(state.stability).toBe(0);
    expect(state.difficulty).toBe(0);
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.next_review_at).toBeNull();
    expect(state.due_timestamp).toBeNull();
  });
});

describe('applyReview - New Card First Review', () => {
  it('moves NEW card to LEARNING on first Again (short-term scheduling)', () => {
    const state = initialCardState();
    const now = new Date().toISOString();
    const newState = applyReview(state, 0, DEFAULT_DECK_SETTINGS, now);

    // With short-term scheduling enabled, new cards go to Learning first
    expect(newState.queue).toBe(CardQueue.LEARNING);
    expect(newState.stability).toBeGreaterThan(0);
    expect(newState.difficulty).toBeGreaterThan(0);
    // In FSRS, first review (even Again) is NOT a lapse - card was never learned yet
    expect(newState.lapses).toBe(0);
    expect(newState.next_review_at).not.toBeNull();
    // Learning step should be short (minutes, not days)
    expect(newState.interval).toBe(0); // scheduled_days is 0 for learning
  });

  it('moves NEW card to LEARNING on first Good (short-term scheduling)', () => {
    const state = initialCardState();
    const now = new Date().toISOString();
    const newState = applyReview(state, 2, DEFAULT_DECK_SETTINGS, now);

    // Good on a new card goes to Learning (not Review) with short-term enabled
    expect(newState.queue).toBe(CardQueue.LEARNING);
    expect(newState.stability).toBeGreaterThan(0);
    expect(newState.difficulty).toBeGreaterThan(0);
    expect(newState.reps).toBe(1);
    expect(newState.lapses).toBe(0);
  });

  it('gives higher stability for Easy than Good on first review', () => {
    const state = initialCardState();
    const now = new Date().toISOString();

    const goodState = applyReview(state, 2, DEFAULT_DECK_SETTINGS, now);
    const easyState = applyReview(state, 3, DEFAULT_DECK_SETTINGS, now);

    expect(easyState.stability).toBeGreaterThan(goodState.stability);
  });

  it('sets initial difficulty based on first rating', () => {
    const state = initialCardState();
    const now = new Date().toISOString();

    const hardState = applyReview(state, 1, DEFAULT_DECK_SETTINGS, now);
    const goodState = applyReview(state, 2, DEFAULT_DECK_SETTINGS, now);
    const easyState = applyReview(state, 3, DEFAULT_DECK_SETTINGS, now);

    // Higher ratings = lower difficulty
    expect(hardState.difficulty).toBeGreaterThan(goodState.difficulty);
    expect(goodState.difficulty).toBeGreaterThan(easyState.difficulty);
  });
});

describe('applyReview - Review Card', () => {
  it('increases stability after successful review', () => {
    const state = initialCardState();
    const now = new Date();

    // Use Easy to skip learning phase and go directly to Review
    let currentState = applyReview(state, 3, DEFAULT_DECK_SETTINGS, now.toISOString());
    expect(currentState.queue).toBe(CardQueue.REVIEW);
    const stabilityAfterFirst = currentState.stability;

    // Second review after interval
    const reviewTime = addDays(now, Math.max(1, Math.ceil(stabilityAfterFirst)));
    currentState = applyReview(currentState, 2, DEFAULT_DECK_SETTINGS, reviewTime.toISOString());

    expect(currentState.stability).toBeGreaterThan(stabilityAfterFirst);
    expect(currentState.reps).toBe(2);
  });

  it('decreases stability and increments lapses on Again', () => {
    const state = initialCardState();
    const now = new Date();

    // Use Easy to skip learning and go to Review
    let currentState = applyReview(state, 3, DEFAULT_DECK_SETTINGS, now.toISOString());
    expect(currentState.queue).toBe(CardQueue.REVIEW);
    const stabilityBeforeLapse = currentState.stability;
    expect(currentState.lapses).toBe(0);

    // Lapse (Again) - only counts as lapse when card is in Review state
    const reviewTime = addDays(now, 1);
    currentState = applyReview(currentState, 0, DEFAULT_DECK_SETTINGS, reviewTime.toISOString());

    expect(currentState.stability).toBeLessThan(stabilityBeforeLapse);
    expect(currentState.lapses).toBe(1);
  });

  it('slightly adjusts difficulty based on ratings over time', () => {
    const state = initialCardState();
    const now = new Date();

    // First review (Hard)
    let currentState = applyReview(state, 1, DEFAULT_DECK_SETTINGS, now.toISOString());
    const initialDifficulty = currentState.difficulty;

    // Keep rating Easy to decrease difficulty
    for (let i = 0; i < 5; i++) {
      const reviewTime = addDays(now, i + 1);
      currentState = applyReview(currentState, 3, DEFAULT_DECK_SETTINGS, reviewTime.toISOString());
    }

    // Difficulty should have decreased (easier ratings reduce difficulty)
    expect(currentState.difficulty).toBeLessThan(initialDifficulty);
  });
});

describe('computeCardState', () => {
  it('returns initial state for empty events', () => {
    const state = computeCardState([]);
    expect(state.queue).toBe(CardQueue.NEW);
    expect(state.stability).toBe(0);
    expect(state.reps).toBe(0);
  });

  it('produces same state for same events', () => {
    const cardId = 'test-card-1';
    const now = new Date();
    const events = [
      createEvent(cardId, 2, now.toISOString()),
      createEvent(cardId, 2, addDays(now, 1).toISOString()),
      createEvent(cardId, 3, addDays(now, 4).toISOString()),
    ];

    const state1 = computeCardState(events);
    const state2 = computeCardState(events);

    expect(state1.queue).toBe(state2.queue);
    expect(state1.stability).toBe(state2.stability);
    expect(state1.difficulty).toBe(state2.difficulty);
    expect(state1.reps).toBe(state2.reps);
    expect(state1.lapses).toBe(state2.lapses);
  });

  it('handles multiple lapses correctly', () => {
    const cardId = 'test-card-1';
    const now = new Date();
    // Use Easy first to skip learning and get to Review state
    // Then lapses count when Again is pressed in Review state
    const events = [
      createEvent(cardId, 3, now.toISOString()),              // Easy -> goes to Review
      createEvent(cardId, 0, addDays(now, 8).toISOString()),  // Lapse 1 (from Review)
      createEvent(cardId, 3, addDays(now, 9).toISOString()),  // Easy -> back to Review
      createEvent(cardId, 0, addDays(now, 17).toISOString()), // Lapse 2 (from Review)
      createEvent(cardId, 2, addDays(now, 18).toISOString()), // Good
    ];

    const state = computeCardState(events);
    expect(state.lapses).toBe(2);
    expect(state.reps).toBeGreaterThanOrEqual(1); // At least 1 successful rep after last lapse
  });
});

describe('Checkpoints', () => {
  it('creates checkpoint with correct event count', () => {
    const cardId = 'test-card-1';
    const now = new Date();
    const event = createEvent(cardId, 2, now.toISOString());
    const state = computeCardState([event]);

    const checkpoint = createCheckpoint(cardId, state, event, 1);

    expect(checkpoint.card_id).toBe(cardId);
    expect(checkpoint.event_count).toBe(1);
    expect(checkpoint.checkpoint_at).toBe(event.reviewed_at);
  });

  it('detects stale checkpoint', () => {
    const checkpoint = {
      card_id: 'test',
      checkpoint_at: '2024-01-01T00:00:00Z',
      event_count: 5,
      state: initialCardState(),
    };

    expect(isCheckpointStale(checkpoint, '2024-01-02T00:00:00Z')).toBe(true);
    expect(isCheckpointStale(checkpoint, '2024-01-01T00:00:00Z')).toBe(false);
    expect(isCheckpointStale(checkpoint, '2023-12-31T00:00:00Z')).toBe(false);
    expect(isCheckpointStale(checkpoint, null)).toBe(false);
  });

  it('computes correctly from checkpoint', () => {
    const cardId = 'test-card-1';
    const now = new Date();

    // Initial events
    const events1 = [
      createEvent(cardId, 2, now.toISOString()),
      createEvent(cardId, 2, addDays(now, 1).toISOString()),
    ];
    const stateAtCheckpoint = computeCardState(events1);

    const checkpoint = createCheckpoint(cardId, stateAtCheckpoint, events1[1], 2);

    // More events
    const allEvents = [
      ...events1,
      createEvent(cardId, 3, addDays(now, 5).toISOString()),
    ];

    // Compute with and without checkpoint should give same result
    const stateWithoutCheckpoint = computeCardState(allEvents);
    const stateWithCheckpoint = computeCardState(allEvents, DEFAULT_DECK_SETTINGS, checkpoint);

    expect(stateWithCheckpoint.stability).toBeCloseTo(stateWithoutCheckpoint.stability, 5);
    expect(stateWithCheckpoint.difficulty).toBeCloseTo(stateWithoutCheckpoint.difficulty, 5);
    expect(stateWithCheckpoint.reps).toBe(stateWithoutCheckpoint.reps);
    expect(stateWithCheckpoint.lapses).toBe(stateWithoutCheckpoint.lapses);
  });
});

describe('formatInterval', () => {
  it('formats minutes correctly', () => {
    expect(formatInterval(5)).toBe('5m');
    expect(formatInterval(30)).toBe('30m');
    expect(formatInterval(59)).toBe('59m');
  });

  it('formats hours correctly', () => {
    expect(formatInterval(60)).toBe('1h');
    expect(formatInterval(120)).toBe('2h');
    expect(formatInterval(180)).toBe('3h');
    expect(formatInterval(1439)).toBe('24h');
  });

  it('formats days correctly', () => {
    expect(formatInterval(1440)).toBe('1d');
    expect(formatInterval(2880)).toBe('2d');
    expect(formatInterval(10080)).toBe('1w');
  });

  it('formats months and years', () => {
    expect(formatInterval(43200)).toBe('1mo');
    expect(formatInterval(525600)).toBe('1y');
  });
});

describe('getIntervalPreviews', () => {
  it('returns previews for all ratings', () => {
    const state = initialCardState();
    const previews = getIntervalPreviews(state);

    expect(previews.length).toBe(4);
    expect(previews[0].rating).toBe(0); // Again
    expect(previews[1].rating).toBe(1); // Hard
    expect(previews[2].rating).toBe(2); // Good
    expect(previews[3].rating).toBe(3); // Easy

    // All should have interval text
    for (const preview of previews) {
      expect(preview.intervalText).toBeTruthy();
      expect(typeof preview.intervalDays).toBe('number');
    }
  });

  it('Easy interval is longest for new cards', () => {
    const state = initialCardState();
    const previews = getIntervalPreviews(state);

    const againDays = previews[0].intervalDays;
    const hardDays = previews[1].intervalDays;
    const goodDays = previews[2].intervalDays;
    const easyDays = previews[3].intervalDays;

    expect(easyDays).toBeGreaterThan(goodDays);
    expect(goodDays).toBeGreaterThan(hardDays);
    expect(hardDays).toBeGreaterThanOrEqual(againDays);
  });

  it('NEW card intervals use short-term scheduling (learning steps)', () => {
    const state = initialCardState();
    const previews = getIntervalPreviews(state, DEFAULT_DECK_SETTINGS, new Date('2024-01-01T12:00:00Z'));

    // With short-term scheduling enabled:
    // - Again, Hard, Good go to Learning state with short intervals (minutes)
    // - Easy skips learning and goes directly to Review with ~8 day interval

    const againDays = previews[0].intervalDays;
    const hardDays = previews[1].intervalDays;
    const goodDays = previews[2].intervalDays;
    const easyDays = previews[3].intervalDays;

    console.log('NEW card intervals:');
    console.log('  Again:', previews[0].intervalText, `(${againDays.toFixed(4)} days)`);
    console.log('  Hard:', previews[1].intervalText, `(${hardDays.toFixed(4)} days)`);
    console.log('  Good:', previews[2].intervalText, `(${goodDays.toFixed(4)} days)`);
    console.log('  Easy:', previews[3].intervalText, `(${easyDays.toFixed(4)} days)`);

    // Again/Hard/Good should be very short (minutes) - Learning state
    expect(againDays).toBeLessThan(0.01); // ~1 minute = 0.0007 days
    expect(hardDays).toBeLessThan(0.01);   // ~6 minutes
    expect(goodDays).toBeLessThan(0.01);   // ~10 minutes

    // Again should go to Learning state
    expect(previews[0].nextState).toBe(CardQueue.LEARNING);
    expect(previews[1].nextState).toBe(CardQueue.LEARNING);
    expect(previews[2].nextState).toBe(CardQueue.LEARNING);

    // Easy should skip learning and go to Review with ~8 day interval
    expect(easyDays).toBeGreaterThan(5);
    expect(easyDays).toBeLessThan(15);
    expect(previews[3].nextState).toBe(CardQueue.REVIEW);
  });
});

describe('getRetrievability', () => {
  it('returns 1 for new cards', () => {
    const state = initialCardState();
    const r = getRetrievability(state);
    expect(r).toBe(1);
  });

  it('returns value between 0 and 1 for review cards', () => {
    const state = initialCardState();
    const now = new Date();

    // After first review
    const reviewedState = applyReview(state, 2, DEFAULT_DECK_SETTINGS, now.toISOString());

    // Check retrievability right after review (should be high)
    const r = getRetrievability(reviewedState, DEFAULT_DECK_SETTINGS, now);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

describe('FSRS Properties', () => {
  it('stability is bounded and grows over successful reviews', () => {
    const state = initialCardState();
    let current = state;
    const now = new Date();

    // Do 10 successful reviews
    for (let i = 0; i < 10; i++) {
      const reviewTime = addDays(now, i * 10);
      current = applyReview(current, 2, DEFAULT_DECK_SETTINGS, reviewTime.toISOString());
    }

    // Stability should have grown significantly
    expect(current.stability).toBeGreaterThan(30);
    // But should be bounded by maximum_interval
    expect(current.stability).toBeLessThanOrEqual(DEFAULT_DECK_SETTINGS.maximum_interval);
  });

  it('difficulty is bounded between 1 and 10', () => {
    const state = initialCardState();
    const now = new Date();

    // Test with Hard rating (high difficulty)
    let hardCard = applyReview(state, 1, DEFAULT_DECK_SETTINGS, now.toISOString());
    for (let i = 0; i < 20; i++) {
      hardCard = applyReview(hardCard, 1, DEFAULT_DECK_SETTINGS, addDays(now, i + 1).toISOString());
    }
    expect(hardCard.difficulty).toBeLessThanOrEqual(10);
    expect(hardCard.difficulty).toBeGreaterThanOrEqual(1);

    // Test with Easy rating (low difficulty)
    let easyCard = applyReview(state, 3, DEFAULT_DECK_SETTINGS, now.toISOString());
    for (let i = 0; i < 20; i++) {
      easyCard = applyReview(easyCard, 3, DEFAULT_DECK_SETTINGS, addDays(now, i + 1).toISOString());
    }
    expect(easyCard.difficulty).toBeLessThanOrEqual(10);
    expect(easyCard.difficulty).toBeGreaterThanOrEqual(1);
  });
});
