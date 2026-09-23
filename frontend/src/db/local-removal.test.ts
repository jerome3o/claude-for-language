import { describe, it, expect } from 'vitest';
import { db, removeDecksLocally, removeNotesLocally } from './database';
import { CardQueue } from '../types';

const now = new Date().toISOString();
async function seedDeck(deckId: string, noteIds: string[]) {
  await db.decks.put({ id: deckId, user_id: 'u', name: deckId, description: null, new_cards_per_day: 20, request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4, relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1, hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: now, updated_at: now, _synced_at: null });
  for (const n of noteIds) {
    await db.notes.put({ id: n, deck_id: deckId, hanzi: n, pinyin: 'x', english: 'y', audio_url: null, audio_provider: null, fun_facts: null, context: null, sentence_clue: null, sentence_clue_pinyin: null, sentence_clue_translation: null, sentence_clue_audio_url: null, multiple_choice_options: null, pinyin_only: 0, alternatives: null, created_at: now, updated_at: now, _synced_at: null });
    for (const t of ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const) {
      const id = `${n}-${t}`;
      await db.cards.put({ id, note_id: n, deck_id: deckId, card_type: t, queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null, created_at: now, updated_at: now, _synced_at: null });
      await db.cardCheckpoints.put({ card_id: id, queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0, reps: 0, next_review_at: null, due_timestamp: null, last_event_id: null, last_event_at: null, computed_at: now } as never);
    }
    await db.noteSentences.put({ id: `${n}-s1`, note_id: n, position: 1, hanzi: '句子', pinyin: null, translation: null, audio_url: null, focus: 'core', explanation: null, created_at: now, updated_at: now } as never);
  }
  await db.dailyStats.put({ id: `2026-01-01:${deckId}`, date: '2026-01-01', deck_id: deckId, new_cards_studied: 1 });
}

describe('local removal', () => {
  it('removeDecksLocally drops the deck, its notes, cards, checkpoints, sentences and stats, nothing else', async () => {
    await seedDeck('d1', ['n1', 'n2']);
    await seedDeck('d2', ['n3']);
    await db.reviewEvents.put({ id: 'ev1', card_id: 'n1-hanzi_to_meaning', rating: 2, time_spent_ms: 1, user_answer: null, reviewed_at: now, _synced: 1, _created_at: now });
    await removeDecksLocally(['d1']);
    expect(await db.decks.toArray()).toHaveLength(1);
    expect((await db.notes.toArray()).map(n => n.id)).toEqual(['n3']);
    expect(await db.cards.where('deck_id').equals('d1').count()).toBe(0);
    expect(await db.cards.count()).toBe(3);
    expect(await db.cardCheckpoints.count()).toBe(3);
    expect(await db.noteSentences.count()).toBe(1);
    expect(await db.dailyStats.count()).toBe(1);
    // history is kept
    expect(await db.reviewEvents.count()).toBe(1);
  });

  it('removeNotesLocally drops only those notes and their cards', async () => {
    await seedDeck('d1', ['n1', 'n2']);
    await removeNotesLocally(['n2']);
    expect((await db.notes.toArray()).map(n => n.id)).toEqual(['n1']);
    expect(await db.cards.count()).toBe(3);
    expect(await db.cardCheckpoints.count()).toBe(3);
    expect(await db.decks.count()).toBe(1);
  });

  it('is a no-op for empty lists', async () => {
    await seedDeck('d1', ['n1']);
    await removeDecksLocally([]);
    await removeNotesLocally([]);
    expect(await db.decks.count()).toBe(1);
    expect(await db.cards.count()).toBe(3);
  });
});
