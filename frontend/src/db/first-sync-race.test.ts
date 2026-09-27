import { describe, it, expect } from 'vitest';
import { liveQuery } from 'dexie';
import { db, getRawQueueCounts, getStudyQueue, introducedTodayFromEvents, createLocalReviewEvent } from './database';
import { CardQueue } from '../types';

// First sync of a brand-new account (27 Sep 2026): Home showed "3 cards due" while Study
// opened straight to "All Done". Home's live query (useRawQueueCounts → getRawQueueCounts)
// started the shared single-flight "introduced today" computation INSIDE its liveQuery
// zone; the study session's load awaited that same promise from ensureDailyStatsInitialized
// and then wrote dailyStats — a readwrite transaction in the liveQuery's zone →
// "ReadOnlyError: Readwrite transaction in liveQuery context", the load threw, and the
// session showed All Done with 45 cards in IndexedDB.

async function seed() {
  const now = new Date().toISOString();
  await db.decks.put({
    id: 'd1', user_id: 'u', name: 'Starter Chinese', description: null, new_cards_per_day: 3, secondary_cards_per_day: 6,
    request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
    relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
    hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, study_priority: 0,
    created_at: now, updated_at: now, _synced_at: null,
  });
  for (let i = 0; i < 15; i++) {
    await db.notes.put({
      id: `n${i}`, deck_id: 'd1', hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', audio_url: null, audio_provider: null,
      fun_facts: null, context: null, sentence_clue: null, sentence_clue_pinyin: null, sentence_clue_translation: null,
      sentence_clue_audio_url: null, multiple_choice_options: null, pinyin_only: 0, alternatives: null,
      created_at: now, updated_at: now, _synced_at: null,
    });
    for (const t of ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const) {
      await db.cards.put({
        id: `n${i}-${t}`, note_id: `n${i}`, deck_id: 'd1', card_type: t, queue: CardQueue.NEW, stability: 0, difficulty: 0,
        lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
        created_at: now, updated_at: now, _synced_at: null,
      });
    }
  }
  // A review today, so "introduced today" has real work to do (siblings, first reviews).
  await createLocalReviewEvent({ id: 'e1', card_id: 'n0-hanzi_to_meaning', rating: 2, time_spent_ms: null, user_answer: null, reviewed_at: now, _synced: 1 });
}

describe('study load while Home\'s live query computes (first sync)', () => {
  it('loads the same queue Home counts, even when both start at the same moment', async () => {
    await seed();
    // The overlap depends on how far the live query's querier has got, so try it
    // after 0..7 reads of head start.
    for (let round = 0; round < 8; round++) {
      // Home: a live query over the raw counts, started first (it owns the shared computation).
      const home = new Promise<number>((resolve, reject) => {
        const sub = liveQuery(() => getRawQueueCounts()).subscribe({
          next: (raw) => { sub.unsubscribe(); resolve([...raw.values()].reduce((n, r) => n + r.totalNew + r.totalSecondaryNew, 0)); },
          error: reject,
        });
      });
      // Study: what the session's loadQueue does, at the same moment — and, like the
      // old dailyStats seeding did, a WRITE after awaiting the introduced-today numbers
      // (it failed with "Readwrite transaction in liveQuery context" while that
      // computation was a promise shared with the live query).
      const study = getStudyQueue(undefined, 0);
      const writeAfter = (async () => {
        for (let i = 0; i < round; i++) await db.decks.toArray(); // let the live query's querier get ahead
        const m = await introducedTodayFromEvents();
        await db.dailyStats.put({ id: 'probe', date: 'probe', deck_id: 'd1', new_cards_studied: m.get('d1')?.primary ?? 0 });
      })();
      const [pool, queue] = await Promise.all([home, study, writeAfter]);
      expect(pool).toBeGreaterThan(0);
      expect(queue.dueCards.length).toBeGreaterThan(0);
      await db.dailyStats.clear();
    }
  });
});
