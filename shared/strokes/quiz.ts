import type {
  CharStrokeData,
  CharacterWritingResult,
  Point,
  StrokeMistake,
  StrokeResult,
  StrokeVerdict,
  WritingExerciseResult,
  WritingGrade,
  WritingMode,
} from './types';
import { matchStroke } from './match';
import { compactStroke } from './geometry';

/**
 * The per-character writing quiz as a pure state machine: feed it drawn
 * strokes, get back the new state and what to show. The UI owns rendering and
 * timing; this owns the rules (what counts, when to hint, when to give up and
 * fill the stroke in) so a lesson exercise, the practice page and the native
 * app all behave the same.
 */

export interface QuizOptions {
  mode: WritingMode;
  /** Matching leniency (see matchStroke). Default 1. */
  leniency?: number;
  /** After this many misses on a stroke, show where it starts and which way it goes. Default 2. */
  startHintAfter?: number;
  /** After this many misses, animate the expected stroke (counts as hinted). Default 3. */
  strokeHintAfter?: number;
  /** After this many misses, fill the stroke in and move on (counts as revealed). Default 5. */
  revealAfter?: number;
}

interface Pending {
  misses: number;
  mistakes: StrokeMistake[];
  hinted: boolean;
  startedAt: number;
}

export interface CharacterQuizState {
  character: string;
  data: CharStrokeData;
  options: Required<QuizOptions>;
  /** Index of the next stroke to write; === strokeCount when finished. */
  current: number;
  done: StrokeResult[];
  pending: Pending;
  startedAt: number;
  finishedAt: number | null;
}

/** How much help to show for the current stroke. */
export type HintLevel = 'none' | 'start' | 'stroke';

export type QuizFeedback =
  | { kind: 'ignored' }
  | { kind: 'correct'; index: number; complete: boolean }
  | {
      kind: 'mistake';
      verdict: Exclude<StrokeVerdict, 'correct' | 'ignored'>;
      index: number;
      matchedIndex?: number;
      misses: number;
      hint: HintLevel;
    }
  | { kind: 'revealed'; index: number; complete: boolean };

export function strokeCount(state: CharacterQuizState): number {
  return state.data.strokes.length;
}

export function isComplete(state: CharacterQuizState): boolean {
  return state.current >= strokeCount(state);
}

export function createQuiz(character: string, data: CharStrokeData, options: QuizOptions, now: number): CharacterQuizState {
  return {
    character,
    data,
    options: {
      mode: options.mode,
      leniency: options.leniency ?? 1,
      startHintAfter: options.startHintAfter ?? 2,
      strokeHintAfter: options.strokeHintAfter ?? 3,
      revealAfter: options.revealAfter ?? 5,
    },
    current: 0,
    done: [],
    pending: { misses: 0, mistakes: [], hinted: false, startedAt: now },
    startedAt: now,
    finishedAt: null,
  };
}

/** The help to show for the current stroke, from its misses (and any hint asked for). */
export function hintLevel(state: CharacterQuizState): HintLevel {
  const { misses, hinted } = state.pending;
  if (hinted || misses >= state.options.strokeHintAfter) return 'stroke';
  if (misses >= state.options.startHintAfter) return 'start';
  return 'none';
}

function finishStroke(
  state: CharacterQuizState,
  now: number,
  extra: { revealed: boolean; drawn?: [number, number][]; hinted?: boolean },
): CharacterQuizState {
  const result: StrokeResult = {
    index: state.current,
    misses: state.pending.misses,
    mistakes: state.pending.mistakes,
    hinted: state.pending.hinted || extra.hinted === true || extra.revealed,
    revealed: extra.revealed,
    ms: Math.max(0, now - state.pending.startedAt),
    ...(extra.drawn ? { drawn: extra.drawn } : {}),
  };
  const current = state.current + 1;
  return {
    ...state,
    current,
    done: [...state.done, result],
    pending: { misses: 0, mistakes: [], hinted: false, startedAt: now },
    finishedAt: current >= strokeCount(state) ? now : null,
  };
}

/** Grade one drawn stroke. */
export function submitStroke(
  state: CharacterQuizState,
  points: Point[],
  now: number,
): { state: CharacterQuizState; feedback: QuizFeedback } {
  if (isComplete(state)) return { state, feedback: { kind: 'ignored' } };
  const match = matchStroke(points, state.data, state.current, {
    leniency: state.options.leniency,
    outlineVisible: state.options.mode === 'trace',
  });
  if (match.verdict === 'ignored') return { state, feedback: { kind: 'ignored' } };

  if (match.verdict === 'correct') {
    const index = state.current;
    // A stroke the learner only managed after the full-stroke hint counts as hinted.
    const next = finishStroke(state, now, {
      revealed: false,
      drawn: compactStroke(points),
      hinted: hintLevel(state) === 'stroke',
    });
    return { state: next, feedback: { kind: 'correct', index, complete: isComplete(next) } };
  }

  const pending: Pending = {
    ...state.pending,
    misses: state.pending.misses + 1,
    mistakes: [...state.pending.mistakes, match.verdict],
  };
  const missed: CharacterQuizState = { ...state, pending };

  if (pending.misses >= state.options.revealAfter) {
    const index = state.current;
    const next = finishStroke(missed, now, { revealed: true });
    return { state: next, feedback: { kind: 'revealed', index, complete: isComplete(next) } };
  }

  const hint = hintLevel(missed);
  const withHint: CharacterQuizState =
    hint === 'stroke' ? { ...missed, pending: { ...pending, hinted: true } } : missed;
  return {
    state: withHint,
    feedback: {
      kind: 'mistake',
      verdict: match.verdict,
      index: state.current,
      ...(match.matchedIndex !== undefined ? { matchedIndex: match.matchedIndex } : {}),
      misses: pending.misses,
      hint,
    },
  };
}

/** The learner asked for a hint: show the current stroke (counts as hinted). */
export function requestHint(state: CharacterQuizState): CharacterQuizState {
  if (isComplete(state)) return state;
  return { ...state, pending: { ...state.pending, hinted: true } };
}

/** "Show me" — fill the current stroke in and move on (counts as revealed). */
export function revealStroke(state: CharacterQuizState, now: number): CharacterQuizState {
  if (isComplete(state)) return state;
  return finishStroke(state, now, { revealed: true });
}

export function gradeCharacter(strokes: StrokeResult[]): WritingGrade {
  const n = strokes.length;
  const mistakes = strokes.reduce((s, r) => s + r.misses, 0);
  const hints = strokes.filter((r) => r.hinted).length;
  const revealed = strokes.filter((r) => r.revealed).length;
  if (mistakes === 0 && hints === 0) return 'perfect';
  if (revealed === 0 && hints <= 1 && mistakes <= Math.max(1, Math.round(n * 0.25))) return 'good';
  return 'practice';
}

/** The result for a finished (or abandoned) character. */
export function summarizeCharacter(state: CharacterQuizState, now: number): CharacterWritingResult {
  const strokes = state.done;
  const n = strokeCount(state);
  const clean = strokes.filter((r) => r.misses === 0 && !r.hinted).length;
  return {
    character: state.character,
    mode: state.options.mode,
    strokes,
    mistakes: strokes.reduce((s, r) => s + r.misses, 0),
    hints: strokes.filter((r) => r.hinted).length,
    revealed: strokes.filter((r) => r.revealed).length,
    ms: Math.max(0, (state.finishedAt ?? now) - state.startedAt),
    // An unfinished character is graded on all its strokes, not only the ones written.
    grade: strokes.length < n ? 'practice' : gradeCharacter(strokes),
    accuracy: n === 0 ? 1 : clean / n,
  };
}

export function gradeExercise(characters: CharacterWritingResult[]): WritingGrade {
  if (characters.length === 0) return 'good';
  if (characters.some((c) => c.grade === 'practice')) return 'practice';
  if (characters.every((c) => c.grade === 'perfect')) return 'perfect';
  return 'good';
}

export function summarizeExercise(
  text: string,
  mode: WritingMode,
  characters: CharacterWritingResult[],
  skipped: string[],
  startedAt: number,
  finishedAt: number,
): WritingExerciseResult {
  return {
    text,
    mode,
    characters,
    skipped,
    started_at: startedAt,
    finished_at: finishedAt,
    grade: gradeExercise(characters),
  };
}

/**
 * Whether a handwriting exercise counts as correct: only a word written FROM
 * MEMORY (recall) with nothing revealed and at most light help (grade perfect /
 * good). A run in Trace mode — including the learner switching to "Trace it" —
 * means they needed help, so it is scored as not yet correct. Jerome's decision;
 * see docs/STROKE_ORDER.md "Scoring in mini lessons".
 */
export function writtenFromMemory(result: Pick<WritingExerciseResult, 'mode' | 'grade'>): boolean {
  return result.mode === 'recall' && result.grade !== 'practice';
}

/** The characters of `text` worth writing: Han ideographs only, in order (duplicates kept). */
export function writableCharacters(text: string): string[] {
  return Array.from(text).filter((ch) => /\p{Script=Han}/u.test(ch));
}

/** The one-line coaching message for a mistake (stroke numbers are 1-based for people). */
export function mistakeMessage(fb: Extract<QuizFeedback, { kind: 'mistake' }>): string {
  const n = fb.index + 1;
  switch (fb.verdict) {
    case 'backwards':
      return `Right stroke, other direction — start from the dot.`;
    case 'wrong_order':
      return fb.matchedIndex !== undefined
        ? `That's stroke ${fb.matchedIndex + 1} — stroke ${n} comes first.`
        : `That stroke comes later — stroke ${n} first.`;
    case 'too_short':
      return `Keep going — draw stroke ${n} all the way to its end.`;
    default:
      return fb.hint === 'none' ? `Not quite — try stroke ${n} again.` : `Follow the hint for stroke ${n}.`;
  }
}
