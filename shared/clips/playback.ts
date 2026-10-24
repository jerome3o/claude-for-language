/**
 * The clip clock (both players; the Lab port is parity-tested): a tiny state machine the web
 * player's requestAnimationFrame loop and the Lab player's frame loop both drive with
 * `clipTick(spec, state, dtMs, speaking)`.
 *
 * - A scene runs for its duration_ms, then HOLDS while its audio is still speaking.
 * - A quiz scene counts down its duration until answered (`clipAnswerQuiz`); time running out
 *   reveals the answer (`timed_out`). Either way the explanation shows for QUIZ_REVEAL_MS (and
 *   any speech) before the clip moves on.
 * - After the last scene: `done` (the end card), scene = scenes.length.
 */
import { QUIZ_REVEAL_MS } from './timeline';
import type { ClipSpec } from './types';

export interface ClipQuizState {
  picked: number | null;
  timed_out: boolean;
  /** Time spent showing the answer. */
  reveal_ms: number;
}

export interface ClipPlayState {
  /** The scene on screen; scenes.length = the end card. */
  scene: number;
  /** Time in this scene (capped at its duration). */
  elapsed_ms: number;
  quiz: ClipQuizState | null;
  done: boolean;
}

export function clipStart(spec: Pick<ClipSpec, 'scenes'>, scene = 0): ClipPlayState {
  const at = Math.max(0, Math.min(scene, spec.scenes.length));
  return {
    scene: at,
    elapsed_ms: 0,
    quiz: spec.scenes[at]?.layout === 'quiz' ? { picked: null, timed_out: false, reveal_ms: 0 } : null,
    done: at >= spec.scenes.length,
  };
}

function advance(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState): ClipPlayState {
  return clipStart(spec, state.scene + 1);
}

/** Is the quiz on screen waiting for an answer? */
export function clipQuizWaiting(state: ClipPlayState): boolean {
  return !!state.quiz && state.quiz.picked === null && !state.quiz.timed_out;
}

/** One step of the clock. `speaking` = the scene's audio is still playing (or about to). */
export function clipTick(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState, dtMs: number, speaking: boolean): ClipPlayState {
  if (state.done) return state;
  const scene = spec.scenes[state.scene];
  if (!scene) return { ...state, done: true, scene: spec.scenes.length };
  const dt = Math.max(0, dtMs);
  if (state.quiz) {
    if (clipQuizWaiting(state)) {
      const elapsed = Math.min(scene.duration_ms, state.elapsed_ms + dt);
      if (elapsed >= scene.duration_ms) return { ...state, elapsed_ms: elapsed, quiz: { ...state.quiz, timed_out: true } };
      return { ...state, elapsed_ms: elapsed };
    }
    const reveal = state.quiz.reveal_ms + dt;
    if (reveal >= QUIZ_REVEAL_MS && !speaking) return advance(spec, state);
    return { ...state, elapsed_ms: scene.duration_ms, quiz: { ...state.quiz, reveal_ms: Math.min(reveal, QUIZ_REVEAL_MS) } };
  }
  const elapsed = Math.min(scene.duration_ms, state.elapsed_ms + dt);
  if (elapsed >= scene.duration_ms && !speaking) return advance(spec, state);
  return { ...state, elapsed_ms: elapsed };
}

/** The learner picked an option (only while the quiz waits). */
export function clipAnswerQuiz(state: ClipPlayState, option: number): ClipPlayState {
  if (!clipQuizWaiting(state)) return state;
  return { ...state, quiz: { ...state.quiz!, picked: option } };
}

/** Was the pick right? null before an answer. */
export function clipQuizRight(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState): boolean | null {
  const scene = spec.scenes[state.scene];
  if (!state.quiz || state.quiz.picked === null || scene?.layout !== 'quiz') return null;
  return state.quiz.picked === scene.quiz.answer_index;
}

/** The progress bar's fill for the scene on screen (a quiz showing its answer is full). */
export function clipSceneFill(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState): number {
  const scene = spec.scenes[state.scene];
  if (!scene) return 1;
  if (state.quiz && !clipQuizWaiting(state)) return 1;
  return Math.max(0, Math.min(1, state.elapsed_ms / scene.duration_ms));
}

/**
 * How many of a story's lines show at `elapsed_ms`: one at the start, then spread over the
 * first 70 % of the scene; the line being spoken (`spokenLine`, -1 = none) always shows.
 */
export function storyLinesShown(lineCount: number, durationMs: number, elapsedMs: number, spokenLine = -1): number {
  if (lineCount <= 0) return 0;
  const span = durationMs * 0.7;
  const byTime = lineCount === 1 ? 1 : 1 + Math.floor((Math.min(elapsedMs, span) / span) * (lineCount - 1) + 1e-9);
  return Math.min(lineCount, Math.max(byTime, spokenLine + 1));
}
