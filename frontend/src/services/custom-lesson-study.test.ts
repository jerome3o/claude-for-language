import { describe, it, expect } from 'vitest';
import {
  getDueCustomLessons,
  completeCustomLesson,
  MAX_NEW_LESSONS_PER_SESSION,
  computeLessonState,
  uploadCustomLessonCompletions,
  uploadLessonAttemptMedia,
} from './custom-lesson-study';
import { selectNextItem, LESSON_MIX_INTERVAL } from '../hooks/useStudySession';
import { db, LocalCustomLesson, LocalCard, LocalReader, LocalGrammarLesson } from '../db/database';
import { CardQueue } from '../types';
import { MAX_LESSON_REVISITS_PER_DAY } from '@shared/study/revisit';
import { markRevisit, writeRevisitSettings } from './revisit';

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

  it('offers due revisits, most overdue first, ahead of new ones', async () => {
    const yesterday = Date.now() - 86_400_000;
    const lastWeek = Date.now() - 7 * 86_400_000;
    const nextMonth = Date.now() + 30 * 86_400_000;
    await db.customLessons.bulkPut([
      makeLesson({ id: 'l-due', queue: CardQueue.REVIEW, repetitions: 1, due_timestamp: yesterday }),
      makeLesson({ id: 'l-overdue', queue: CardQueue.REVIEW, repetitions: 1, due_timestamp: lastWeek }),
      makeLesson({ id: 'l-future', queue: CardQueue.REVIEW, repetitions: 1, due_timestamp: nextMonth }),
      makeLesson({ id: 'l-new' }),
    ]);

    const due = await getDueCustomLessons();
    expect(due.map(l => l.id)).toEqual(['l-overdue', 'l-due', 'l-new']);
  });

  it('a backlog of overdue lessons trickles back a couple a day, never floods in', async () => {
    await db.customLessons.bulkPut(
      Array.from({ length: 6 }, (_, i) => makeLesson({ id: `l-old-${i}`, queue: CardQueue.REVIEW, repetitions: 1, due_timestamp: Date.now() - (i + 1) * 86_400_000 })),
    );
    const due = await getDueCustomLessons();
    expect(due).toHaveLength(MAX_LESSON_REVISITS_PER_DAY);
    expect(due.map(l => l.id)).toEqual(['l-old-5', 'l-old-4']);
  });

  it('never offers a lesson that is done for good', async () => {
    await db.customLessons.bulkPut([
      makeLesson({ id: 'l-retired', queue: CardQueue.REVIEW, repetitions: 1, retired: true }),
      makeLesson({ id: 'l-new-retired', retired: true }),
    ]);
    expect(await getDueCustomLessons()).toEqual([]);
  });
});

describe('completeCustomLesson', () => {
  it('records a rated event; Good brings it back in two weeks, not today', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-1' }));

    const { event, newState } = await completeCustomLesson('l-1', 4, 5, 2);

    expect(event._synced).toBe(0);
    expect(event.rating).toBe(2);
    expect(newState.status).toBe('scheduled');
    expect(newState.gap_days).toBe(14);
    const lesson = await db.customLessons.get('l-1');
    expect(lesson?.queue).toBe(CardQueue.REVIEW);
    expect(lesson?.status).toBe('active');
    const days = ((lesson?.due_timestamp ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect((await getDueCustomLessons()).map(l => l.id)).not.toContain('l-1');
  });

  it('Again brings it back tomorrow, Hard in two days, Easy in six weeks', async () => {
    for (const [rating, gap] of [[0, 1], [1, 2], [3, 42]] as const) {
      await db.customLessons.put(makeLesson({ id: `l-${rating}` }));
      const { newState } = await completeCustomLesson(`l-${rating}`, 5, 5, rating);
      expect(newState.gap_days).toBe(gap);
    }
    expect((await getDueCustomLessons()).map(l => l.id)).toEqual([]);
  });

  it('the gap grows across repeated completions of the same lesson', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-3' }));

    const first = await completeCustomLesson('l-3', 3, 5, 2);
    const second = await completeCustomLesson('l-3', 5, 5, 2);

    expect(first.newState.gap_days).toBe(14);
    expect(second.newState.gap_days).toBe(28);
    expect(second.newState.finishes).toBe(2);
    expect(await db.customLessonCompletionEvents.where('lesson_id').equals('l-3').count()).toBe(2);
  });

  it('Done for good: recorded as finished, never scheduled again; Bring back makes it due', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-dfg' }));
    const { newState } = await completeCustomLesson('l-dfg', 5, 5, 2, undefined, [], { retire: true });
    expect(newState.status).toBe('retired');
    expect(await db.customLessonCompletionEvents.where('lesson_id').equals('l-dfg').count()).toBe(1);
    const marks = await db.revisitEvents.toArray();
    expect(marks).toMatchObject([{ item_kind: 'lesson', item_id: 'l-dfg', action: 'retire', _synced: 0 }]);
    expect((await db.customLessons.get('l-dfg'))?.retired).toBe(true);
    expect((await getDueCustomLessons()).map(l => l.id)).not.toContain('l-dfg');

    await markRevisit('lesson', 'l-dfg', 'restore');
    expect((await db.customLessons.get('l-dfg'))?.retired).toBe(false);
    expect((await getDueCustomLessons()).map(l => l.id)).toContain('l-dfg');
  });

  it('legacy completions without a rating count as Good', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-legacy' }));
    await db.customLessonCompletionEvents.put({ id: 'ev-old', lesson_id: 'l-legacy', correct: 1, total: 1, completed_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), rating: null, _synced: 1 });
    const state = await computeLessonState('l-legacy');
    expect(state.gap_days).toBe(14);
    expect(state.due_ms).toBeLessThan(Date.now()); // came back 6 days ago
  });

  it('a different account setting changes the gaps', async () => {
    writeRevisitSettings({ hard_days: 3, good_days: 7, easy_days: 30, growth: 3, cap_days: 60 });
    await db.customLessons.put(makeLesson({ id: 'l-custom' }));
    await completeCustomLesson('l-custom', 1, 1, 2);
    const { newState } = await completeCustomLesson('l-custom', 1, 1, 2);
    expect(newState.gap_days).toBe(21);
    localStorage.removeItem('revisitSettings');
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

describe('lesson attempts (per-exercise answers + recordings)', () => {
  const attempt = {
    started_at: '2026-09-27T10:00:00Z',
    duration_ms: 95_000,
    exercises: [
      { section: 0, index: 0, type: 'oral_expression', correct: true, points: 1, max_points: 1, duration_ms: 40_000,
        answer: { self_assessed: true, recording: { media_key: 's0e0', duration_ms: 12_000, mime: 'audio/webm' } } },
    ],
  };

  it('keeps the attempt on the completion event and queues the recording', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-att' }));
    const blob = new Blob(['voice'], { type: 'audio/webm' });

    const { event } = await completeCustomLesson('l-att', 1, 1, 2, attempt, [{ media_key: 's0e0', blob }]);

    expect((await db.customLessonCompletionEvents.get(event.id))?.attempt).toEqual(attempt);
    const media = await db.lessonAttemptMedia.get(event.id + ':s0e0');
    expect(media?._synced).toBe(0);
    expect(media?.attempt_id).toBe(event.id);
  });

  it('uploads the attempt with its event, then the recording by media key', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-up' }));
    const recording = { media_key: 's0e0', blob: new Blob(['v'], { type: 'audio/webm' }) };
    const { event } = await completeCustomLesson('l-up', 1, 1, 2, attempt, [recording]);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
      await uploadCustomLessonCompletions();
      await uploadLessonAttemptMedia();
    } finally {
      globalThis.fetch = realFetch;
    }

    const upload = calls.find(c => c.url.endsWith('/api/custom-lessons/offline-complete'))!;
    const sent = JSON.parse(String(upload.init.body)).events.find((e: { id: string }) => e.id === event.id);
    expect(sent.attempt).toEqual(attempt);
    const media = calls.find(c => c.url.includes('/api/lesson-attempts/' + event.id + '/media/s0e0'))!;
    expect(media.init.method).toBe('PUT');
    expect((await db.lessonAttemptMedia.get(event.id + ':s0e0'))?._synced).toBe(1);
  });
});

describe('selectNextItem with bumped cards ("⚡ Study it today")', () => {
  it('shows a bumped card first, even before a learning card due now', () => {
    const learning = makeCard({ queue: CardQueue.LEARNING, due_timestamp: Date.now() - 60_000 });
    const review = makeCard();
    const bumped = makeCard({ queue: CardQueue.NEW });
    const pick = selectNextItem([learning, review, bumped], [], [], false, null, [], new Set(), undefined, undefined, new Set([bumped.id]));
    expect(pick && 'card' in pick && pick.card.id).toBe(bumped.id);
  });

  it('keeps spacing a word’s siblings: a bumped card of a just-rated note waits', () => {
    const sibling = makeCard({ queue: CardQueue.NEW, note_id: 'n-recent' });
    const other = makeCard();
    const pick = selectNextItem([sibling, other], [], [], false, null, ['n-recent'], new Set(), undefined, undefined, new Set([sibling.id]));
    expect(pick && 'card' in pick && pick.card.id).toBe(other.id);
  });
});
