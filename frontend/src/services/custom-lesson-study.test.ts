import { describe, it, expect } from 'vitest';
import {
  completeCustomLesson,
  lessonsToDo,
  uploadCustomLessonCompletions,
  uploadLessonAttemptMedia,
} from './custom-lesson-study';
import { selectNextItem } from '../hooks/useStudySession';
import { db, LocalCustomLesson, LocalCard, LocalReader, LocalGrammarLesson } from '../db/database';
import { CardQueue } from '../types';
import { computeLessonLearn, homeLessonOf, revisionKeysFor } from './lessonLearn';
import { loadLessonRun, saveLessonRun } from './lessonRuns';
import { lessonShape } from '@shared/study/lessonRun';

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

const wrongFirst = (missedIndex: number | null) => ({
  started_at: '2026-10-01T10:00:00Z',
  duration_ms: 60_000,
  exercises: [0, 1].map(i => ({
    section: 0, index: i, type: 'choice', correct: i !== missedIndex, points: i !== missedIndex ? 1 : 0, max_points: 1, duration_ms: 1000,
  })),
});
const twoQuestions = {
  title: 'Two', sections: [{ exercises: [
    { type: 'choice', question: '?', options: ['a', 'b'], answer: 0 },
    { type: 'choice', question: '?', options: ['a', 'b'], answer: 1 },
  ] }],
} as unknown as LocalCustomLesson['spec'];

describe('revise until right first time (services/lessonLearn)', () => {
  it('all right first time → done forever; a mistake → a revision in a week with that exercise', async () => {
    await db.customLessons.bulkPut([makeLesson({ id: 'perfect', spec: twoQuestions }), makeLesson({ id: 'missed', spec: twoQuestions })]);
    await completeCustomLesson('perfect', 2, 2, wrongFirst(null));
    const { newState } = await completeCustomLesson('missed', 1, 2, wrongFirst(1));
    expect((await computeLessonLearn('perfect')).status).toBe('done');
    expect(newState).toMatchObject({ status: 'revision', revision: 1, missed: ['s0e1'] });
    const row = (await db.customLessons.get('missed'))!;
    expect(row.learn?.status).toBe('revision');
    // The revision: the missed one + one of the others (≥ 1 extra).
    expect(revisionKeysFor(row)).toEqual(['s0e0', 's0e1']);
    expect((await db.customLessonCompletionEvents.toArray()).find(e => e.lesson_id === 'missed')?.outcome).toEqual({ keys: ['s0e0', 's0e1'], missed: ['s0e1'] });
  });

  it('a legacy finish with no answers follows its rating; an old Done for good is done forever', async () => {
    await db.customLessons.bulkPut([makeLesson({ id: 'hard' }), makeLesson({ id: 'good' }), makeLesson({ id: 'retired' })]);
    await db.customLessonCompletionEvents.bulkPut([
      { id: 'e1', lesson_id: 'hard', correct: 1, total: 2, completed_at: '2026-09-01T10:00:00Z', rating: 1, _synced: 1 },
      { id: 'e2', lesson_id: 'good', correct: 1, total: 2, completed_at: '2026-09-01T10:00:00Z', rating: 2, _synced: 1 },
      { id: 'e3', lesson_id: 'retired', correct: 1, total: 2, completed_at: '2026-09-01T10:00:00Z', rating: 0, _synced: 1 },
    ]);
    await db.revisitEvents.put({ id: 'm1', item_kind: 'lesson', item_id: 'retired', action: 'retire', created_at: '2026-09-01T10:00:01Z', _synced: 1 });
    expect(await computeLessonLearn('hard')).toMatchObject({ status: 'revision', full: true });
    expect((await computeLessonLearn('good')).status).toBe('done');
    expect((await computeLessonLearn('retired')).status).toBe('done');
  });

  it("Home's lessons to do: due revisions first, then new ones oldest first; locked / not-yet-due / done never", async () => {
    const day = 86_400_000;
    await db.customLessons.bulkPut([
      makeLesson({ id: 'new-2', created_at: '2026-08-02T00:00:00Z' }),
      makeLesson({ id: 'new-1', created_at: '2026-08-01T00:00:00Z' }),
      makeLesson({ id: 'locked', unlock: { kind: 'manual', prompt: 'Go to a café' }, unlocked_at: null }),
      makeLesson({ id: 'old-rev', spec: twoQuestions }),
      makeLesson({ id: 'fresh-rev', spec: twoQuestions }),
    ]);
    const old = new Date(Date.now() - 10 * day).toISOString();
    await db.customLessonCompletionEvents.bulkPut([
      { id: 'r1', lesson_id: 'old-rev', correct: 1, total: 2, completed_at: old, rating: null, outcome: { keys: ['s0e0', 's0e1'], missed: ['s0e0'] }, _synced: 1 },
      { id: 'r2', lesson_id: 'fresh-rev', correct: 1, total: 2, completed_at: new Date().toISOString(), rating: null, outcome: { keys: ['s0e0', 's0e1'], missed: ['s0e0'] }, _synced: 1 },
    ]);
    const { recomputeAllLessonLearn } = await import('./lessonLearn');
    await recomputeAllLessonLearn();
    expect((await lessonsToDo()).map(l => l.id)).toEqual(['old-rev', 'new-1', 'new-2']);
    const home = homeLessonOf((await db.customLessons.get('old-rev'))!, Date.now());
    expect(home).toMatchObject({ status: 'revision', revision_due: true, revision: 1 });
    expect(home.size).toMatch(/^2 questions · ~1 min$/);
  });

  it('a run left half-way is kept across days and dropped when the lesson changes shape', async () => {
    const lesson = makeLesson({ id: 'half', spec: twoQuestions });
    await db.customLessons.put(lesson);
    await saveLessonRun({
      lesson_id: 'half', shape: lessonShape(twoQuestions), mode: 'full', keys: null,
      state: { pos: 1, owed: ['s0e0'], fixed: 0 }, correct: 0, total: 1,
      started_at: '2026-09-01T20:00:00Z', saved_at: '2026-09-01T20:05:00Z',
      attempts: [], recordings: [{ media_key: 's0e0', blob: new Blob(['x']) }],
    });
    const back = await loadLessonRun('half', lessonShape(twoQuestions));
    expect(back?.state).toEqual({ pos: 1, owed: ['s0e0'], fixed: 0 });
    expect(back?.recordings).toHaveLength(1);
    expect(await loadLessonRun('half', 'note')).toBeNull();
    expect(await db.lessonRuns.get('half')).toBeUndefined();
  });

  it('finishing clears the saved run', async () => {
    await db.customLessons.put(makeLesson({ id: 'fin', spec: twoQuestions }));
    await saveLessonRun({
      lesson_id: 'fin', shape: lessonShape(twoQuestions), mode: 'full', keys: null,
      state: { pos: 1, owed: [], fixed: 0 }, correct: 1, total: 1,
      started_at: '2026-09-01T20:00:00Z', saved_at: '2026-09-01T20:05:00Z', attempts: [], recordings: [],
    });
    await completeCustomLesson('fin', 2, 2, wrongFirst(null));
    expect(await db.lessonRuns.get('fin')).toBeUndefined();
  });
});

describe('selectNextItem: no mini lessons in the session any more', () => {
  it('readers close out the session after the cards; grammar after the readers', () => {
    const grammar = { grammar_point_id: 'g', status: 'new' } as unknown as LocalGrammarLesson;
    const reviewCards = [makeCard()];
    expect(selectNextItem(reviewCards, [makeReader()], null, [], new Set())).toMatchObject({ card: reviewCards[0] });
    expect(selectNextItem([], [makeReader()], grammar, [], new Set())).toMatchObject({ reader: { id: 'reader-1' } });
    expect(selectNextItem([], [], grammar, [], new Set())).toMatchObject({ grammar });
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

    const { event } = await completeCustomLesson('l-att', 1, 1, attempt, [{ media_key: 's0e0', blob }]);

    expect((await db.customLessonCompletionEvents.get(event.id))?.attempt).toEqual(attempt);
    const media = await db.lessonAttemptMedia.get(event.id + ':s0e0');
    expect(media?._synced).toBe(0);
    expect(media?.attempt_id).toBe(event.id);
  });

  it('uploads the attempt with its event, then the recording by media key', async () => {
    await db.customLessons.put(makeLesson({ id: 'l-up' }));
    const recording = { media_key: 's0e0', blob: new Blob(['v'], { type: 'audio/webm' }) };
    const { event } = await completeCustomLesson('l-up', 1, 1, attempt, [recording]);

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
    const pick = selectNextItem([learning, review, bumped], [], null, [], new Set(), undefined, undefined, new Set([bumped.id]));
    expect(pick && 'card' in pick && pick.card.id).toBe(bumped.id);
  });

  it('keeps spacing a word’s siblings: a bumped card of a just-rated note waits', () => {
    const sibling = makeCard({ queue: CardQueue.NEW, note_id: 'n-recent' });
    const other = makeCard();
    const pick = selectNextItem([sibling, other], [], null, ['n-recent'], new Set(), undefined, undefined, new Set([sibling.id]));
    expect(pick && 'card' in pick && pick.card.id).toBe(other.id);
  });
});

describe('selectNextItem: a word of known characters starts with English → Chinese (shared/decks/lead-card.ts)', () => {
  it('offers the note’s meaning_to_hanzi card first, its hanzi_to_meaning card otherwise', () => {
    const read = makeCard({ queue: CardQueue.NEW, note_id: 'n-known', card_type: 'hanzi_to_meaning' });
    const write = makeCard({ queue: CardQueue.NEW, note_id: 'n-known', card_type: 'meaning_to_hanzi' });
    for (let i = 0; i < 20; i++) {
      const pick = selectNextItem([read, write], [], null, [], new Set(), undefined, undefined, new Set(), new Set(['n-known']));
      expect(pick && 'card' in pick && pick.card.id).toBe(write.id);
    }
    const usual = selectNextItem([read, write], [], null, [], new Set(), undefined, undefined, new Set(), new Set());
    expect(usual && 'card' in usual && usual.card.id).toBe(read.id);
  });
});
