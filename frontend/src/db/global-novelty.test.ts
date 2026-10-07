/**
 * "Order new cards by" on the web device (new characters first across all decks): the session queue
 * (getStudyQueue) takes a bottom-deck word with a never-seen character before the
 * top deck's words, and Home's per-deck rows (getRawQueueCounts → allocateQueueCounts)
 * say the same thing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, getStudyQueue, getRawQueueCounts, allocateQueueCounts, sumQueueCounts, type LocalCard } from './database';
import { CardQueue } from '../types';
import { writeStudyBudget } from '../services/studyBudget';
import { writeNewCardOrder } from '../services/newCardOrder';
import { DEFAULT_NEW_CARD_ORDER } from '@shared/decks';

const iso = () => new Date().toISOString();

async function seed() {
  const deck = (id: string, priority: number) => ({
    id, user_id: 'u1', name: id, description: null, new_cards_per_day: 3, secondary_cards_per_day: 6, study_priority: priority,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
  });
  await db.decks.bulkPut([deck('top', 5), deck('bottom', 0)] as never);
  const notes: Array<[string, string, string]> = [['n-seen', 'top', '你好'], ['n-ni', 'top', '你'], ['n-hao', 'top', '好'], ['n-bear', 'bottom', '熊猫']];
  for (const [id, deckId, hanzi] of notes) {
    await db.notes.put({ id, deck_id: deckId, hanzi, pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  }
  const card = (id: string, noteId: string, deckId: string, queue: number): LocalCard => ({
    id, note_id: noteId, deck_id: deckId, card_type: 'hanzi_to_meaning', queue, stability: queue ? 30 : 0, difficulty: 0, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: queue ? 3 : 0,
    next_review_at: queue ? new Date(Date.now() + 9 * 86_400_000).toISOString() : null, due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard);
  await db.cards.bulkPut([
    card('c-seen', 'n-seen', 'top', CardQueue.REVIEW), card('c-ni', 'n-ni', 'top', CardQueue.NEW),
    card('c-hao', 'n-hao', 'top', CardQueue.NEW), card('c-bear', 'n-bear', 'bottom', CardQueue.NEW),
  ]);
}

describe('new characters first across all decks (web device)', () => {
  beforeEach(async () => {
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear()]);
    await seed();
    writeStudyBudget({ new_cards_per_day: 2, secondary_cards_per_day: 0, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
  });

  it('the session and the per-deck counts both take the bottom deck’s new character first', async () => {
    const q = await getStudyQueue();
    // 熊猫 brings new characters; then the words in deck order, the most common first (你 before 好).
    expect(q.dueCards.map(c => c.id)).toEqual(['c-bear', 'c-ni']);
    const perDeck = allocateQueueCounts(await getRawQueueCounts(), 0);
    expect(perDeck.get('bottom')?.new).toBe(1);
    expect(perDeck.get('top')?.new).toBe(1);
    expect(sumQueueCounts(perDeck.values()).new).toBe(q.counts.new);
  });

  it('follows the cached "Order new cards by": every switch off = the plain deck order', async () => {
    writeNewCardOrder({ new_characters_first: false, new_words_first: false, most_common_first: false, sentences_last: false });
    try {
      const q = await getStudyQueue();
      expect(q.dueCards.map(c => c.id)).toEqual(['c-hao', 'c-ni']);
      const perDeck = allocateQueueCounts(await getRawQueueCounts(), 0);
      expect(perDeck.get('bottom')?.new).toBe(0);
      expect(perDeck.get('top')?.new).toBe(2);
    } finally {
      writeNewCardOrder({ ...DEFAULT_NEW_CARD_ORDER });
    }
  });
});
