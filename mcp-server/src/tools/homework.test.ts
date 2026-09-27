import { describe, it, expect } from 'vitest';
import { compactAssignment, compactLoad } from './homework';
import { computeHomeworkLoad, type HomeworkAssignment } from '../../../shared/homework';

const base: HomeworkAssignment = {
  id: 'a1',
  relationship_id: 'rel',
  tutor_id: 't',
  student_id: 's',
  batch_id: 'b',
  kind: 'deck',
  target_id: 'deck-copy',
  source_id: 'deck',
  title: 'Restaurant · day 1 of 2',
  mode: 'both',
  due_date: '2026-09-26',
  item_ids: ['n1', 'n2', 'n3'],
  item_count: 3,
  part_index: 0,
  part_count: 2,
  status: 'active',
  done_count: 1,
  completed_at: null,
  created_at: '2026-09-25T10:00:00Z',
  updated_at: '2026-09-25T10:00:00Z',
};

describe('homework tool shaping', () => {
  it('gives the chat the due label, progress and part', () => {
    expect(compactAssignment(base, '2026-09-27')).toEqual({
      id: 'a1',
      kind: 'deck',
      title: 'Restaurant · day 1 of 2',
      mode: 'both',
      status: 'active',
      due_date: '2026-09-26',
      due: 'overdue',
      progress: '1/3 words',
      part: '1 of 2',
      target_id: 'deck-copy',
      source_id: 'deck',
    });
    expect(compactAssignment({ ...base, kind: 'lesson', mode: 'fsrs', due_date: null, part_count: 1, done_count: 0 }, '2026-09-27')).toMatchObject({ progress: 'not started' });
  });

  it('compacts the load gauge', () => {
    const load = computeHomeworkLoad({ assignments: [base], today: '2026-09-27', fsrsWordsToGo: 9, newPerDay: 3 });
    const c = compactLoad(load);
    expect(c.level).toBe('moderate');
    expect(c.one_off).toMatchObject({ pending_items: 1, pending_words: 2, overdue_items: 1 });
    expect(c.one_off.next_7_days[0]).toBe('2026-09-27: 0 items, 0 words');
    expect(c.long_term).toEqual({ words_to_go: 9, days_to_go: 3, new_per_day: 3 });
  });
});
