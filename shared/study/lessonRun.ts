/**
 * A mini lesson RUN: the exercises it plays, where it stands, the retry round at the end, and
 * the saved copy that lets it continue later — on another day, after the app was closed,
 * offline (docs/STUDY_SESSION.md "Mini lessons").
 *
 * Jerome (Oct 2026): "Make sure homework progress isn't lost over multiple days." He half-did
 * a homework lesson, opened it the next day, and it had reset. Two causes: the web player kept
 * the run in memory only, and the Lab app's saved run was dropped on another local day (and
 * whenever the spec's JSON changed — a picture drawn later, a pinyin fix). Now a run is saved
 * after every exercise and continues until it is finished or "Start over" is pressed; it is
 * keyed on the lesson's SHAPE (`lessonShape`: the exercise types in order), so content fixes
 * and pictures never throw it away.
 *
 * The retry round (Jerome: "at the end of the lesson, go over all the things you didn't get,
 * similar to the one-off card review"): every scored exercise answered wrong on the main pass
 * is owed; after the last exercise the owed ones come back, one by one, until each is right
 * (wrong again → back to the end of the queue). Notes and other unscored exercises never are.
 *
 * Pure; the Lab app's port (core/…/LessonRun.kt) is parity-tested against it.
 */
import type { CustomLessonSpec, LessonExercise } from '../lesson/types';
import { isScoreable } from '../lesson/types';
import { isHandwritingExercise } from '../lesson/handwriting';
import { retryBar, type RetryBar, type RetryBarUnit } from '../homework/retry-bar';

/** The key of an exercise in a lesson: its place (section, index) — like exerciseMediaKey. */
export function exerciseKey(section: number, index: number): string {
  return `s${section}e${index}`;
}

/** One exercise in a run's play order. */
export interface LessonRunStep {
  key: string;
  section: number;
  index: number;
  type: string;
  /** Counts toward the score (and so can be owed in the retry round). */
  scored: boolean;
}

function step(ex: Pick<LessonExercise, 'type'>, section: number, index: number): LessonRunStep {
  return { key: exerciseKey(section, index), section, index, type: ex.type, scored: isScoreable(ex as LessonExercise) };
}

/** How a run is played for this learner. */
export interface LessonStepOptions {
  /** "Skip handwriting exercises" (shared/lesson/handwriting.ts): write_handwriting is left out. */
  skipHandwriting?: boolean;
}

/**
 * The steps of a run. `only` = a revision's scored exercises: those, each with the note right
 * before it in its section (context, not scored), in lesson order. Null = the whole lesson.
 * With `skipHandwriting`, write_handwriting exercises are left out (their keys stay the same).
 */
export function lessonSteps(spec: Pick<CustomLessonSpec, 'sections'>, only?: readonly string[] | null, opts: LessonStepOptions = {}): LessonRunStep[] {
  const all: LessonRunStep[] = [];
  spec.sections.forEach((s, si) => s.exercises.forEach((ex, i) => {
    if (opts.skipHandwriting && isHandwritingExercise(ex)) return;
    all.push(step(ex, si, i));
  }));
  if (!only) return all;
  const wanted = new Set(only);
  const keep = new Set<string>();
  all.forEach((st, n) => {
    if (!wanted.has(st.key) || !st.scored) return;
    keep.add(st.key);
    // The nearest note before it in the same section, for context.
    for (let k = n - 1; k >= 0 && all[k].section === st.section; k--) {
      if (all[k].type === 'note') { keep.add(all[k].key); break; }
    }
  });
  return all.filter(st => keep.has(st.key));
}

/** The lesson's shape: its exercise types in order. A saved run continues while it is unchanged. */
export function lessonShape(spec: Pick<CustomLessonSpec, 'sections'>): string {
  return spec.sections.map(s => s.exercises.map(e => e.type).join(',')).join('|');
}

/** Where a run stands. */
export interface LessonRunState {
  /** The next step of the main pass (== steps.length once it is through). */
  pos: number;
  /** The retry round: keys still to get right, the first comes next. */
  owed: string[];
  /** Retries answered right so far. */
  fixed: number;
  /** Retries answered so far, right or wrong — each is a step of the progress bar (0 when absent). */
  retried?: number;
}

export const NEW_RUN: Readonly<LessonRunState> = Object.freeze({ pos: 0, owed: [], fixed: 0, retried: 0 });

export type LessonRunPhase = 'main' | 'retry';

export interface LessonRunCurrent {
  step: LessonRunStep;
  phase: LessonRunPhase;
}

/** What is on screen now; null when the run is finished (main pass through, nothing owed). */
export function runCurrent(state: LessonRunState, steps: readonly LessonRunStep[]): LessonRunCurrent | null {
  if (state.pos < steps.length) return { step: steps[state.pos], phase: 'main' };
  for (const key of state.owed) {
    const st = steps.find(s => s.key === key);
    if (st) return { step: st, phase: 'retry' };
  }
  return null;
}

export function runFinished(state: LessonRunState, steps: readonly LessonRunStep[]): boolean {
  return runCurrent(state, steps) === null;
}

/**
 * After the exercise on screen: `correct` = its verdict (null = unscored). On the main pass a
 * wrong scored exercise becomes owed (end of the queue); in the retry round a right answer
 * takes it off, a wrong one sends it to the back.
 */
export function advanceRun(state: LessonRunState, steps: readonly LessonRunStep[], correct: boolean | null): LessonRunState {
  const cur = runCurrent(state, steps);
  if (!cur) return state;
  if (cur.phase === 'main') {
    const owe = cur.step.scored && correct === false && !state.owed.includes(cur.step.key);
    return { pos: state.pos + 1, owed: owe ? [...state.owed, cur.step.key] : [...state.owed], fixed: state.fixed, retried: state.retried ?? 0 };
  }
  const rest = state.owed.filter(k => k !== cur.step.key);
  const retried = (state.retried ?? 0) + 1;
  if (correct === false) return { pos: state.pos, owed: [...rest, cur.step.key], fixed: state.fixed, retried };
  return { pos: state.pos, owed: rest, fixed: state.fixed + 1, retried };
}

/** What an exercise is called in the bar's label. */
export const EXERCISE_UNIT: RetryBarUnit = { one: 'exercise', other: 'exercises' };

/**
 * The progress bar — the homework pass's retry bar (shared/homework/retry-bar.ts), one slot per
 * showing of an exercise: blue = exercises answered (main pass + every retry), the track = those
 * not shown yet, orange at the RIGHT end = the ones still owed. A mistake adds a slot, so the
 * blue never runs backwards; once the main pass is through the blue meets the orange and each
 * retry put right eats one orange slot.
 */
export function runRetryBar(state: LessonRunState, steps: readonly LessonRunStep[]): RetryBar {
  const owed = state.owed.filter(k => steps.some(s => s.key === k)).length;
  const pos = Math.min(Math.max(0, state.pos), steps.length);
  return retryBar({
    answered: pos + (state.retried ?? state.fixed),
    fresh: steps.length - pos,
    retries: owed,
    itemsDone: pos - owed,
    items: steps.length,
  });
}

/** Whether a verdict counts as wrong for the retry round (a conversation with any question missed is). */
export function verdictWrong(correct: boolean | null, points: number, maxPoints: number): boolean {
  if (correct === null || maxPoints <= 0) return false;
  return correct === false || points < maxPoints;
}

// ============ The saved run ============

export type LessonRunMode = 'full' | 'revision';

/** A run saved after every exercise. The answers ride along (the attempt rows), recordings by media key. */
export interface SavedLessonRunCore {
  lesson_id: string;
  /** `lessonShape` when it was saved. */
  shape: string;
  mode: LessonRunMode;
  /** A revision's scored keys (`revisionKeys` when it started); null for the whole lesson. */
  keys: string[] | null;
  state: LessonRunState;
  correct: number;
  total: number;
  /** ISO. */
  started_at: string;
  saved_at: string;
  /** ↺ Undo's frames (`LessonRunUndoFrame`), so a continued run can still step back; absent = none. */
  undo?: LessonRunUndoFrame[];
}

/**
 * Whether a saved run can be continued: the same lesson, still the same shape, something
 * answered. NOT bounded by day or age — a run waits until it is finished or started over.
 */
export function canResumeRun(saved: SavedLessonRunCore | null | undefined, lessonId: string, shape: string): boolean {
  if (!saved || saved.lesson_id !== lessonId || saved.shape !== shape) return false;
  const st = saved.state;
  if (!st || !Number.isInteger(st.pos) || st.pos < 0 || !Array.isArray(st.owed)) return false;
  return st.pos > 0 || st.fixed > 0;
}

/**
 * The progress bar of a lesson's run in progress, for its row on Home / the homework list / Mini
 * Lessons (Jerome: "If I haven't started it, there should be no bar"): the saved run's retry bar —
 * blue answered, orange owed at the right end — or null when there is no run to continue
 * (`canResumeRun`: nothing answered, another lesson, the shape changed).
 */
export function savedRunBar(
  saved: SavedLessonRunCore | null | undefined,
  lessonId: string,
  spec: Pick<CustomLessonSpec, 'sections'>,
  opts: LessonStepOptions = {}
): RetryBar | null {
  if (!saved || !canResumeRun(saved, lessonId, lessonShape(spec))) return null;
  return runRetryBar(saved.state, lessonSteps(spec, saved.keys, opts));
}

/**
 * "Continue where you left off (7 of 18)" — the next exercise of the main pass, or how many
 * mistakes are left in the retry round.
 */
export function resumeLine(state: LessonRunState, steps: readonly LessonRunStep[]): string {
  if (state.pos < steps.length) return `Continue where you left off (${state.pos + 1} of ${steps.length})`;
  const owed = runRetryBar(state, steps).retries;
  if (owed === 0) return 'Continue where you left off (all done)';
  return `Continue where you left off (${owed} ${owed === 1 ? 'mistake' : 'mistakes'} to put right)`;
}

/** The line over a retry: "Let's put this one right · 2 left". */
export function retryLine(owedLeft: number): string {
  return owedLeft <= 1 ? "Let's put this one right · last one" : `Let's put this one right · ${owedLeft} left`;
}

/** The media key of a recording made when an exercise is asked again (the main pass uses exerciseMediaKey). */
export function retryMediaKey(section: number, index: number, retry: number): string {
  return retry > 0 ? `${exerciseKey(section, index)}r${retry}` : exerciseKey(section, index);
}

/** How many times `key` was asked again before (attempt rows `retry`), so the next row gets n + 1. */
export function retryNumber(attempts: ReadonlyArray<{ section: number; index: number; retry?: number }>, key: string): number {
  let n = 0;
  for (const a of attempts) if ((a.retry ?? 0) > 0 && exerciseKey(a.section, a.index) === key) n = Math.max(n, a.retry ?? 0);
  return n + 1;
}

// ============ ↺ Undo ============
//
// Jerome (Nov 2026): "I accidentally clicked I got it right. Can we add a go back thing like we have
// in the flashcards, but to the lessons?" Every answer in a run pushes an UNDO FRAME — the run exactly
// as it stood before that answer (where it was, the score, how many attempt rows and recordings) — so
// ↺ restores it EXACTLY: the score, the "missed first time" set (derived from the attempt rows, which
// are cut back), the retry round's queue. Frames stack for the whole run (saved with it), so repeated
// ↺ step back to the start of the run, across the retry round's boundary. Only before the run is
// finished: the end records the completion at once. docs/STUDY_SESSION.md "Mini lessons" → "Undo".

/** The run as it stood before one answer — what ↺ restores. */
export interface LessonRunUndoFrame {
  /** The exercise answered (what comes back on screen). */
  key: string;
  type: string;
  phase: LessonRunPhase;
  scored: boolean;
  state: LessonRunState;
  correct: number;
  total: number;
  /** Attempt rows / recordings before the answer (the answer's own are cut off). */
  attempts: number;
  recordings: number;
}

/**
 * The frame to push just BEFORE the exercise on screen is answered (null when the run is finished).
 * `attempts` / `recordings` = how many the run holds now.
 */
export function runUndoFrame(
  state: LessonRunState,
  steps: readonly LessonRunStep[],
  score: { correct: number; total: number },
  attempts: number,
  recordings: number
): LessonRunUndoFrame | null {
  const cur = runCurrent(state, steps);
  if (!cur) return null;
  return {
    key: cur.step.key,
    type: cur.step.type,
    phase: cur.phase,
    scored: cur.step.scored,
    state: { pos: state.pos, owed: [...state.owed], fixed: state.fixed, retried: state.retried ?? 0 },
    correct: score.correct,
    total: score.total,
    attempts,
    recordings,
  };
}

/** Whether ↺ can take anything back. */
export function canUndoRun(stack: readonly LessonRunUndoFrame[] | null | undefined): boolean {
  return !!stack && stack.length > 0;
}

/**
 * ↺: the frame to restore and the stack left. It takes back the last GRADED answer — notes passed
 * since (an unscored "Next") go with it, so one tap lands on the exercise he mis-graded; with no
 * graded answer on the stack it steps back one screen. Null when there is nothing to undo.
 */
export function undoRun(stack: readonly LessonRunUndoFrame[] | null | undefined): { frame: LessonRunUndoFrame; stack: LessonRunUndoFrame[] } | null {
  if (!stack || stack.length === 0) return null;
  let i = stack.length - 1;
  while (i > 0 && !stack[i].scored) i--;
  if (!stack[i].scored) i = stack.length - 1;
  return { frame: stack[i], stack: stack.slice(0, i) };
}

/** The self-checked exercises that come back on their ANSWER side after ↺. */
const UNDO_KEEPS_ANSWER = new Set(['translate', 'listen_translate', 'describe_image']);

/**
 * Whether ↺ brings an exercise back on its answer side with the answer he gave (`answer` = its undone
 * attempt row's answer): only the self-checked ones (translate, listen & translate, describe the
 * picture), where the slip is the Got it / Missed it tap. Everything else — checked on the device,
 * recorded, or in several parts — comes back fresh, to answer again.
 */
export function undoKeepsAnswer(type: string, answer: { self_assessed?: boolean } | null | undefined): boolean {
  return UNDO_KEEPS_ANSWER.has(type) && answer?.self_assessed === true;
}
