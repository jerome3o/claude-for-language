import { describe, it, expect } from 'vitest';
import {
  homeHomework,
  homeHomeworkRows,
  isLessonRow,
  compactDue,
  wordsMet,
  longTermActive,
  toHomeworkItems,
  sortHomeworkItems,
  dueLabel,
  type HomeworkAssignment,
  type LongTermHomework,
  type HomeLesson,
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

describe('row bars: only once started, with the orange retry part', () => {
  const deck = assignment({ id: 'a-deck', kind: 'deck', target_id: 'deck-1', item_ids: ['n1', 'n2'] });
  const lesson = assignment({ id: 'a-lesson', kind: 'lesson', target_id: 'lesson-1' });
  const runBar = { answered: 4, fresh: 3, retries: 1, itemsDone: 3, items: 7, slots: 8, doneFraction: 0.5, retryFraction: 0.125, onRetries: false, complete: false };

  it('no bar for a pass not started', () => {
    const rows = homeHomeworkRows(todo([deck, lesson]), []);
    expect(rows.map((r) => r.bar)).toEqual([null, null]);
  });

  it("a lesson row takes its run in progress's bar; a revision and a tutor's new lesson too", () => {
    const rows = homeHomeworkRows(todo([lesson]), [{ kind: 'lesson', target_id: 'lt', title: 'x', tutor_name: '明慧老师', sent_at: '2026-09-20T00:00:00Z', met: null, total: null, assignment_id: 'a-lt' }], {
      runBars: { 'lesson-1': runBar, rev: runBar, lt: { ...runBar, answered: 0 } },
      lessons: [
        { id: 'rev', title: 'Rev', created_at: '2026-09-01', status: 'revision', locked: false, revision_due: true, revision: 1, due_ms: 1, size: '', tutor_name: null },
        { id: 'lt', title: 'LT', created_at: '2026-09-02', status: 'new', locked: false, revision_due: false, revision: 0, due_ms: null, size: '', tutor_name: null },
      ],
    });
    expect(rows.map((r) => [r.key, r.bar?.answered ?? null, r.assignment_id, r.lesson_id])).toEqual([
      ['a-lesson', 4, 'a-lesson', 'lesson-1'],
      ['revision:rev', 4, null, 'rev'],
      // answered 0 = not started: no bar.
      ['lesson:lt', null, 'a-lt', 'lt'],
    ]);
  });

  it('a skipped assignment is not a row', () => {
    const items = sortHomeworkItems(toHomeworkItems([deck, lesson], [{ id: 'k1', assignment_id: 'a-lesson', item_id: 'lesson-1', result: 'skip', created_at: '2026-09-28T10:00:00Z' }], TODAY));
    expect(items.skipped.map((i) => i.assignment.id)).toEqual(['a-lesson']);
    expect(homeHomeworkRows(items.todo, []).map((r) => r.key)).toEqual(['a-deck']);
  });
});

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
    expect(rows[0]).toMatchObject({ icon: '🎓', progress: 'lesson', bar: null, due: 'overdue', tone: 'overdue', route: '/homework/a-lesson', assignment_id: 'a-lesson', lesson_id: 'lesson-1' });
    expect(rows[1]).toMatchObject({ icon: '📚', title: '餐厅点菜', progress: '1 / 4', due: 'due tomorrow', tone: 'soon', route: '/homework/a-deck', assignment_id: 'a-deck', lesson_id: null });
    // The pass's retry bar: Got it + Not yet = 2 steps, the Not yet owed once more (orange).
    expect(rows[1].bar).toMatchObject({ answered: 2, fresh: 2, retries: 1, slots: 5 });
    expect(rows[2]).toMatchObject({ icon: '📖', progress: 'reader', due: 'due in 4 days', tone: 'later', route: '/homework/a-reader' });
    expect(more).toBe(0);
    expect(heading).toBe('From 明慧老师');
  });

  it('a long-term deck (daily review only) is not a homework row; a long-term lesson only shows as a NEW lesson', () => {
    const longTerm: LongTermHomework[] = [
      { kind: 'deck', target_id: 'deck-lt', title: 'HSK 3', tutor_name: '明慧老师', sent_at: '2026-09-20T00:00:00Z', met: 5, total: 12 },
      { kind: 'deck', target_id: 'deck-unknown', title: 'Not synced', tutor_name: null, sent_at: '2026-09-26T00:00:00Z', met: null, total: null },
      { kind: 'lesson', target_id: 'lesson-lt', title: '了 lesson', tutor_name: '明慧老师', sent_at: '2026-09-25T00:00:00Z', met: null, total: null },
    ];
    expect(homeHomework([], longTerm).rows).toEqual([]);
    const lessons: HomeLesson[] = [
      { id: 'lesson-lt', title: '了 lesson', created_at: '2026-09-25T00:00:00Z', status: 'new', locked: false, revision_due: false, revision: 0, due_ms: null, size: '12 exercises · ~8 min', tutor_name: null },
    ];
    const { rows, heading } = homeHomework([], longTerm, { lessons });
    expect(rows.map((r) => [r.key, r.route, r.progress, r.size, r.due, r.tutor_name])).toEqual([
      ['lesson:lesson-lt', '/lessons/lesson-lt/play?from=home', 'new', '12 exercises · ~8 min', '', '明慧老师'],
    ]);
    expect(heading).toBe('From 明慧老师');
  });

  it('revisions due today come after the assignments, then new tutor-sent lessons; locked / done / not-yet-due ones never show', () => {
    const base = { created_at: '2026-09-20T00:00:00Z', locked: false, revision: 0, due_ms: null, size: '', tutor_name: null } as const;
    const lessons: HomeLesson[] = [
      { ...base, id: 'r2', title: 'Later revision', status: 'revision', revision_due: true, revision: 2, due_ms: 2000, size: '3 questions · ~2 min' },
      { ...base, id: 'r1', title: 'Old revision', status: 'revision', revision_due: true, revision: 1, due_ms: 1000, size: '5 questions · ~3 min' },
      { ...base, id: 'r3', title: 'Not yet', status: 'revision', revision_due: false, revision: 1, due_ms: 9000 },
      { ...base, id: 'n2', title: 'Newer', status: 'new', revision_due: false, created_at: '2026-09-22T00:00:00Z', size: '4 exercises · ~3 min' },
      { ...base, id: 'n1', title: 'Older', status: 'new', revision_due: false, created_at: '2026-09-21T00:00:00Z' },
      { ...base, id: 'lk', title: 'Locked', status: 'new', revision_due: false, locked: true },
      { ...base, id: 'dn', title: 'Done', status: 'done', revision_due: false },
      { ...base, id: 'lesson-1', title: 'Covered by its pass', status: 'new', revision_due: false },
    ];
    const sent = (id: string): LongTermHomework => ({ kind: 'lesson', target_id: id, title: id, tutor_name: '明慧老师', sent_at: '2026-09-20T00:00:00Z', met: null, total: null });
    const lesson = assignment({ id: 'a-lesson', kind: 'lesson', target_id: 'lesson-1', title: '把 sentences', due_date: '2026-09-28' });
    const { rows, more, heading } = homeHomework(todo([lesson, deck]), [sent('n1'), sent('n2'), sent('lk'), sent('dn')], { lessons, limit: 10, sizes: { 'lesson-1': '18 exercises · ~12 min' } });
    expect(rows.map((r) => r.key)).toEqual(['a-lesson', 'a-deck', 'revision:r1', 'revision:r2', 'lesson:n1', 'lesson:n2']);
    expect(rows[0].size).toBe('18 exercises · ~12 min');
    expect(rows[1].size).toBe('4 words');
    expect(rows[2]).toMatchObject({ icon: '🔁', progress: 'Revision 1', size: '5 questions · ~3 min', due: 'due today', tone: 'today', route: '/lessons/r1/play?from=home&mode=revision' });
    expect(more).toBe(0);
    expect(heading).toBe('Homework');
    expect(homeHomework([], [], { lessons }).heading).toBe('To do');
  });

  it('a NEW lesson is a row only when a tutor sent it for long-term review: never his own, never one whose assignment was cancelled', () => {
    const base = { created_at: '2026-09-20T00:00:00Z', locked: false, revision_due: false, revision: 0, due_ms: null, size: '', tutor_name: null } as const;
    const lessons: HomeLesson[] = [
      { ...base, id: 'own', title: 'China trip 5', status: 'new' },
      { ...base, id: 'companion', title: 'Podcast companion', status: 'new' },
      { ...base, id: 'took-back', title: '了 (cancelled)', status: 'new', tutor_name: '明慧老师' },
      { ...base, id: 'lt', title: '把 long-term', status: 'new' },
      { ...base, id: 'own-rev', title: 'China trip 1', status: 'revision', revision_due: true, revision: 1, due_ms: 1000 },
    ];
    const cancelled = assignment({ id: 'a-c', kind: 'lesson', target_id: 'took-back', status: 'cancelled' });
    const longTerm: LongTermHomework[] = [{ kind: 'lesson', target_id: 'lt', title: '把 long-term', tutor_name: '明慧老师', sent_at: '2026-09-21T00:00:00Z', met: null, total: null }];
    const all = homeHomeworkRows(todo([cancelled]), longTerm, { lessons });
    expect(all.map((r) => r.key)).toEqual(['revision:own-rev', 'lesson:lt']);
    expect(all[1]).toMatchObject({ progress: 'new', tutor_name: '明慧老师', route: '/lessons/lt/play?from=home' });
    expect(all.every(isLessonRow)).toBe(true);
    const card = homeHomework(todo([cancelled]), longTerm, { lessons, limit: 1 });
    expect(card.rows.map((r) => r.key)).toEqual(['revision:own-rev']);
    expect(card.more).toBe(1);
    // His own revision has no tutor: mixed → "Homework".
    expect(card.heading).toBe('Homework');
  });

  it('"+N more" counts exactly the rows past the limit (assignments, then the lesson rows /homework lists)', () => {
    const many = [1, 2, 3].map((i) => assignment({ id: `a${i}`, kind: 'deck', target_id: `d${i}`, item_ids: ['n'], due_date: `2026-10-0${i}` }));
    const base = { created_at: '2026-09-20T00:00:00Z', locked: false, revision: 1, due_ms: 1, size: '', tutor_name: '明慧老师' } as const;
    const lessons: HomeLesson[] = [1, 2, 3].map((i) => ({ ...base, id: `r${i}`, title: `R${i}`, status: 'revision' as const, revision_due: true }));
    const items = todo(many);
    const all = homeHomeworkRows(items, [], { lessons });
    const card = homeHomework(items, [], { lessons });
    expect(card.rows.length + card.more).toBe(all.length);
    expect(card.more).toBe(2);
    expect(all.filter(isLessonRow).map((r) => r.key)).toEqual(['revision:r1', 'revision:r2', 'revision:r3']);
    expect(all.filter((r) => !isLessonRow(r)).map((r) => r.key)).toEqual(['a1', 'a2', 'a3']);
    expect(card.heading).toBe('From 明慧老师');
  });

  it('only one-off rows (and long-term lessons) count: a long-term deck next to a one-off pass adds nothing', () => {
    const items = todo([deck]);
    const longTerm: LongTermHomework[] = [
      { kind: 'deck', target_id: 'deck-1', title: '餐厅点菜', tutor_name: '明慧老师', sent_at: '2026-09-27T00:00:00Z', met: 0, total: 4 },
      { kind: 'deck', target_id: 'deck-other', title: 'HSK 3', tutor_name: '明慧老师', sent_at: '2026-09-27T00:00:00Z', met: 1, total: 40 },
    ];
    const { rows } = homeHomework(items, longTerm);
    expect(rows.map((r) => r.key)).toEqual(['a-deck']);
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
