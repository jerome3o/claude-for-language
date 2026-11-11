import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAY_ROLLOVER_HOUR,
  dayRolloverHour,
  dayRolloverLabel,
  pickDayRolloverUpdate,
  localTimeToInstant,
  shiftedDayKey,
  sqliteDayModifier,
  studyCutoffMs,
  studyDayAt,
  studyDayAtOffset,
  studyDayKey,
  studyDayShiftMinutes,
  zoneOffsetMinutes,
} from './studyDay';
import { pickTodaysReader, shouldGenerateDailyReader } from './daily-reader';
import { introducedToday } from '../decks/study-queue';
import { shouldCelebrate, celebrationMark } from './celebration';

const LONDON = 'Europe/London';
const LA = 'America/Los_Angeles';
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('study day: the rule', () => {
  it('defaults to 4 am; NULL / invalid read as the default', () => {
    expect(DEFAULT_DAY_ROLLOVER_HOUR).toBe(4);
    expect(dayRolloverHour(null)).toBe(4);
    expect(dayRolloverHour(undefined)).toBe(4);
    expect(dayRolloverHour(7)).toBe(4);
    expect(dayRolloverHour(2.5)).toBe(4);
    expect(dayRolloverHour('3')).toBe(4);
    expect(dayRolloverHour(0)).toBe(0);
    expect(dayRolloverHour(6)).toBe(6);
  });

  it('01:30 local with a 4 am rollover is still yesterday', () => {
    // 11 Nov 2026 01:30 in London (GMT) = 01:30Z.
    const day = studyDayAt(Date.UTC(2026, 10, 11, 1, 30), 4, LONDON);
    expect(day.key).toBe('2026-11-10');
    expect(iso(day.startMs)).toBe('2026-11-10T04:00:00.000Z');
    expect(iso(day.endMs)).toBe('2026-11-11T04:00:00.000Z');
    // 04:00 sharp is the new day.
    expect(studyDayKey(Date.UTC(2026, 10, 11, 4, 0), 4, LONDON)).toBe('2026-11-11');
    expect(studyDayKey(Date.UTC(2026, 10, 11, 3, 59, 59, 999), 4, LONDON)).toBe('2026-11-10');
  });

  it('a rollover of 0 is the calendar day (the old midnight behaviour)', () => {
    for (const zone of [LONDON, LA, 'Asia/Shanghai', 'UTC']) {
      for (const ms of [Date.UTC(2026, 10, 11, 0, 30), Date.UTC(2026, 6, 1, 23, 10), Date.UTC(2026, 2, 8, 9, 0)]) {
        const day = studyDayAt(ms, 0, zone);
        const local = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
        expect(day.key).toBe(local);
        expect(studyDayKey(day.startMs, 0, zone)).toBe(day.key);
        expect(studyDayKey(day.startMs - 1, 0, zone)).not.toBe(day.key);
      }
    }
  });

  it('the device zone path matches the old setHours(0) / setHours(23,59,59,999) at rollover 0', () => {
    const now = Date.UTC(2026, 10, 11, 15, 0);
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const eod = new Date(now); eod.setHours(23, 59, 59, 999);
    const day = studyDayAt(now, 0);
    expect(day.startMs).toBe(start.getTime());
    expect(studyCutoffMs(now, day)).toBe(Math.max(eod.getTime(), now + H));
  });

  it('London spring forward (29 Mar 2026, 01:00 GMT → 02:00 BST)', () => {
    // Rollover 1: 01:00 local does not exist → moved later by the gap (02:00 BST = 01:00Z).
    const d1 = studyDayAt(Date.UTC(2026, 2, 29, 1, 30), 1, LONDON);
    expect(d1.key).toBe('2026-03-29');
    expect(iso(d1.startMs)).toBe('2026-03-29T01:00:00.000Z');
    expect(iso(d1.endMs)).toBe('2026-03-30T00:00:00.000Z'); // 01:00 BST
    // Rollover 4: a 23-hour day.
    const d4 = studyDayAt(Date.UTC(2026, 2, 29, 12), 4, LONDON);
    expect(iso(d4.startMs)).toBe('2026-03-29T03:00:00.000Z');
    expect(d4.endMs - d4.startMs).toBe(24 * H);
    const before = studyDayAt(Date.UTC(2026, 2, 29, 0, 30), 4, LONDON);
    expect(before.key).toBe('2026-03-28');
    expect(iso(before.startMs)).toBe('2026-03-28T04:00:00.000Z');
    expect(before.endMs - before.startMs).toBe(23 * H);
    expect(localTimeToInstant(2026, 3, 29, 1, LONDON)).toBe(Date.UTC(2026, 2, 29, 1));
  });

  it('London fall back (25 Oct 2026, 02:00 BST → 01:00 GMT)', () => {
    // Rollover 1: 01:00 happens twice → the earlier (01:00 BST = 00:00Z).
    const d1 = studyDayAt(Date.UTC(2026, 9, 25, 0, 30), 1, LONDON);
    expect(d1.key).toBe('2026-10-25');
    expect(iso(d1.startMs)).toBe('2026-10-25T00:00:00.000Z');
    expect(studyDayAt(Date.UTC(2026, 9, 25, 1, 30), 1, LONDON).key).toBe('2026-10-25');
    // Rollover 4: the night is a 25-hour day.
    const night = studyDayAt(Date.UTC(2026, 9, 25, 2), 4, LONDON);
    expect(night.key).toBe('2026-10-24');
    expect(iso(night.startMs)).toBe('2026-10-24T03:00:00.000Z');
    expect(iso(night.endMs)).toBe('2026-10-25T04:00:00.000Z');
    expect(night.endMs - night.startMs).toBe(25 * H);
  });

  it('Los Angeles spring forward (8 Mar 2026, 02:00 PST → 03:00 PDT)', () => {
    // Rollover 2: 02:00 local does not exist → 03:00 PDT = 10:00Z.
    const d = studyDayAt(Date.UTC(2026, 2, 8, 12), 2, LA);
    expect(d.key).toBe('2026-03-08');
    expect(iso(d.startMs)).toBe('2026-03-08T10:00:00.000Z');
    expect(iso(d.endMs)).toBe('2026-03-09T09:00:00.000Z');
    // 01:59 PST is still the 7th; 03:00 PDT is the 8th.
    expect(studyDayKey(Date.UTC(2026, 2, 8, 9, 59), 2, LA)).toBe('2026-03-07');
    expect(studyDayKey(Date.UTC(2026, 2, 8, 10, 0), 2, LA)).toBe('2026-03-08');
    // Rollover 4: a 23-hour day.
    const d4 = studyDayAt(Date.UTC(2026, 2, 8, 9), 4, LA); // 01:00 PST
    expect(d4.key).toBe('2026-03-07');
    expect(d4.endMs - d4.startMs).toBe(23 * H);
  });

  it('Los Angeles fall back (1 Nov 2026, 02:00 PDT → 01:00 PST)', () => {
    // Rollover 1: 01:00 twice → the earlier (01:00 PDT = 08:00Z).
    const d1 = studyDayAt(Date.UTC(2026, 10, 1, 12), 1, LA);
    expect(iso(d1.startMs)).toBe('2026-11-01T08:00:00.000Z');
    const d4 = studyDayAt(Date.UTC(2026, 10, 1, 9, 30), 4, LA); // 01:30 PST, the second time
    expect(d4.key).toBe('2026-10-31');
    expect(d4.endMs - d4.startMs).toBe(25 * H);
    expect(iso(d4.endMs)).toBe('2026-11-01T12:00:00.000Z');
  });

  it('every instant lies inside its own day, and days tile without gaps', () => {
    for (const zone of [LONDON, LA, 'Australia/Lord_Howe', 'Asia/Kolkata']) {
      for (const r of [0, 1, 2, 3, 4, 5, 6]) {
        let ms = Date.UTC(2026, 2, 1);
        let prev = studyDayAt(ms, r, zone);
        for (let k = 0; k < 24 * 50; k++) {
          ms += H * 0.75;
          const day = studyDayAt(ms, r, zone);
          expect(ms >= day.startMs && ms < day.endMs).toBe(true);
          if (day.key !== prev.key) expect(day.startMs).toBe(prev.endMs);
          prev = day;
        }
      }
    }
  });

  it('a fixed offset and the SQL shift agree', () => {
    const ms = Date.UTC(2026, 10, 11, 1, 30);
    expect(studyDayAtOffset(ms, 4, 0).key).toBe('2026-11-10');
    expect(studyDayAtOffset(ms, 0, 0).key).toBe('2026-11-11');
    expect(studyDayAtOffset(ms, 4, 480).key).toBe('2026-11-11'); // 09:30 in Shanghai
    expect(studyDayShiftMinutes(-480, 4)).toBe(-720);
    expect(sqliteDayModifier(-240)).toBe('-240 minutes');
    expect(sqliteDayModifier(60)).toBe('+60 minutes');
    expect(sqliteDayModifier(0)).toBe('+0 minutes');
    for (const off of [-480, -300, 0, 60, 330, 780]) {
      for (const r of [0, 4, 6]) {
        for (let k = 0; k < 48; k++) {
          const t = ms + k * 1_800_000;
          const d = studyDayAtOffset(t, r, off);
          expect(shiftedDayKey(t, studyDayShiftMinutes(off, r))).toBe(d.key);
          expect(t >= d.startMs && t < d.endMs).toBe(true);
        }
      }
    }
  });

  it('zone offsets', () => {
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 1), LONDON)).toBe(60);
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 1), LONDON)).toBe(0);
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 1), LA)).toBe(-480);
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 1), 'Asia/Kolkata')).toBe(330);
  });

  it('the setting', () => {
    expect(pickDayRolloverUpdate({ day_rollover_hour: 3 })).toEqual({ value: 3, problems: [] });
    expect(pickDayRolloverUpdate({ day_rollover_hour: null })).toEqual({ value: null, problems: [] });
    expect(pickDayRolloverUpdate({ day_rollover_hour: 7 }).problems.length).toBe(1);
    expect(pickDayRolloverUpdate({ day_rollover_hour: -1 }).problems.length).toBe(1);
    expect(pickDayRolloverUpdate({}).problems.length).toBe(1);
    expect(dayRolloverLabel(0)).toBe('midnight');
    expect(dayRolloverLabel(4)).toBe('4 am');
  });
});

describe('study day: what it changes', () => {
  const late = (h: number, m = 0) => Date.UTC(2026, 10, 11, h, m); // London = UTC in November

  it('a reader read at 23:50 and the session at 00:30 is the same day: no new reader', () => {
    const readAt = Date.UTC(2026, 10, 10, 23, 50);
    const sessionAt = late(0, 30);
    const today = studyDayAt(sessionAt, 4, LONDON);
    const readToday = readAt >= today.startMs && readAt < today.endMs;
    expect(readToday).toBe(true);
    const readers = [{ id: 'next', created_at: iso(readAt), studyable: true, read: false }];
    expect(pickTodaysReader(readers, readToday)).toBeNull();
    expect(shouldGenerateDailyReader({ readToday, hasUnread: false, lastAttemptDate: null, today: today.key })).toBe(false);
    // With the old midnight rule it was a new day.
    const midnight = studyDayAt(sessionAt, 0, LONDON);
    expect(readAt >= midnight.startMs).toBe(false);
  });

  it('the new-card budget does not reset at midnight', () => {
    const cards = [
      { id: 'a', note_id: 'n1', deck_id: 'd', card_type: 'hanzi_to_meaning', queue: 1, due_ms: null },
      { id: 'b', note_id: 'n2', deck_id: 'd', card_type: 'hanzi_to_meaning', queue: 1, due_ms: null },
    ];
    // Two new words started at 22:00 and 23:30.
    const first = new Map([['a', Date.UTC(2026, 10, 10, 22)], ['b', Date.UTC(2026, 10, 10, 23, 30)]]);
    const at0030 = studyDayAt(late(0, 30), 4, LONDON);
    expect(introducedToday(cards, first, at0030.startMs).get('d')).toEqual({ primary: 2, secondary: 0 });
    // At 04:00 the budget is fresh.
    const at0400 = studyDayAt(late(4), 4, LONDON);
    expect(introducedToday(cards, first, at0400.startMs).get('d')).toBeUndefined();
  });

  it('the celebration does not come again at 00:30 for the same night', () => {
    const mark = celebrationMark(studyDayKey(Date.UTC(2026, 10, 10, 23, 40), 4, LONDON), 120);
    expect(shouldCelebrate(mark, studyDayKey(late(0, 30), 4, LONDON), 120, true)).toBe(false);
    expect(shouldCelebrate(mark, studyDayKey(late(0, 30), 0, LONDON), 120, true)).toBe(true);
  });

  it('the cutoff runs to the end of the study day', () => {
    const now = Date.UTC(2026, 10, 10, 22);
    expect(iso(studyCutoffMs(now, studyDayAt(now, 4, LONDON)))).toBe('2026-11-11T03:59:59.999Z');
    expect(iso(studyCutoffMs(now, studyDayAt(now, 0, LONDON)))).toBe('2026-11-10T23:59:59.999Z');
    const at0330 = late(3, 30);
    expect(iso(studyCutoffMs(at0330, studyDayAt(at0330, 4, LONDON)))).toBe('2026-11-11T04:30:00.000Z');
  });
});
