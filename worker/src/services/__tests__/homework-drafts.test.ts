import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * services/homework-drafts.ts: the review view (dedupe against the student's
 * words, load now and after) and assigning a draft once, from its plan.
 */

const patchJob = vi.fn(async () => {});
vi.mock('../../db/tutor-notes-queries', () => ({
  patchJob: (...a: unknown[]) => patchJob(...(a as [])),
  getUserBrief: vi.fn(async () => ({ name: 'Jerome', bio: null })),
  findStudentWords: vi.fn(async () => new Map([['服务员', [{ deck_name: 'HSK 2', state: 'review' }]]])),
}));
vi.mock('../../db/homework-queries', () => ({
  listDeckNotes: vi.fn(async () => [
    { id: 'n1', hanzi: '菜单', pinyin: 'càidān', english: 'menu' },
    { id: 'n2', hanzi: '服务员', pinyin: 'fúwùyuán', english: 'waiter' },
    { id: 'n3', hanzi: '点菜', pinyin: 'diǎn cài', english: 'to order' },
  ]),
  listStudentHanzi: vi.fn(async () => ['服务员']),
  listBatchAssignments: vi.fn(async () => []),
}));
const assignHomework = vi.fn(async (_env: unknown, input: { items: Array<{ kind: string; source_id: string }> }) => ({
  assignments: input.items.map((i, n) => ({ id: `a${n}`, kind: i.kind, source_id: i.source_id, target_id: `copy-${i.source_id}` })),
  skipped: [],
  errors: [],
}));
vi.mock('../homework', () => ({
  assignHomework: (...a: unknown[]) => assignHomework(...(a as [unknown, { items: Array<{ kind: string; source_id: string }> }])),
  studentLoadInputs: vi.fn(async () => ({ active: [], fsrsWordsToGo: 10, newPerDay: 3 })),
  HomeworkError: class HomeworkError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('../tutor-notes-agent', () => ({
  draftContents: (r: { deck?: { id: string; name: string; note_count: number }; lessons?: Array<{ library_item_id: string; title: string }> }) => ({
    deck: r.deck ? { id: r.deck.id, title: r.deck.name, word_count: r.deck.note_count } : null,
    lessons: (r.lessons ?? []).map((l) => ({ id: l.library_item_id, title: l.title })),
    reader: null,
  }),
}));

import { buildDraftView, assignDraft, planToItems } from '../homework-drafts';
import { defaultDraftPlan } from '@shared/homework';

const today = '2026-09-27';
function job(over: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    relationship_id: 'rel',
    tutor_id: 't',
    student_id: 's',
    status: 'done',
    assigned_at: null,
    plan: null,
    chat: [],
    steps: [],
    transcript: [{ role: 'user', content: 'x' }],
    result: { deck: { id: 'deck-1', name: 'Restaurant', note_count: 3 }, lessons: [{ library_item_id: 'lib-1', title: '把', exercise_count: 3 }] },
    ...over,
  } as never;
}

beforeEach(() => {
  patchJob.mockClear();
  assignHomework.mockClear();
});

describe('buildDraftView', () => {
  it('skips the words the student has, says where they are, and projects the load', async () => {
    const view = await buildDraftView({ DB: {} } as never, job(), today);
    expect(view.words.map((w) => [w.hanzi, w.skipped, w.known?.deck_name ?? null])).toEqual([
      ['菜单', false, null],
      ['服务员', true, 'HSK 2'],
      ['点菜', false, null],
    ]);
    expect(view.kept_count).toBe(2);
    expect(view.load.fsrs.words_to_go).toBe(10);
    // default plan: words both (2 one-off words + 2 long-term), lesson one-off
    expect(view.load_after.one_off).toMatchObject({ items: 2, words: 2 });
    expect(view.load_after.fsrs.words_to_go).toBe(12);
    expect('transcript' in view.job).toBe(false);
  });

  it('keeps a known word the tutor included anyway', async () => {
    const plan = { ...defaultDraftPlan({ deck: { id: 'deck-1', title: 'Restaurant', word_count: 3 }, lessons: [] }, today), include_known: ['服务员'] };
    const view = await buildDraftView({ DB: {} } as never, job({ plan }), today);
    expect(view.kept_count).toBe(3);
  });
});

describe('assignDraft', () => {
  it('assigns the included items once, as one batch, and marks the job', async () => {
    const plan = defaultDraftPlan({ deck: { id: 'deck-1', title: 'Restaurant', word_count: 3 }, lessons: [{ id: 'lib-1', title: '把' }] }, today);
    plan.items[1].include = false;
    plan.split_days = 2;
    const items = planToItems(plan);
    expect(items).toEqual([
      { kind: 'deck', source_id: 'deck-1', mode: 'both', due_date: '2026-09-29', title: 'Restaurant', split_days: 2, priority: 'core', skip_known: true, include_known: [] },
    ]);
    const res = await assignDraft({} as never, job({ plan }), today);
    expect(assignHomework).toHaveBeenCalledWith({}, expect.objectContaining({ batchId: 'job-1', items }));
    expect(res.assignments).toHaveLength(1);
    expect(patchJob).toHaveBeenCalledWith(undefined, 'job-1', expect.objectContaining({ assigned_at: expect.any(String) }));
    await expect(assignDraft({} as never, job({ assigned_at: '2026-09-27T10:00:00Z' }), today)).rejects.toThrow(/already assigned/);
    await expect(assignDraft({} as never, job({ status: 'running' }), today)).rejects.toThrow(/not ready/);
  });
});
