/**
 * Golden vectors for a mini lesson RUN (shared/study/lessonRun.ts): the steps (whole lesson and a
 * revision's subset with its context notes), the shape, the retry round driven by random verdicts
 * (state, what is on screen, the retry bar, the resume line after every answer), canResumeRun,
 * verdictWrong, retryNumber / retryMediaKey / retryLine, ↺ undo (random answers + undos with the
 * player's bookkeeping, the outcome after each), undoKeepsAnswer. Writes lesson-run.json; checked by
 * core/…/LessonRunParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceRun, canResumeRun, lessonShape, lessonSteps, resumeLine, retryLine, retryMediaKey, retryNumber,
  runCurrent, runRetryBar, verdictWrong, NEW_RUN, type LessonRunState,
  canUndoRun, runUndoFrame, undoKeepsAnswer, undoRun, type LessonRunUndoFrame,
} from '../../../shared/study/lessonRun';
import { runOutcome } from '../../../shared/study/lessonRevision';

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

// ↺ Undo: random runs mixing answers and undos, with the player's bookkeeping (score, attempt rows,
// recordings) — after every action the run, score, counts, the stack and the outcome the rows give.
type Row = { section: number; index: number; type: string; correct: boolean | null; points: number; max_points: number; retry?: number };
const undos = Array.from({ length: 150 }, () => {
  const sections = Array.from({ length: int(1, 3) }, () => Array.from({ length: int(1, 5) }, () => pick(TYPES)));
  const spec = { sections: sections.map((types) => ({ exercises: types.map((type) => ({ type })) })) };
  const steps = lessonSteps(spec as never);
  let state: LessonRunState = NEW_RUN;
  let correct = 0;
  let total = 0;
  let rows: Row[] = [];
  let recordings = 0;
  let stack: LessonRunUndoFrame[] = [];
  const actions: unknown[] = [];
  for (let i = 0; i < 50; i++) {
    const cur = runCurrent(state, steps);
    if (!cur) break;
    if (canUndoRun(stack) && r() < 0.3) {
      const u = undoRun(stack)!;
      state = u.frame.state;
      correct = u.frame.correct;
      total = u.frame.total;
      rows = rows.slice(0, u.frame.attempts);
      recordings = Math.min(recordings, u.frame.recordings);
      stack = u.stack;
      actions.push({ kind: 'undo', restored: u.frame.key, phase: u.frame.phase, state, correct, total, attempts: rows.length, recordings, stack: stack.length, can_undo: canUndoRun(stack), outcome: runOutcome({ exercises: rows }) });
      continue;
    }
    const verdict = cur.step.scored ? (r() < 0.45 ? false : true) : null;
    const recording = cur.step.scored && r() < 0.2;
    const frame = runUndoFrame(state, steps, { correct, total }, rows.length, recordings)!;
    stack = [...stack, frame];
    const max = verdict === null ? 0 : 1;
    const points = verdict ? max : 0;
    const retry = cur.phase === 'retry' ? retryNumber(rows, cur.step.key) : 0;
    if (cur.phase === 'main' && max) { correct += points; total += max; }
    rows = [...rows, { section: cur.step.section, index: cur.step.index, type: cur.step.type, correct: verdict, points, max_points: max, ...(retry ? { retry } : {}) }];
    if (recording) recordings++;
    state = advanceRun(state, steps, verdict);
    actions.push({ kind: 'answer', verdict, recording, state, correct, total, attempts: rows.length, recordings, stack: stack.length, can_undo: canUndoRun(stack), outcome: runOutcome({ exercises: rows }) });
  }
  return { sections, actions };
});

const keepsAnswer = ['translate', 'listen_translate', 'describe_image', 'speak', 'choice', 'note', 'oral_expression'].flatMap((type) =>
  [true, false, null].map((selfAssessed) => ({ type, self_assessed: selfAssessed, keeps: undoKeepsAnswer(type, selfAssessed === null ? null : { self_assessed: selfAssessed }) })),
);

writeFileSync(join(OUT, 'lesson-run.json'), JSON.stringify({ runs, resume, verdicts, retries, undos, keepsAnswer }));
