import { describe, it, expect } from 'vitest';
import {
  db,
  getStudyQueue,
  getDueCards,
  getQueueCounts,
  getReviewedNoteIds,
  getNewCardsStudiedToday,
  ensureDailyStatsInitialized,
  createLocalReviewEvent,
  LocalCard,
} from './database';
import { CardQueue, CardType } from '../types';

const DAY = 24 * 60 * 60 * 1000;

async function createTestDeck(id: string, newCardsPerDay = 3, secondaryCardsPerDay = 2) {
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

async function createCard(
  id: string,
  deckId: string,
  noteId: string,
  cardType: CardType,
  queue: CardQueue,
  extra: Partial<LocalCard> = {}
): Promise<LocalCard> {
  const card: LocalCard = {
    id,
    note_id: noteId,
    deck_id: deckId,
    card_type: cardType,
    queue,
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
    ...extra,
  };
  await db.cards.put(card);
  return card;
}

async function review(cardId: string, at: Date) {
  await createLocalReviewEvent({
    id: crypto.randomUUID(),
    card_id: cardId,
    rating: 2,
    time_spent_ms: 1000,
    user_answer: null,
    reviewed_at: at.toISOString(),
    _synced: 0,
  });
}

/** A small but varied collection: unseen notes, started notes, learning, due and future reviews. */
async function seedCollection() {
  await createTestDeck('d1', 3, 2);
  await createTestDeck('d2', 1, 1);
  const now = Date.now();
  const past = new Date(now - DAY).toISOString();
  const future = new Date(now + 10 * DAY).toISOString();
  // d1: two unseen notes (3 cards each), one started note (h2m reviewed, rest new)
  for (const n of ['n1', 'n2']) {
    await createCard(`${n}-h`, 'd1', n, 'hanzi_to_meaning', CardQueue.NEW);
    await createCard(`${n}-m`, 'd1', n, 'meaning_to_hanzi', CardQueue.NEW);
    await createCard(`${n}-a`, 'd1', n, 'audio_to_hanzi', CardQueue.NEW);
  }
  await createCard('n3-h', 'd1', 'n3', 'hanzi_to_meaning', CardQueue.REVIEW, { next_review_at: past });
  await createCard('n3-m', 'd1', 'n3', 'meaning_to_hanzi', CardQueue.NEW);
  await createCard('n3-a', 'd1', 'n3', 'audio_to_hanzi', CardQueue.NEW);
  // d1: learning due now, learning due later today, review in the future
  await createCard('n4-h', 'd1', 'n4', 'hanzi_to_meaning', CardQueue.LEARNING, { due_timestamp: now - 1000 });
  await createCard('n4-m', 'd1', 'n4', 'meaning_to_hanzi', CardQueue.RELEARNING, { due_timestamp: now + 60_000 });
  await createCard('n4-a', 'd1', 'n4', 'audio_to_hanzi', CardQueue.REVIEW, { next_review_at: future });
  // d2: one unseen note, one due review
  await createCard('n5-h', 'd2', 'n5', 'hanzi_to_meaning', CardQueue.NEW);
  await createCard('n5-m', 'd2', 'n5', 'meaning_to_hanzi', CardQueue.NEW);
  await createCard('n6-h', 'd2', 'n6', 'hanzi_to_meaning', CardQueue.REVIEW, { next_review_at: past });
}

describe('getStudyQueue', () => {
  it('matches getDueCards + getQueueCounts + getReviewedNoteIds for all decks', async () => {
    await seedCollection();
    for (const bonus of [0, 5, Infinity]) {
      const combined = await getStudyQueue(undefined, bonus);
      const [due, counts, reviewed] = await Promise.all([
        getDueCards(undefined, bonus),
        getQueueCounts(undefined, bonus),
        getReviewedNoteIds(),
      ]);
      expect(combined.dueCards.map(c => c.id)).toEqual(due.map(c => c.id));
      expect(combined.counts).toEqual(counts);
      expect([...combined.reviewedNoteIds].sort()).toEqual([...reviewed].sort());
    }
  });

  it('matches the separate calls for one deck', async () => {
    await seedCollection();
    const combined = await getStudyQueue('d1', 0);
    expect(combined.dueCards.map(c => c.id)).toEqual((await getDueCards('d1', 0)).map(c => c.id));
    expect(combined.counts).toEqual(await getQueueCounts('d1', 0));
    expect([...combined.reviewedNoteIds].sort()).toEqual([...(await getReviewedNoteIds('d1'))].sort());
    // Sanity: the numbers themselves
    expect(combined.counts.new).toBe(3);          // primary budget 3 over 6 unseen cards
    expect(combined.counts.secondaryNew).toBe(2); // n3's two remaining cards fit the secondary quota
    expect(combined.counts.learning).toBe(2);
    expect(combined.counts.review).toBe(1);
    expect(combined.counts.hasMoreNew).toBe(true);
    expect(combined.reviewedNoteIds).toEqual(new Set(['n3', 'n4']));
  });

  it('returns empty counts for an unknown deck', async () => {
    await seedCollection();
    const q = await getStudyQueue('nope', 0);
    expect(q.dueCards).toEqual([]);
    expect(q.counts).toEqual({ new: 0, secondaryNew: 0, learning: 0, review: 0, hasMoreNew: false });
    expect(q.reviewedNoteIds.size).toBe(0);
  });
});

describe('first-of-day recompute (batched first-review lookup)', () => {
  it('classifies primary vs secondary from each card\'s earliest event, across many cards', async () => {
    await createTestDeck('d1', 50, 50);
    const now = new Date();
    const yesterday = new Date(now.getTime() - DAY);
    const earlierToday = new Date(now.getTime() - 60_000);
    // 30 notes; note i: h2m card reviewed for the first time TODAY (primary),
    // m2h card reviewed yesterday and again today (NOT new today),
    // a2h card first reviewed today after its sibling (secondary).
    for (let i = 0; i < 30; i++) {
      const n = `n${i}`;
      await createCard(`${n}-h`, 'd1', n, 'hanzi_to_meaning', CardQueue.LEARNING);
      await createCard(`${n}-m`, 'd1', n, 'meaning_to_hanzi', CardQueue.REVIEW);
      await createCard(`${n}-a`, 'd1', n, 'audio_to_hanzi', CardQueue.LEARNING);
      await review(`${n}-m`, yesterday);
      await review(`${n}-m`, now);
      await review(`${n}-h`, earlierToday);
      await review(`${n}-h`, now); // a second review today must not double count
      await review(`${n}-a`, now);
    }
    await ensureDailyStatsInitialized();
    const row = await db.dailyStats.where('deck_id').equals('d1').first();
    // h2m cards were first reviewed today but their m2h sibling was in
    // circulation since yesterday, so all 30 count as secondary; a2h too.
    expect(row?.new_cards_studied).toBe(0);
    expect(row?.secondary_cards_studied).toBe(60);
  });

  it('counts a note whose first card was introduced today as primary, later siblings as secondary', async () => {
    await createTestDeck('d1', 50, 50);
    const now = Date.now();
    await createCard('n1-h', 'd1', 'n1', 'hanzi_to_meaning', CardQueue.LEARNING);
    await createCard('n1-m', 'd1', 'n1', 'meaning_to_hanzi', CardQueue.LEARNING);
    await createCard('n2-h', 'd1', 'n2', 'hanzi_to_meaning', CardQueue.NEW); // untouched
    await review('n1-h', new Date(now - 30_000));
    await review('n1-m', new Date(now - 10_000));
    expect(await getNewCardsStudiedToday('d1')).toBe(1);
    await ensureDailyStatsInitialized();
    const row = await db.dailyStats.where('deck_id').equals('d1').first();
    expect(row).toMatchObject({ new_cards_studied: 1, secondary_cards_studied: 1 });
  });

  it('shares one run between concurrent ensureDailyStatsInitialized calls', async () => {
    await createTestDeck('d1');
    await createTestDeck('d2');
    await createCard('n1-h', 'd1', 'n1', 'hanzi_to_meaning', CardQueue.LEARNING);
    await review('n1-h', new Date());
    const a = ensureDailyStatsInitialized();
    const b = ensureDailyStatsInitialized();
    expect(b).toBe(a); // same in-flight promise
    await Promise.all([a, b]);
    const rows = await db.dailyStats.toArray();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.deck_id === 'd1')?.new_cards_studied).toBe(1);
    // A later call is a fresh (cheap) run, not the settled promise
    const c = ensureDailyStatsInitialized();
    expect(c).not.toBe(a);
    await c;
    expect(await db.dailyStats.count()).toBe(2);
  });
});
