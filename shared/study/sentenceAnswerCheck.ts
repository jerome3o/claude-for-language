/**
 * Sentence answers checked by Claude (docs/STUDY_SESSION.md "Sentence answers checked by Claude").
 *
 * Jerome, Nov 2026 (homework pass, Hard mode, "Second angle · English → Chinese"): the card's answer was
 * 我早上喝咖啡是为了上班不困。; he said 我早上喝咖啡，因为工作不困。 — "I think I've said it reasonably well,
 * but it's not great. I'd love to have the check-if-my-answer-is-okay logic, give me some advice, but then
 * also allow me to retry, to be on this page."
 *
 * So, in Hard mode's check on the question (the study session and the homework pass alike), a meaning →
 * hanzi card whose answer is a SENTENCE (`noteKind`: more than 4 Han characters, or punctuated) and whose
 * typed / spoken answer the device does NOT accept (`checkTypedAnswer` / `checkSpokenAnswer`: wrong or
 * close) is asked of Claude's lesson answer check (`POST /api/lessons/answer-check`, exercise_type
 * 'translate' — cached for everyone by `answerCheckCacheText`, so the same answer twice is one call):
 * - correct / acceptable → RIGHT: the ladder goes on as for a right answer (the round, Good / Easy open; the
 *   pass suggests Got it), held first with "You said" vs the card and Claude's tips (`sentenceCheckDifference`);
 * - almost → like a device `close` (≈ Nearly); wrong → wrong — both with Claude's verdict, the corrected
 *   sentence, tips and an alternative ON THE QUESTION, then 🔁 Try again (a new answer, checked afresh) or
 *   👁 Show answer (giving up, exactly as before).
 * Offline / no check to be had → the device's verdict, as before. Never the listening card (audio → hanzi
 * is dictation: another wording isn't right there), never a multiple-choice grid, never a word card.
 *
 * Pure; the Lab app's port (core `SentenceAnswerCheck.kt`) is parity-tested
 * (android-lab/parity/fixtures/sentence-answer-check.ts).
 */
import type { AnswerVerdict } from '../cards/answer';
import type { PassOutcome } from '../homework/pass-card';
import { passSuggestion } from '../homework/pass-card';
import { hasHan, type AnswerCheckInput, type AnswerCheckVerdict } from '../lesson/answerCheck';
import { noteKind } from '../progress/known';
import { roundTakeDifference, type DifferenceReason } from './answerDifference';
import { hardModeQuestionResult } from './hardMode';

/** The cards whose sentence answers Claude checks: English → Chinese only (audio → hanzi is dictation). */
export const SENTENCE_CHECK_CARD_TYPES: readonly string[] = ['meaning_to_hanzi'];

/** A verdict the device accepts (`isAcceptedVerdict`, repeated so this module stays light). */
const accepted = (v: AnswerVerdict) => v !== 'wrong' && v !== 'close';

/** The card's answer is a sentence / longer phrase (more than 4 Han characters, or punctuated). */
export function isSentenceAnswer(hanzi: string): boolean {
  return noteKind(hanzi) === 'sentence';
}

/**
 * Does this answer go to Claude? A meaning → hanzi card with a sentence answer, an answer in Chinese
 * typed or said (never a multiple-choice grid), that the device didn't accept.
 */
export function sentenceAnswerCheckApplies(args: {
  cardType: string;
  hanzi: string;
  answer: string | null | undefined;
  /** The device's verdict of that answer (null = nothing to check). */
  verdict: AnswerVerdict | null | undefined;
  multipleChoice?: boolean;
}): boolean {
  if (!SENTENCE_CHECK_CARD_TYPES.includes(args.cardType) || args.multipleChoice) return false;
  if (!args.verdict || accepted(args.verdict)) return false;
  const answer = (args.answer ?? '').trim();
  return answer.length > 0 && hasHan(answer) && isSentenceAnswer(args.hanzi);
}

/** The check's request: the card's English is the prompt, its hanzi + pinyin the model answer. */
export function sentenceAnswerCheckInput(args: {
  english: string;
  hanzi: string;
  pinyin?: string | null;
  answer: string;
  spoken: boolean;
}): AnswerCheckInput {
  const input: AnswerCheckInput = {
    prompt_en: args.english.trim(),
    model_answer: args.hanzi.trim(),
    answer: args.answer.trim(),
    exercise_type: 'translate',
    input: args.spoken ? 'spoken' : 'typed',
  };
  const pinyin = (args.pinyin ?? '').trim();
  if (pinyin) input.model_pinyin = pinyin;
  return input;
}

/**
 * The verdict the card goes on with: the device's when it accepted the answer or there is no check;
 * else Claude's — correct / acceptable → 'equivalent' (right), almost → 'close' (≈ Nearly), wrong → 'wrong'.
 * Every rule downstream (Hard mode's question result, the pass's suggestion, the answer side's colour)
 * reads this verdict, so they all agree.
 */
export function sentenceCheckedVerdict(local: AnswerVerdict, claude: AnswerCheckVerdict | null | undefined): AnswerVerdict {
  if (!claude || accepted(local)) return local;
  if (claude === 'correct' || claude === 'acceptable') return 'equivalent';
  return claude === 'almost' ? 'close' : 'wrong';
}

/** What Claude's verdict means on the card. */
export interface SentenceCheckOutcome {
  answerVerdict: AnswerVerdict;
  /** Hard mode's question result: right / close / wrong. */
  question: 'right' | 'close' | 'wrong';
  /** The homework pass's suggestion. */
  pass: PassOutcome;
  /** Counts as right. */
  right: boolean;
}

/** Claude's verdict on an answer the device didn't accept → what it means for the card. */
export function sentenceCheckOutcome(claude: AnswerCheckVerdict): SentenceCheckOutcome {
  const answerVerdict = sentenceCheckedVerdict('wrong', claude);
  const question = hardModeQuestionResult({ answerVerdict }) as 'right' | 'close' | 'wrong';
  const pass = passSuggestion({ answerVerdict }) as PassOutcome;
  return { answerVerdict, question, pass, right: question === 'right' };
}

/**
 * Right per Claude but not the card's words: why the check holds the page with "You said" vs the card
 * (shared/study/answerDifference.ts) — acceptable, or correct in other words; null otherwise.
 */
export function sentenceCheckDifference(said: string, model: string, claude: AnswerCheckVerdict | null | undefined): DifferenceReason | null {
  return roundTakeDifference({ mode: 'translate', said, model, local: 'wrong', claude });
}

/** `study.sentence_answer_check { verdict }` when there was no check: offline, or it failed. */
export type SentenceCheckEventVerdict = AnswerCheckVerdict | 'offline' | 'error';

// --- words (both apps) ---------------------------------------------------------------------------

/** While Claude reads it (the question's check row). */
export const SENTENCE_CHECKING = 'Checking your sentence…';
/** A spoken answer's second way to try again: the box, holding what was said, to fix it by hand. */
export const SENTENCE_CHECK_TYPE_INSTEAD = 'Type it';
