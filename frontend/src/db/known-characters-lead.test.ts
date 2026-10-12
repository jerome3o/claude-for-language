/**
 * "Words made of characters I know: start with English → Chinese" (shared/decks/lead-card.ts)
 * on the web device: the session gives a word of known characters its meaning_to_hanzi card,
 * Home's counts stay the session's, a one-deck session knows the characters of other decks,
 * and the switch (cached "Order new cards by") turns it off.
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
    id, user_id: 'u1', name: id, description: null, new_cards_per_day: 5, secondary_cards_per_day: 6, study_priority: priority,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
  });
  await db.decks.bulkPut([deck('old', 0), deck('new', 5)] as never);
  // 大学 and 生活 are known (mature) in the old deck; 学校 is only learning (stability 5).
  const notes: Array<[string, string, string]> = [
    ['k-daxue', 'old', '大学'], ['k-shenghuo', 'old', '生活'], ['l-xuexiao', 'old', '学校'],
    ['w-xuesheng', 'new', '学生'], ['w-xiao', 'new', '学校生活'],
  ];
  for (const [id, deckId, hanzi] of notes) {
    await db.notes.put({ id, deck_id: deckId, hanzi, pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  }
  const card = (noteId: string, deckId: string, type: string, queue: number, stability = 0): LocalCard => ({
    id: `${noteId}-${type}`, note_id: noteId, deck_id: deckId, card_type: type, queue, stability, difficulty: 5, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: queue ? 3 : 0,
    next_review_at: queue ? new Date(Date.now() + 9 * 86_400_000).toISOString() : null, due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard);
  const fresh = (noteId: string) => ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'].map(t => card(noteId, 'new', t, CardQueue.NEW));
  await db.cards.bulkPut([
    card('k-daxue', 'old', 'hanzi_to_meaning', CardQueue.REVIEW, 40),
    card('k-shenghuo', 'old', 'hanzi_to_meaning', CardQueue.REVIEW, 30),
    card('l-xuexiao', 'old', 'hanzi_to_meaning', CardQueue.REVIEW, 5),
    ...fresh('w-xuesheng'),
    ...fresh('w-xiao'),
  ]);
}

describe('a word of known characters starts with English → Chinese (web device)', () => {
  beforeEach(async () => {
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear()]);
    await seed();
    writeStudyBudget({ new_cards_per_day: 2, secondary_cards_per_day: 0, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
    writeNewCardOrder({ ...DEFAULT_NEW_CARD_ORDER });
  });

  it('all decks: 学生 comes as meaning_to_hanzi, 学校生活 as usual, and Home counts the same', async () => {
    const q = await getStudyQueue();
    expect(q.dueCards.map(c => c.id).sort()).toEqual(['w-xiao-hanzi_to_meaning', 'w-xuesheng-meaning_to_hanzi']);
    expect([...q.knownCharacterNoteIds]).toEqual(['w-xuesheng']);
    const perDeck = allocateQueueCounts(await getRawQueueCounts(), 0);
    expect(perDeck.get('new')?.new).toBe(2);
    expect(sumQueueCounts(perDeck.values()).new).toBe(q.counts.new);
  });

  it('a one-deck session still knows the characters learned in other decks', async () => {
    const q = await getStudyQueue('new');
    expect(q.dueCards.map(c => c.id).sort()).toEqual(['w-xiao-hanzi_to_meaning', 'w-xuesheng-meaning_to_hanzi']);
  });

  it('the switch off: hanzi_to_meaning first, as before', async () => {
    writeNewCardOrder({ ...DEFAULT_NEW_CARD_ORDER, known_characters_english_first: false });
    const q = await getStudyQueue();
    expect(q.dueCards.map(c => c.id).sort()).toEqual(['w-xiao-hanzi_to_meaning', 'w-xuesheng-hanzi_to_meaning']);
    expect(q.knownCharacterNoteIds.size).toBe(0);
  });
});
