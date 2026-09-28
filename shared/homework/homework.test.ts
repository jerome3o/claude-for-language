import { describe, it, expect } from 'vitest';
import {
  addDays,
  daysBetween,
  dueLabel,
  compareDue,
  isDateString,
  shortDay,
  splitIntoDays,
  suggestSplitDays,
  clampSplitDays,
  passProgress,
  nextPassItem,
  passSummary,
  dedupeWords,
  computeHomeworkLoad,
  assignmentRowsFor,
  defaultDraftPlan,
  normalizeDraftPlan,
  plannedLoad,
  passItemIds,
  hasOneOff,
  hasFsrs,
  defaultHomeworkDueDate,
  lessonDay,
  DEFAULT_SEND_MODE,
  type LoadAssignmentInput,
} from './index';

describe('due dates', () => {
  it('does calendar arithmetic on date strings', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-09-27', '2026-09-30')).toBe(3);
    expect(daysBetween('2026-09-30', '2026-09-27')).toBe(-3);
    // DST change in Europe (25 Oct 2026) must not shift a day
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('validates date strings', () => {
    expect(isDateString('2026-09-27')).toBe(true);
    expect(isDateString('2026-02-30')).toBe(false);
    expect(isDateString('27/09/2026')).toBe(false);
    expect(isDateString(null)).toBe(false);
  });

  it('labels due dates the way the student reads them', () => {
    const today = '2026-09-27';
    expect(dueLabel('2026-09-26', today)).toEqual({ text: 'overdue', tone: 'overdue', days: -1 });
    expect(dueLabel('2026-09-27', today)).toEqual({ text: 'due today', tone: 'today', days: 0 });
    expect(dueLabel('2026-09-28', today)).toEqual({ text: 'due in 1 day', tone: 'soon', days: 1 });
    expect(dueLabel('2026-09-29', today).tone).toBe('soon');
    expect(dueLabel('2026-10-04', today)).toEqual({ text: 'due in 7 days', tone: 'later', days: 7 });
    expect(dueLabel(null, today)).toEqual({ text: '', tone: 'none', days: null });
  });

  it('sorts earliest first, undated last', () => {
    expect(['2026-10-02', null, '2026-09-28'].sort(compareDue)).toEqual(['2026-09-28', '2026-10-02', null]);
  });

  it('formats a short day', () => {
    expect(shortDay('2026-09-29')).toBe('Tue 29 Sep');
  });
});

describe('splitIntoDays', () => {
  const words = ['一', '二', '三', '四', '五', '六', '七'];

  it('makes balanced consecutive slices with one due date per day', () => {
    const parts = splitIntoDays(words, 3, '2026-09-28');
    expect(parts.map((p) => p.items)).toEqual([['一', '二', '三'], ['四', '五'], ['六', '七']]);
    expect(parts.map((p) => p.due_date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
  });

  it('never makes more parts than items, nor fewer than one', () => {
    expect(splitIntoDays(['一', '二'], 5, '2026-09-28')).toHaveLength(2);
    expect(splitIntoDays(words, 0, '2026-09-28')).toHaveLength(1);
    expect(splitIntoDays([], 3, '2026-09-28')).toEqual([]);
    expect(clampSplitDays(40, 100)).toBe(14);
  });

  it('suggests about ten words a day', () => {
    expect(suggestSplitDays(8)).toBe(1);
    expect(suggestSplitDays(24)).toBe(3);
  });
});

describe('the one-off pass', () => {
  const items = ['a', 'b', 'c'];

  it('shows every item once, then the missed ones until right', () => {
    let p = passProgress(items, []);
    expect(p.remaining).toEqual(['a', 'b', 'c']);
    expect(nextPassItem(p)).toBe('a');

    p = passProgress(items, [{ item_id: 'a', result: 'wrong', created_at: '2026-09-27T10:00:00Z' }]);
    expect(p.remaining).toEqual(['b', 'c', 'a']);
    expect(p.retrying).toBe(1);

    p = passProgress(items, [
      { item_id: 'a', result: 'wrong', created_at: '2026-09-27T10:00:00Z' },
      { item_id: 'b', result: 'right', created_at: '2026-09-27T10:01:00Z' },
      { item_id: 'c', result: 'wrong', created_at: '2026-09-27T10:02:00Z' },
    ]);
    // a was missed before c, so it comes back first
    expect(p.remaining).toEqual(['a', 'c']);
    expect(p.done).toBe(1);
    expect(p.complete).toBe(false);
  });

  it('is complete when every item was right once (a later miss does not undo it)', () => {
    const p = passProgress(items, [
      { item_id: 'a', result: 'right', created_at: '1' },
      { item_id: 'b', result: 'right', created_at: '2' },
      { item_id: 'c', result: 'wrong', created_at: '3' },
      { item_id: 'c', result: 'right', created_at: '4' },
      { item_id: 'a', result: 'wrong', created_at: '5' },
    ]);
    expect(p.complete).toBe(true);
    expect(p.remaining).toEqual([]);
    expect(passSummary(p, 'deck')).toBe('done');
  });

  it('ignores events for other items and treats done as right', () => {
    const p = passProgress(['lesson-1'], [
      { item_id: 'other', result: 'right', created_at: '1' },
      { item_id: 'lesson-1', result: 'done', created_at: '2' },
    ]);
    expect(p.complete).toBe(true);
    expect(passProgress([], []).complete).toBe(false);
  });

  it('summarises progress for a row', () => {
    expect(passSummary(passProgress(items, []), 'deck')).toBe('3 words');
    expect(passSummary(passProgress(items, [{ item_id: 'a', result: 'right', created_at: '1' }]), 'deck')).toBe('2 of 3 words left');
    expect(passSummary(passProgress(['x'], []), 'lesson')).toBe('not started');
  });

  it('walks deck parts by note id and lessons by their target', () => {
    expect(passItemIds({ kind: 'deck', item_ids: ['n1', 'n2'], target_id: 'd' })).toEqual(['n1', 'n2']);
    expect(passItemIds({ kind: 'lesson', item_ids: null, target_id: 'l1' })).toEqual(['l1']);
    expect(hasOneOff('both') && hasFsrs('both') && !hasOneOff('fsrs') && !hasFsrs('one_off')).toBe(true);
  });
});

describe('dedupeWords', () => {
  const words = [{ hanzi: '菜单' }, { hanzi: '服务员' }, { hanzi: '点菜' }, { hanzi: '菜单 ' }, { hanzi: '买单。' }];

  it('skips words the student has (normalised hanzi) and repeats within the draft', () => {
    const r = dedupeWords(words, ['服务员', '买单']);
    expect(r.keep.map((w) => w.hanzi)).toEqual(['菜单', '点菜']);
    expect(r.skipped.map((s) => [s.word.hanzi, s.reason])).toEqual([
      ['服务员', 'known'],
      ['菜单 ', 'repeat'],
      ['买单。', 'known'],
    ]);
  });

  it('keeps a known word the tutor chose to include anyway', () => {
    const r = dedupeWords(words, ['服务员'], ['服务员']);
    expect(r.keep.map((w) => w.hanzi)).toContain('服务员');
  });
});

describe('computeHomeworkLoad', () => {
  const today = '2026-09-27';
  const a = (over: Partial<LoadAssignmentInput>): LoadAssignmentInput => ({
    kind: 'deck', mode: 'one_off', status: 'active', due_date: today, item_count: 10, done_count: 0, ...over,
  });

  it('is light with nothing pending', () => {
    const load = computeHomeworkLoad({ assignments: [], today, fsrsWordsToGo: 0, newPerDay: 3 });
    expect(load.level).toBe('light');
    expect(load.summary).toBe('No one-off homework pending · nothing waiting in long-term review');
  });

  it('counts pending words, overdue and per-day, ignoring done / fsrs-only / cancelled', () => {
    const load = computeHomeworkLoad({
      assignments: [
        a({ due_date: '2026-09-25', item_count: 8, done_count: 3 }), // overdue, 5 left
        a({ due_date: today, item_count: 6 }),
        a({ kind: 'lesson', due_date: '2026-09-29', item_count: 1 }),
        a({ due_date: '2026-09-28', item_count: 4, done_count: 4 }), // finished
        a({ mode: 'fsrs', due_date: null }),
        a({ status: 'cancelled' }),
        a({ status: 'done' }),
      ],
      today,
      fsrsWordsToGo: 45,
      newPerDay: 3,
    });
    expect(load.one_off).toMatchObject({ items: 3, words: 11, other: 1, overdue_items: 1, overdue_words: 5, due_today_items: 1 });
    expect(load.one_off.by_day[0]).toEqual({ date: today, items: 1, words: 6 });
    expect(load.one_off.by_day[2]).toEqual({ date: '2026-09-29', items: 1, words: 0 });
    expect(load.fsrs).toEqual({ words_to_go: 45, days_to_go: 15, new_per_day: 3 });
    expect(load.level).toBe('moderate');
    expect(load.summary).toBe('3 one-off items pending (11 words, 1 lesson / reader) · 1 overdue · 45 words to go in long-term review (~15 days at 3/day)');
  });

  it('is heavy with a month of long-term words or lots overdue', () => {
    expect(computeHomeworkLoad({ assignments: [], today, fsrsWordsToGo: 120, newPerDay: 3 }).level).toBe('heavy');
    expect(computeHomeworkLoad({ assignments: [a({ due_date: '2026-09-20' }), a({ due_date: '2026-09-21' })], today, fsrsWordsToGo: 0, newPerDay: 3 }).level).toBe('heavy');
    expect(computeHomeworkLoad({ assignments: [], today, fsrsWordsToGo: 5, newPerDay: 0 }).fsrs.days_to_go).toBe(999);
  });
});

describe('assignmentRowsFor', () => {
  const today = '2026-09-27';
  const notes = ['n1', 'n2', 'n3', 'n4', 'n5'];

  it('splits a one-off deck over days', () => {
    const rows = assignmentRowsFor({ kind: 'deck', mode: 'both', title: 'Restaurant', due_date: '2026-09-29', split_days: 2 }, notes, today);
    expect(rows).toEqual([
      { title: 'Restaurant · day 1 of 2', due_date: '2026-09-29', item_ids: ['n1', 'n2', 'n3'], item_count: 3, part_index: 0, part_count: 2 },
      { title: 'Restaurant · day 2 of 2', due_date: '2026-09-30', item_ids: ['n4', 'n5'], item_count: 2, part_index: 1, part_count: 2 },
    ]);
  });

  it('gives an fsrs-only deck one undated row with every note', () => {
    expect(assignmentRowsFor({ kind: 'deck', mode: 'fsrs', title: 'D', due_date: '2026-09-29', split_days: 3 }, notes, today)).toEqual([
      { title: 'D', due_date: null, item_ids: notes, item_count: 5, part_index: 0, part_count: 1 },
    ]);
  });

  it('gives a lesson one row and a default due date when none was given', () => {
    expect(assignmentRowsFor({ kind: 'lesson', mode: 'one_off', title: 'L', due_date: null }, null, today)).toEqual([
      { title: 'L', due_date: '2026-09-29', item_ids: null, item_count: 1, part_index: 0, part_count: 1 },
    ]);
  });
});

describe('the draft plan', () => {
  const today = '2026-09-27';
  const contents = {
    deck: { id: 'deck-1', title: 'Restaurant', word_count: 20 },
    lessons: [{ id: 'lib-1', title: '把 sentences' }],
    reader: { id: 'r-1', title: 'At the restaurant' },
  };

  it('defaults to words one-off + long-term and the lesson / reader one-off, due in two days', () => {
    const plan = defaultDraftPlan(contents, today);
    expect(plan.split_days).toBe(1);
    expect(plan.items.map((i) => [i.key, i.mode, i.due_date, i.include])).toEqual([
      ['deck', 'both', '2026-09-29', true],
      ['lesson:lib-1', 'one_off', '2026-09-29', true],
      ['reader', 'one_off', '2026-09-29', true],
    ]);
  });

  it('normalises a plan against the draft: unknown items dropped, bad values fall back', () => {
    const plan = normalizeDraftPlan(
      {
        split_days: 40,
        priority: 'non_urgent',
        include_known: ['服务员', 3],
        items: [
          { key: 'deck', mode: 'fsrs', due_date: 'soon' },
          { key: 'lesson:lib-1', include: false, due_date: '2026-10-01' },
          { key: 'lesson:gone', mode: 'both' },
        ],
      },
      contents,
      today
    );
    expect(plan.split_days).toBe(14);
    expect(plan.priority).toBe('non_urgent');
    expect(plan.include_known).toEqual(['服务员']);
    expect(plan.items.map((i) => i.key)).toEqual(['deck', 'lesson:lib-1', 'reader']);
    expect(plan.items[0]).toMatchObject({ mode: 'fsrs', due_date: '2026-09-29' });
    expect(plan.items[1]).toMatchObject({ include: false, due_date: '2026-10-01' });
    expect(normalizeDraftPlan('nonsense', contents, today)).toEqual(defaultDraftPlan(contents, today));
  });

  it('projects what the plan adds to the load', () => {
    const plan = { ...defaultDraftPlan(contents, today), split_days: 2 };
    const { assignments, fsrsWords } = plannedLoad(plan, 12, today);
    expect(fsrsWords).toBe(12);
    expect(assignments.map((a) => [a.kind, a.item_count, a.due_date])).toEqual([
      ['deck', 6, '2026-09-29'],
      ['deck', 6, '2026-09-30'],
      ['lesson', 1, '2026-09-29'],
      ['reader', 1, '2026-09-29'],
    ]);
  });
});

describe('sending homework: defaults', () => {
  it('sends as both (one-off pass by a date, then long-term review)', () => {
    expect(DEFAULT_SEND_MODE).toBe('both');
  });

  it('is due at the next logged lesson, else in two days', () => {
    const today = '2026-09-28';
    expect(defaultHomeworkDueDate(today)).toBe('2026-09-30');
    expect(defaultHomeworkDueDate(today, [])).toBe('2026-09-30');
    // Past and same-day lessons don't count; the earliest future one wins.
    expect(defaultHomeworkDueDate(today, ['2026-09-21', '2026-09-28', '2026-10-06', '2026-10-01'])).toBe('2026-10-01');
    // A lesson more than two weeks out is too far to be "by the next lesson".
    expect(defaultHomeworkDueDate(today, ['2026-10-20'])).toBe('2026-09-30');
    expect(defaultHomeworkDueDate(today, [null, 'nope', undefined])).toBe('2026-09-30');
  });

  it('reads lesson-log timestamps as calendar days', () => {
    expect(lessonDay('2026-10-01')).toBe('2026-10-01');
    expect(lessonDay('garbage')).toBeNull();
    expect(lessonDay('2026-10-01T12:00:00.000Z')).toMatch(/^2026-10-0[12]$/);
  });
});
