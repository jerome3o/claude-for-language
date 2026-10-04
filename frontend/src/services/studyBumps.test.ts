/**
 * "⚡ Study it today" on the web device: a bump (offline) puts the note's cards first
 * in getStudyQueue — NEW over a spent budget — and in the Home counts; a review ends
 * it; a sync's list replaces the synced rows but never this device's pending ones.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, getStudyQueue, getRawQueueCounts, allocateQueueCounts, sumQueueCounts, createLocalReviewEvent, type LocalCard } from '../db/database';
import { CardQueue } from '../types';
import { bumpNotes, clearBump, replaceLocalBumps, findExistingNotes } from './studyBumps';
import { writeStudyBudget } from './studyBudget';

vi.mock('./analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));

const iso = () => new Date().toISOString();

async function seed() {
  await db.decks.put({
    id: 'd1', user_id: 'u1', name: 'HSK 2', description: null, new_cards_per_day: 3, secondary_cards_per_day: 6,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
  } as never);
  for (const [id, hanzi] of [['n-bank', '银行'], ['n-apple', '苹果']]) {
    await db.notes.put({ id, deck_id: 'd1', hanzi, pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  }
  const card = (id: string, noteId: string): LocalCard => ({
    id, note_id: noteId, deck_id: 'd1', card_type: 'hanzi_to_meaning', queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard);
  await db.cards.bulkPut([card('c-bank', 'n-bank'), card('c-apple', 'n-apple')]);
}

describe('study bumps on the device', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear()]);
    await seed();
    writeStudyBudget({ new_cards_per_day: 0, secondary_cards_per_day: 0, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
  });

  it('a bumped NEW card comes first over a spent budget, and Home counts it', async () => {
    expect((await getStudyQueue()).dueCards).toEqual([]);
    const out = await bumpNotes(['n-bank'], 'coach');
    expect(out.message).toBe('⚡ 银行 will come first in today’s study');
    const q = await getStudyQueue();
    expect(q.dueCards.map(c => c.id)).toEqual(['c-bank']);
    expect([...q.bumpedCardIds]).toEqual(['c-bank']);
    const counts = sumQueueCounts(allocateQueueCounts(await getRawQueueCounts(), 0).values());
    expect(counts).toMatchObject({ new: 1, bumped: 1 });
    expect((await bumpNotes(['n-bank'], 'coach')).already).toEqual(['n-bank']);
  });

  it('is done once the card is reviewed since the bump', async () => {
    await bumpNotes(['n-bank'], 'coach');
    await new Promise(r => setTimeout(r, 5));
    await createLocalReviewEvent({ id: 'e1', card_id: 'c-bank', rating: 2, time_spent_ms: null, user_answer: null, reviewed_at: iso(), _synced: 0 });
    await db.cards.update('c-bank', { queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const counts = sumQueueCounts(allocateQueueCounts(await getRawQueueCounts(), 0).values());
    expect(counts.bumped).toBe(0);
    expect((await getStudyQueue()).dueCards).toEqual([]);
  });

  it('clearing hides it at once; a sync list never overrides pending rows', async () => {
    await bumpNotes(['n-bank'], 'deck');
    await replaceLocalBumps([{ id: 's1', note_id: 'n-apple', created_at: '2026-10-04 08:00:00', source: 'mcp', bumped_by: null, bumped_by_name: null, hanzi: '苹果', pinyin: '', english: '', deck_id: 'd1', deck_name: 'HSK 2' }]);
    expect((await db.studyBumps.toArray()).map(b => b.note_id).sort()).toEqual(['n-apple', 'n-bank']);
    await clearBump('n-bank');
    expect(await db.studyBumps.where('note_id').equals('n-bank').count()).toBe(0); // pending add → just dropped
    await clearBump('n-apple');
    expect((await db.studyBumps.where('note_id').equals('n-apple').first())?.pending).toBe('clear');
    await replaceLocalBumps([{ id: 's1', note_id: 'n-apple', created_at: '2026-10-04 08:00:00', source: 'mcp', bumped_by: null, bumped_by_name: null, hanzi: '苹果', pinyin: '', english: '', deck_id: 'd1', deck_name: 'HSK 2' }]);
    expect((await db.studyBumps.where('note_id').equals('n-apple').first())?.pending).toBe('clear');
    expect((await getStudyQueue()).dueCards).toEqual([]);
  });

  it('finds a word I already have, punctuation ignored', async () => {
    const hits = await findExistingNotes(' 银行。');
    expect(hits.map(h => [h.note.id, h.deckName])).toEqual([['n-bank', 'HSK 2']]);
  });
});
