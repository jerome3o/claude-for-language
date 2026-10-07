import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVISIT_SETTINGS,
  MAX_LESSON_REVISITS_PER_DAY,
  applyRevisitSettingsUpdate,
  computeRevisitState,
  isRevisitDue,
  nextGapDays,
  parseRevisitSettings,
  pickRevisitSettingsUpdate,
  pickRevisitsForToday,
  newLessonsIntroducedToday,
  pickNewLessonsForToday,
  revisitGapLabel,
  revisitPreviews,
  type RevisitEvent,
} from './revisit';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-01T09:00:00.000Z');
const at = (days: number) => new Date(T0 + days * DAY).toISOString();
let n = 0;
const rate = (days: number, rating: number | null): RevisitEvent => ({ id: `e${++n}`, at: at(days), kind: 'rating', rating });
const retire = (days: number): RevisitEvent => ({ id: `r${++n}`, at: at(days), kind: 'retire' });
const restore = (days: number): RevisitEvent => ({ id: `s${++n}`, at: at(days), kind: 'restore' });

describe('nextGapDays', () => {
  it('first finish: the rating sets the gap', () => {
    expect([0, 1, 2, 3].map(r => nextGapDays(0, r))).toEqual([1, 2, 14, 42]);
  });
  it('a legacy finish without a rating counts as Good', () => {
    expect(nextGapDays(0, null)).toBe(14);
  });
  it('later successful visits grow the gap (Hard less)', () => {
    expect(nextGapDays(14, 2)).toBe(28);
    expect(nextGapDays(14, 3)).toBe(42); // max(42, 28)
    expect(nextGapDays(42, 3)).toBe(84);
    expect(nextGapDays(14, 1)).toBeCloseTo(16.8);
    expect(nextGapDays(1, 1)).toBe(2); // max(base 2, 1.2)
  });
  it('is capped', () => {
    expect(nextGapDays(120, 2)).toBe(180);
    expect(nextGapDays(180, 3)).toBe(180);
  });
  it('Again resets to a day', () => {
    expect(nextGapDays(84, 0)).toBe(1);
  });
});

describe('computeRevisitState', () => {
  it('no history = new (and due)', () => {
    const s = computeRevisitState([]);
    expect(s.status).toBe('new');
    expect(isRevisitDue(s, T0)).toBe(true);
  });

  it('Good → back in 14 days, not later today', () => {
    const s = computeRevisitState([rate(0, 2)]);
    expect(s.status).toBe('scheduled');
    expect(s.due_ms).toBe(T0 + 14 * DAY);
    expect(isRevisitDue(s, T0 + 0.5 * DAY)).toBe(false);
    expect(isRevisitDue(s, T0 + 14 * DAY)).toBe(true);
  });

  it('grows across visits, resets on Again', () => {
    const s = computeRevisitState([rate(0, 2), rate(14, 2), rate(42, 2)]);
    expect(s.gap_days).toBe(56);
    expect(s.finishes).toBe(3);
    const again = computeRevisitState([rate(0, 2), rate(14, 2), rate(42, 0)]);
    expect(again.gap_days).toBe(1);
    expect(again.due_ms).toBe(T0 + 43 * DAY);
    const after = computeRevisitState([rate(0, 2), rate(14, 2), rate(42, 0), rate(43, 2)]);
    expect(after.gap_days).toBe(14);
  });

  it('replays in time order whatever the input order', () => {
    const a = computeRevisitState([rate(14, 2), rate(0, 3)]);
    const b = computeRevisitState([rate(0, 3), rate(14, 2)]);
    expect(a).toEqual(b);
    expect(a.gap_days).toBe(84);
  });

  it('done for good retires it; bring back makes it due at once', () => {
    const r = computeRevisitState([rate(0, 2), retire(0)]);
    expect(r.status).toBe('retired');
    expect(isRevisitDue(r, T0 + 999 * DAY)).toBe(false);
    const back = computeRevisitState([rate(0, 2), retire(0), restore(3)]);
    expect(back.status).toBe('scheduled');
    expect(back.due_ms).toBe(T0 + 3 * DAY);
    expect(back.gap_days).toBe(14);
    // A later finish continues from the kept gap.
    expect(computeRevisitState([rate(0, 2), retire(0), restore(3), rate(3, 2)]).gap_days).toBe(28);
  });

  it('a restore of something not retired changes nothing', () => {
    expect(computeRevisitState([rate(0, 2), restore(1)]).due_ms).toBe(T0 + 14 * DAY);
  });

  it('retiring a never-finished item retires it', () => {
    expect(computeRevisitState([retire(0)]).status).toBe('retired');
  });

  it('legacy rows (rating null) count as Good', () => {
    expect(computeRevisitState([rate(0, null), rate(14, null)]).gap_days).toBe(28);
  });

  it('custom settings', () => {
    const s = { hard_days: 3, good_days: 7, easy_days: 30, growth: 3, cap_days: 60, new_lessons_per_day: 1 };
    expect(computeRevisitState([rate(0, 2)], s).gap_days).toBe(7);
    expect(computeRevisitState([rate(0, 2), rate(7, 2)], s).gap_days).toBe(21);
    expect(computeRevisitState([rate(0, 2), rate(7, 2), rate(28, 2)], s).gap_days).toBe(60);
    // Hard grows at most by growth when growth < 1.2
    expect(nextGapDays(10, 1, { ...s, growth: 1.1 })).toBe(11);
  });
});

describe('revisitPreviews / labels', () => {
  it('previews from the current gap', () => {
    expect(revisitPreviews(computeRevisitState([]))).toEqual([1, 2, 14, 42]);
    expect(revisitPreviews(computeRevisitState([rate(0, 2)]))).toEqual([1, 16.8, 28, 42]);
  });
  it('labels', () => {
    expect([1, 2, 13, 14, 16.8, 42, 84, 180, 400].map(revisitGapLabel)).toEqual(
      ['1 day', '2 days', '13 days', '2 wk', '2 wk', '6 wk', '3 mo', '6 mo', '1.1 yr'],
    );
  });
});

describe('pickRevisitsForToday', () => {
  const items = [
    { item: 'a', state: computeRevisitState([rate(-30, 2)]) }, // due -16
    { item: 'b', state: computeRevisitState([rate(-20, 2)]) }, // due -6
    { item: 'c', state: computeRevisitState([rate(-40, 2)]) }, // due -26
    { item: 'd', state: computeRevisitState([rate(-1, 2)]) }, // not due
    { item: 'e', state: computeRevisitState([]) }, // new: not a revisit
    { item: 'f', state: computeRevisitState([rate(-90, 2), retire(-90)]) },
  ];
  it('most overdue first, a couple a day', () => {
    expect(pickRevisitsForToday(items, T0, 0)).toEqual(['c', 'a']);
    expect(MAX_LESSON_REVISITS_PER_DAY).toBe(2);
  });
  it('counts what was already revisited today', () => {
    expect(pickRevisitsForToday(items, T0, 1)).toEqual(['c']);
    expect(pickRevisitsForToday(items, T0, 2)).toEqual([]);
  });
});

describe('settings', () => {
  it('validates an update', () => {
    expect(pickRevisitSettingsUpdate({ good_days: 10, growth: '1.5' })).toEqual({ update: { good_days: 10, growth: 1.5 }, problems: [] });
    expect(pickRevisitSettingsUpdate({ good_days: 0 }).problems).toHaveLength(1);
    expect(pickRevisitSettingsUpdate({ hard_days: 2.5 }).problems).toHaveLength(1);
    expect(pickRevisitSettingsUpdate({ growth: 9 }).problems).toHaveLength(1);
    expect(pickRevisitSettingsUpdate({ cap_days: 5000 }).problems).toHaveLength(1);
    expect(pickRevisitSettingsUpdate({ hard_days: 20 }).problems).toEqual(['the gaps must go up: Hard ≤ Good ≤ Easy']);
    expect(pickRevisitSettingsUpdate({ hard_days: null }).update).toEqual({ hard_days: null });
  });
  it('applies an update, null = default', () => {
    const s = applyRevisitSettingsUpdate({ ...DEFAULT_REVISIT_SETTINGS, good_days: 10 }, { good_days: null, easy_days: 60 });
    expect(s).toEqual({ ...DEFAULT_REVISIT_SETTINGS, easy_days: 60 });
  });
  it('parses stored JSON safely', () => {
    expect(parseRevisitSettings(null)).toEqual(DEFAULT_REVISIT_SETTINGS);
    expect(parseRevisitSettings('not json')).toEqual(DEFAULT_REVISIT_SETTINGS);
    expect(parseRevisitSettings('{"good_days":7,"growth":1.5}')).toEqual({ ...DEFAULT_REVISIT_SETTINGS, good_days: 7, growth: 1.5 });
    expect(parseRevisitSettings({ good_days: 9999 })).toEqual(DEFAULT_REVISIT_SETTINGS);
  });
});

describe('new lessons per local day', () => {
  const dayStart = Date.parse('2026-10-07T00:00:00.000Z');
  it('counts lessons whose FIRST finish is today', () => {
    const events = [
      { lesson_id: 'a', completed_at: '2026-10-07T08:00:00.000Z' }, // new today
      { lesson_id: 'b', completed_at: '2026-10-01T08:00:00.000Z' }, // a revisit today, not new
      { lesson_id: 'b', completed_at: '2026-10-07T09:00:00.000Z' },
      { lesson_id: 'c', completed_at: '2026-10-07T10:00:00.000Z' }, // one-off homework: excluded
    ];
    expect(newLessonsIntroducedToday(events, dayStart)).toBe(2);
    expect(newLessonsIntroducedToday(events, dayStart, new Set(['c']))).toBe(1);
  });
  it('picks the oldest new lessons that still fit today', () => {
    const fresh = [
      { id: 'x', created_at: '2026-10-03' },
      { id: 'y', created_at: '2026-10-01' },
      { id: 'z', created_at: '2026-10-02' },
    ];
    expect(pickNewLessonsForToday(fresh, 0).map(l => l.id)).toEqual(['y']);
    expect(pickNewLessonsForToday(fresh, 1)).toEqual([]);
    expect(pickNewLessonsForToday(fresh, 1, 3).map(l => l.id)).toEqual(['y', 'z']);
    expect(pickNewLessonsForToday(fresh, 0, 0)).toEqual([]);
  });
  it('is a setting: default 1, whole numbers 0–20', () => {
    expect(DEFAULT_REVISIT_SETTINGS.new_lessons_per_day).toBe(1);
    expect(pickRevisitSettingsUpdate({ new_lessons_per_day: 3 })).toEqual({ update: { new_lessons_per_day: 3 }, problems: [] });
    expect(pickRevisitSettingsUpdate({ new_lessons_per_day: 0 }).problems).toEqual([]);
    expect(pickRevisitSettingsUpdate({ new_lessons_per_day: 1.5 }).problems).toHaveLength(1);
    expect(pickRevisitSettingsUpdate({ new_lessons_per_day: 21 }).problems).toHaveLength(1);
    expect(parseRevisitSettings('{"new_lessons_per_day":2}').new_lessons_per_day).toBe(2);
    expect(parseRevisitSettings('{"new_lessons_per_day":99}').new_lessons_per_day).toBe(1);
  });
});
