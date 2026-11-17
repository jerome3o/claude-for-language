/**
 * The "right" moment on the study card (docs/STUDY_SESSION.md "A right answer you can see"). Jerome, Nov 2026,
 * after the boxes went (#751) and the feedback went to one line (#754): "when I get things right, it's not super
 * obvious. I wouldn't mind some haptic feedback … some indication that things are green — but not as fluorescent
 * as before. Mini confetti. Doesn't have to be too elaborate."
 *
 * ONE moment everywhere a study-card answer is judged right — Hard mode's question (a read take, a typed / spoken
 * answer, Claude's sentence check), each Sentence round exercise (listen exercises too), a 🎤 take on an example
 * sentence row, a typed answer judged right on the answer side; the homework pass through the same card:
 * - a soft green wash on the thing that was right (the row / the answer area) that settles to a faint tint, and a
 *   ✓ in the same place — no thick outline;
 * - a SMALL confetti burst from that spot (the lesson feedback's burst, a dozen pieces, ~0.7 s);
 * - the StudyFeel haptic (+ its sound when sounds are on).
 * Small every time, so a run of right answers never gets noisy; the round's last right exercise ("2 / 2") is a
 * little bigger. Reduce motion: no confetti and the tint without animation (the feel is unchanged). A moment already
 * celebrated on this showing (Claude agreeing after the device did) adds nothing but the tint.
 *
 * Lab: core `RightMoment.kt`, parity-tested (android-lab/parity/fixtures/hard-mode.ts `moments`).
 */
import type { StudyFeel } from './hardMode';

/** Where the answer was judged right. */
export type RightMomentWhere = 'question' | 'round_exercise' | 'sentence_row' | 'typed_answer';

export const RIGHT_MOMENT_WHERE: readonly RightMomentWhere[] = ['question', 'round_exercise', 'sentence_row', 'typed_answer'];

export interface RightMoment {
  /** The StudyFeel to play (null = already felt on this showing). */
  feel: StudyFeel | null;
  /** Confetti pieces from the spot (0 = none). */
  confetti: number;
  /** How long the burst flies (ms); the wash settles in the same time. */
  durationMs: number;
  /** false = the tint and ✓ appear at once (reduce motion). */
  animate: boolean;
}

/** The small burst: a dozen pieces, ~0.7 s. */
export const RIGHT_MOMENT_PIECES = 12;
export const RIGHT_MOMENT_MS = 700;
/** The round's last right exercise ("2 / 2"): a little bigger. */
export const RIGHT_MOMENT_DONE_PIECES = 20;
export const RIGHT_MOMENT_DONE_MS = 850;

export function rightMoment(
  where: RightMomentWhere,
  opts: { roundDone?: boolean; reduceMotion?: boolean; celebrated?: boolean } = {},
): RightMoment {
  const done = where === 'round_exercise' && !!opts.roundDone;
  const feel: StudyFeel = where === 'question' || where === 'typed_answer' ? 'success' : done ? 'round_done' : 'round_right';
  const pieces = done ? RIGHT_MOMENT_DONE_PIECES : where === 'sentence_row' ? RIGHT_MOMENT_PIECES - 2 : RIGHT_MOMENT_PIECES;
  const ms = done ? RIGHT_MOMENT_DONE_MS : RIGHT_MOMENT_MS;
  if (opts.celebrated) return { feel: null, confetti: 0, durationMs: ms, animate: false };
  if (opts.reduceMotion) return { feel, confetti: 0, durationMs: ms, animate: false };
  return { feel, confetti: pieces, durationMs: ms, animate: true };
}
