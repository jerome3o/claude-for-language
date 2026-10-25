import { describe, expect, it } from 'vitest';
import {
  homeRowKind,
  homeworkRowActionConfirm,
  homeworkRowActionLabel,
  homeworkRowActions,
  homeworkRowActionToast,
  homeworkRowActionUndoable,
  liveSkip,
  isSkipped,
  toHomeworkItems,
  sortHomeworkItems,
  itemStatus,
  homeworkRowDetail,
  type HomeworkAssignment,
} from './index';

const base = { assignment_id: null, lesson_id: null, has_handwriting: false, skip_handwriting: false };

describe('homeworkRowActions — the long-press / ⋯ menu', () => {
  it("the tutor's homework: skip it (never delete her item)", () => {
    expect(homeworkRowActions({ ...base, kind: 'assignment', assignment_id: 'a1' })).toEqual(['skip_homework']);
    expect(homeworkRowActions({ ...base, kind: 'assignment', assignment_id: 'a1', lesson_id: 'l1', has_handwriting: true })).toEqual(['skip_homework', 'skip_handwriting']);
    expect(homeworkRowActions({ ...base, kind: 'tutor_lesson', assignment_id: 'a1', lesson_id: 'l1' })).toEqual(['skip_homework']);
  });
  it('a revision or his own lesson: done for good, delete', () => {
    expect(homeworkRowActions({ ...base, kind: 'revision', lesson_id: 'l1' })).toEqual(['done_for_good', 'delete_lesson']);
    expect(homeworkRowActions({ ...base, kind: 'lesson', lesson_id: 'l1', has_handwriting: true })).toEqual(['done_for_good', 'delete_lesson', 'skip_handwriting']);
    // A tutor lesson sent before assignments existed has no assignment to skip.
    expect(homeworkRowActions({ ...base, kind: 'tutor_lesson', lesson_id: 'l1' })).toEqual(['done_for_good', 'delete_lesson']);
  });
  it('no handwriting shortcut once the switch is on; nothing without a target', () => {
    expect(homeworkRowActions({ ...base, kind: 'lesson', lesson_id: 'l1', has_handwriting: true, skip_handwriting: true })).toEqual(['done_for_good', 'delete_lesson']);
    expect(homeworkRowActions({ ...base, kind: 'assignment' })).toEqual([]);
    expect(homeworkRowActions({ ...base, kind: 'revision' })).toEqual([]);
  });
  it('words', () => {
    expect(homeRowKind({ key: 'revision:x', kind: 'revision' })).toBe('revision');
    expect(homeRowKind({ key: 'lesson:x', kind: 'lesson' })).toBe('tutor_lesson');
    expect(homeRowKind({ key: 'a1', kind: 'deck' })).toBe('assignment');
    expect(homeworkRowActionLabel('done_for_good', 'revision')).toBe('Stop revising — done for good');
    expect(homeworkRowActionLabel('done_for_good', 'lesson')).toBe('Done for good — stop showing it');
    expect(homeworkRowActionConfirm('skip_homework', { title: '把', tutor_name: '明慧老师' })).toBe('Skip “把”? 明慧老师 will see it as skipped. You can undo this.');
    expect(homeworkRowActionConfirm('skip_homework', { title: '把', tutor_name: null })).toContain('Your tutor will see it');
    expect(homeworkRowActionConfirm('delete_lesson', { title: '把', tutor_name: null })).toBe("Delete “把”? This can't be undone.");
    expect(homeworkRowActionConfirm('done_for_good', { title: '把', tutor_name: null })).toBeNull();
    expect(homeworkRowActionToast('skip_homework', { tutor_name: '明慧老师' })).toBe('Skipped — 明慧老师 will see it');
    expect(homeworkRowActionUndoable('delete_lesson')).toBe(false);
    expect(homeworkRowActionUndoable('skip_homework')).toBe(true);
  });
});

function assignment(over: Partial<HomeworkAssignment> = {}): HomeworkAssignment {
  return {
    id: 'a1', relationship_id: 'r', tutor_id: 't', student_id: 's', batch_id: null, kind: 'lesson', target_id: 'l1', source_id: null,
    title: 'Writing 把', mode: 'one_off', due_date: '2026-10-01', item_ids: null, item_count: 1, part_index: 0, part_count: 1,
    status: 'active', done_count: 0, completed_at: null, created_at: '2026-09-30T00:00:00Z', updated_at: '2026-09-30T00:00:00Z', ...over,
  };
}

describe('skip events (docs/HOMEWORK.md §3d)', () => {
  const skip = { id: 'k1', assignment_id: 'a1', item_id: 'l1', result: 'skip' as const, created_at: '2026-10-02T09:00:00Z' };
  const undo = { id: 'u1', assignment_id: 'a1', item_id: 'l1', result: 'undo' as const, undoes: 'k1', created_at: '2026-10-02T09:01:00Z' };

  it('a live skip skips; its undo takes it back; the server copy counts until the device has its own events', () => {
    expect(liveSkip([skip])?.id).toBe('k1');
    expect(liveSkip([skip, undo])).toBeNull();
    expect(isSkipped([skip, undo], '2026-10-02T09:00:00Z')).toBe(false);
    expect(isSkipped([], '2026-10-02T09:00:00Z')).toBe(true);
    expect(isSkipped([], null)).toBe(false);
  });

  it('a skipped item leaves To do, keeps its due date, says "skipped"', () => {
    const items = toHomeworkItems([assignment()], [skip], '2026-10-03');
    expect(items[0]).toMatchObject({ skipped: true, skipped_at: '2026-10-02T09:00:00Z', done: false });
    const sorted = sortHomeworkItems(items);
    expect(sorted.todo).toHaveLength(0);
    expect(sorted.skipped).toHaveLength(1);
    expect(itemStatus(items[0], '2026-10-03')).toBe('skipped');
    expect(homeworkRowDetail(items[0], false)).toBe('skipped');
    const back = sortHomeworkItems(toHomeworkItems([assignment()], [skip, undo], '2026-10-03'));
    expect(back.todo).toHaveLength(1);
  });

  it('a skip never counts as an answer', () => {
    const deck = assignment({ kind: 'deck', item_ids: ['n1'], target_id: 'd1' });
    const items = toHomeworkItems([deck], [{ ...skip, item_id: 'd1' }], '2026-10-03');
    expect(items[0].progress.done).toBe(0);
    expect(items[0].bar.answered).toBe(0);
  });
});
