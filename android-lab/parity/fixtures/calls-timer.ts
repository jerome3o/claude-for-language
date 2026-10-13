/**
 * Video calls: the call timer (shared/calls/timer.ts). Seeded action sequences through reduceTimer,
 * every view of the timer at sampled times, the chime rule, the words and the typed-length parser.
 * Writes calls-timer.json; checked by core/…/calls/CallsTimerParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  canControlTimer,
  formatTimer,
  minutesLabel,
  parseTimerInput,
  reduceTimer,
  sanitizeTimer,
  shouldChimeTimer,
  timerAria,
  timerByLine,
  timerDone,
  timerElapsed,
  timerEndsAt,
  timerFinishKey,
  timerLabel,
  timerShown,
  MAX_TIMER_MS,
  MIN_TIMER_MS,
  TIMER_BUTTON_LABEL,
  TIMER_COUNTDOWN_LABEL,
  TIMER_FLASH_MS,
  TIMER_PRESET_MINUTES,
  TIMER_STOPWATCH_LABEL,
  TIMER_UP_LABEL,
  type CallTimer,
  type CallTimerAction,
} from '../../../shared/calls/timer';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261013);
const int = (n: number) => Math.floor(r() * n);

// ---- seeded runs: actions at increasing times, every step's timer and its views at a few times.
const users = [{ userId: 'tutor', name: 'Minghui Li' }, { userId: 'me', name: '  明慧  ' }];
const runs: unknown[] = [];
for (let k = 0; k < 40; k++) {
  let n = 0;
  const newId = () => `t${k}-${++n}`;
  let now = 1_000_000 + int(1_000_000);
  let cur: CallTimer | null = null;
  const steps: unknown[] = [];
  for (let i = 0; i < 12; i++) {
    now += int(4) === 0 ? int(700_000) : int(40_000);
    const roll = int(10);
    const action: CallTimerAction =
      roll === 0
        ? { kind: 'set', mode: 'stopwatch', ...(r() < 0.6 ? { start: true } : {}) }
        : roll <= 2
          ? { kind: 'set', mode: 'countdown', duration_ms: [60_000, 120_000, 300_000, 5_000, 90_000, 600_000][int(6)], ...(r() < 0.7 ? { start: true } : {}) }
          : roll <= 4
            ? { kind: 'start' }
            : roll <= 6
              ? { kind: 'pause' }
              : roll <= 8
                ? { kind: 'reset' }
                : { kind: 'clear' };
    const by = users[int(2)];
    cur = reduceTimer(cur, action, by, now, newId);
    const at = [now, now + 1, now + 999, now + 1000, now + int(400_000), now + 3_600_000];
    const views = cur
      ? at.map((t) => ({
          t,
          elapsed: timerElapsed(cur!, t),
          shown: timerShown(cur!, t),
          done: timerDone(cur!, t),
          label: timerLabel(cur!, t),
          by_me: timerByLine(cur!, 'tutor', t),
          by_other: timerByLine(cur!, 'student', t),
          aria: timerAria(cur!, t),
          chime_saw: shouldChimeTimer(cur!, t, null, true),
          chime_unseen: shouldChimeTimer(cur!, t, null, false),
          chime_done: shouldChimeTimer(cur!, t, timerFinishKey(cur!), true),
        }))
      : [];
    steps.push({ now, action, by: by.userId, by_name: by.name, timer: cur, ends_at: cur ? timerEndsAt(cur) : null, key: cur ? timerFinishKey(cur) : null, views });
  }
  runs.push({ steps });
}

// ---- stored timers (sanitizeTimer)
const raws: unknown[] = [
  null, 1, 'x', {}, { id: 'a' }, { id: 'a', mode: 'egg' }, { id: 7, mode: 'countdown' },
  { id: 'a', mode: 'countdown', duration_ms: 60000, running: true, started_at: 5, elapsed_ms: 10, v: 3, run: 2, by: 'u', name: 'N' },
  { id: 'a', mode: 'stopwatch', running: true },
  { id: 'a', mode: 'stopwatch', running: 'yes', started_at: 4 },
  { id: 'a', mode: 'countdown', duration_ms: '60000', elapsed_ms: null, by: 3 },
];

writeFileSync(
  join(OUT, 'calls-timer.json'),
  JSON.stringify({
    constants: { MAX_TIMER_MS, MIN_TIMER_MS, TIMER_FLASH_MS, TIMER_PRESET_MINUTES, TIMER_BUTTON_LABEL, TIMER_UP_LABEL, TIMER_COUNTDOWN_LABEL, TIMER_STOPWATCH_LABEL },
    control: [['tutor', 'tutor'], ['student', 'tutor'], ['me', null]].map(([u, t]) => ({ user: u, tutor: t, can: canControlTimer(u as string, t) })),
    runs,
    stored: raws.map((raw) => ({ raw, timer: sanitizeTimer(raw) })),
    format: [0, 1, 999, 1000, 59_001, 59_999, 60_000, 600_000, 3_599_999, 3_600_000, 3_723_900, -5, 36_000_000].flatMap((ms) => [false, true].map((up) => ({ ms, up, text: formatTimer(ms, up) }))),
    minutes: [0, 1000, 45_000, 60_000, 90_000, 299_500, 300_000, 3_600_000, 5_500].map((ms) => ({ ms, text: minutesLabel(ms) })),
    inputs: ['7', ' 1:30 ', '90s', '2m', '2 min', '2m30s', '2min30sec', '1.5', '0.25', '0', '3s', '4s', '5s', '500', '180', '181', 'soon', '', '1:75', '10:5', '12 MINUTES', '45 seconds', '1:2:3', '-1', '3.', '.5'].map((text) => ({ text, ms: parseTimerInput(text) })),
  }, null, 1),
);
