/**
 * Video calls round 4: lessons — calls within LESSON_GAP_MS of each other (two hours since round 5;
 * shared/calls/lessons.ts).
 * Writes calls-lessons.json; checked by core/…/calls/CallsLessonsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { continuesLesson, groupCallsByLesson, groupIntoLessons, LESSON_GAP_MS, lessonOpen, type LessonCallLike } from '../../../shared/calls/lessons';

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
const r = rng(20261002);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const T0 = Date.parse('2026-10-02T12:00:00Z');
const gaps = [0, 1, 60_000, LESSON_GAP_MS - 1, LESSON_GAP_MS, LESSON_GAP_MS + 1, 25 * 60_000, 3 * 3600_000, -5 * 60_000];

// groupIntoLessons: sequences of calls per scope (a gap after each call, sometimes overlapping, some live).
const groupings: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const calls: LessonCallLike[] = [];
  const n = 1 + Math.floor(r() * 7);
  const cursor = new Map<string, number>();
  for (let k = 0; k < n; k++) {
    const scope = pick(['rel-1', 'rel-1', 'rel-2', 'solo:me']);
    const start = (cursor.get(scope) ?? T0 + Math.floor(r() * 3) * 60_000) + pick(gaps);
    const len = pick([4_000, 60_000, 17 * 60_000, 22 * 60_000, 65 * 60_000]);
    const end = r() < 0.12 ? null : start + len;
    cursor.set(scope, end ?? start + len);
    calls.push({ id: `c${i}-${k}`, scope, start, end });
  }
  // Shuffle: the function sorts within a scope.
  for (let k = calls.length - 1; k > 0; k--) {
    const j = Math.floor(r() * (k + 1));
    [calls[k], calls[j]] = [calls[j], calls[k]];
  }
  groupings.push({ calls, result: Object.fromEntries(groupIntoLessons(calls)) });
}

const continues: unknown[] = [];
const opens: unknown[] = [];
for (const gap of gaps) {
  for (const lastEnd of [null, T0]) {
    const start = T0 + gap;
    continues.push({ last_end: lastEnd, start, result: continuesLesson(lastEnd, start) });
    for (const live of [false, true]) opens.push({ last_end: lastEnd, any_live: live, now: start, result: lessonOpen(lastEnd, live, start) });
  }
}

// groupCallsByLesson: list rows with / without a lesson, SQLite created_at strings (some equal).
const sql = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const lists: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const n = Math.floor(r() * 9);
  const rows = Array.from({ length: n }, (_, k) => ({
    id: `r${i}-${k}`,
    lesson_id: pick([null, '', 'L1', 'L1', 'L2', 'L3', `r${i}-0`]),
    created_at: sql(T0 + pick([0, 60_000, 60_000, 3_600_000, -86_400_000, Math.floor(r() * 10) * 600_000])),
  }));
  lists.push({ rows, result: groupCallsByLesson(rows).map((g) => ({ lesson_id: g.lessonId, ids: g.calls.map((c) => c.id) })) });
}

writeFileSync(join(OUT, 'calls-lessons.json'), JSON.stringify({ gap: LESSON_GAP_MS, groupings, continues, opens, lists }));
