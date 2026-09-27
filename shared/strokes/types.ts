/**
 * Handwriting / stroke-order practice — the shared shapes.
 *
 * Character data is the Make Me a Hanzi format as shipped by hanzi-writer-data
 * (Arphic Public License, see docs/STROKE_ORDER.md): per stroke an SVG outline
 * path and a "median" — the centre line of the stroke, in writing order and
 * writing direction. Coordinates live in a 1024-unit box with y pointing UP
 * (x 0..1024, y -124..900); renderers flip with `translate(0 900) scale(1 -1)`.
 *
 * Everything in shared/strokes is pure (no DOM), so the same grading can run in
 * the web app, a future mini-lesson exercise, the worker and — ported — the
 * native Lab app.
 */

/** A point in character-data space (y up). */
export interface Point {
  x: number;
  y: number;
}

/** One character's stroke data, as served from /strokes/<hex>.json. */
export interface CharStrokeData {
  /** SVG path per stroke (the filled outline), writing order. */
  strokes: string[];
  /** Centre line per stroke as [x, y] pairs, start → end in writing direction. */
  medians: [number, number][][];
  /** Stroke indices that belong to the radical (optional, informational). */
  radStrokes?: number[];
}

/** How the learner is writing. */
export type WritingMode =
  /** Grey outline of the whole character is shown; draw over it. */
  | 'trace'
  /** Blank 米字格 grid; write from memory (hints on demand / after misses). */
  | 'recall';

/**
 * What one drawn stroke was judged to be.
 * - `correct` — the expected stroke, the right way round
 * - `backwards` — the expected stroke drawn from the wrong end
 * - `wrong_order` — a real stroke of this character, but one that comes later
 * - `too_short` — started in the right place but stopped short
 * - `wrong` — doesn't match the expected stroke (or any later one)
 * - `ignored` — a tap or a tiny scribble; not counted as a mistake
 */
export type StrokeVerdict = 'correct' | 'backwards' | 'wrong_order' | 'too_short' | 'wrong' | 'ignored';

/** A mistake kind recorded against a stroke (every verdict but correct/ignored). */
export type StrokeMistake = Exclude<StrokeVerdict, 'correct' | 'ignored'>;

export interface StrokeMatch {
  verdict: StrokeVerdict;
  /** For `wrong_order`: the (later) stroke the drawing matched. */
  matchedIndex?: number;
  /** Mean distance from the drawing to the expected median (data units), for tuning / debugging. */
  avgDist?: number;
}

/**
 * Per-stroke result — the unit a tutor would review and a future "write" card
 * would schedule on.
 */
export interface StrokeResult {
  /** Stroke index in writing order (0-based). */
  index: number;
  /** Mistaken attempts before the stroke was accepted (or revealed). */
  misses: number;
  /** The kind of each mistaken attempt, in order. */
  mistakes: StrokeMistake[];
  /** The expected stroke was shown to the learner (a hint) before it was written. */
  hinted: boolean;
  /** The learner never got it: the app filled the stroke in after too many misses. */
  revealed: boolean;
  /** Time from the previous stroke's completion (or the start) to this one, ms. */
  ms: number;
  /**
   * The accepted drawing, downsampled and rounded, in data space — so the
   * handwriting itself can be replayed for a tutor later. Absent when revealed.
   */
  drawn?: [number, number][];
}

/** A rough grade a UI can colour: no mistakes, a couple, or needs practice. */
export type WritingGrade = 'perfect' | 'good' | 'practice';

export interface CharacterWritingResult {
  character: string;
  mode: WritingMode;
  strokes: StrokeResult[];
  /** Total mistaken attempts across strokes. */
  mistakes: number;
  /** Strokes shown as a hint (incl. revealed ones). */
  hints: number;
  /** Strokes the app had to fill in. */
  revealed: number;
  ms: number;
  grade: WritingGrade;
  /** 0..1 — share of strokes written unaided at the first attempt. */
  accuracy: number;
}

/**
 * The result of writing a whole word — what a lesson exercise / tutor review
 * would store. Characters with no stroke data (punctuation, rare characters)
 * are listed in `skipped` rather than failing the exercise.
 */
export interface WritingExerciseResult {
  text: string;
  mode: WritingMode;
  characters: CharacterWritingResult[];
  skipped: string[];
  started_at: number;
  finished_at: number;
  grade: WritingGrade;
}
