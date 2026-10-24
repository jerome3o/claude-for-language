/**
 * The clip clock (both players; the Lab port is parity-tested): a tiny state machine the web
 * player's timer and the Lab player's frame loop both drive with
 * `clipTick(spec, state, dtMs, speaking)`.
 *
 * - A scene runs for its duration_ms, then HOLDS while its audio is still speaking.
 * - An INTERACTIVE scene (quiz, listen, order, reveal, speak — `isInteractiveLayout`) stops the
 *   clock and WAITS for the learner: the answer (`clipAnswerOption` / `clipAnswerOrder` /
 *   `clipFlip` / `clipSpeakResult`) or Skip (`clipSkip`, offered after CLIP_SKIP_AFTER_MS).
 *   Then the answer shows for `clipRevealMs` (and any speech) — or until "Next ›"
 *   (`clipContinue`) — before the clip moves on. (Until Oct 2026 a quiz timed out by itself after
 *   its duration; Jerome didn't know the options were tappable.)
 * - After the last scene: `done` (the end card), scene = scenes.length.
 */
import { isAcceptedVerdict, type AnswerVerdict } from '../cards/answer';
import { QUIZ_REVEAL_MS } from './timeline';
import { CLIP_INTERACT_VALUES, isInteractiveLayout, type ClipInteractResult, type ClipScene, type ClipSpec } from './types';

/** An interactive scene offers "Skip ›" after waiting this long. */
export const CLIP_SKIP_AFTER_MS = 6000;

export interface ClipInteractState {
  /** quiz / listen: the option picked; null otherwise. */
  picked: number | null;
  /** null = waiting for the learner. */
  result: ClipInteractResult | null;
  /** Time spent waiting (Skip shows after CLIP_SKIP_AFTER_MS). */
  waited_ms: number;
  /** Time spent showing the answer. */
  reveal_ms: number;
}

export interface ClipPlayState {
  /** The scene on screen; scenes.length = the end card. */
  scene: number;
  /** Time in this scene (capped at its duration). */
  elapsed_ms: number;
  /** An interactive scene's state; null on the others. */
  interact: ClipInteractState | null;
  done: boolean;
}

export function clipStart(spec: Pick<ClipSpec, 'scenes'>, scene = 0): ClipPlayState {
  const at = Math.max(0, Math.min(scene, spec.scenes.length));
  const layout = spec.scenes[at]?.layout;
  return {
    scene: at,
    elapsed_ms: 0,
    interact: layout && isInteractiveLayout(layout) ? { picked: null, result: null, waited_ms: 0, reveal_ms: 0 } : null,
    done: at >= spec.scenes.length,
  };
}

function advance(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState): ClipPlayState {
  return clipStart(spec, state.scene + 1);
}

/** Is an interactive scene on screen waiting for the learner? */
export function clipWaiting(state: ClipPlayState): boolean {
  return !!state.interact && state.interact.result === null;
}

/** Show "Skip ›"? (waited long enough) */
export function clipSkipShown(state: ClipPlayState): boolean {
  return clipWaiting(state) && state.interact!.waited_ms >= CLIP_SKIP_AFTER_MS;
}

/** How long the answer shows after an interactive scene (and any speech): longer where there is more to read. */
export function clipRevealMs(layout: ClipScene['layout'], result: ClipInteractResult): number {
  if (result === 'skipped') return QUIZ_REVEAL_MS;
  switch (layout) {
    case 'order':
    case 'reveal':
      return 3000;
    case 'speak':
      return 3500;
    default:
      return QUIZ_REVEAL_MS;
  }
}

/** One step of the clock. `speaking` = the scene's audio is still playing (or about to). */
export function clipTick(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState, dtMs: number, speaking: boolean): ClipPlayState {
  if (state.done) return state;
  const scene = spec.scenes[state.scene];
  if (!scene) return { ...state, done: true, scene: spec.scenes.length };
  const dt = Math.max(0, dtMs);
  if (state.interact) {
    if (state.interact.result === null) {
      const elapsed = Math.min(scene.duration_ms, state.elapsed_ms + dt);
      return { ...state, elapsed_ms: elapsed, interact: { ...state.interact, waited_ms: state.interact.waited_ms + dt } };
    }
    const need = clipRevealMs(scene.layout, state.interact.result);
    const reveal = state.interact.reveal_ms + dt;
    if (reveal >= need && !speaking) return advance(spec, state);
    return { ...state, elapsed_ms: scene.duration_ms, interact: { ...state.interact, reveal_ms: Math.min(reveal, need) } };
  }
  const elapsed = Math.min(scene.duration_ms, state.elapsed_ms + dt);
  if (elapsed >= scene.duration_ms && !speaking) return advance(spec, state);
  return { ...state, elapsed_ms: elapsed };
}

function settle(state: ClipPlayState, result: ClipInteractResult, picked: number | null = null): ClipPlayState {
  if (!clipWaiting(state)) return state;
  return { ...state, interact: { ...state.interact!, result, picked, reveal_ms: 0 } };
}

/** quiz / listen: the learner picked an option (only while the scene waits). */
export function clipAnswerOption(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState, option: number): ClipPlayState {
  const scene = spec.scenes[state.scene];
  const answer = scene?.layout === 'quiz' ? scene.quiz.answer_index : scene?.layout === 'listen' ? scene.listen.answer_index : null;
  if (answer === null) return state;
  return settle(state, option === answer ? 'right' : 'wrong', option);
}

/** Do the tapped tiles (indexes into `tiles`, which IS the right order) read as the sentence? Identical tiles are interchangeable. */
export function clipOrderRight(tiles: readonly string[], order: readonly number[]): boolean {
  if (order.length !== tiles.length) return false;
  return order.every((idx, i) => tiles[idx] === tiles[i]);
}

/** order: every tile placed — `order` = the tiles' indexes in the order tapped. */
export function clipAnswerOrder(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState, order: readonly number[]): ClipPlayState {
  const scene = spec.scenes[state.scene];
  if (scene?.layout !== 'order') return state;
  return settle(state, clipOrderRight(scene.order.tiles, order) ? 'right' : 'wrong');
}

/** reveal: the card was flipped. */
export function clipFlip(state: ClipPlayState): ClipPlayState {
  return settle(state, 'done');
}

/** speak: the take was checked (`checkSpokenAnswer`'s verdict, via practiseSentence): accepted = right, other tones = close. */
export function clipSpeakResult(state: ClipPlayState, verdict: AnswerVerdict): ClipPlayState {
  return settle(state, isAcceptedVerdict(verdict) ? 'right' : verdict === 'close' ? 'close' : 'wrong');
}

/** Skip: the answer shows, the clip moves on. */
export function clipSkip(state: ClipPlayState): ClipPlayState {
  return settle(state, 'skipped');
}

/** "Next ›" while the answer shows: on to the next scene now. */
export function clipContinue(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState): ClipPlayState {
  if (!state.interact || state.interact.result === null || state.done) return state;
  return advance(spec, state);
}

/** Was the quiz / listen pick right? null before an answer (or skipped). */
export function clipQuizRight(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState): boolean | null {
  const scene = spec.scenes[state.scene];
  if (!state.interact || state.interact.picked === null) return null;
  if (scene?.layout === 'quiz') return state.interact.picked === scene.quiz.answer_index;
  if (scene?.layout === 'listen') return state.interact.picked === scene.listen.answer_index;
  return null;
}

/** The number an `interact` event carries. */
export function clipInteractValue(result: ClipInteractResult): number {
  return CLIP_INTERACT_VALUES[result];
}

/** The progress bar's fill for the scene on screen (an answered interactive scene is full). */
export function clipSceneFill(spec: Pick<ClipSpec, 'scenes'>, state: ClipPlayState): number {
  const scene = spec.scenes[state.scene];
  if (!scene) return 1;
  if (state.interact && !clipWaiting(state)) return 1;
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

// ---------- order: the tiles on screen ----------

/** FNV-1a (32-bit) over UTF-16 code units — the same in Kotlin. */
export function clipHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The order the tiles are offered in (indexes into `tiles`): a seeded shuffle (xorshift32 +
 * Fisher–Yates, the same on both apps for the same clip + scene) that never already reads as the
 * answer.
 */
export function clipOrderShuffle(tiles: readonly string[], seed: string): number[] {
  const idx = tiles.map((_, i) => i);
  if (idx.length < 2) return idx;
  let s = clipHash(seed) || 1;
  const next = () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s;
  };
  for (let i = idx.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  if (clipOrderRight(tiles, idx)) {
    idx.push(idx.shift()!);
    if (clipOrderRight(tiles, idx)) idx.reverse();
  }
  return idx;
}
