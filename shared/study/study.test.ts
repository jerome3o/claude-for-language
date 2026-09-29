import { describe, expect, it } from 'vitest';
import {
  ACTIVE_IDLE_MS,
  activeInteract,
  activePause,
  activeTotal,
  dayTotalAcrossDevices,
  emptyActiveTime,
  formatActiveMinutes,
  pendingActiveMs,
  pickStudyTimeDays,
  pruneActiveTime,
  todayStudyLine,
} from './activeTime';
import { resumeCardId, resumeElapsedMs, studyScope, type StudyResumePoint } from './resume';
import { celebrationMark, shouldCelebrate } from './celebration';

const D = '2026-09-29';
const T0 = 1_790_000_000_000;

describe('active study time', () => {
  it('accrues between interactions while they keep coming', () => {
    let s = activeInteract(emptyActiveTime(), T0, D);
    s = activeInteract(s, T0 + 10_000, D);
    s = activeInteract(s, T0 + 40_000, D);
    expect(s.totals[D]).toBe(40_000);
    expect(activeTotal(s, D, T0 + 45_000)).toBe(45_000);
  });

  it('pauses after the idle cut-off: a long gap only counts ~75 s', () => {
    let s = activeInteract(emptyActiveTime(), T0, D);
    s = activeInteract(s, T0 + 10 * 60_000, D); // came back after 10 minutes
    expect(s.totals[D]).toBe(ACTIVE_IDLE_MS);
    // Sitting idle: the running total stops growing at the cut-off.
    expect(activeTotal(s, D, T0 + 10 * 60_000 + 5 * 60_000)).toBe(2 * ACTIVE_IDLE_MS);
  });

  it('stops at once when backgrounded, and nothing accrues until the next interaction', () => {
    let s = activeInteract(emptyActiveTime(), T0, D);
    s = activePause(s, T0 + 20_000); // screen off 20 s after the last tap
    expect(s.last).toBeNull();
    expect(activeTotal(s, D, T0 + 3_600_000)).toBe(20_000);
    s = activeInteract(s, T0 + 3_600_000, D); // back an hour later
    expect(s.totals[D]).toBe(20_000);
    s = activeInteract(s, T0 + 3_605_000, D);
    expect(s.totals[D]).toBe(25_000);
  });

  it('pausing twice or with nothing pending changes nothing', () => {
    const s = emptyActiveTime();
    expect(activePause(s, T0)).toBe(s);
    const once = activePause(activeInteract(s, T0, D), T0 + 5_000);
    expect(activePause(once, T0 + 99_000)).toBe(once);
  });

  it('credits the interval to the day it started on, and a clock going back credits nothing', () => {
    let s = activeInteract(emptyActiveTime(), T0, '2026-09-28');
    s = activeInteract(s, T0 + 30_000, D);
    expect(s.totals).toEqual({ '2026-09-28': 30_000 });
    expect(pendingActiveMs(activeInteract(s, T0 + 60_000, D), T0 + 50_000)).toBe(0);
  });

  it('prunes old days and keeps the pending interval', () => {
    let s = activeInteract(emptyActiveTime(), T0, '2026-09-01');
    s = activeInteract(s, T0 + 1_000, D);
    const p = pruneActiveTime(s, '2026-09-16');
    expect(p.totals).toEqual({});
    expect(p.last).toEqual({ at: T0 + 1_000, day: D });
  });

  it('adds other devices from the server to this device', () => {
    expect(dayTotalAcrossDevices(10 * 60_000, 30 * 60_000, 8 * 60_000)).toBe(32 * 60_000);
    expect(dayTotalAcrossDevices(5_000, 0, 0)).toBe(5_000);
    expect(dayTotalAcrossDevices(0, 1_000, 2_000)).toBe(0);
  });

  it('formats minutes and the today line', () => {
    expect(formatActiveMinutes(0)).toBe('0 min');
    expect(formatActiveMinutes(20_000)).toBe('<1 min');
    expect(formatActiveMinutes(23 * 60_000 + 20_000)).toBe('23 min');
    expect(formatActiveMinutes(65 * 60_000)).toBe('1 h 5 min');
    expect(formatActiveMinutes(120 * 60_000)).toBe('2 h');
    expect(todayStudyLine(23 * 60_000, 142)).toBe('Today: 23 min · 142 reviews');
    expect(todayStudyLine(60_000, 1)).toBe('Today: 1 min · 1 review');
  });

  it('validates report rows', () => {
    const { days, problems } = pickStudyTimeDays([
      { date: D, active_ms: 1000 },
      { date: D, active_ms: 3000.4 },
      { date: '2026-09-28', active_ms: 5 },
      { date: 'yesterday', active_ms: 5 },
      { date: '2026-09-27', active_ms: -1 },
      { date: '2026-09-26', active_ms: 90_000_000 },
    ]);
    expect(days).toEqual([{ date: '2026-09-28', active_ms: 5 }, { date: D, active_ms: 3000 }]);
    expect(problems).toHaveLength(3);
    expect(pickStudyTimeDays('nope').problems).toEqual(['days must be an array']);
  });
});

describe('resume', () => {
  const point: StudyResumePoint = { day: D, scope: 'all', card_id: 'c2', revealed: true, answer: '你好', elapsed_ms: 12_000 };

  it('resumes the saved card when it is still due today in the same scope', () => {
    expect(resumeCardId(point, D, 'all', ['c1', 'c2'])).toBe('c2');
  });

  it('not on another day, in another scope, or once the card is no longer due', () => {
    expect(resumeCardId(point, '2026-09-30', 'all', ['c2'])).toBeNull();
    expect(resumeCardId(point, D, 'deck-1', ['c2'])).toBeNull();
    expect(resumeCardId(point, D, 'all', ['c1'])).toBeNull();
    expect(resumeCardId(null, D, 'all', ['c2'])).toBeNull();
  });

  it('scope and elapsed time', () => {
    expect(studyScope(undefined)).toBe('all');
    expect(studyScope('d1')).toBe('d1');
    expect(resumeElapsedMs(point)).toBe(12_000);
    expect(resumeElapsedMs({ ...point, elapsed_ms: -5 })).toBe(0);
    expect(resumeElapsedMs({ ...point, elapsed_ms: 9e9 })).toBe(3_600_000);
  });
});

describe('celebration', () => {
  it('celebrates emptying today\'s queue once', () => {
    expect(shouldCelebrate(null, D, 40, true)).toBe(true);
    const mark = celebrationMark(D, 40);
    expect(shouldCelebrate(mark, D, 40, true)).toBe(false); // reopening Study later
  });

  it('again when more cards became due and were cleared', () => {
    expect(shouldCelebrate(celebrationMark(D, 40), D, 46, true)).toBe(true);
  });

  it('never with cards left or nothing reviewed today; a new day starts over', () => {
    expect(shouldCelebrate(null, D, 40, false)).toBe(false);
    expect(shouldCelebrate(null, D, 0, true)).toBe(false);
    expect(shouldCelebrate(celebrationMark('2026-09-28', 90), D, 3, true)).toBe(true);
  });
});
