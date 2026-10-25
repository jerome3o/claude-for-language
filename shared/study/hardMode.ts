/**
 * Hard mode (docs/STUDY_SESSION.md "Hard mode"): a Worldle-like ladder on the reading
 * (hanzi → meaning) and meaning (meaning → hanzi) cards of the regular study session.
 *
 *   question → his answer, checked AT ONCE on the question (✓ Right / ✗ Not quite — 🔁 Try again,
 *   👁 Show answer) → once right, the Sentence round (shared/study/sentenceRound.ts) → the answer side.
 *
 * - The answer is checked with the checks the card already has: a typed answer `checkTypedAnswer`,
 *   a spoken one `checkSpokenAnswer`, a multiple-choice grid all rows right, a read card's take its
 *   "You said" against the card (said as written, or inside a sentence). Nothing new is judged here.
 * - Giving up (👁 Show answer, Skip recording, Show with nothing typed) is a MISS: straight to the
 *   answer side, no round, and Good / Easy stay locked on this showing — Again or Hard
 *   (`hardModeLock`). The answer side says so.
 * - Three settings, per device (web localStorage, Lab StudyPrefs), switched from the session's header
 *   or Settings → Study: **Off** (the default — the card goes straight to its answer) · **Red cards
 *   only** (the cards he's struggling with right now: learning / relearning — the red count in the
 *   header, which is where every card rated Again today goes) · **All cards**.
 * - Never the listening card, the homework pass, the tutor-notes practice or the Try-it previews.
 *
 * Pure; the Lab app's port (core `HardMode.kt`) is parity-tested (parity/fixtures/hard-mode.ts).
 */
// Type only: this module stays light (no pinyin-pro through answer.ts).
import type { AnswerVerdict } from '../cards/answer';
import { SENTENCE_GATE_CARD_TYPES, type SentenceGate } from './sentencePractise';

export type HardMode = 'off' | 'red' | 'all';
export const HARD_MODES: readonly HardMode[] = ['off', 'red', 'all'];
export const DEFAULT_HARD_MODE: HardMode = 'off';

/**
 * A stored value → the mode. The switch it replaces ("Sentence round before the answer", stored as
 * '1' / '0') reads as All cards / Off, so a phone that had it on keeps it.
 */
export function parseHardMode(raw: string | null | undefined): HardMode {
  if (raw === 'off' || raw === 'red' || raw === 'all') return raw;
  if (raw === '1' || raw === 'true') return 'all';
  return DEFAULT_HARD_MODE;
}

/** The header chip's tap order when cycled: Off → Red cards only → All cards → Off. */
export function nextHardMode(mode: HardMode): HardMode {
  return HARD_MODES[(HARD_MODES.indexOf(mode) + 1) % HARD_MODES.length];
}

/** Queue values (NEW 0, LEARNING 1, REVIEW 2, RELEARNING 3). */
const LEARNING = 1;
const RELEARNING = 3;

/**
 * A "red" card: one he is struggling with right now — learning or relearning (the red count in the
 * session header). A card rated Again today is always one of these (Again on a new card → learning,
 * on a review card → relearning, on a learning card → learning).
 */
export function isRedCard(queue: number | null | undefined): boolean {
  return queue === LEARNING || queue === RELEARNING;
}

/** Hard mode on this card: the setting, a reading / meaning card, and (Red cards only) a red card. */
export function hardModeApplies(args: { mode: HardMode; cardType: string; queue: number | null | undefined }): boolean {
  if (args.mode === 'off' || !SENTENCE_GATE_CARD_TYPES.includes(args.cardType)) return false;
  return args.mode === 'all' || isRedCard(args.queue);
}

// --- the question's own answer, checked at once --------------------------------------------------

/** right / close / wrong; checking = a take still being transcribed; unknown = it can't be (offline, failed). */
export type HardModeQuestionResult = 'right' | 'close' | 'wrong' | 'checking' | 'unknown';

export type HardModeTake =
  | { status: 'checking' }
  | { status: 'unknown' }
  | { status: 'done'; isMatch: boolean; containsExpected: boolean };

export interface HardModeEvidence {
  /** A typing card: the verdict of what was typed / said / picked (null = nothing). A grid: all rows right = 'exact', else 'wrong'. */
  answerVerdict?: AnswerVerdict | null;
  /** A read card: its take (null = no take). */
  take?: HardModeTake | null;
}

/**
 * The question's result. null = nothing was tried (that is giving up). A read card's take is right
 * when it was said as written or inside a sentence — the "You said ✅" — and wrong otherwise.
 */
export function hardModeQuestionResult(evidence: HardModeEvidence): HardModeQuestionResult | null {
  const v = evidence.answerVerdict;
  if (v) return v === 'wrong' ? 'wrong' : v === 'close' ? 'close' : 'right';
  const take = evidence.take;
  if (!take) return null;
  if (take.status === 'done') return take.isMatch || take.containsExpected ? 'right' : 'wrong';
  return take.status;
}

/** What comes after the question: right → the round (or the answer when there is none); a miss stays. */
export function hardModeRoundFollows(result: HardModeQuestionResult | null, sentenceCount: number | null): boolean {
  return (result === 'right' || result === 'unknown') && (sentenceCount == null || sentenceCount > 0);
}

/** How long "✓ Right" shows before the round opens by itself. */
export const HARD_MODE_RIGHT_BEAT_MS = 1500;

export interface HardModeLock {
  /** Good / Easy are disabled. */
  locked: boolean;
  /** The line above the ratings (null = none). */
  label: string | null;
  /** Said when a locked Good / Easy is tapped. */
  blockedNote: string;
  /** He looked at the answer: the sentences can't unlock it on this showing. */
  gaveUp: boolean;
}

/**
 * Good / Easy on the answer side. Gave up (looked at the answer before getting it right): locked for
 * this showing whatever the sentences say — Again or Hard. Otherwise the Sentence gate decides
 * (`sentenceGate`: the round's two right, or two on the answer side).
 */
export function hardModeLock(gate: SentenceGate, gaveUp: boolean, gateLabel: string | null, gateBlockedNote: string): HardModeLock {
  if (gaveUp) return { locked: true, label: HARD_MODE_GAVE_UP_LINE, blockedNote: HARD_MODE_GAVE_UP_BLOCKED, gaveUp: true };
  return { locked: gate.locked, label: gateLabel, blockedNote: gateBlockedNote, gaveUp: false };
}

// --- words (both apps) ---------------------------------------------------------------------------

export const HARD_MODE_TITLE = 'Hard mode';
/** Settings → Study, under the title. */
export const HARD_MODE_DESCRIPTION =
  'Your answer is checked first — try again until it’s right — then a round of harder sentence questions comes before the answer side.';
export const HARD_MODE_OPTION: Record<HardMode, string> = {
  off: 'Off',
  red: 'Red cards only',
  all: 'All cards',
};
export const HARD_MODE_OPTION_HINT: Record<HardMode, string> = {
  off: 'Straight to the answer, as usual',
  red: 'Only the cards you’re struggling with (the red ones)',
  all: 'Every reading and meaning card',
};
/** The header chip (short; the full name is its accessible label). */
export const HARD_MODE_CHIP: Record<HardMode, string> = {
  off: '🎯 Off',
  red: '🎯 Red',
  all: '🎯 All',
};
/** The chip's accessible name: "Hard mode: Red cards only". */
export function hardModeChipLabel(mode: HardMode): string {
  return `${HARD_MODE_TITLE}: ${HARD_MODE_OPTION[mode]}`;
}

/** The question's result line (icon + words, never colour alone). */
export const HARD_MODE_RESULT: Record<'right' | 'close' | 'wrong', string> = {
  right: '✓ Right',
  close: '≈ Nearly',
  wrong: '✗ Not quite',
};
export const HARD_MODE_CHECKING = 'Checking what you said…';
export const HARD_MODE_UNKNOWN = 'Couldn’t check your answer';
export const HARD_MODE_TRY_AGAIN = 'Try again';
export const HARD_MODE_SHOW_ANSWER = 'Show answer';
/** Under a miss: what 👁 Show answer means. */
export const HARD_MODE_MISS_NOTE = 'Showing the answer counts as a miss — Again or Hard.';
/** The button after a right answer (or one that couldn't be checked). */
export function hardModeNextLabel(roundFollows: boolean): string {
  return roundFollows ? 'Next: harder questions' : 'See the answer';
}
/** "Your answer: 银行" / "You said: 银航" — his own words only, never the card's answer. */
export function hardModeSaidLine(said: string, spoken: boolean): string {
  return `${spoken ? 'You said' : 'Your answer'}: ${said}`;
}
export const HARD_MODE_GAVE_UP_LINE = '👁 You looked at the answer — Again or Hard this time';
export const HARD_MODE_GAVE_UP_BLOCKED =
  'You looked at the answer before getting it right, so Good and Easy stay locked on this card — Again or Hard.';
