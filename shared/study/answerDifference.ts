/**
 * "Hold it and show me what was different" (docs/STUDY_SESSION.md "Hard mode" → "Right, but said
 * differently"; Jerome, Oct 2026: "if I submit my spoken version of a translation from English,
 * sometimes I word it differently. It loads for a second and then goes through without explaining
 * what the differences were").
 *
 * In Hard mode's ladder (the question's own check and the Sentence round, in the study session and in
 * the homework pass) an answer that is ACCEPTED but is not the model / expected answer never goes on by
 * itself: it stays on the page with "You said" vs the model answer, the characters that differ marked,
 * the pinyin of both, Claude's tips / fix / alternative when the check gave them, and an explicit button
 * on. It still counts as right. An identical answer keeps the quick ✓ and goes on by itself as before;
 * close / wrong are unchanged (Try again).
 *
 * Accepted but different:
 * - a translate take Claude judged **acceptable**, or **correct** in other words (after punctuation,
 *   spaces, numbers ↔ hanzi and 两 / 二: `hanziAnswerKey`) — `reworded`;
 * - a translate take right on the device by SOUND only (other characters, the same toned pinyin) —
 *   `homophone`;
 * - the question's spoken answer that "Sounded right — written 由" (`sound`) — `homophone`; a typed /
 *   spoken listed alternative (`alternative`).
 * Never a difference: a 📖 Read it aloud take (he read the sentence on screen — other characters are the
 * recogniser's, not his), the answer said inside a longer sentence (`contains`: the answer is right there
 * in what he said), exact / punctuation-only / equivalent answers.
 *
 * Pure; the Lab app's port (core `AnswerDifference.kt`) is parity-tested (parity/fixtures/answer-difference.ts).
 */
import type { AnswerVerdict } from '../cards/answer';
import { spokenResultMarks, type SpokenResultChar, type SpokenResultState } from '../cards/spoken-result';
import type { AnswerCheckVerdict } from '../lesson/answerCheck';
import { hanziAnswerKey } from '../text/numberHanzi';
import type { SentencePractiseMode } from './sentencePractise';

/** Why an accepted answer is held: Claude said acceptable · correct in other words · right by sound · a listed alternative. */
export type DifferenceReason = 'acceptable' | 'reworded' | 'homophone' | 'alternative';
export const DIFFERENCE_REASONS: readonly DifferenceReason[] = ['acceptable', 'reworded', 'homophone', 'alternative'];

/** The same words: equal once punctuation, spaces, numbers ↔ hanzi and 两 / 二 are set aside. */
export function sameAnswerWords(said: string, model: string): boolean {
  return hanziAnswerKey(said) === hanziAnswerKey(model);
}

/**
 * A Sentence round take (or a sentence row's): right but not the model sentence → why; else null
 * (identical, not right, or a read take). `local` = the device's judgement (`practiseSentence`),
 * `claude` = the answer check's verdict when there is one (it decides, as in `sentencePractiseResult`).
 */
export function roundTakeDifference(args: {
  mode: SentencePractiseMode;
  said: string;
  model: string;
  local: SpokenResultState;
  claude: AnswerCheckVerdict | null | undefined;
}): DifferenceReason | null {
  if (args.mode !== 'translate') return null;
  if (args.claude) {
    if (args.claude === 'acceptable') return 'acceptable';
    if (args.claude === 'correct') return sameAnswerWords(args.said, args.model) ? null : 'reworded';
    return null;
  }
  if (args.local === 'sound') return sameAnswerWords(args.said, args.model) ? null : 'homophone';
  return null;
}

/**
 * How a Sentence round take shows under its exercise (Jerome, Oct 2026: "It would be nice if this
 * didn't take up so much space — we've duplicated both the pinyin and the Chinese characters"). The
 * exercise already shows its sentence (hanzi + pinyin) and English, so the take adds only what's new:
 * - `compare`: "You said" vs the model answer (`DifferenceCompare`) — Claude's check of a translate
 *   take, unless it was correct in the very same words (then the sentence above IS what he said);
 * - otherwise ONE compact row: `transcript` = what he said, shown only when its words differ from the
 *   sentence (a plain match is just "You said ✓ Match"); `pinyin` = the transcript's pinyin, only when
 *   it sounded different (≈ close / ✗ didn't match — the tones / syllables he got wrong).
 */
export interface RoundTakeView {
  compare: boolean;
  transcript: boolean;
  pinyin: boolean;
}

export function roundTakeView(args: {
  mode: SentencePractiseMode;
  said: string;
  model: string;
  local: SpokenResultState;
  claude: AnswerCheckVerdict | null | undefined;
}): RoundTakeView {
  if (args.mode === 'translate' && args.claude) {
    const same = args.claude === 'correct' && sameAnswerWords(args.said, args.model);
    return { compare: !same, transcript: false, pinyin: false };
  }
  const differs = args.local !== 'match' || !sameAnswerWords(args.said, args.model);
  return { compare: false, transcript: differs, pinyin: args.local === 'close' || args.local === 'wrong' };
}

/** Hard mode's question (a typing card's typed / spoken answer): accepted but not the card's hanzi → why. */
export function questionDifference(verdict: AnswerVerdict | null | undefined): DifferenceReason | null {
  if (verdict === 'sound') return 'homophone';
  if (verdict === 'alternative') return 'alternative';
  return null;
}

/** The two lines, marked: his characters not in the model, and the model's not in his (LCS, shared/cards/spoken-result.ts). */
export interface DifferenceLines {
  said: SpokenResultChar[];
  model: SpokenResultChar[];
}

/**
 * "You said" vs the model answer, character by character. Accepted: the characters that differ are
 * `differs` on both lines (written / worded differently — yellow, dotted). Not accepted (almost /
 * wrong): his are `wrong` (red, solid), the model's `differs`.
 */
export function differenceLines(said: string, model: string, accepted: boolean): DifferenceLines {
  return {
    said: spokenResultMarks(said, model, accepted ? 'sound' : 'wrong'),
    model: spokenResultMarks(model, said, 'sound'),
  };
}

// --- words (both apps) ---------------------------------------------------------------------------

/** The held exercise's line under its ✓ (icon + words, never colour alone). */
export const DIFFERENCE_TITLE: Record<DifferenceReason, string> = {
  acceptable: '✓ Right — said differently from the model',
  reworded: '✓ Right — worded differently',
  homophone: '✓ Sounded right — written differently',
  alternative: '✓ Right — the card writes it differently',
};
export const DIFFERENCE_SAID = 'You said';
export const DIFFERENCE_MODEL = 'Model answer';
/** The question's model is the card itself. */
export const DIFFERENCE_CARD = 'The card';
/** Under the comparison while it holds the page. */
export const DIFFERENCE_HOLD_NOTE = 'Have a look at the difference, then go on.';
export const DIFFERENCE_CONTINUE = 'Continue';
/**
 * On an accepted (✓ Right) round exercise — read or translate, held or not: say it again to get it
 * better (Jerome: "Also right — … slightly wordy" → he wants another go). The new take is judged the
 * same way and its result replaces the one shown; it never takes back a right already counted, and the
 * round never goes on by itself after one.
 */
export const DIFFERENCE_SAY_AGAIN = 'Say it again';
