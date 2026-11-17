/**
 * ONE look for every judged result (docs/STUDY_SESSION.md "One look for every result"). Jerome, Nov 2026, on the
 * card 测试: "you've kept the orange border in. This is not a problem … I do mind that you've made it inconsistent
 * between green and yellow or whatever. There's a discrepancy in the UX now. Can you go through and unify all the UX".
 *
 * Four states, each with ONE colour (theme tokens — web index.css `--result-*`, Lab `ResultColors`) and ONE icon:
 *   right ✓ · close ≈ (almost / contains the answer / tones off / needs work) · wrong ✗ · pending … (checking)
 * and ONE surface for all of them, differing only by colour: a light 1px outline in the state colour and a faint tint
 * of it, a small radius ([RESULT_SURFACE]). The right moment's wash (rightMoment.ts) settles to this same surface in
 * green, so right and close are siblings. The big hanzi of the card stays in normal ink: the result row carries the
 * state. Every surface that shows a verdict maps its own vocabulary through [resultStateOf].
 *
 * Lab: core `ResultState.kt`, parity-tested (android-lab/parity/fixtures/hard-mode.ts `resultStates`).
 */

export type ResultState = 'right' | 'close' | 'wrong' | 'pending';

export const RESULT_STATES: readonly ResultState[] = ['right', 'close', 'wrong', 'pending'];

/** The state's one icon (no state relies on colour alone — Jerome is red / green colour-blind). */
export const RESULT_STATE_ICON: Record<ResultState, string> = {
  right: '✓',
  close: '≈',
  wrong: '✗',
  pending: '…',
};

/**
 * The one surface, the same for every state: the outline is the state colour at [border] opacity (1px), the fill
 * the state colour at [tint] opacity, corners [radius] (px / dp).
 */
export const RESULT_SURFACE = { border: 0.35, tint: 0.08, borderWidth: 1, radius: 10 } as const;

/** Every verdict word any surface uses → its state. */
const RIGHT = new Set([
  'right', 'match', 'exact', 'correct', 'acceptable', 'equivalent', 'alternative', 'punctuation_only',
  'sounds_right', 'sounded_right', 'sound', 'homophone', 'accepted', 'got_it', 'all_right',
]);
const CLOSE = new Set([
  'close', 'contains', 'almost', 'nearly', 'needs_work', 'partial', 'tones_off', 'tone', 'near',
]);
const WRONG = new Set([
  'wrong', 'miss', 'missed', 'incorrect', 'didnt_match', 'no_match', 'failed', 'missed_it',
]);

/** A verdict (any surface's word for it) → its state; anything unknown / waiting → pending. */
export function resultStateOf(verdict: string | null | undefined): ResultState {
  const v = (verdict ?? '').trim().toLowerCase();
  if (RIGHT.has(v)) return 'right';
  if (CLOSE.has(v)) return 'close';
  if (WRONG.has(v)) return 'wrong';
  return 'pending';
}
