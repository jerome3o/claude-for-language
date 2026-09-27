import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db, type LocalHomeworkAssignment, type LocalCustomLesson } from '../db/database';
import { oneOffOnlyTargetIds, recordTargetDone, sortHomeworkItems, syncHomework, toHomeworkItems, recordPassEvent } from './homework';
import { getDueCustomLessons, completeCustomLesson } from './custom-lesson-study';
import { CardQueue } from '../types';

function assignment(over: Partial<LocalHomeworkAssignment> = {}): LocalHomeworkAssignment {
  return {
    id: over.id ?? `a-${Math.random().toString(36).slice(2, 8)}`,
    relationship_id: 'rel',
    tutor_id: 'tutor',
    student_id: 'me',
    batch_id: 'b',
    kind: 'deck',
    target_id: 'deck-1',
    source_id: 'src',
    title: '点菜 words',
    mode: 'one_off',
    due_date: '2026-09-28',
    item_ids: ['n1', 'n2'],
    item_count: 2,
    part_index: 0,
    part_count: 1,
    status: 'active',
    done_count: 0,
    completed_at: null,
    created_at: '2026-09-26T10:00:00Z',
    updated_at: '2026-09-26T10:00:00Z',
    tutor_name: 'Minghui',
    _synced_at: 0,
    ...over,
  };
}

function lesson(id: string): LocalCustomLesson {
  return {
    id,
    title: '把 sentences',
    description: null,
    icon: null,
    source: 'api',
    status: 'active',
    created_at: '2026-09-01T00:00:00Z',
    spec: { title: '把 sentences', sections: [{ exercises: [{ type: 'note', text: '把 moves the object before the verb.' }] }] },
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
  } as unknown as LocalCustomLesson;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ assignments: [], events: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('toHomeworkItems / sortHomeworkItems', () => {
  it('lists one-off items overdue first, hides fsrs-only and cancelled, and counts local events', () => {
    const items = toHomeworkItems(
      [
        assignment({ id: 'later', due_date: '2026-10-03' }),
        assignment({ id: 'overdue', due_date: '2026-09-25' }),
        assignment({ id: 'fsrs', mode: 'fsrs', due_date: null }),
        assignment({ id: 'cancelled', status: 'cancelled' }),
        assignment({ id: 'finished-here', due_date: '2026-09-27' }),
      ],
      [
        { id: 'e1', assignment_id: 'finished-here', item_id: 'n1', result: 'right', created_at: '1', _synced: 0 },
        { id: 'e2', assignment_id: 'finished-here', item_id: 'n2', result: 'right', created_at: '2', _synced: 0 },
        { id: 'e3', assignment_id: 'later', item_id: 'n1', result: 'right', created_at: '3', _synced: 1 },
      ],
      '2026-09-27'
    );
    const { todo, done } = sortHomeworkItems(items);
    expect(todo.map((i) => [i.assignment.id, i.due.text])).toEqual([
      ['overdue', 'overdue'],
      ['later', 'due in 6 days'],
    ]);
    expect(todo[1].progress.done).toBe(1);
    expect(done.map((i) => i.assignment.id)).toEqual(['finished-here']);
  });
});

describe('one-off lessons and readers stay out of FSRS', () => {
  it('excludes a one-off-only lesson from the session mix, keeps one that is also long-term', async () => {
    await db.customLessons.bulkPut([lesson('once'), lesson('both'), lesson('mine')]);
    await db.homeworkAssignments.bulkPut([
      assignment({ id: 'a1', kind: 'lesson', target_id: 'once', item_ids: null, item_count: 1 }),
      assignment({ id: 'a2', kind: 'lesson', target_id: 'both', mode: 'both', item_ids: null, item_count: 1 }),
    ]);
    expect(await oneOffOnlyTargetIds()).toEqual(new Set(['once']));
    const due = await getDueCustomLessons();
    expect(due.map((l) => l.id).sort()).toEqual(['both', 'mine']);
  });

  it('finishing a lesson records the homework as done (once) and uploads it', async () => {
    await db.customLessons.put(lesson('l1'));
    await db.homeworkAssignments.put(assignment({ id: 'a1', kind: 'lesson', target_id: 'l1', item_ids: null, item_count: 1 }));
    await completeCustomLesson('l1', 3, 3, 2);
    await recordTargetDone('lesson', 'l1');
    const events = await db.homeworkEvents.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ assignment_id: 'a1', item_id: 'l1', result: 'done' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/me/homework/events'), expect.objectContaining({ method: 'POST' }));
  });
});

describe('a word pass is not an FSRS review (Jerome: no tsunami of reviews)', () => {
  it('Got it / Not yet in a "both" pass write homework events only — no review events', async () => {
    await db.homeworkAssignments.put(assignment({ id: 'both', mode: 'both' }));
    const before = await db.reviewEvents.count();
    await recordPassEvent('both', 'n1', 'wrong');
    await recordPassEvent('both', 'n1', 'right');
    await recordPassEvent('both', 'n2', 'right');
    expect(await db.reviewEvents.count()).toBe(before);
    const events = await db.homeworkEvents.where('assignment_id').equals('both').toArray();
    expect(events.map((e) => e.result).sort()).toEqual(['right', 'right', 'wrong']);
  });
});

describe('syncHomework', () => {
  it('uploads local events, then mirrors the server (deletes gone rows, merges other devices\' events)', async () => {
    await db.homeworkAssignments.bulkPut([assignment({ id: 'keep' }), assignment({ id: 'gone' })]);
    await db.homeworkEvents.put({ id: 'local', assignment_id: 'keep', item_id: 'n1', result: 'right', created_at: '2026-09-27T09:00:00Z', _synced: 0 });
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: 1, assignments: [assignment({ id: 'keep', done_count: 1 })] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          assignments: [assignment({ id: 'keep', done_count: 2 }), assignment({ id: 'new', title: 'Reader', kind: 'reader' })],
          events: [{ id: 'other-device', assignment_id: 'keep', item_id: 'n2', result: 'right', created_at: '2026-09-27T10:00:00Z' }],
        }),
      });
    const r = await syncHomework();
    expect(r).toEqual({ uploaded: 1, assignments: 2 });
    expect((await db.homeworkAssignments.toArray()).map((a) => a.id).sort()).toEqual(['keep', 'new']);
    expect((await db.homeworkEvents.get('local'))?._synced).toBe(1);
    expect((await db.homeworkEvents.get('other-device'))?._synced).toBe(1);
    const items = toHomeworkItems(await db.homeworkAssignments.toArray(), await db.homeworkEvents.toArray(), '2026-09-27');
    expect(items.find((i) => i.assignment.id === 'keep')?.done).toBe(true);
  });

  it('keeps a pass event locally when the upload fails', async () => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('offline'));
    await recordPassEvent('a1', 'n1', 'wrong');
    await new Promise((r) => setTimeout(r, 0));
    const [e] = await db.homeworkEvents.toArray();
    expect(e).toMatchObject({ result: 'wrong', _synced: 0 });
  });
});
