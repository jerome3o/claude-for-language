import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Session notes create in the TUTOR's account; sending is a separate, explicit
 * step. `auto_share` is off unless a request says `true`; `sendJobItems` sends
 * only what the tutor picked (or everything unsent) through assignHomework.
 */

const createJob = vi.fn(async (_db: unknown, input: Record<string, unknown>) => ({ id: 'job-1', ...input }));
const patchJob = vi.fn(async () => undefined);
vi.mock('../../db/tutor-notes-queries', () => ({
  createJob: (...a: unknown[]) => createJob(...(a as [unknown, Record<string, unknown>])),
  countRunningJobs: vi.fn(async () => 0),
  patchJob: (...a: unknown[]) => patchJob(...(a as [])),
}));
vi.mock('../../db/insights-queries', () => ({
  createLessonLogEntry: vi.fn(async () => ({ id: 'log-1' })),
  createStudentLessonNote: vi.fn(async () => undefined),
}));

const assignHomework = vi.fn(async (_env: unknown, input: { items: Array<{ kind: string; source_id: string }> }) => ({
  assignments: input.items.map((i, n) => ({ id: `a${n}`, kind: i.kind, source_id: i.source_id })),
  skipped: [],
  errors: [],
  copies: input.items.map((i) => ({ kind: i.kind, source_id: i.source_id, target_id: `student-${i.source_id}`, target_name: i.source_id, share_id: i.kind === 'lesson' ? null : `share-${i.source_id}` })),
}));
vi.mock('../homework', () => ({ assignHomework: (...a: unknown[]) => assignHomework(...(a as [unknown, { items: Array<{ kind: string; source_id: string }> }])) }));

import { submitSessionNotes, wantsAutoShare } from '../tutor-notes-submit';
import { markSent, sendJobItems, unsentJobItems, SendJobError } from '../tutor-notes-send';
import type { TutorNotesJob, TutorNotesResult } from '../../db/tutor-notes-queries';

const result: TutorNotesResult = {
  deck: { id: 'deck-1', name: '饭馆', note_count: 12 },
  lessons: [{ library_item_id: 'lib-1', title: '把 sentences', exercise_count: 6 }],
  reader: { id: 'reader-1', title_english: 'At the restaurant', title_chinese: '在饭馆', page_count: 5 },
  summary: 'Made a deck, a lesson and a reader.',
};

function job(over: Partial<TutorNotesJob> = {}): TutorNotesJob {
  return {
    id: 'job-1', relationship_id: 'rel', tutor_id: 'tutor', student_id: 'student', title: null, notes: 'x'.repeat(40), lesson_at: null,
    priority: 'core', auto_share: 0, status: 'done', progress: 'Done', steps: [], transcript: null, rounds: 3, result, error: null,
    plan: null, chat: [], review: 0, ...over,
  } as unknown as TutorNotesJob;
}

beforeEach(() => {
  createJob.mockClear();
  patchJob.mockClear();
  assignHomework.mockClear();
});

describe('auto_share defaults to false', () => {
  it('only an explicit true sends automatically', () => {
    expect(wantsAutoShare({})).toBe(false);
    expect(wantsAutoShare(undefined)).toBe(false);
    expect(wantsAutoShare({ auto_share: false })).toBe(false);
    expect(wantsAutoShare({ auto_share: 'true' })).toBe(false);
    expect(wantsAutoShare({ auto_share: true })).toBe(true);
  });

  it('a job submitted without autoShare is stored with auto_share off', async () => {
    const env = { ANTHROPIC_API_KEY: 'k', TUTOR_NOTES_QUEUE: { send: vi.fn() }, DB: {} } as never;
    await submitSessionNotes(env, {
      relationshipId: 'rel', tutor: { id: 'tutor', name: 'Minghui', email: 'm@example.com' }, studentId: 'student',
      notes: '今天学了点菜、服务员、买单 and the 把 construction.', title: null, lessonAt: null, priority: 'core', logLesson: false,
    });
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob.mock.calls[0][1]).toMatchObject({ auto_share: false });
  });
});

describe('unsentJobItems', () => {
  it('lists every item still only in the tutor account', () => {
    expect(unsentJobItems(result).map((i) => i.key)).toEqual(['deck', 'lesson:lib-1', 'reader']);
  });

  it('leaves out sent, taken-back and empty items', () => {
    expect(unsentJobItems({
      deck: { id: 'd', name: 'd', note_count: 3, target_deck_id: 'x' },
      lessons: [{ library_item_id: 'l', title: 'l', exercise_count: 1, removed_at: '2026-10-01' }],
      reader: { id: 'r', title_english: 'r', title_chinese: 'r', page_count: 1, target_reader_id: 'y' },
    })).toEqual([]);
    expect(unsentJobItems({ deck: { id: 'd', name: 'd', note_count: 0 } })).toEqual([]);
  });
});

describe('sendJobItems', () => {
  const env = { DB: {} } as never;

  it('sends only the picked item and marks it sent', async () => {
    const out = await sendJobItems(env, job(), { keys: ['deck'], today: '2026-10-03' });
    expect(assignHomework).toHaveBeenCalledTimes(1);
    const input = assignHomework.mock.calls[0][1] as unknown as { items: Array<Record<string, unknown>>; studentId: string };
    expect(input.studentId).toBe('student');
    expect(input.items).toEqual([expect.objectContaining({ kind: 'deck', source_id: 'deck-1', mode: 'both', priority: 'core' })]);
    expect(out.sent.map((i) => i.key)).toEqual(['deck']);
    expect(out.job.result.deck?.target_deck_id).toBe('student-deck-1');
    expect(out.job.result.lessons?.[0].lesson_id).toBeUndefined();
    expect(out.job.result.reader?.target_reader_id).toBeUndefined();
    expect(patchJob).toHaveBeenCalledTimes(1);
  });

  it('"Send all" sends everything unsent', async () => {
    const out = await sendJobItems(env, job(), {});
    expect(out.sent.map((i) => i.key)).toEqual(['deck', 'lesson:lib-1', 'reader']);
    expect(unsentJobItems(out.job.result)).toEqual([]);
  });

  it('refuses unfinished jobs, drafts and nothing-left-to-send', async () => {
    await expect(sendJobItems(env, job({ status: 'running' }), {})).rejects.toBeInstanceOf(SendJobError);
    await expect(sendJobItems(env, job({ review: 1 } as never), {})).rejects.toThrow(/draft/);
    await expect(sendJobItems(env, job({ result: markSent(result, [{ kind: 'deck', source_id: 'deck-1', target_id: 't', target_name: 'n', share_id: 's' }, { kind: 'lesson', source_id: 'lib-1', target_id: 't', target_name: 'n', share_id: null }, { kind: 'reader', source_id: 'reader-1', target_id: 't', target_name: 'n', share_id: 's' }], 'now') }), {})).rejects.toThrow(/already been sent/);
    expect(assignHomework).not.toHaveBeenCalled();
  });
});
