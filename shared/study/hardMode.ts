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
 *   answer side, no round, and Good / Easy are GREYED on this showing — Again or Hard suggested
 *   (`goodEasyGate`). Never locked: a second tap within a few seconds still rates Good / Easy
 *   (`overrideTap` — Jerome: "sometimes I'm just on the train"). The answer side says so.
 * - A right answer is FELT: a firm success haptic + sound (`hardModeQuestionFeel` / `roundTakeFeel`,
 *   the web's `STUDY_FEEL_VIBRATION`, the Lab's Haptics.success / celebrate).
 * - Three settings, per device (web localStorage, Lab StudyPrefs), switched from the session's header
 *   or Settings → Study: **Off** (the default — the card goes straight to its answer) · **Red cards
 *   only** (the cards he's struggling with right now: learning / relearning — the red count in the
 *   header, which is where every card rated Again today goes) · **All cards**.
 * - The listening card (audio → hanzi) too: its question is checked the same way, then a round of
 *   "say it in Chinese" sentences (`pickListenRoundExercises` in sentenceRound.ts). Never the
 *   tutor-notes practice or the Try-it previews (the homework pass has its own setting, pass-angles.ts).
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

/** Hard mode on this card: the setting, a reading / meaning / listening card, and (Red cards only) a red card. */
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
  | { status: 'done'; isMatch: boolean; containsExpected: boolean; /** Same syllables, other tones (`compareTranscription`). */ tonesOff?: boolean };

export interface HardModeEvidence {
  /** A typing card: the verdict of what was typed / said / picked (null = nothing). A grid: all rows right = 'exact', else 'wrong'. */
  answerVerdict?: AnswerVerdict | null;
  /** A read card: its take (null = no take). */
  take?: HardModeTake | null;
}

/**
 * The question's result. null = nothing was tried (that is giving up). A read card's take is right
 * when it was said as written or inside a sentence — the "You said ✅" —, close when only the tones
 * were off ("≈ Close — tones off", like a typing card's `close`), and wrong otherwise.
 */
export function hardModeQuestionResult(evidence: HardModeEvidence): HardModeQuestionResult | null {
  const v = evidence.answerVerdict;
  if (v) return v === 'wrong' ? 'wrong' : v === 'close' ? 'close' : 'right';
  const take = evidence.take;
  if (!take) return null;
  if (take.status === 'done') return take.isMatch || take.containsExpected ? 'right' : take.tonesOff ? 'close' : 'wrong';
  return take.status;
}

/** What comes after the question: right → the round (or the answer when there is none); a miss stays. */
export function hardModeRoundFollows(result: HardModeQuestionResult | null, sentenceCount: number | null): boolean {
  return (result === 'right' || result === 'unknown') && (sentenceCount == null || sentenceCount > 0);
}

/**
 * 👁 Show answer before a right answer (or Skip / Show with nothing tried): the answer shows IN PLACE on the
 * question — the hanzi, pinyin and meaning, like a wrong answer's reveal — then **Continue to the
 * sentences ›** goes on to the round (Jerome: "it should just show me the answer and then let me click
 * through to the next stage"). It still counts as giving up (Good / Easy greyed). Known to have no
 * sentences → the answer side at once, as before. null = the sentences are still loading (in place).
 */
export function hardModeGiveUpInPlace(sentenceCount: number | null): boolean {
  return sentenceCount == null || sentenceCount > 0;
}

/** How long "✓ Right" shows before the round opens by itself. */
export const HARD_MODE_RIGHT_BEAT_MS = 1500;

/** Good / Easy on the answer side: open, or greyed with Again / Hard suggested (never locked). */
export type GoodEasyState = 'open' | 'suggest_lower';
/** Why Good / Easy are greyed: he looked at the answer, or the sentences aren't right yet. */
export type GoodEasyReason = 'gave_up' | 'sentences';

export interface GoodEasyGate {
  state: GoodEasyState;
  reason: GoodEasyReason | null;
  /** The line above the ratings (null = none). */
  label: string | null;
  /** He looked at the answer: the sentences can't open it on this showing. */
  gaveUp: boolean;
}

/**
 * Good / Easy on the answer side. Gave up (looked at the answer before getting it right): greyed for
 * this showing whatever the sentences say — Again or Hard suggested. Otherwise the Sentence gate
 * decides (`sentenceGate`: the round's two right, or two on the answer side). Greyed is a SUGGESTION:
 * `overrideTap` lets a second tap rate anyway.
 */
export function goodEasyGate(gate: SentenceGate, gaveUp: boolean, gateLabel: string | null): GoodEasyGate {
  if (gaveUp) return { state: 'suggest_lower', reason: 'gave_up', label: HARD_MODE_GAVE_UP_LINE, gaveUp: true };
  return { state: gate.locked ? 'suggest_lower' : 'open', reason: gate.locked ? 'sentences' : null, label: gateLabel, gaveUp: false };
}

/** Ratings 0 Again · 1 Hard · 2 Good · 3 Easy: a greyed Good / Easy needs a second tap. */
export function ratingNeedsOverride(rating: number, g: GoodEasyGate): boolean {
  return g.state === 'suggest_lower' && rating >= 2;
}

/** The rating the answer side points him to while Good / Easy are greyed (Hard), else null. */
export function suggestedRating(g: GoodEasyGate): number | null {
  return g.state === 'suggest_lower' ? 1 : null;
}

/** How long the first tap on a greyed Good / Easy stays armed ("Tap again to rate Good anyway"). */
export const HARD_MODE_OVERRIDE_MS = 3000;

/** A first tap on a greyed rating, waiting for the second. */
export interface OverrideArm {
  rating: number;
  at: number;
}

export interface OverrideTap {
  /** Rate now. */
  rate: boolean;
  /** This rating went through on the second tap (analytics `study.hard_mode_override`). */
  override: boolean;
  /** The arm to keep (null = none). */
  armed: OverrideArm | null;
}

/**
 * A tap on a rating. Not greyed → rates. Greyed: the first tap arms it (the prompt shows); a second tap
 * on the SAME rating within `HARD_MODE_OVERRIDE_MS` rates it; another greyed rating, or a tap after the
 * window, arms afresh.
 */
export function overrideTap(args: { needsOverride: boolean; rating: number; armed: OverrideArm | null; now: number }): OverrideTap {
  if (!args.needsOverride) return { rate: true, override: false, armed: null };
  const a = args.armed;
  if (a && a.rating === args.rating && args.now - a.at >= 0 && args.now - a.at <= HARD_MODE_OVERRIDE_MS) {
    return { rate: true, override: true, armed: null };
  }
  return { rate: false, override: false, armed: { rating: args.rating, at: args.now } };
}

const RATING_NAME: Record<number, string> = { 0: 'Again', 1: 'Hard', 2: 'Good', 3: 'Easy' };

/** "Tap again to rate Good anyway". */
export function overridePrompt(rating: number): string {
  return `Tap again to rate ${RATING_NAME[rating] ?? 'it'} anyway`;
}

/** The small mark on the suggested rating while Good / Easy are greyed. */
export const HARD_MODE_SUGGESTED = 'suggested';
/** The small mark on a greyed rating, and on it once armed. */
export const HARD_MODE_TAP_TWICE = 'tap twice';
export const HARD_MODE_TAP_AGAIN = 'tap again';

// --- the feel: a right answer you can feel ----------------------------------------------------------

/**
 * What a moment of the ladder feels like (Jerome: "when I get it right on the very first page there's no
 * satisfying haptics — I find myself quite dependent on it"):
 * - success — the question's own answer checked right: a firm double buzz + a rising chime;
 * - round_right — a Sentence round exercise (or a sentence row) said right: the same, a touch lighter;
 * - round_done — the round's last one needed: Good and Easy open — a longer celebration;
 * - nearly — ≈ close: one short tick; miss — ✗ wrong: a low double thud.
 */
export type StudyFeel = 'success' | 'round_right' | 'round_done' | 'nearly' | 'miss';

/** The question's result → its feel (checking / unknown / nothing tried → none). */
export function hardModeQuestionFeel(result: HardModeQuestionResult | null): StudyFeel | null {
  if (result === 'right') return 'success';
  if (result === 'close') return 'nearly';
  if (result === 'wrong') return 'miss';
  return null;
}

/** A judged sentence take → its feel; `done` = this take made the round's count (Good and Easy open). */
export function roundTakeFeel(result: 'right' | 'close' | 'wrong' | 'failed' | 'empty', done: boolean): StudyFeel | null {
  if (result === 'right') return done ? 'round_done' : 'round_right';
  if (result === 'close') return 'nearly';
  if (result === 'wrong') return 'miss';
  return null;
}

/**
 * The web's vibration pattern per feel (navigator.vibrate: on / off ms; Android Chrome / the installed
 * PWA). Pulses of 35 ms and more: shorter ones (the 10 ms ticks elsewhere) are barely felt on a Pixel.
 * The Lab app composes its own primitives per feel (fx/Haptics: success / celebrate / tick / wrong).
 */
export const STUDY_FEEL_VIBRATION: Record<StudyFeel, readonly number[]> = {
  success: [40, 70, 60],
  round_right: [35, 60, 50],
  round_done: [40, 60, 40, 60, 110],
  nearly: [25],
  miss: [30, 80, 30],
};

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
  all: 'Every reading, meaning and listening card',
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
export const HARD_MODE_MISS_NOTE = 'Showing the answer counts as a miss — Again or Hard suggested.';
/** The button after a right answer (or one that couldn't be checked). */
export function hardModeNextLabel(roundFollows: boolean): string {
  return roundFollows ? 'Next: harder questions' : 'See the answer';
}
/** "Your answer: 银行" / "You said: 银航" — his own words only, never the card's answer. */
export function hardModeSaidLine(said: string, spoken: boolean): string {
  return `${spoken ? 'You said' : 'Your answer'}: ${said}`;
}
export const HARD_MODE_GAVE_UP_LINE = '👁 You looked at the answer — Again or Hard suggested';
/** The in-place reveal after 👁 Show answer (`hardModeGiveUpInPlace`). */
export const HARD_MODE_REVEALED_TITLE = '👁 The answer';
export const HARD_MODE_REVEALED_NOTE = 'You looked, so this one counts as a miss — the sentences are still worth doing.';
/** Its button: on to the round (or, none after all, the full answer side). */
export function hardModeRevealedNextLabel(roundFollows: boolean): string {
  return roundFollows ? 'Continue to the sentences' : 'See the full answer';
}
/** The round's cheer once enough are right after giving up ("Good and Easy unlocked" would not be true). */
export function hardModeGaveUpCheer(got: number, needed: number): string {
  return `🎉 ${got} / ${needed} — nice recovery`;
}
