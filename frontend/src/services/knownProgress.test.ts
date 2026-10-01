import { describe, it, expect, vi, afterEach } from 'vitest';
import { db, createLocalReviewEvent, type LocalCard, type LocalNote } from '../db/database';
import { CardQueue } from '../types';
import { loadKnownProgress, cachedKnownProgress } from './knownProgress';

function note(id: string, hanzi: string): LocalNote {
  return {
    id, deck_id: 'd1', hanzi, pinyin: '', english: '', audio_url: null, fun_facts: null,
    created_at: '2026-01-01', updated_at: '2026-01-01',
  } as LocalNote;
}

function card(id: string, noteId: string): LocalCard {
  return {
    id, note_id: noteId, deck_id: 'd1', card_type: 'hanzi_to_meaning', queue: CardQueue.NEW,
    stability: 0, difficulty: 0, lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0,
    next_review_at: null, due_timestamp: null, created_at: '2026-01-01', updated_at: '2026-01-01', _synced_at: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('loadKnownProgress', () => {
  it('counts from the device\'s notes, cards and events and remembers the result', async () => {
    vi.stubGlobal('Worker', undefined); // no workers in happy-dom: computed inline
    await db.notes.bulkPut([note('n1', '你好'), note('n2', '好吃'), note('n3', '我很好。')]);
    await db.cards.bulkPut([card('c1', 'n1'), card('c2', 'n2'), card('c3', 'n3')]);
    // 你好: Easy, then Easy three days later → stability ≈ 26 days: known.
    for (const [i, [cardId, rating, at]] of ([
      ['c1', 3, '2026-09-01T09:00:00.000Z'],
      ['c1', 3, '2026-09-04T09:00:00.000Z'],
      ['c2', 2, '2026-09-05T09:00:00.000Z'],
    ] as const).entries()) {
      await createLocalReviewEvent({
        id: `e${i}`, card_id: cardId, rating, reviewed_at: at, time_spent_ms: null, user_answer: null, _synced: 1,
      });
    }

    const p = await loadKnownProgress(Date.parse('2026-09-30T12:00:00.000Z'));
    expect(p.words).toEqual({ known: 1, learning: 1 });
    expect(p.characters).toEqual({ known: 2, learning: 1 }); // 你 好 known, 吃 learning
    expect(p.sentences).toEqual({ known: 0, learning: 0 });
    expect(p.history.length).toBeGreaterThan(2);
    expect(p.history[p.history.length - 1].characters.known).toBe(2);
    expect(cachedKnownProgress()).toEqual(p);
  });
});
