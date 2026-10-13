import { describe, expect, it } from 'vitest';
import {
  canControlTimer,
  formatTimer,
  minutesLabel,
  parseTimerInput,
  reduceTimer,
  sanitizeTimer,
  sanitizeTimerAction,
  shouldChimeTimer,
  timerAria,
  timerByLine,
  timerDone,
  timerElapsed,
  timerEndsAt,
  timerFinishKey,
  timerLabel,
  timerShown,
  type CallTimer,
} from './timer';

const ids = () => {
  let n = 0;
  return () => `t${++n}`;
};
const ming = { userId: 'tutor', name: 'Minghui Li' };
const MIN = 60_000;

function countdown(minutes: number, at: number, start = true, newId = ids()): CallTimer {
  return reduceTimer(null, { kind: 'set', mode: 'countdown', duration_ms: minutes * MIN, start }, ming, at, newId)!;
}

describe('timer: who runs it', () => {
  it('the relationship’s tutor; anyone in a solo call', () => {
    expect(canControlTimer('tutor', 'tutor')).toBe(true);
    expect(canControlTimer('student', 'tutor')).toBe(false);
    expect(canControlTimer('me', null)).toBe(true);
  });

  it('cleans what clients send', () => {
    expect(sanitizeTimerAction({ kind: 'set', mode: 'countdown', duration_ms: 300_000.4, start: true })).toEqual({ kind: 'set', mode: 'countdown', duration_ms: 300_000, start: true });
    expect(sanitizeTimerAction({ kind: 'set', mode: 'countdown', duration_ms: 1000 })).toBeNull(); // under 5 s
    expect(sanitizeTimerAction({ kind: 'set', mode: 'countdown', duration_ms: 4 * 3600_000 })).toBeNull();
    expect(sanitizeTimerAction({ kind: 'set', mode: 'countdown' })).toBeNull();
    expect(sanitizeTimerAction({ kind: 'set', mode: 'stopwatch', duration_ms: 5 })).toEqual({ kind: 'set', mode: 'stopwatch' });
    expect(sanitizeTimerAction({ kind: 'pause', extra: 1 })).toEqual({ kind: 'pause' });
    expect(sanitizeTimerAction({ kind: 'explode' })).toBeNull();
    expect(sanitizeTimerAction('start')).toBeNull();
  });
});

describe('timer: counting in room time', () => {
  it('a countdown counts down, pauses, resumes and reaches zero', () => {
    const t0 = 1_000_000;
    const a = countdown(5, t0);
    expect(a).toMatchObject({ id: 't1', mode: 'countdown', duration_ms: 5 * MIN, running: true, started_at: t0, elapsed_ms: 0, v: 1, run: 1, by: 'tutor', name: 'Minghui Li' });
    expect(timerLabel(a, t0)).toBe('5:00');
    expect(timerLabel(a, t0 + 1)).toBe('5:00'); // rounds up: 4:59.999 still shows 5:00
    expect(timerLabel(a, t0 + 1000)).toBe('4:59');
    const p = reduceTimer(a, { kind: 'pause' }, ming, t0 + 61_500, ids())!;
    expect(p).toMatchObject({ running: false, started_at: null, elapsed_ms: 61_500, v: 2, run: 1 });
    expect(timerLabel(p, t0 + 999_999)).toBe('3:59'); // paused: no time passes
    const r = reduceTimer(p, { kind: 'start' }, ming, t0 + 100_000, ids())!;
    expect(r).toMatchObject({ running: true, started_at: t0 + 100_000, elapsed_ms: 61_500, v: 3, run: 1 });
    expect(timerEndsAt(r)).toBe(t0 + 100_000 + 5 * MIN - 61_500);
    const end = timerEndsAt(r)!;
    expect(timerDone(r, end - 1)).toBe(false);
    expect(timerDone(r, end)).toBe(true);
    expect(timerShown(r, end + 50_000)).toBe(0);
    expect(timerLabel(r, end + 50_000)).toBe('0:00');
  });

  it('start on a finished countdown runs it again from the top (a new run)', () => {
    const a = countdown(1, 0);
    const again = reduceTimer(a, { kind: 'start' }, ming, 2 * MIN, ids())!;
    expect(again).toMatchObject({ running: true, started_at: 2 * MIN, elapsed_ms: 0, run: 2 });
    // A start on a running one changes nothing.
    expect(reduceTimer(again, { kind: 'start' }, ming, 2 * MIN + 10, ids())).toBe(again);
  });

  it('pause at zero keeps it at zero; reset starts a new run, stopped', () => {
    const a = countdown(1, 0);
    const p = reduceTimer(a, { kind: 'pause' }, ming, 5 * MIN, ids())!;
    expect(p.elapsed_ms).toBe(MIN);
    expect(timerDone(p, 5 * MIN)).toBe(true);
    const z = reduceTimer(p, { kind: 'reset' }, ming, 6 * MIN, ids())!;
    expect(z).toMatchObject({ running: false, started_at: null, elapsed_ms: 0, run: 2 });
    expect(timerLabel(z, 7 * MIN)).toBe('1:00');
  });

  it('a stopwatch counts up and never finishes', () => {
    const s = reduceTimer(null, { kind: 'set', mode: 'stopwatch', start: true }, ming, 0, ids())!;
    expect(s.duration_ms).toBe(0);
    expect(timerLabel(s, 3_723_900)).toBe('1:02:03');
    expect(timerDone(s, 10 * 3600_000)).toBe(false);
    expect(timerEndsAt(s)).toBeNull();
  });

  it('set replaces the timer (new id), clear removes it; nothing to start / pause without one', () => {
    const newId = ids();
    const a = countdown(5, 0, true, newId);
    const b = reduceTimer(a, { kind: 'set', mode: 'countdown', duration_ms: 2 * MIN }, ming, 10, newId)!;
    expect(b.id).toBe('t2');
    expect(b.running).toBe(false);
    expect(reduceTimer(b, { kind: 'clear' }, ming, 20, newId)).toBeNull();
    expect(reduceTimer(null, { kind: 'start' }, ming, 0, newId)).toBeNull();
    expect(reduceTimer(null, { kind: 'pause' }, ming, 0, newId)).toBeNull();
    expect(reduceTimer(null, { kind: 'reset' }, ming, 0, newId)).toBeNull();
  });

  it('a time running backwards (clocks) never counts negative', () => {
    const a = countdown(1, 1000);
    expect(timerElapsed(a, 0)).toBe(0);
    expect(timerShown(a, 0)).toBe(MIN);
  });

  it('a stored timer is checked', () => {
    const a = countdown(3, 5);
    expect(sanitizeTimer(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(sanitizeTimer({ id: 'x', mode: 'egg' })).toBeNull();
    expect(sanitizeTimer({ id: 'x', mode: 'stopwatch', running: true })).toMatchObject({ running: false, started_at: null });
    expect(sanitizeTimer(null)).toBeNull();
  });
});

describe('timer: the chime at zero', () => {
  it('once per run, only for a device that watched it run', () => {
    const a = countdown(1, 0);
    expect(shouldChimeTimer(a, MIN - 1, null, true)).toBe(false);
    expect(shouldChimeTimer(a, MIN, null, true)).toBe(true);
    expect(shouldChimeTimer(a, MIN + 5, timerFinishKey(a), true)).toBe(false);
    // Joined (or reconnected) into a countdown already at zero: silent.
    expect(shouldChimeTimer(a, MIN, null, false)).toBe(false);
    // Run again: chimes again.
    const again = reduceTimer(a, { kind: 'start' }, ming, 2 * MIN, ids())!;
    expect(shouldChimeTimer(again, 3 * MIN, timerFinishKey(a), true)).toBe(true);
    expect(shouldChimeTimer(null, 0, null, true)).toBe(false);
  });
});

describe('timer: words', () => {
  it('formats times and lengths', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(59_999)).toBe('0:59');
    expect(formatTimer(59_001, true)).toBe('1:00');
    expect(formatTimer(600_000)).toBe('10:00');
    expect(formatTimer(-5)).toBe('0:00');
    expect(minutesLabel(5 * MIN)).toBe('5 min');
    expect(minutesLabel(90_000)).toBe('1 min 30 s');
    expect(minutesLabel(45_000)).toBe('45 s');
  });

  it('reads what the tutor types as a length', () => {
    expect(parseTimerInput('7')).toBe(7 * MIN);
    expect(parseTimerInput(' 1:30 ')).toBe(90_000);
    expect(parseTimerInput('90s')).toBe(90_000);
    expect(parseTimerInput('2m')).toBe(2 * MIN);
    expect(parseTimerInput('2 min')).toBe(2 * MIN);
    expect(parseTimerInput('2m30s')).toBe(150_000);
    expect(parseTimerInput('1.5')).toBe(90_000);
    expect(parseTimerInput('0')).toBeNull();
    expect(parseTimerInput('3s')).toBeNull();
    expect(parseTimerInput('500')).toBeNull(); // over 3 hours
    expect(parseTimerInput('soon')).toBeNull();
    expect(parseTimerInput('')).toBeNull();
  });

  it('says who set it and where it is', () => {
    const a = countdown(5, 0);
    expect(timerByLine(a, 'student', 1000)).toBe('5 min countdown · set by Minghui');
    expect(timerByLine(a, 'tutor', 1000)).toBe('5 min countdown · set by you');
    const p = reduceTimer(a, { kind: 'pause' }, ming, 1000, ids())!;
    expect(timerByLine(p, 'student', 2000)).toBe('5 min countdown · paused · set by Minghui');
    const z = reduceTimer(a, { kind: 'reset' }, ming, 1000, ids())!;
    expect(timerByLine(z, 'student', 2000)).toBe('5 min countdown · ready · set by Minghui');
    expect(timerByLine(a, 'student', 5 * MIN)).toBe('Time’s up · 5 min');
    expect(timerAria(a, 1000)).toBe('Countdown 4:59');
    expect(timerAria(p, 1000)).toBe('Countdown 4:59, paused');
    expect(timerAria(a, 5 * MIN)).toBe('Timer: Time’s up');
  });
});
