import { describe, it, expect } from 'vitest';
import {
  weekStart, ratePoints, knownRate, knownProgressWithRate, weekLabel, weekSummary, signedCount,
  paceLabel, paceTrendLabel, parseKnownChartMode, WEEK_MS,
} from './known-rate';
import { knownProgress, historyPoints, type KnownEventInput, type KnownPoint } from './known';

const DAY = 86_400_000;
// Monday 5 Jan 2026, 00:00 UTC.
const MON = Date.parse('2026-01-05T00:00:00.000Z');

const point = (at_ms: number, characters: number, words: number): KnownPoint =>
  ({ at_ms, characters: { known: characters, learning: 0 }, words: { known: words, learning: 0 } });

describe('weekStart', () => {
  it('is Monday 00:00 in the given offset', () => {
    expect(weekStart(MON, 0)).toBe(MON);
    expect(weekStart(MON + 3 * DAY + 5 * 3_600_000, 0)).toBe(MON);
    expect(weekStart(MON - 1, 0)).toBe(MON - 7 * DAY);
    // Sunday 23:30 UTC is already Monday 00:30 in UTC+1: that Monday, 23:00 UTC.
    expect(weekStart(MON + 6 * DAY + 23.5 * 3_600_000, 60)).toBe(MON + 7 * DAY - 3_600_000);
    // Monday 03:00 UTC is still Sunday 22:00 in New York (UTC−5).
    expect(weekStart(MON + 3 * 3_600_000, -300)).toBe(MON - 7 * DAY + 5 * 3_600_000);
  });
});

describe('ratePoints', () => {
  it('every Monday from the first review, 4 and 8 weeks ago, and now', () => {
    const now = MON + 70 * DAY + 10 * 3_600_000; // a Monday, 10:00
    const events: KnownEventInput[] = [{ card_id: 'c', rating: 2, reviewed_at: new Date(MON + 2 * DAY).toISOString() }];
    const pts = ratePoints(events, now, 0);
    const mondays = Array.from({ length: 11 }, (_, k) => MON + k * WEEK_MS);
    expect(pts).toEqual([...mondays, now - 8 * WEEK_MS, now - 4 * WEEK_MS, now].sort((a, b) => a - b));
  });
  it('no events → none; at most a year of weeks', () => {
    expect(ratePoints([], MON, 0)).toEqual([]);
    const events = [{ card_id: 'c', rating: 2, reviewed_at: new Date(MON - 500 * DAY).toISOString() }];
    const pts = ratePoints(events, MON + DAY, 0, 52);
    expect(pts[0]).toBe(MON - 52 * WEEK_MS);
  });
});

describe('knownRate', () => {
  const now = MON + 2 * WEEK_MS + 3 * DAY; // Thursday of the third week
  const history = [
    point(MON, 0, 0),
    point(MON + WEEK_MS, 10, 20),
    point(MON + 2 * WEEK_MS, 7, 25), // characters lapsed this week
    point(now, 12, 31),
  ];

  it('weekly buckets with the net change, a negative week and the partial current week', () => {
    const r = knownRate(history, MON + DAY, now, 0);
    expect(r.weeks).toEqual([
      { start_ms: MON, end_ms: MON + WEEK_MS, partial: false, characters: 10, words: 20 },
      { start_ms: MON + WEEK_MS, end_ms: MON + 2 * WEEK_MS, partial: false, characters: -3, words: 5 },
      { start_ms: MON + 2 * WEEK_MS, end_ms: now, partial: true, characters: 5, words: 6 },
    ]);
    expect(r.pace).toBeNull(); // under 4 weeks of history
  });

  it('nothing reviewed → no weeks, no pace', () => {
    expect(knownRate([], null, now, 0)).toEqual({ weeks: [], pace: null });
  });

  it('pace over the last 4 weeks vs the 4 before, rounded per week', () => {
    const n = MON + 10 * WEEK_MS;
    const h = [point(n - 8 * WEEK_MS, 100, 200), point(n - 4 * WEEK_MS, 150, 330), point(n, 250, 330)];
    const r = knownRate(h, MON, n, 0);
    expect(r.pace).toEqual({
      characters: { per_week: 25, previous_per_week: 13, trend: 'up' }, // 100 / 4, 50 / 4 = 12.5 → 13
      words: { per_week: 0, previous_per_week: 33, trend: 'down' }, // 130 / 4 = 32.5 → 33
    });
    // 5 weeks of history: a pace, no comparison yet.
    const r5 = knownRate(h, n - 5 * WEEK_MS, n, 0);
    expect(r5.pace?.words).toEqual({ per_week: 0, previous_per_week: null, trend: null });
  });

  it('a falling count gives a negative pace (never −0)', () => {
    const n = MON + 10 * WEEK_MS;
    const r = knownRate([point(n - 4 * WEEK_MS, 10, 10), point(n, 9, 2)], MON, n, 0);
    expect(r.pace?.characters.per_week).toBe(0);
    expect(Object.is(r.pace?.characters.per_week, -0)).toBe(false);
    expect(r.pace?.words.per_week).toBe(-2);
  });
});

describe('knownProgressWithRate', () => {
  it('the same totals and history as knownProgress, plus weeks that add up to the total', () => {
    const notes = [{ id: 'n1', hanzi: '你好' }, { id: 'n2', hanzi: '咖啡' }, { id: 'n3', hanzi: '吃饭' }];
    const cards = notes.map((n) => ({ id: `${n.id}c`, note_id: n.id }));
    const ev = (card: string, day: number, rating: number, i: number): KnownEventInput =>
      ({ id: `e${i}`, card_id: card, rating, reviewed_at: new Date(MON + day * DAY + 9 * 3_600_000).toISOString() });
    const events = [
      ev('n1c', 0, 3, 1), ev('n1c', 3, 3, 2),
      ev('n2c', 10, 3, 3), ev('n2c', 13, 3, 4),
      ev('n3c', 20, 3, 5), ev('n3c', 23, 3, 6), ev('n3c', 60, 0, 7), // n3 lapses on day 60
    ];
    const now = MON + 75 * DAY;
    const r = knownProgressWithRate(notes, cards, events, now, 0);
    const plain = knownProgress(notes, cards, events, historyPoints(events, now));
    expect({ ...r, rate: undefined }).toEqual({ ...plain, rate: undefined });
    const sum = (k: 'characters' | 'words') => r.rate.weeks.reduce((s, w) => s + w[k], 0);
    expect(sum('words')).toBe(r.words.known);
    expect(sum('characters')).toBe(r.characters.known);
    expect(r.rate.weeks.some((w) => w.words < 0)).toBe(true);
    expect(r.rate.weeks[r.rate.weeks.length - 1].partial).toBe(true);
    expect(r.rate.pace).not.toBeNull();
  });
});

describe('labels', () => {
  it('week, signed counts, pace', () => {
    const w = { start_ms: Date.parse('2026-10-06T00:00:00Z') - 3_600_000, end_ms: 0, partial: false, characters: 38, words: 61 };
    expect(weekLabel(w, 60)).toBe('Week of 6 Oct');
    expect(weekSummary(w, 60)).toBe('Week of 6 Oct · +38 characters · +61 words');
    expect(weekLabel({ ...w, partial: true }, 60)).toBe('Week of 6 Oct (so far)');
    expect(signedCount(-5)).toBe('−5');
    expect(signedCount(0)).toBe('0');
    expect(signedCount(1234)).toBe('+1,234');
    expect(paceLabel(42, 'words')).toBe('≈ 42 words / week');
    expect(paceLabel(-3, 'characters')).toBe('≈ −3 characters / week');
    expect(paceTrendLabel({ per_week: 42, previous_per_week: 30, trend: 'up' })).toBe('↑ from 30');
    expect(paceTrendLabel({ per_week: 2, previous_per_week: 30, trend: 'down' })).toBe('↓ from 30');
    expect(paceTrendLabel({ per_week: 30, previous_per_week: 30, trend: 'same' })).toBe('same as before');
    expect(paceTrendLabel({ per_week: 30, previous_per_week: null, trend: null })).toBeNull();
    expect(parseKnownChartMode('rate')).toBe('rate');
    expect(parseKnownChartMode('nonsense')).toBe('total');
  });
});
