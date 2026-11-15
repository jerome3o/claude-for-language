/**
 * A read card's take checked by Claude when the device can't accept it (docs/STUDY_SESSION.md "You said" →
 * "Read takes checked by Claude").
 *
 * Jerome, Nov 2026 (Hard mode, a sentence card 我越学中文，越觉得英文很繁琐。 read aloud): the box said
 * "✕ Didn't match" for 我越学中文，越觉得英语很"繁琐"。 — "can you update the logic of matching here to be more
 * like the other more advanced answer checking?". Two differences: the recogniser's quote marks (never
 * matter now — `compareTranscription` drops every punctuation mark, `tidySpokenTranscript` hides them) and
 * 英语 for 英文, a same-meaning word: never a flat ✗.
 *
 * So the read card (hanzi → meaning) judges a take on the device first (`compareTranscription`: by sound,
 * punctuation ignored, one swallowed 是 / 的 / 了 in a sentence forgiven, "contains", tones off = ≈ Close).
 * When the device says ✗ Didn't match, the card's hanzi has two or more Chinese characters and the device is
 * online, the take goes to Claude's lesson answer check (`POST /api/lessons/answer-check`, the SAME
 * machinery as the sentence answers — cached for everyone, cost guard `ai`) as a READ-ALOUD check
 * (`exercise_type: 'read_aloud'`, spoken; model = the card's hanzi, answer = his tidied transcript). Its
 * verdict replaces the bare ✗:
 * - correct → ✓ Right (as a device match: Good / Easy, Hard mode's ✓, the pass's Got it);
 * - acceptable / almost → ≈ Close with Claude's one-line reason ("You said 英语 — the card has 英文 (same
 *   meaning)") — as the device's ≈ Close today (Hard mode ≈ Nearly). A same-meaning word is never ✗;
 * - wrong → ✗ Didn't match with Claude's tip.
 * While it runs the box says "Checking…"; offline or failed → the device's verdict stays.
 *
 * Pure; Lab port core `ReadTakeCheck.kt`, parity-tested (android-lab/parity/fixtures/read-take-check.ts).
 */
import type { AnswerCheck, AnswerCheckInput, AnswerCheckVerdict } from '../lesson/answerCheck';
import { tidySpokenTranscript } from '../cards/answer';

/** The exercise type of a read-aloud check (shared/lesson/answerCheck.ts `READ_ALOUD_CHECK_TYPE`). */
export const READ_TAKE_CHECK_TYPE = 'read_aloud';

/** The card type whose take is a reading of the card's hanzi. */
export const READ_TAKE_CARD_TYPE = 'hanzi_to_meaning';

const HAN_ALL = /\p{Script=Han}/gu;
const HAN = /\p{Script=Han}/u;

/** How many Chinese characters a text has. */
export function hanCount(text: string): number {
  return (text.match(HAN_ALL) ?? []).length;
}

/** The device's view of a take (`compareTranscription` / Lab `Transcription.compare`). */
export interface ReadTakeComparison {
  isMatch: boolean;
  containsExpected: boolean;
  tonesOff?: boolean;
}

/** The "You said" box's state: ✓ match · ≈ contains · ≈ close · ✗ miss. */
export type ReadTakeState = 'match' | 'contains' | 'close' | 'miss';

/** The device's state of a take. */
export function readTakeDeviceState(c: ReadTakeComparison): ReadTakeState {
  return c.isMatch ? 'match' : c.containsExpected ? 'contains' : c.tonesOff ? 'close' : 'miss';
}

/**
 * Does this take go to Claude? A read card, the device said ✗ (not a match, not "contains", not tones
 * off), the card has two or more Chinese characters and something Chinese was heard.
 */
export function readTakeCheckApplies(args: {
  cardType: string;
  hanzi: string;
  transcript: string | null | undefined;
  comparison: ReadTakeComparison | null | undefined;
}): boolean {
  if (args.cardType !== READ_TAKE_CARD_TYPE || !args.comparison) return false;
  if (readTakeDeviceState(args.comparison) !== 'miss') return false;
  return hanCount(args.hanzi) >= 2 && HAN.test(args.transcript ?? '');
}

/** The check's request: the card's hanzi is the model, his tidied transcript the answer, its English the meaning. */
export function readTakeCheckInput(args: {
  hanzi: string;
  pinyin?: string | null;
  english?: string | null;
  transcript: string;
}): AnswerCheckInput {
  const hanzi = args.hanzi.trim();
  const input: AnswerCheckInput = {
    prompt_en: (args.english ?? '').trim() || hanzi,
    model_answer: hanzi,
    answer: tidySpokenTranscript(args.transcript, hanzi),
    exercise_type: READ_TAKE_CHECK_TYPE,
    input: 'spoken',
  };
  const pinyin = (args.pinyin ?? '').trim();
  if (pinyin) input.model_pinyin = pinyin;
  return input;
}

/** Claude's verdict → the box's state: correct = ✓, acceptable / almost = ≈ Close, wrong = ✗. */
export function readTakeClaudeState(verdict: AnswerCheckVerdict): Exclude<ReadTakeState, 'contains'> {
  if (verdict === 'correct') return 'match';
  return verdict === 'wrong' ? 'miss' : 'close';
}

/**
 * The take as every rule downstream reads it (the box, Hard mode's question result, the pass's
 * suggestion): the device's, or — for a take Claude checked — Claude's verdict as match / tones off / miss.
 */
export function readTakeChecked<T extends ReadTakeComparison>(c: T, claude: AnswerCheckVerdict | null | undefined): T {
  if (!claude || readTakeDeviceState(c) !== 'miss') return c;
  const state = readTakeClaudeState(claude);
  return { ...c, isMatch: state === 'match', containsExpected: false, tonesOff: state === 'close' };
}

/** The box's chip words for a take Claude checked. */
export const READ_TAKE_CHIP: Record<Exclude<ReadTakeState, 'contains'>, string> = {
  match: 'Right',
  close: 'Close',
  miss: 'Didn’t match',
};

/** While Claude reads it. */
export const READ_TAKE_CHECKING = 'Checking…';

/** What the box says under what was said: Claude's one-line reason, and for ✗ its first tip (null = nothing). */
export function readTakeReason(check: AnswerCheck): { reason: string; tip: string | null } {
  const tip = check.verdict === 'wrong' ? check.tips[0]?.text ?? null : null;
  return { reason: check.headline, tip: tip && tip !== check.headline ? tip : null };
}

/** `study.read_take_check { verdict }` when there was no check: offline, or it failed. */
export type ReadTakeCheckEventVerdict = AnswerCheckVerdict | 'offline' | 'error';
