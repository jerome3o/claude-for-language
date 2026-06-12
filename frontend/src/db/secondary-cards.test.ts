import { describe, it, expect } from 'vitest';
import {
  db,
  getDueCards,
  applyNewCardBonus,
  newCardBudgets,
  incrementNewCardsStudiedToday,
  ensureDailyStatsInitialized,
  createLocalReviewEvent,
  DeckQueueRaw,
  LocalCard,
} from './database';
import { CardQueue, CardType } from '../types';

async function createTestDeck(
  id: string,
  newCardsPerDay: number,
  secondaryCardsPerDay: number
) {
  await db.decks.put({
    id,
    user_id: 'user-1',
    name: `Deck ${id}`,
    description: null,
    new_cards_per_day: newCardsPerDay,
    secondary_cards_per_day: secondaryCardsPerDay,
    request_retention: 0.9,
    fsrs_weights: null,
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
    maximum_interval: 36500,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _synced_at: null,
  });
}

async function createTestCard(opts: {
  id: string;
  deckId: string;
  noteId: string;
  cardType?: CardType;
  queue?: CardQueue;
}): Promise<LocalCard> {
  const card: LocalCard = {
    id: opts.id,
    note_id: opts.noteId,
    deck_id: opts.deckId,
    card_type: opts.cardType ?? 'hanzi_to_meaning',
    queue: opts.queue ?? CardQueue.NEW,
    stability: 0,
    difficulty: 0,
    lapses: 0,
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

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('Secondary new cards', () => {
  describe('getDueCards budgets', () => {
    it('admits secondary cards via their own quota even when unseen notes exceed the primary limit', async () => {
      const deckId = 'deck-1';
      await createTestDeck(deckId, 2, 2);

      // 3 unseen notes, 3 NEW cards each (primary pool = 9, far above limit of 2)
      for (let n = 1; n <= 3; n++) {
        await createTestCard({ id: `u${n}-h`, deckId, noteId: `unseen-${n}`, cardType: 'hanzi_to_meaning' });
        await createTestCard({ id: `u${n}-m`, deckId, noteId: `unseen-${n}`, cardType: 'meaning_to_hanzi' });
        await createTestCard({ id: `u${n}-a`, deckId, noteId: `unseen-${n}`, cardType: 'audio_to_hanzi' });
      }
      // 2 notes already in circulation: one REVIEW card + two NEW (secondary pool = 4)
      for (let n = 1; n <= 2; n++) {
        await createTestCard({ id: `c${n}-h`, deckId, noteId: `circ-${n}`, cardType: 'hanzi_to_meaning', queue: CardQueue.REVIEW });
        await createTestCard({ id: `c${n}-m`, deckId, noteId: `circ-${n}`, cardType: 'meaning_to_hanzi' });
        await createTestCard({ id: `c${n}-a`, deckId, noteId: `circ-${n}`, cardType: 'audio_to_hanzi' });
      }

      const due = await getDueCards(deckId);
      const newCards = due.filter(c => c.queue === CardQueue.NEW);
      const primaryAdmitted = newCards.filter(c => c.note_id.startsWith('unseen-'));
      const secondaryAdmitted = newCards.filter(c => c.note_id.startsWith('circ-'));

      // Without the secondary quota, the 9 unseen-note cards would have
      // consumed the entire daily limit and starved the circ-* cards forever.
      expect(primaryAdmitted.length).toBe(2);
      expect(secondaryAdmitted.length).toBe(2);
      // Primary picks are the highest-priority tier: unseen + hanzi_to_meaning
      expect(primaryAdmitted.every(c => c.card_type === 'hanzi_to_meaning')).toBe(true);
    });

    it('lets secondary cards spill into leftover primary budget when there are no unseen notes', async () => {
      const deckId = 'deck-1';
      await createTestDeck(deckId, 3, 1);

      // 3 notes in circulation, each with 2 NEW secondary cards (pool = 6)
      for (let n = 1; n <= 3; n++) {
        await createTestCard({ id: `c${n}-h`, deckId, noteId: `circ-${n}`, cardType: 'hanzi_to_meaning', queue: CardQueue.REVIEW });
        await createTestCard({ id: `c${n}-m`, deckId, noteId: `circ-${n}`, cardType: 'meaning_to_hanzi' });
        await createTestCard({ id: `c${n}-a`, deckId, noteId: `circ-${n}`, cardType: 'audio_to_hanzi' });
      }

      const due = await getDueCards(deckId);
      const newCards = due.filter(c => c.queue === CardQueue.NEW);

      // 1 from the secondary quota + 3 spilled into the unused primary budget
      expect(newCards.length).toBe(4);
    });

    it('respects already-studied counters for both budgets', async () => {
      const deckId = 'deck-1';
      await createTestDeck(deckId, 2, 1);
      await db.dailyStats.put({
        id: `${todayString()}:${deckId}`,
        date: todayString(),
        deck_id: deckId,
        new_cards_studied: 2, // primary budget exhausted
        secondary_cards_studied: 0,
      });

      await createTestCard({ id: 'u1-h', deckId, noteId: 'unseen-1', cardType: 'hanzi_to_meaning' });
      await createTestCard({ id: 'c1-h', deckId, noteId: 'circ-1', cardType: 'hanzi_to_meaning', queue: CardQueue.REVIEW });
      await createTestCard({ id: 'c1-m', deckId, noteId: 'circ-1', cardType: 'meaning_to_hanzi' });
      await createTestCard({ id: 'c1-a', deckId, noteId: 'circ-1', cardType: 'audio_to_hanzi' });

      const due = await getDueCards(deckId);
      const newCards = due.filter(c => c.queue === CardQueue.NEW);

      // Primary is used up, so the unseen-note card stays out; the secondary
      // quota still admits exactly one circulating-note card.
      expect(newCards.length).toBe(1);
      expect(newCards[0].note_id).toBe('circ-1');
    });

    it('counts secondary cards studied beyond their quota against the primary budget', async () => {
      const deckId = 'deck-1';
      await createTestDeck(deckId, 2, 1);
      await db.dailyStats.put({
        id: `${todayString()}:${deckId}`,
        date: todayString(),
        deck_id: deckId,
        new_cards_studied: 0,
        secondary_cards_studied: 3, // 2 beyond quota -> consumed the primary budget
      });

      await createTestCard({ id: 'u1-h', deckId, noteId: 'unseen-1', cardType: 'hanzi_to_meaning' });
      await createTestCard({ id: 'c1-h', deckId, noteId: 'circ-1', cardType: 'hanzi_to_meaning', queue: CardQueue.REVIEW });
      await createTestCard({ id: 'c1-m', deckId, noteId: 'circ-1', cardType: 'meaning_to_hanzi' });

      const due = await getDueCards(deckId);
      expect(due.filter(c => c.queue === CardQueue.NEW).length).toBe(0);
    });
  });

  describe('newCardBudgets / applyNewCardBonus', () => {
    const raw = (overrides: Partial<DeckQueueRaw>): DeckQueueRaw => ({
      learning: 0,
      review: 0,
      totalNew: 0,
      totalSecondaryNew: 0,
      newCardsPerDay: 20,
      secondaryCardsPerDay: 10,
      studiedToday: 0,
      secondaryStudiedToday: 0,
      ...overrides,
    });

    it('splits budgets and reports both counts', () => {
      const counts = applyNewCardBonus(raw({ totalNew: 50, totalSecondaryNew: 50 }), 0);
      expect(counts.new).toBe(20);
      expect(counts.secondaryNew).toBe(10);
      expect(counts.hasMoreNew).toBe(true);
    });

    it('spills unused primary budget into the secondary count', () => {
      const counts = applyNewCardBonus(raw({ totalNew: 0, totalSecondaryNew: 50 }), 0);
      expect(counts.new).toBe(0);
      expect(counts.secondaryNew).toBe(30); // 10 quota + 20 unused primary
    });

    it('charges secondary overflow to the primary budget', () => {
      const budgets = newCardBudgets(
        { newCardsPerDay: 20, secondaryCardsPerDay: 10, studiedToday: 5, secondaryStudiedToday: 14 },
        0
      );
      expect(budgets.primary).toBe(11); // 20 - 5 studied - 4 overflow
      expect(budgets.secondary).toBe(0);
    });

    it('supports an infinite bonus (no limit)', () => {
      const counts = applyNewCardBonus(raw({ totalNew: 7, totalSecondaryNew: 3 }), Infinity);
      expect(counts.new).toBe(7);
      expect(counts.secondaryNew).toBe(3);
      expect(counts.hasMoreNew).toBe(false);
    });
  });

  describe('daily counters', () => {
    it('incrementNewCardsStudiedToday tracks primary and secondary separately', async () => {
      const deckId = 'deck-1';
      await createTestDeck(deckId, 20, 10);

      await incrementNewCardsStudiedToday(deckId);
      await incrementNewCardsStudiedToday(deckId, true);
      await incrementNewCardsStudiedToday(deckId, true);

      const row = await db.dailyStats.get(`${todayString()}:${deckId}`);
      expect(row?.new_cards_studied).toBe(1);
      expect(row?.secondary_cards_studied).toBe(2);
    });

    it('recomputes the primary/secondary split from review events', async () => {
      const deckId = 'deck-1';
      await createTestDeck(deckId, 20, 10);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const now = new Date();
      const earlier = new Date(now.getTime() - 60_000);

      // note-1: first card introduced yesterday, second card today -> secondary
      await createTestCard({ id: 'n1-h', deckId, noteId: 'note-1', queue: CardQueue.REVIEW });
      await createTestCard({ id: 'n1-m', deckId, noteId: 'note-1', cardType: 'meaning_to_hanzi', queue: CardQueue.LEARNING });
      await createLocalReviewEvent({
        id: 'e1', card_id: 'n1-h', rating: 2, time_spent_ms: null, user_answer: null,
        reviewed_at: yesterday.toISOString(), _synced: 0,
      });
      await createLocalReviewEvent({
        id: 'e2', card_id: 'n1-m', rating: 2, time_spent_ms: null, user_answer: null,
        reviewed_at: now.toISOString(), _synced: 0,
      });

      // note-2: both cards introduced today -> first is primary, second secondary
      await createTestCard({ id: 'n2-h', deckId, noteId: 'note-2', queue: CardQueue.LEARNING });
      await createTestCard({ id: 'n2-m', deckId, noteId: 'note-2', cardType: 'meaning_to_hanzi', queue: CardQueue.LEARNING });
      await createLocalReviewEvent({
        id: 'e3', card_id: 'n2-h', rating: 2, time_spent_ms: null, user_answer: null,
        reviewed_at: earlier.toISOString(), _synced: 0,
      });
      await createLocalReviewEvent({
        id: 'e4', card_id: 'n2-m', rating: 2, time_spent_ms: null, user_answer: null,
        reviewed_at: now.toISOString(), _synced: 0,
      });

      await ensureDailyStatsInitialized();

      const row = await db.dailyStats.get(`${todayString()}:${deckId}`);
      expect(row?.new_cards_studied).toBe(1); // n2-h only
      expect(row?.secondary_cards_studied).toBe(2); // n1-m and n2-m
    });
  });
});
