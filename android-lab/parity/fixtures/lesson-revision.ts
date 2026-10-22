/**
 * Golden vectors for "revise until right first time" (shared/study/lessonRevision.ts): a lesson's
 * state replayed from random run histories (outcomes, legacy ratings, Done for good / Bring back
 * marks), the revision's exercises (revisionKeys, seeded), runOutcome from attempt rows,
 * parseRunOutcome's cleaning, the labels, fnv1a32; and the tutor's side in shared/homework/library.ts
 * (libraryStatus with `revising`, revisionProgressLabel). Writes lesson-revision.json; checked by
 * core/…/LessonRevisionParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeLessonLearnState, fnv1a32, isRevisionDue, parseRunOutcome, revisionDaysAway, revisionDueText,
  revisionExtraCount, revisionKeys, revisionTitle, runEndLine, runOutcome, toGetRightLabel,
  type LessonMarkRecord, type LessonRunRecord,
} from '../../../shared/study/lessonRevision';
import { lessonSteps } from '../../../shared/study/lessonRun';
import { addDays, libraryStatus, revisionProgressLabel } from '../../../shared/homework';

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
const r = rng(20261025);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const TYPES = ['note', 'choice', 'choice', 'scramble', 'translate', 'match', 'conversation', 'listen_choice', 'dictation'];
const DAY = 86_400_000;
const BASE = Date.parse('2026-10-01T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const histories = Array.from({ length: 250 }, () => {
  const sections = Array.from({ length: int(1, 3) }, () => Array.from({ length: int(1, 7) }, () => pick(TYPES)));
  const spec = { sections: sections.map((types) => ({ exercises: types.map((type) => ({ type })) })) };
  const steps = lessonSteps(spec as never);
  const scored = steps.filter((s) => s.scored).map((s) => s.key);
  const runs: LessonRunRecord[] = Array.from({ length: int(0, 4) }, (_, i) => {
    const at = iso(BASE + int(0, 30) * DAY + int(0, 3600) * 1000);
    if (r() < 0.25) return { id: `c${i}${pick(['a', 'b', ''])}`, at, outcome: null, rating: r() < 0.15 ? null : int(0, 3) };
    const keys = scored.filter(() => r() < 0.9);
    const missed = keys.filter(() => r() < 0.3);
    if (r() < 0.1) missed.push('s7e7');
    return { id: `c${i}`, at, outcome: { keys, missed }, rating: r() < 0.5 ? null : int(0, 3) };
  });
  const marks: LessonMarkRecord[] = Array.from({ length: r() < 0.7 ? 0 : int(1, 2) }, (_, i) => ({ id: `m${i}`, at: iso(BASE + int(0, 30) * DAY), action: pick(['retire', 'restore'] as const) }));
  if (r() < 0.05 && runs.length) runs.push({ ...runs[0], id: `${runs[0].id}x` }); // same time, tie by id
  const state = computeLessonLearnState(runs, marks);
  const lessonId = pick(['L1', 'lesson-餐厅', 'abc']);
  const cutoff = BASE + int(0, 45) * DAY;
  return {
    sections, runs, marks, lessonId, cutoff, state,
    keys: revisionKeys(state, steps, lessonId),
    due: isRevisionDue(state, cutoff),
    days: revisionDaysAway(state, cutoff),
    dueText: revisionDueText(state, cutoff),
    title: revisionTitle(state),
    toGetRight: toGetRightLabel(state, scored.length),
  };
});

const outcomes = Array.from({ length: 120 }, () => {
  const exercises = Array.from({ length: int(0, 8) }, () => {
    const correct = pick([true, false, null]);
    const max = correct === null ? 0 : int(0, 3);
    return { section: int(0, 1), index: int(0, 3), type: 'choice', correct, points: int(0, 3), max_points: max, duration_ms: 1, ...(r() < 0.25 ? { retry: int(1, 2) } : {}) };
  });
  const outcome = runOutcome({ exercises } as never);
  return { exercises, outcome, end: outcome ? runEndLine(outcome, r() < 0.5) : null, endRevision: outcome ? runEndLine(outcome, true) : null };
});

const cleaned = Array.from({ length: 60 }, () => {
  const keys = Array.from({ length: int(0, 5) }, () => pick(['s0e1', 's1e2', 's0e1', 'bad', 's12e400', 's1000e1']));
  const missed = Array.from({ length: int(0, 3) }, () => pick(['s0e1', 's1e2', 'x', 's3e3']));
  return { input: { keys, missed }, out: parseRunOutcome({ keys, missed }) };
});

const hashes = ['', 'a', 'L1:c0|s0e1', '餐厅:c1|s2e3', 'abc:|s0e0', '𠮷x'].map((text) => ({ text, h: fnv1a32(text) }));
const extras = Array.from({ length: 25 }, (_, n) => ({ n: n - 1, k: revisionExtraCount(n - 1) }));

const TODAY = '2026-10-22';
const library = Array.from({ length: 120 }, () => {
  const summary = {
    status: pick(['new', 'revision', 'revision', 'done'] as const),
    revision: int(0, 4),
    due_date: r() < 0.2 ? null : addDays(TODAY, int(-3, 40)),
    to_get_right: int(0, 9),
    percent: int(0, 100),
  };
  const complete = r() < 0.3;
  const started = r() < 0.5;
  const revising = r() < 0.5;
  const due = r() < 0.3 ? null : addDays(TODAY, int(-4, 4));
  return { summary, label: revisionProgressLabel(summary, TODAY), complete, started, revising, due, status: libraryStatus({ complete, started, due_date: due, today: TODAY, revising }) };
});

writeFileSync(join(OUT, 'lesson-revision.json'), JSON.stringify({ histories, outcomes, cleaned, hashes, extras, today: TODAY, library }));
