/**
 * Word order (scramble) answers Claude checks (docs/STUDY_SESSION.md "Claude checks your answer" →
 * "Word order"). Jerome (Nov 2026) built 一看见蛋糕孩子就高兴起来了 for "As soon as the child saw the
 * cake, he cheered up." — natural Chinese (一到家，我就睡觉了) — and the app said "✗ Not quite" because the
 * author listed only 孩子一看见蛋糕就高兴起来了 and no `alt_orders`.
 *
 * The rule, one for both apps (Lab port core `ScrambleCheck.kt`, parity-tested in
 * parity/fixtures/lesson-answer-check.ts):
 * - his order IS the correct order or one of `alt_orders` → ✓ Correct on the device (as before);
 * - he used every tile in ANOTHER order → the lesson answer check (`POST /api/lessons/answer-check`,
 *   exercise_type `scramble`, cached for everyone) decides while the banner says "Checking…" in place:
 *   correct / acceptable → "✓ Also right" (scored right: no retry round, no revision for it), the expected
 *   order shown as "Also: …" with ▶, no red marks; almost / wrong → "✗ Not quite" + Claude's one-line reason;
 * - offline / the check failed / no key → "✗ Not quite" at once, as before. Nothing ever waits on it.
 *
 * The orders travel as their tiles joined with single spaces (so Claude sees the tiles); every comparison and
 * the cache ignore the spaces (`normalizeHanziAnswer`).
 */
import { SCRAMBLE_CHECK_TYPE, type AnswerCheck, type AnswerCheckInput } from './answerCheck';
import type { LessonFeelMoment } from './feedback';

export { SCRAMBLE_CHECK_TYPE, SCRAMBLE_CHECK_VERSION, isScrambleCheck } from './answerCheck';

export const SCRAMBLE_CHECKING_BANNER = 'Checking…';
export const SCRAMBLE_CORRECT_BANNER = '✓ Correct';
export const SCRAMBLE_ALSO_RIGHT_BANNER = '✓ Also right';
export const SCRAMBLE_NOT_QUITE_BANNER = '✗ Not quite';
/** The expected order's label: while Claude checks, when his order is also right, when it isn't. */
export const SCRAMBLE_EXPECTED_LABEL = 'The expected order:';
export const SCRAMBLE_ALSO_LABEL = 'Also:';
export const SCRAMBLE_RIGHT_ORDER_LABEL = 'The right order:';

/** A tile list as one sentence, whitespace dropped — the device's own comparison (checkScrambleOrder). */
export function scrambleSentence(order: readonly string[]): string {
  return order.join('').replace(/\s/g, '');
}

/** The tiles as they travel to the check: joined with single spaces, each tile's own spaces folded. */
export function scrambleOrderText(order: readonly string[]): string {
  return order.map((t) => t.replace(/\s+/g, '')).filter(Boolean).join(' ');
}

/**
 * What the device can say about his order: `right` = the correct order or an accepted alternative,
 * `unexpected` = every tile used in another order (→ Claude), `incomplete` = not every tile placed.
 */
export type ScrambleLocalVerdict = 'right' | 'unexpected' | 'incomplete';

export function scrambleLocalVerdict(
  picked: readonly string[],
  tiles: readonly string[],
  correctOrder: readonly string[],
  altOrders?: readonly (readonly string[])[] | null,
): ScrambleLocalVerdict {
  if (picked.length !== tiles.length) return 'incomplete';
  const mine = scrambleSentence(picked);
  if (mine === scrambleSentence(correctOrder)) return 'right';
  if ((altOrders ?? []).some((alt) => mine === scrambleSentence(alt))) return 'right';
  return 'unexpected';
}

/** The check of an unexpected order (null when the device has decided, or there is no Chinese to judge). */
export function scrambleCheckInput(
  ex: { english: string; correct_order: readonly string[] },
  picked: readonly string[],
  focus?: string | null,
): AnswerCheckInput | null {
  const english = (ex.english ?? '').trim();
  const answer = scrambleOrderText(picked);
  const model = scrambleOrderText(ex.correct_order);
  if (!english || !answer || !model || !/\p{Script=Han}/u.test(answer)) return null;
  const input: AnswerCheckInput = { prompt_en: english, model_answer: model, answer, exercise_type: SCRAMBLE_CHECK_TYPE, input: 'typed' };
  const f = (focus ?? '').trim();
  if (f) input.focus = f;
  return input;
}

/** Where Claude's check of his order stands. */
export type ScrambleCheckStatus =
  | { status: 'checking' }
  | { status: 'done'; check: AnswerCheck }
  /** Offline / failed / no key: the device's strict verdict stands. */
  | { status: 'unavailable' };

export type ScrambleOutcomeKind = 'right' | 'checking' | 'also_right' | 'not_quite';

export interface ScrambleOutcome {
  kind: ScrambleOutcomeKind;
  /** The banner, in place from the moment he presses Check. */
  banner: string;
  tone: 'good' | 'bad' | 'neutral';
  /** Scored as right (the run, the retry round and the revision read this). */
  correct: boolean;
  /** The label over the expected order (null = shown bare: his order IS it). */
  expectedLabel: string | null;
  /** Claude's one line (its headline) for the slot below the buttons; null while checking / without a check. */
  note: string | null;
  /** "Claude is checking…" below the buttons. */
  checking: boolean;
  /** The answer screen's feel (shared/lesson/feedback.ts) — null while checking / for a miss. */
  moment: LessonFeelMoment | null;
}

/**
 * The answer screen of a checked word order. `local` = the device's verdict on Check; `sameAsExpected` = his
 * order IS the expected one (an accepted alternative is labelled "Also:"); `check` = Claude's check of an
 * unexpected order (ignored for `right`).
 */
export function scrambleOutcome(
  local: Exclude<ScrambleLocalVerdict, 'incomplete'>,
  check: ScrambleCheckStatus | null,
  sameAsExpected = local === 'right',
): ScrambleOutcome {
  if (local === 'right') {
    return {
      kind: 'right', banner: SCRAMBLE_CORRECT_BANNER, tone: 'good', correct: true,
      expectedLabel: sameAsExpected ? null : SCRAMBLE_ALSO_LABEL, note: null, checking: false, moment: 'checked_right',
    };
  }
  if (check?.status === 'checking') {
    return {
      kind: 'checking', banner: SCRAMBLE_CHECKING_BANNER, tone: 'neutral', correct: false,
      expectedLabel: SCRAMBLE_EXPECTED_LABEL, note: null, checking: true, moment: null,
    };
  }
  if (check?.status === 'done' && (check.check.verdict === 'correct' || check.check.verdict === 'acceptable')) {
    return {
      kind: 'also_right', banner: SCRAMBLE_ALSO_RIGHT_BANNER, tone: 'good', correct: true,
      expectedLabel: SCRAMBLE_ALSO_LABEL, note: check.check.headline || null, checking: false, moment: 'claude_right',
    };
  }
  return {
    kind: 'not_quite', banner: SCRAMBLE_NOT_QUITE_BANNER, tone: 'bad', correct: false,
    expectedLabel: SCRAMBLE_RIGHT_ORDER_LABEL,
    note: check?.status === 'done' ? check.check.headline || null : null,
    checking: false, moment: null,
  };
}

/** The sentence to play once the verdict is known: his own order when it is right, else the expected one. */
export function scrambleSpokenSentence(outcome: Pick<ScrambleOutcome, 'kind'>, picked: readonly string[], correctOrder: readonly string[]): string | null {
  if (outcome.kind === 'checking') return null;
  return outcome.kind === 'not_quite' ? correctOrder.join('') : picked.join('');
}
