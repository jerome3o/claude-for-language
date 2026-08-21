import { describe, it, expect } from 'vitest';
import {
  getPendingCustomLessons,
  completeCustomLesson,
  MAX_LESSONS_PER_SESSION,
} from './custom-lesson-study';
import { selectNextItem, LESSON_MIX_INTERVAL } from '../hooks/useStudySession';
import { db, LocalCustomLesson, LocalCard, LocalReader, LocalGrammarLesson } from '../db/database';
import { CardQueue } from '../types';

function makeLesson(overrides: Partial<LocalCustomLesson> = {}): LocalCustomLesson {
  const id = overrides.id ?? `lesson-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: 'Ordering at a café',
    description: null,
    icon: '☕',
    source: 'mcp',
    status: 'active',
    created_at: '2026-08-01T00:00:00Z',
    spec: {
      title: 'Ordering at a café',
      sections: [
        {
          exercises: [
            { type: 'match', pairs: [{ hanzi: '咖啡', english: 'coffee' }, { hanzi: '茶', english: 'tea' }] },
          ],
        },
      ],
    },
    _synced_at: null,
    ...overrides,
  };
}

function makeCard(overrides: Partial<LocalCard> = {}): LocalCard {
  return {
    id: `card-${Math.random().toString(36).slice(2, 8)}`,
    note_id: `note-${Math.random().toString(36).slice(2, 8)}`,
    deck_id: 'deck-1',
    card_type: 'hanzi_to_meaning',
    queue: CardQueue.REVIEW,
    learning_step: 0,
    ease_factor: 2.5,
    interval: 3,
    repetitions: 2,
    next_review_at: null,
    due_timestamp: null,
    stability: 3,
    difficulty: 5,
    lapses: 0,
    last_reviewed_at: null,
    updated_at: new Date().toISOString(),
    _synced_at: null,
    ...overrides,
  } as LocalCard;
}

function makeReader(): LocalReader {
  return {
    id: 'reader-1',
    queue: CardQueue.NEW,
    due_timestamp: null,
  } as unknown as LocalReader;
}

describe('getPendingCustomLessons', () => {
  it('returns active lessons oldest first, capped per session', async () => {
    const lessons = Array.from({ length: MAX_LESSONS_PER_SESSION + 2 }, (_, i) =>
      makeLesson({ id: `l-${i}`, created_at: `2026-08-0${i + 1}T00:00:00Z` })
    );
    // Insert newest-first to prove ordering comes from created_at
    await db.customLessons.bulkPut([...lessons].reverse());
    await db.customLessons.put(makeLesson({ id: 'l-done', status: 'done', created_at: '2026-07-01T00:00:00Z' }));

    const pending = await getPendingCustomLessons();
    expect(pending.map(l => l.id)).toEqual(lessons.slice(0, MAX_LESSONS_PER_SESSION).map(l => l.id));
  });
});

describe('completeCustomLesson', () => {
  it('records an unsynced event and marks the lesson done', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-1' }));

    const event = await completeCustomLesson('l-1', 4, 5);

    expect(event._synced).toBe(0);
    expect(event.correct).toBe(4);
    expect((await db.customLessons.get('l-1'))?.status).toBe('done');
    expect(await getPendingCustomLessons()).toEqual([]);
  });
});

describe('selectNextItem lesson mixing', () => {
  const lesson = makeLesson({ id: 'l-mix' });

  it('interleaves a lesson into the card flow when the break is due', () => {
    const reviewCards = [makeCard(), makeCard()];
    const noBreak = selectNextItem(reviewCards, [], [lesson], false, null, [], new Set());
    expect(noBreak && 'card' in noBreak).toBe(true);

    const withBreak = selectNextItem(reviewCards, [], [lesson], true, null, [], new Set());
    expect(withBreak).toEqual({ customLesson: lesson });
  });

  it('lets learning cards due NOW win over a due lesson break', () => {
    const learningCard = makeCard({ queue: CardQueue.LEARNING, due_timestamp: Date.now() - 1000 });
    const selection = selectNextItem([learningCard], [], [lesson], true, null, [], new Set());
    expect(selection && 'card' in selection && selection.card.id === learningCard.id).toBe(true);
  });

  it('runs leftover lessons after the cards but before the readers', () => {
    const selection = selectNextItem([], [makeReader()], [lesson], false, null, [], new Set());
    expect(selection).toEqual({ customLesson: lesson });

    const afterLessons = selectNextItem([], [makeReader()], [], false, null, [], new Set());
    expect(afterLessons && 'reader' in afterLessons).toBe(true);
  });

  it('keeps grammar as the session closer', () => {
    const grammar = { grammar_point_id: 'gp-1' } as LocalGrammarLesson;
    const selection = selectNextItem([], [], [lesson], false, grammar, [], new Set());
    expect(selection).toEqual({ customLesson: lesson });

    const closing = selectNextItem([], [], [], false, grammar, [], new Set());
    expect(closing).toEqual({ grammar });
  });

  it('exposes the interleave interval as a sane constant', () => {
    expect(LESSON_MIX_INTERVAL).toBeGreaterThan(2);
  });
});
