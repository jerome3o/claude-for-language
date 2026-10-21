/**
 * "Pause new cards on heavy days" on the web device (shared/decks/review-load.ts): with more
 * reviews due today than the cached limit, the session (getStudyQueue), Home's counts
 * (getRawQueueCounts → allocateQueueCounts) and a one-deck session all get 0 new cards —
 * the reviews stay, the load counts the cards already reviewed today, and "Study 10 more"
 * still adds new cards.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, getStudyQueue, getRawQueueCounts, allocateQueueCounts, sumQueueCounts, type LocalCard } from './database';
import { CardQueue } from '../types';
import { readReviewLoadCap, writeStudyBudget } from '../services/studyBudget';

const iso = () => new Date().toISOString();
const DAY = 86_400_000;

async function seed(reviewsDue: number, reviewedToday: number) {
  const deck = (id: string, priority: number) => ({
    id, user_id: 'u1', name: id, description: null, new_cards_per_day: 3, secondary_cards_per_day: 6, study_priority: priority,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
  });
  await db.decks.bulkPut([deck('reviews', 5), deck('words', 0)] as never);
  const card = (id: string, deckId: string, queue: number, nextMs: number | null): LocalCard => ({
    id, note_id: `n-${id}`, deck_id: deckId, card_type: 'hanzi_to_meaning', queue, stability: queue ? 30 : 0, difficulty: 5, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: queue ? 3 : 0,
    next_review_at: nextMs === null ? null : new Date(nextMs).toISOString(), due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard);
  const cards: LocalCard[] = [];
  for (let i = 0; i < reviewsDue; i++) cards.push(card(`due-${i}`, 'reviews', CardQueue.REVIEW, Date.now() - 1000));
  // Done earlier today: scheduled days ahead now, first reviewed long ago.
  for (let i = 0; i < reviewedToday; i++) cards.push(card(`done-${i}`, 'reviews', CardQueue.REVIEW, Date.now() + 5 * DAY));
  for (let i = 0; i < 5; i++) cards.push(card(`new-${i}`, 'words', CardQueue.NEW, null));
  await db.cards.bulkPut(cards);
  for (const c of cards) await db.notes.put({ id: c.note_id, deck_id: c.deck_id, hanzi: `字${c.id}`, pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  const events = [];
  for (let i = 0; i < reviewedToday; i++) {
    events.push({ id: `old-${i}`, card_id: `done-${i}`, rating: 2, reviewed_at: new Date(Date.now() - 30 * DAY).toISOString(), _synced: 1 });
    events.push({ id: `today-${i}`, card_id: `done-${i}`, rating: 2, reviewed_at: new Date(Date.now() - 60_000).toISOString(), _synced: 1 });
  }
  await db.reviewEvents.bulkPut(events as never);
}

function setLimit(limit: number | null) {
  writeStudyBudget({ new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true, set_by_id: null, set_by_name: null, set_by_tutor: false, set_at: null, pause_new_when_reviews_over: limit });
}

describe('pause new cards on heavy days (web device)', () => {
  beforeEach(async () => {
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear(), db.upNext.clear()]);
  });

  it('reads the limit from the cached budget info', () => {
    setLimit(100);
    expect(readReviewLoadCap()).toBe(100);
    setLimit(null);
    expect(readReviewLoadCap()).toBeNull();
  });

  it('over the limit: 0 new cards in the session and on Home, the reviews stay', async () => {
    await seed(8, 4); // load 12 (8 due + 4 done today)
    setLimit(10);
    const q = await getStudyQueue();
    expect(q.dueCards.filter(c => c.queue === CardQueue.NEW)).toHaveLength(0);
    expect(q.dueCards.filter(c => c.queue === CardQueue.REVIEW)).toHaveLength(8);
    const raw = await getRawQueueCounts();
    expect(raw.reviewLoad).toEqual({ load: 12, threshold: 10, paused: true });
    const total = sumQueueCounts(allocateQueueCounts(raw, 0).values());
    expect(total.new + total.secondaryNew).toBe(0);
    expect(total.review).toBe(8);
    expect(total.hasMoreNew).toBe(true);
    // A one-deck session of the words deck: still paused (the load is account-wide).
    const one = await getStudyQueue('words');
    expect(one.dueCards).toHaveLength(0);
    // Study 10 more: new cards anyway (within the deck's own cap of 3).
    expect((await getStudyQueue(undefined, 10)).dueCards.filter(c => c.queue === CardQueue.NEW)).toHaveLength(3);
  });

  it('at or under the limit (or off): the configured budget', async () => {
    await seed(8, 4);
    setLimit(12);
    expect((await getStudyQueue()).dueCards.filter(c => c.queue === CardQueue.NEW)).toHaveLength(3);
    expect((await getRawQueueCounts()).reviewLoad).toEqual({ load: 12, threshold: 12, paused: false });
    setLimit(null);
    expect((await getStudyQueue()).dueCards.filter(c => c.queue === CardQueue.NEW)).toHaveLength(3);
  });
});
