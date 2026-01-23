import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  getNewCardsStudiedToday,
  incrementNewCardsStudiedToday,
  cleanupOldDailyStats,
  createLocalReviewEvent,
  LocalCard,
} from './database';
import { CardQueue } from '../types';

// Helper to create a test deck
async function createTestDeck(id: string, name = 'Test Deck') {
  await db.decks.put({
    id,
    user_id: 'user-1',
    name,
    description: null,
    new_cards_per_day: 20,
    learning_steps: '1 10',
    graduating_interval: 1,
    easy_interval: 4,
    relearning_steps: '10',
    starting_ease: 2.5,
    minimum_ease: 1.3,
    maximum_ease: 3.0,
    interval_modifier: 1.0,
    hard_multiplier: 1.2,
    easy_bonus: 1.3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _synced_at: null,
  });
}

// Helper to create a test card
async function createTestCard(id: string, deckId: string, queue: CardQueue = CardQueue.NEW): Promise<LocalCard> {
  const card: LocalCard = {
    id,
    note_id: `note-${id}`,
    deck_id: deckId,
    card_type: 'hanzi_to_meaning',
    queue,
    learning_step: 0,
    ease_factor: 2.5,
    interval: 0,
    repetitions: 0,
    next_review_at: null,
    due_timestamp: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _synced_at: null,
  };
  await db.cards.put(card);
  return card;
}

// Helper to create a review event
async function createReviewEvent(cardId: string, reviewedAt: Date) {
  await createLocalReviewEvent({
    id: crypto.randomUUID(),
    card_id: cardId,
    rating: 2,
    time_spent_ms: 1000,
    user_answer: null,
    reviewed_at: reviewedAt.toISOString(),
    _synced: 0,
  });
}

describe('Daily Stats', () => {
  const deckId = 'deck-1';

  beforeEach(async () => {
    await createTestDeck(deckId);
  });

  describe('getNewCardsStudiedToday', () => {
    it('returns 0 when no cards have been studied', async () => {
      const count = await getNewCardsStudiedToday(deckId);
      expect(count).toBe(0);
    });

    it('computes count from review events when no cache exists', async () => {
      // Create cards and review events from today
      const card1 = await createTestCard('card-1', deckId);
      const card2 = await createTestCard('card-2', deckId);

      // Create review events for today
      const today = new Date();
      await createReviewEvent(card1.id, today);
      await createReviewEvent(card2.id, today);

      // Should compute from events (read-only, no caching)
      const count = await getNewCardsStudiedToday(deckId);
      expect(count).toBe(2);

      // Note: getNewCardsStudiedToday is read-only and does NOT cache
      // Caching happens via incrementNewCardsStudiedToday when cards are reviewed
      const todayStr = today.toISOString().slice(0, 10);
      const cached = await db.dailyStats.get(`${todayStr}:${deckId}`);
      expect(cached).toBeUndefined(); // No caching on read
    });

    it('returns cached value on subsequent calls', async () => {
      // Manually set the counter
      const today = new Date().toISOString().slice(0, 10);
      await db.dailyStats.put({
        id: `${today}:${deckId}`,
        date: today,
        deck_id: deckId,
        new_cards_studied: 5,
      });

      // Should return cached value without computing
      const count = await getNewCardsStudiedToday(deckId);
      expect(count).toBe(5);
    });

    it('does not count cards that were already reviewed before today', async () => {
      const card1 = await createTestCard('card-1', deckId);

      // Create a review event from yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await createReviewEvent(card1.id, yesterday);

      // Create a review event from today (second review)
      const today = new Date();
      await createReviewEvent(card1.id, today);

      // Card1 was not NEW today (had prior reviews)
      const count = await getNewCardsStudiedToday(deckId);
      expect(count).toBe(0);
    });

    it('handles "All Decks" mode (no deckId)', async () => {
      const deckId2 = 'deck-2';
      await createTestDeck(deckId2, 'Test Deck 2');

      // Set counters for both decks
      const today = new Date().toISOString().slice(0, 10);
      await db.dailyStats.put({
        id: `${today}:${deckId}`,
        date: today,
        deck_id: deckId,
        new_cards_studied: 3,
      });
      await db.dailyStats.put({
        id: `${today}:${deckId2}`,
        date: today,
        deck_id: deckId2,
        new_cards_studied: 2,
      });

      // Should sum both decks
      const count = await getNewCardsStudiedToday();
      expect(count).toBe(5);
    });
  });

  describe('incrementNewCardsStudiedToday', () => {
    it('increments the counter', async () => {
      // Initialize counter
      const today = new Date().toISOString().slice(0, 10);
      await db.dailyStats.put({
        id: `${today}:${deckId}`,
        date: today,
        deck_id: deckId,
        new_cards_studied: 3,
      });

      // Increment
      await incrementNewCardsStudiedToday(deckId);

      // Verify
      const count = await getNewCardsStudiedToday(deckId);
      expect(count).toBe(4);
    });

    it('initializes counter if it does not exist', async () => {
      // Increment without prior counter
      await incrementNewCardsStudiedToday(deckId);

      // Should have initialized to 0 and then incremented to 1
      const count = await getNewCardsStudiedToday(deckId);
      expect(count).toBe(1);
    });

    it('multiple increments work correctly', async () => {
      await incrementNewCardsStudiedToday(deckId);
      await incrementNewCardsStudiedToday(deckId);
      await incrementNewCardsStudiedToday(deckId);

      const count = await getNewCardsStudiedToday(deckId);
      expect(count).toBe(3);
    });
  });

  describe('cleanupOldDailyStats', () => {
    it('removes stats older than 7 days', async () => {
      const today = new Date();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const todayStr = today.toISOString().slice(0, 10);
      const oldStr = oldDate.toISOString().slice(0, 10);

      // Add old and new stats
      await db.dailyStats.put({
        id: `${todayStr}:${deckId}`,
        date: todayStr,
        deck_id: deckId,
        new_cards_studied: 5,
      });
      await db.dailyStats.put({
        id: `${oldStr}:${deckId}`,
        date: oldStr,
        deck_id: deckId,
        new_cards_studied: 3,
      });

      // Cleanup
      await cleanupOldDailyStats();

      // Old should be deleted, today should remain
      const remaining = await db.dailyStats.toArray();
      expect(remaining.length).toBe(1);
      expect(remaining[0].date).toBe(todayStr);
    });
  });

  describe('performance', () => {
    it('getNewCardsStudiedToday is fast with cached counter', async () => {
      // Set up counter
      const today = new Date().toISOString().slice(0, 10);
      await db.dailyStats.put({
        id: `${today}:${deckId}`,
        date: today,
        deck_id: deckId,
        new_cards_studied: 50,
      });

      // Time the call
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await getNewCardsStudiedToday(deckId);
      }
      const elapsed = performance.now() - start;

      // 100 calls should complete in well under 100ms with cached counter
      expect(elapsed).toBeLessThan(100);
      console.log(`100 cached getNewCardsStudiedToday calls: ${elapsed.toFixed(2)}ms`);
    });
  });
});
