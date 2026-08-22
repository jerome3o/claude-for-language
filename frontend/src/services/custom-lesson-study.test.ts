import { describe, it, expect } from 'vitest';
import {
  getDueCustomLessons,
  completeCustomLesson,
  MAX_NEW_LESSONS_PER_SESSION,
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
    queue: CardQueue.NEW,
    stability: 0,
    difficulty: 0,
    lapses: 0,
    interval: 0,
    repetitions: 0,
    next_review_at: null,
    due_timestamp: null,
    last_reviewed_at: null,
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

describe('getDueCustomLessons', () => {
  it('caps NEW lessons per session, oldest first', async () => {
    const lessons = Array.from({ length: MAX_NEW_LESSONS_PER_SESSION + 2 }, (_, i) =>
      makeLesson({ id: `l-${i}`, created_at: `2026-08-0${i + 1}T00:00:00Z` })
    );
    await db.customLessons.bulkPut([...lessons].reverse());

    const due = await getDueCustomLessons();
    expect(due.map(l => l.id)).toEqual(lessons.slice(0, MAX_NEW_LESSONS_PER_SESSION).map(l => l.id));
  });

  it('includes FSRS-due review lessons uncapped, ahead of new ones', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await db.customLessons.bulkPut([
      makeLesson({ id: 'l-due', queue: CardQueue.REVIEW, next_review_at: yesterday }),
      makeLesson({ id: 'l-future', queue: CardQueue.REVIEW, next_review_at: nextMonth }),
      makeLesson({ id: 'l-new' }),
    ]);

    const due = await getDueCustomLessons();
    expect(due.map(l => l.id)).toEqual(['l-due', 'l-new']);
  });

  it('includes learning lessons due by the study cutoff', async () => {
    await db.customLessons.bulkPut([
      makeLesson({ id: 'l-learning', queue: CardQueue.LEARNING, due_timestamp: Date.now() - 1000 }),
      makeLesson({ id: 'l-learning-tomorrow', queue: CardQueue.LEARNING, due_timestamp: Date.now() + 2 * 86_400_000 }),
    ]);

    const due = await getDueCustomLessons();
    expect(due.map(l => l.id)).toEqual(['l-learning']);
  });
});

describe('completeCustomLesson', () => {
  it('records a rated event and schedules the lesson with FSRS', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-1' }));

    const { event, newState } = await completeCustomLesson('l-1', 4, 5, 2);

    expect(event._synced).toBe(0);
    expect(event.rating).toBe(2);
    const lesson = await db.customLessons.get('l-1');
    // Rated Good on first study → learning phase, still active (never 'done')
    expect(lesson?.queue).toBe(newState.queue);
    expect(lesson?.status).toBe('active');
    expect(newState.queue).not.toBe(CardQueue.NEW);
  });

  it('Easy on a new lesson schedules it days out', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-2' }));

    const { newState } = await completeCustomLesson('l-2', 5, 5, 3);

    expect(newState.queue).toBe(CardQueue.REVIEW);
    expect(newState.next_review_at && newState.next_review_at > new Date().toISOString()).toBe(true);
    // Scheduled out — no longer due today
    expect((await getDueCustomLessons()).map(l => l.id)).not.toContain('l-2');
  });

  it('state accumulates across repeated completions of the same lesson', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-3' }));

    const first = await completeCustomLesson('l-3', 3, 5, 2);
    const second = await completeCustomLesson('l-3', 5, 5, 2);

    expect(second.newState.reps).toBeGreaterThan(first.newState.reps);
    expect(await db.customLessonCompletionEvents.where('lesson_id').equals('l-3').count()).toBe(2);
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
