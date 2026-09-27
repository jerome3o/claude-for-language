import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * services/homework.ts: copying each kind to the student through the usual
 * share / assign paths, the rows written (split parts, one-off decks capped
 * out of the FSRS budget, dedupe), and progress recomputed from pass events.
 * Every store is mocked; the pure parts come from shared/homework.
 */

type Row = Record<string, any>;
const inserted: Row[] = [];
const events: Row[] = [];
const assignments = new Map<string, Row>();
const progress: Array<[string, number, string]> = [];

vi.mock('../../db/homework-queries', () => ({
  listDeckNotes: vi.fn(async () => [
    { id: 's1', hanzi: '菜单', pinyin: 'càidān', english: 'menu' },
    { id: 's2', hanzi: '服务员', pinyin: 'fúwùyuán', english: 'waiter' },
    { id: 's3', hanzi: '点菜', pinyin: 'diǎn cài', english: 'to order food' },
    { id: 's4', hanzi: '买单', pinyin: 'mǎidān', english: 'to pay the bill' },
  ]),
  listStudentHanzi: vi.fn(async () => ['服务员', '你好']),
  insertAssignments: vi.fn(async (_db: unknown, rows: Row[]) => {
    const out = rows.map((r, i) => ({ id: `a${inserted.length + i + 1}`, status: 'active', done_count: 0, completed_at: null, ...r }));
    inserted.push(...out);
    for (const a of out) assignments.set(a.id, a);
    return out;
  }),
  getAssignmentsByIds: vi.fn(async (_db: unknown, ids: string[]) => ids.map((id) => assignments.get(id)).filter(Boolean)),
  insertEvents: vi.fn(async (_db: unknown, _sid: string, list: Row[]) => {
    let n = 0;
    for (const e of list) if (!events.some((x) => x.id === e.id)) { events.push(e); n++; }
    return n;
  }),
  listEvents: vi.fn(async (_db: unknown, ids: string[]) => events.filter((e) => ids.includes(e.assignment_id))),
  setProgress: vi.fn(async (_db: unknown, id: string, done: number, status: string) => {
    progress.push([id, done, status]);
  }),
  listActiveForStudent: vi.fn(async () => []),
  countFsrsWordsToGo: vi.fn(async () => 30),
  getStudentBudget: vi.fn(async () => null),
}));

const shareDeck = vi.fn(async (_db: unknown, _rel: string, _tutor: string, _deck: string, _prio: string, opts: { excludeNoteIds?: Set<string> }) => {
  const kept = ['s1', 's2', 's3', 's4'].filter((id) => !opts.excludeNoteIds?.has(id));
  return { target_deck_id: 'student-deck', note_ids: kept.map((id) => `copy-${id}`) };
});
vi.mock('../conversations', () => ({ shareDeck: (...a: unknown[]) => shareDeck(...(a as Parameters<typeof shareDeck>)) }));

const updateDeckSettings = vi.fn(async () => ({}));
vi.mock('../content', () => ({ updateDeckSettings: (...a: unknown[]) => updateDeckSettings(...(a as [])) }));

vi.mock('../../db/lesson-library-queries', () => ({
  getLibraryItem: vi.fn(async (_db: unknown, id: string) => (id === 'lib-1' ? { id, spec: JSON.stringify({ title: '把 sentences', sections: [] }) } : null)),
  findAssignedCopy: vi.fn(async () => null),
  createAssignedLesson: vi.fn(async () => ({ id: 'student-lesson' })),
}));
vi.mock('../custom-lesson', () => ({ queueLessonImages: vi.fn(async () => undefined) }));
vi.mock('../shared-readers', () => ({
  shareReader: vi.fn(async () => ({ reader: { id: 'student-reader', title_english: 'At the restaurant', title_chinese: '在饭馆' } })),
}));

import { assignHomework, parseAssignItems, recordEvents, studentLoad, HomeworkError } from '../homework';

const db = {
  prepare: () => ({ bind: () => ({ first: async () => ({ id: 'deck-1', name: 'Restaurant' }) }) }),
} as unknown as D1Database;
const env = { DB: db } as never;
const base = { relationshipId: 'rel', tutorId: 'tutor', studentId: 'student', today: '2026-09-27' };

beforeEach(() => {
  inserted.length = 0;
  events.length = 0;
  assignments.clear();
  progress.length = 0;
  shareDeck.mockClear();
  updateDeckSettings.mockClear();
});

describe('parseAssignItems', () => {
  it('validates kind, source, mode and due date', () => {
    expect(() => parseAssignItems([])).toThrow(HomeworkError);
    expect(() => parseAssignItems([{ kind: 'quest', source_id: 'x', mode: 'fsrs' }])).toThrow(/kind/);
    expect(() => parseAssignItems([{ kind: 'deck', source_id: 'x', mode: 'sometimes' }])).toThrow(/mode/);
    expect(() => parseAssignItems([{ kind: 'deck', source_id: 'x', mode: 'one_off', due_date: 'friday' }])).toThrow(/due_date/);
    expect(parseAssignItems([{ kind: 'deck', source_id: 'x', mode: 'one_off' }])[0]).toMatchObject({ skip_known: true, priority: 'core', split_days: 1 });
  });
});

describe('assignHomework', () => {
  it('copies a one-off deck without the words the student has, caps it out of FSRS and splits it over days', async () => {
    const res = await assignHomework(env, { ...base, items: [{ kind: 'deck', source_id: 'deck-1', mode: 'one_off', due_date: '2026-09-29', split_days: 2 }] });
    expect(shareDeck.mock.calls[0][5].excludeNoteIds).toEqual(new Set(['s2']));
    expect(res.skipped).toEqual([{ source_id: 'deck-1', hanzi: ['服务员'] }]);
    expect(updateDeckSettings).toHaveBeenCalledWith(db, 'student', 'student-deck', { new_cards_per_day: 0, secondary_cards_per_day: 0 });
    expect(res.assignments.map((a) => [a.title, a.due_date, a.item_ids, a.mode])).toEqual([
      ['Restaurant · day 1 of 2', '2026-09-29', ['copy-s1', 'copy-s3'], 'one_off'],
      ['Restaurant · day 2 of 2', '2026-09-30', ['copy-s4'], 'one_off'],
    ]);
    expect(new Set(res.assignments.map((a) => a.batch_id)).size).toBe(1);
  });

  it('leaves a both / fsrs deck in the FSRS budget and gives fsrs-only no due date', async () => {
    const res = await assignHomework(env, {
      ...base,
      items: [
        { kind: 'deck', source_id: 'deck-1', mode: 'fsrs', due_date: '2026-09-29', skip_known: false },
        { kind: 'deck', source_id: 'deck-1', mode: 'both', include_known: ['服务员'] },
      ],
    });
    expect(updateDeckSettings).not.toHaveBeenCalled();
    expect(res.assignments[0]).toMatchObject({ mode: 'fsrs', due_date: null, item_count: 4 });
    expect(res.assignments[1]).toMatchObject({ mode: 'both', due_date: '2026-09-29', item_count: 4 });
  });

  it('assigns a library lesson and shares a reader, and reports a missing source without failing the rest', async () => {
    const res = await assignHomework(env, {
      ...base,
      items: [
        { kind: 'lesson', source_id: 'lib-1', mode: 'one_off', due_date: '2026-09-28' },
        { kind: 'lesson', source_id: 'nope', mode: 'one_off' },
        { kind: 'reader', source_id: 'reader-1', mode: 'both', due_date: '2026-09-30' },
      ],
    });
    expect(res.assignments.map((a) => [a.kind, a.target_id, a.title, a.item_count])).toEqual([
      ['lesson', 'student-lesson', '把 sentences', 1],
      ['reader', 'student-reader', 'At the restaurant', 1],
    ]);
    expect(res.errors).toEqual([{ source_id: 'nope', error: 'Lesson not found in your library' }]);
  });
});

describe('recordEvents', () => {
  it('stores events idempotently, only for the student\'s own assignments, and recomputes progress', async () => {
    const { assignments: [a] } = await assignHomework(env, { ...base, items: [{ kind: 'deck', source_id: 'deck-1', mode: 'one_off', skip_known: false }] });
    assignments.set('other', { id: 'other', student_id: 'someone-else', kind: 'lesson', target_id: 'l', item_ids: null, status: 'active', done_count: 0 });
    const batch = [
      { id: 'e1', assignment_id: a.id, item_id: 'copy-s1', result: 'right', created_at: '2026-09-27T10:00:00Z' },
      { id: 'e2', assignment_id: a.id, item_id: 'copy-s2', result: 'wrong', created_at: '2026-09-27T10:01:00Z' },
      { id: 'e3', assignment_id: 'other', item_id: 'l', result: 'done', created_at: '2026-09-27T10:02:00Z' },
      { id: 'bad', assignment_id: a.id, item_id: 'copy-s3', result: 'maybe' },
    ];
    let r = await recordEvents(db, 'student', batch);
    expect(r.accepted).toBe(2);
    expect(r.assignments[0]).toMatchObject({ done_count: 1, status: 'active' });

    r = await recordEvents(db, 'student', [
      ...batch.slice(0, 2),
      ...['copy-s2', 'copy-s3', 'copy-s4'].map((item, i) => ({ id: `f${i}`, assignment_id: a.id, item_id: item, result: 'right', created_at: `2026-09-27T11:0${i}:00Z` })),
    ]);
    expect(r.accepted).toBe(3);
    expect(r.assignments[0]).toMatchObject({ done_count: 4, status: 'done', completed_at: '2026-09-27T11:02:00.000Z' });
    expect(progress.at(-1)).toEqual([a.id, 4, 'done']);
  });
});

describe('studentLoad', () => {
  it('uses the default budget when the student has none set', async () => {
    const load = await studentLoad(db, 'student', '2026-09-27');
    expect(load.fsrs).toEqual({ words_to_go: 30, days_to_go: 10, new_per_day: 3 });
    expect(load.level).toBe('moderate');
  });
});
