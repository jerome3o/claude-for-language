/**
 * Golden vectors for a mini lesson RUN (shared/study/lessonRun.ts): the steps (whole lesson and a
 * revision's subset with its context notes), the shape, the retry round driven by random verdicts
 * (state, what is on screen, the retry bar, the resume line after every answer), canResumeRun,
 * verdictWrong, retryNumber / retryMediaKey / retryLine. Writes lesson-run.json; checked by
 * core/…/LessonRunParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceRun, canResumeRun, lessonShape, lessonSteps, resumeLine, retryLine, retryMediaKey, retryNumber,
  runCurrent, runRetryBar, verdictWrong, NEW_RUN, type LessonRunState,
} from '../../../shared/study/lessonRun';

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
const r = rng(20261023);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const TYPES = ['note', 'note', 'choice', 'scramble', 'translate', 'match', 'conversation', 'speak', 'listen_choice', 'dictation', 'write_typed', 'mystery'];

const runs = Array.from({ length: 200 }, () => {
  const sections = Array.from({ length: int(0, 4) }, () => Array.from({ length: int(0, 6) }, () => pick(TYPES)));
  const spec = { sections: sections.map((types) => ({ exercises: types.map((type) => ({ type })) })) };
  const all = lessonSteps(spec as never);
  const only = r() < 0.4 ? all.filter(() => r() < 0.4).map((s) => s.key).concat(r() < 0.2 ? ['s9e9'] : []) : null;
  const steps = lessonSteps(spec as never, only);
  let state: LessonRunState = NEW_RUN;
  const trace: unknown[] = [];
  for (let i = 0; i < 40; i++) {
    const cur = runCurrent(state, steps);
    if (!cur) break;
    const verdict = cur.step.scored ? (r() < 0.45 ? false : true) : (r() < 0.1 ? false : null);
    state = advanceRun(state, steps, verdict);
    trace.push({ verdict, state, current: runCurrent(state, steps), bar: runRetryBar(state, steps), resume: resumeLine(state, steps) });
  }
  return { sections, only, steps, shape: lessonShape(spec as never), trace };
});

const resume = Array.from({ length: 80 }, () => {
  const saved = r() < 0.1 ? null : {
    lesson_id: pick(['L1', 'L2']),
    shape: pick(['a', 'b']),
    state: { pos: int(-1, 4), owed: [], fixed: int(0, 2), retried: 0 },
  };
  const lessonId = pick(['L1', 'L2']);
  const shape = pick(['a', 'b']);
  return { saved, lessonId, shape, ok: canResumeRun(saved as never, lessonId, shape) };
});

const verdicts = Array.from({ length: 60 }, () => {
  const correct = pick([true, false, null]);
  const points = int(0, 3);
  const max = int(0, 3);
  return { correct, points, max, wrong: verdictWrong(correct, points, max) };
});

const retries = Array.from({ length: 60 }, () => {
  const attempts = Array.from({ length: int(0, 6) }, () => ({ section: int(0, 1), index: int(0, 2), ...(r() < 0.5 ? { retry: int(1, 3) } : {}) }));
  const key = `s${int(0, 1)}e${int(0, 2)}`;
  const n = int(0, 3);
  return { attempts, key, next: retryNumber(attempts, key), media: retryMediaKey(int(0, 2), int(0, 4), n), n, line: retryLine(n) };
});

writeFileSync(join(OUT, 'lesson-run.json'), JSON.stringify({ runs, resume, verdicts, retries }));
