/**
 * "Today is the session" (shared/study): the active-time tracker (interactions, idle cut-off,
 * pauses, per-day totals, other devices), the minutes line, the resume rule and the
 * celebrate-once rule. Writes study.json; core StudyDayParityTest asserts the Kotlin port
 * (core/StudyDay.kt) matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  activeInteract,
  activePause,
  activeTotal,
  dayTotalAcrossDevices,
  emptyActiveTime,
  formatActiveMinutes,
  pendingActiveMs,
  pruneActiveTime,
  todayStudyLine,
  type ActiveTimeState,
} from '../../../shared/study/activeTime';
import { resumeCardId, resumeElapsedMs, studyScope, type StudyResumePoint } from '../../../shared/study/resume';
import { celebrationMark, shouldCelebrate, type CelebrationMark } from '../../../shared/study/celebration';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: study <out-dir>');
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
const r = rng(29);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const days = ['2026-09-27', '2026-09-28', '2026-09-29'];
const gaps = [0, 1, 999, 5_000, 30_000, 74_999, 75_000, 75_001, 120_000, 600_000, 3_600_000, -2_000];

// Random runs of interactions / pauses; after every step the state and some totals.
const runs: unknown[] = [];
for (let run = 0; run < 120; run++) {
  let s: ActiveTimeState = emptyActiveTime();
  let now = 1_790_000_000_000 + Math.floor(r() * 1e6);
  let dayIndex = 0;
  const steps: unknown[] = [];
  const n = 1 + Math.floor(r() * 25);
  for (let i = 0; i < n; i++) {
    now += pick(gaps);
    if (r() < 0.1 && dayIndex < days.length - 1) dayIndex++;
    const day = days[dayIndex];
    const op = r() < 0.75 ? 'interact' : 'pause';
    s = op === 'interact' ? activeInteract(s, now, day) : activePause(s, now);
    const query = now + pick(gaps);
    steps.push({
      op, at: now, day,
      state: s,
      pending: pendingActiveMs(s, query),
      query,
      totals: Object.fromEntries(days.map((d) => [d, activeTotal(s, d, query)])),
    });
  }
  const prunedFrom = pick(days);
  runs.push({ steps, prunedFrom, pruned: pruneActiveTime(s, prunedFrom) });
}

const devices: unknown[] = [];
for (let i = 0; i < 60; i++) {
  const local = pick([0, 5_000, 60_000, 900_000, 1_799_999]);
  const total = pick([0, 1_000, 600_000, 2_000_000]);
  const mine = pick([0, 1_000, 60_000, 2_500_000]);
  devices.push({ local, total, mine, result: dayTotalAcrossDevices(local, total, mine) });
}

const minuteValues = [0, -5, 1, 29_999, 59_999, 60_000, 89_999, 90_000, 1_380_000, 3_569_999, 3_570_000, 3_600_000, 3_630_000, 3_900_000, 7_200_000, 86_400_000];
const minutes = minuteValues.map((ms) => ({ ms, text: formatActiveMinutes(ms) }));
const lines = [[0, 0], [60_000, 1], [23 * 60_000, 142], [45_000, 2]].map(([ms, reviews]) => ({ ms, reviews, text: todayStudyLine(ms, reviews) }));

const ids = ['c1', 'c2', 'c3', 'c4'];
const resume: unknown[] = [];
for (let i = 0; i < 150; i++) {
  const point: StudyResumePoint | null = r() < 0.1 ? null : {
    day: pick(days), scope: pick(['all', 'deck-1']), card_id: pick(ids), revealed: r() < 0.5,
    answer: pick(['', '你好', '学']), elapsed_ms: pick([-1, 0, 12_000, 3_600_001, 5e9]),
  };
  const day = pick(days);
  const scope = pick(['all', 'deck-1']);
  const queue = ids.filter(() => r() < 0.6);
  resume.push({ point, day, scope, queue, card: resumeCardId(point, day, scope, queue), elapsed: resumeElapsedMs(point) });
}
const scopes = [null, '', 'deck-1'].map((deck) => ({ deck, scope: studyScope(deck) }));

const celebrate: unknown[] = [];
for (let i = 0; i < 150; i++) {
  const mark: CelebrationMark | null = r() < 0.2 ? null : celebrationMark(pick(days), pick([0, 5, 40, 41]));
  const day = pick(days);
  const reviews = pick([0, 1, 5, 40, 41, 60]);
  const empty = r() < 0.7;
  celebrate.push({ mark, day, reviews, empty, result: shouldCelebrate(mark, day, reviews, empty) });
}

writeFileSync(join(OUT, 'study.json'), JSON.stringify({ runs, devices, minutes, lines, resume, scopes, celebrate }));
