import { describe, it, expect } from 'vitest';
import {
  homeHomework,
  compactDue,
  wordsMet,
  longTermActive,
  toHomeworkItems,
  sortHomeworkItems,
  dueLabel,
  type HomeworkAssignment,
  type LongTermHomework,
} from './index';

const TODAY = '2026-09-29';

function assignment(over: Partial<HomeworkAssignment> & Pick<HomeworkAssignment, 'id' | 'kind' | 'target_id'>): HomeworkAssignment {
  return {
    relationship_id: 'rel-1',
    tutor_id: 'tutor',
    student_id: 'me',
    batch_id: null,
    source_id: null,
    title: over.id,
    mode: 'one_off',
    due_date: '2026-09-30',
    item_ids: null,
    item_count: 0,
    part_index: 0,
    part_count: 1,
    status: 'active',
    done_count: 0,
    completed_at: null,
    created_at: '2026-09-27T10:00:00.000Z',
    updated_at: '2026-09-27T10:00:00.000Z',
    tutor_name: '明慧老师',
    ...over,
  };
}

function todo(assignments: HomeworkAssignment[], events: Array<{ assignment_id: string; item_id: string; result: 'right' | 'wrong' | 'done' }> = []) {
  return sortHomeworkItems(toHomeworkItems(assignments, events.map((e, i) => ({ ...e, created_at: `2026-09-28T10:0${i}:00Z` })), TODAY)).todo;
}

describe('compactDue', () => {
  it('says "due tomorrow" for one day out and keeps the rest', () => {
    expect(compactDue(dueLabel('2026-09-30', TODAY))).toBe('due tomorrow');
    expect(compactDue(dueLabel('2026-09-29', TODAY))).toBe('due today');
    expect(compactDue(dueLabel('2026-09-28', TODAY))).toBe('overdue');
    expect(compactDue(dueLabel('2026-10-02', TODAY))).toBe('due in 3 days');
    expect(compactDue(dueLabel(null, TODAY))).toBe('');
  });
});

describe('homeHomework rows', () => {
  const deck = assignment({ id: 'a-deck', kind: 'deck', target_id: 'deck-1', title: '餐厅点菜', item_ids: ['n1', 'n2', 'n3', 'n4'], mode: 'both', due_date: '2026-09-30' });
  const lesson = assignment({ id: 'a-lesson', kind: 'lesson', target_id: 'lesson-1', title: '把 sentences', due_date: '2026-09-28' });
  const reader = assignment({ id: 'a-reader', kind: 'reader', target_id: 'reader-1', title: '小猫', due_date: '2026-10-03' });

  it('one-off rows: overdue first, "5 / 12" words, a tap opens the pass', () => {
    const items = todo([deck, lesson, reader], [
      { assignment_id: 'a-deck', item_id: 'n1', result: 'right' },
      { assignment_id: 'a-deck', item_id: 'n2', result: 'wrong' },
    ]);
    const { rows, more, heading } = homeHomework(items, []);
    expect(rows.map((r) => r.key)).toEqual(['a-lesson', 'a-deck', 'a-reader']);
    expect(rows[0]).toMatchObject({ icon: '🎓', progress: 'lesson', fraction: null, due: 'overdue', tone: 'overdue', route: '/homework/a-lesson' });
    expect(rows[1]).toMatchObject({ icon: '📚', title: '餐厅点菜', progress: '1 / 4', fraction: 0.25, due: 'due tomorrow', tone: 'soon', route: '/homework/a-deck' });
    expect(rows[2]).toMatchObject({ icon: '📖', progress: 'reader', due: 'due in 4 days', tone: 'later', route: '/homework/a-reader' });
    expect(more).toBe(0);
    expect(heading).toBe('From 明慧老师');
  });

  it('long-term deck (daily review only) opens the deck; a lesson sent outside an assignment opens /lessons', () => {
    const longTerm: LongTermHomework[] = [
      { kind: 'deck', target_id: 'deck-lt', title: 'HSK 3', tutor_name: '明慧老师', sent_at: '2026-09-20T00:00:00Z', met: 5, total: 12 },
      { kind: 'lesson', target_id: 'lesson-lt', title: '了 lesson', tutor_name: '明慧老师', sent_at: '2026-09-25T00:00:00Z', met: null, total: null },
    ];
    const { rows } = homeHomework([], longTerm);
    expect(rows.map((r) => [r.key, r.route, r.progress, r.due])).toEqual([
      ['lesson:lesson-lt', '/lessons', 'lesson', 'next session'],
      ['deck:deck-lt', '/decks/deck-lt', '5 / 12', 'daily review'],
    ]);
    expect(rows[1].fraction).toBeCloseTo(5 / 12);
  });

  it('a long-term deck whose words are all met, or covered by a one-off row, is left out', () => {
    const items = todo([deck]);
    const longTerm: LongTermHomework[] = [
      { kind: 'deck', target_id: 'deck-1', title: '餐厅点菜', tutor_name: '明慧老师', sent_at: '2026-09-27T00:00:00Z', met: 0, total: 4 },
      { kind: 'deck', target_id: 'deck-done', title: 'Done', tutor_name: '明慧老师', sent_at: '2026-09-27T00:00:00Z', met: 8, total: 8 },
      { kind: 'deck', target_id: 'deck-unknown', title: 'Not synced', tutor_name: null, sent_at: '2026-09-26T00:00:00Z', met: null, total: null },
    ];
    const { rows } = homeHomework(items, longTerm);
    expect(rows.map((r) => r.key)).toEqual(['a-deck', 'deck:deck-unknown']);
    expect(rows[1]).toMatchObject({ progress: '', fraction: null });
  });

  it('done one-off items and cancelled ones never show; the limit leaves a "more" count', () => {
    const done = assignment({ id: 'a-done', kind: 'lesson', target_id: 'l-done', status: 'done' });
    const cancelled = assignment({ id: 'a-cancel', kind: 'lesson', target_id: 'l-c', status: 'cancelled' });
    const many = [1, 2, 3, 4, 5].map((i) => assignment({ id: `a${i}`, kind: 'lesson', target_id: `l${i}`, due_date: `2026-10-0${i}` }));
    const { rows, more } = homeHomework(todo([done, cancelled, ...many]), [], { limit: 4 });
    expect(rows.map((r) => r.key)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(more).toBe(1);
  });

  it('heading: one tutor → "From <tutor>", several → "Homework"; the unread sender counts', () => {
    const other = assignment({ id: 'a-x', kind: 'lesson', target_id: 'lx', tutor_name: '王老师' });
    expect(homeHomework(todo([deck, other]), []).heading).toBe('Homework');
    expect(homeHomework([], [], { unreadFrom: '王老师' }).heading).toBe('From 王老师');
    expect(homeHomework(todo([deck]), [], { unreadFrom: '王老师' }).heading).toBe('Homework');
  });
});

describe('wordsMet / longTermActive', () => {
  it('counts words with any card out of NEW', () => {
    const cards = [
      { note_id: 'n1', queue: 0 },
      { note_id: 'n1', queue: 2 },
      { note_id: 'n2', queue: 0 },
      { note_id: 'n3', queue: 1 },
      { note_id: 'stranger', queue: 2 },
    ];
    expect(wordsMet(cards, ['n1', 'n2', 'n3'])).toEqual({ met: 2, total: 3 });
    expect(wordsMet([], [])).toEqual({ met: 0, total: 0 });
  });

  it('a deck stays active until every word is met; an empty deck is not active', () => {
    const base = { kind: 'deck' as const, target_id: 'd', title: 't', tutor_name: null, sent_at: '' };
    expect(longTermActive({ ...base, met: 2, total: 3 })).toBe(true);
    expect(longTermActive({ ...base, met: 3, total: 3 })).toBe(false);
    expect(longTermActive({ ...base, met: 0, total: 0 })).toBe(false);
    expect(longTermActive({ ...base, met: null, total: null })).toBe(true);
  });
});
