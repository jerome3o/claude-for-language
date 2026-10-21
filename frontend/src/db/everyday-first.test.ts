/**
 * "Everyday words before formal ones" (shared/decks/formality.ts, new-card-order.ts `everyday_first`)
 * on the web device: the queue reads the shipped word-tag lexicon and each note's AI word tags
 * (notes.word_tags) from IndexedDB, and inside a tier the everyday words come first and the formal
 * ones last — ahead of "Most common first". The switch off gives exactly the old order.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, getStudyQueue, getRawQueueCounts, allocateQueueCounts, sumQueueCounts, type LocalCard } from './database';
import { CardQueue } from '../types';
import { writeStudyBudget } from '../services/studyBudget';
import { writeNewCardOrder } from '../services/newCardOrder';
import { DEFAULT_NEW_CARD_ORDER } from '@shared/decks';

const iso = () => new Date().toISOString();
const FORMAL_AI = JSON.stringify({ v: 2, register: 'formal', register_note: 'formal written; in speech use 告诉', confidence: 'high' });
const EVERYDAY_AI = JSON.stringify({ v: 2, register: 'neutral', spoken: 'everyday', spoken_confidence: 'high', confidence: 'high' });

async function seed() {
  const deck = {
    id: 'd', user_id: 'u1', name: 'd', description: null, new_cards_per_day: 10, secondary_cards_per_day: 6, study_priority: 0,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
  };
  await db.decks.put(deck as never);
  // A studied sentence holds every character, so the five words are all "new words" (one tier).
  const notes: Array<[string, string, string | null]> = [
    ['seen', '他抵达后告知我搞定了结账的工作。', null],
    ['didai', '抵达', null], // lexicon: Formal
    ['gaozhi', '告知', FORMAL_AI], // AI: formal
    ['gaoding', '搞定', null], // lexicon: Colloquial
    ['jiezhang', '结账', EVERYDAY_AI], // AI: Everyday speech
    ['gongzuo', '工作', null], // neutral
  ];
  for (const [id, hanzi, tags] of notes) {
    await db.notes.put({ id, deck_id: 'd', hanzi, pinyin: '', english: '', audio_url: null, fun_facts: null, word_tags: tags, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  }
  const card = (noteId: string, queue: number): LocalCard => ({
    id: `${noteId}-h`, note_id: noteId, deck_id: 'd', card_type: 'hanzi_to_meaning', queue, stability: queue ? 5 : 0, difficulty: 5, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: queue ? 3 : 0,
    next_review_at: queue ? new Date(Date.now() + 9 * 86_400_000).toISOString() : null, due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard);
  await db.cards.bulkPut(notes.map(([id]) => card(id, id === 'seen' ? CardQueue.REVIEW : CardQueue.NEW)));
}

const newOrder = async () => (await getStudyQueue()).dueCards.filter(c => c.queue === CardQueue.NEW).map(c => c.note_id);

describe('everyday words before formal ones (web device)', () => {
  beforeEach(async () => {
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear()]);
    await seed();
    writeStudyBudget({ new_cards_per_day: 5, secondary_cards_per_day: 0, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
    writeNewCardOrder({ ...DEFAULT_NEW_CARD_ORDER });
  });

  it('everyday first, formal last — even though 抵达 / 告知 are far more common than 搞定 / 结账', async () => {
    expect(await newOrder()).toEqual(['gaoding', 'jiezhang', 'gongzuo', 'didai', 'gaozhi']);
  });

  it('only the order changes: Home counts the same five', async () => {
    const perDeck = allocateQueueCounts(await getRawQueueCounts(), 0);
    expect(sumQueueCounts(perDeck.values()).new).toBe(5);
  });

  it('switched off: the most common first, exactly as before', async () => {
    writeNewCardOrder({ ...DEFAULT_NEW_CARD_ORDER, everyday_first: false });
    expect(await newOrder()).toEqual(['gongzuo', 'didai', 'gaozhi', 'gaoding', 'jiezhang']);
  });
});
