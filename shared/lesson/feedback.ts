/**
 * The feel of a mini-lesson exercise's answer screen (docs/STUDY_SESSION.md "Mini lessons" → "Feedback"),
 * one rule for every exercise type and both apps (Lab port core `LessonFeedback.kt`, parity-tested by
 * parity/fixtures/lesson-feedback.ts):
 *
 * 1. **Feel** — a right answer is felt: the success haptic + chime (`StudyFeel`, shared/study/hardMode.ts)
 *    and a SMALL confetti burst at the verdict (never the full-screen rain) — `lessonFeel(moment)`.
 * 2. **No loading states** — on submit the model answer and the device's own diff show at once; Claude's
 *    check (answer check, sentence feedback, the speaking check) runs behind a slim "Claude is checking…"
 *    row placed BELOW everything he is reading (and below the buttons), so when it lands nothing above it
 *    moves (`CLAUDE_CHECKING_LINE`).
 * 3. **🎤 Say it again** — practice only: a quick take of the answer with the fast live transcription,
 *    judged like the coach's "Practise saying it" (shared/coach/practise.ts) into the "You said" row.
 *    Never a review event, a completion, an attempt row or the retry round. The official 🔁 Try again
 *    (Claude's check) stays and keeps its own words. `sayAgainTarget(exercise)` = what to say — the
 *    exercise's answer, or for an open-ended exercise its example; `sayAgainFix(…)` = Claude's corrected
 *    sentence, when it is worth practising on its own.
 */
import type { StudyFeel } from '../study/hardMode';
import type { LessonExercise } from './types';
import { isExactHanziMatch } from './answer-check';

/** The slim row while Claude's check is on its way. */
export const CLAUDE_CHECKING_LINE = 'Claude is checking…';
/** 🎤 Say it again — the practice take's button and its line. */
export const SAY_AGAIN_LABEL = 'Say it again';
export const SAY_AGAIN_NOTE = 'Practice — doesn’t change your score';
/**
 * The label over an open-ended exercise's own example (sentence_making, speak, oral_expression): it is ANOTHER
 * answer, not THE answer — Jerome: "One way to say it" read as if his own (right or nearly right) sentence
 * were wrong.
 */
export const EXAMPLE_LABEL = 'Another way to say it:';
/** The practice row over Claude's corrected sentence. */
export const SAY_AGAIN_FIX_LABEL = 'Say the corrected version';

/**
 * The moments of an answer screen:
 * - checked_right / checked_wrong — the device judged it on Check (scramble, choice, listen_choice, write_typed,
 *   dictation, match all paired, judge / gap_choice all sentences, a conversation's questions, handwriting);
 * - matched_answer — a self-assessed answer the device matched to the model (exact / sounds right);
 * - claude_right / claude_not_right — Claude's check landed (correct / acceptable vs almost / wrong);
 * - say_again_right / say_again_miss — the practice take matched / didn't.
 */
export type LessonFeelMoment =
  | 'checked_right'
  | 'checked_wrong'
  | 'matched_answer'
  | 'claude_right'
  | 'claude_not_right'
  | 'say_again_right'
  | 'say_again_miss';

export const LESSON_FEEL_MOMENTS: readonly LessonFeelMoment[] = [
  'checked_right', 'checked_wrong', 'matched_answer', 'claude_right', 'claude_not_right', 'say_again_right', 'say_again_miss',
];

export interface LessonFeel {
  feel: StudyFeel | null;
  /** The small confetti burst at the verdict. */
  confetti: boolean;
}

/**
 * A moment → its feel. `celebrated` = this answer screen already celebrated (the device matched it): Claude
 * agreeing later adds nothing — one celebration per answer. Wrong moments stay silent (the apps' own wrong
 * sound, where they have one, is unchanged).
 */
export function lessonFeel(moment: LessonFeelMoment, celebrated = false): LessonFeel {
  switch (moment) {
    case 'checked_right':
    case 'matched_answer':
      return { feel: 'success', confetti: true };
    case 'claude_right':
      return celebrated ? { feel: null, confetti: false } : { feel: 'success', confetti: true };
    case 'say_again_right':
      return { feel: 'round_right', confetti: true };
    default:
      return { feel: null, confetti: false };
  }
}

/** Claude's verdict → its moment (anything else, e.g. an error, → none). */
export function claudeVerdictMoment(verdict: string | null | undefined): LessonFeelMoment | null {
  if (verdict === 'correct' || verdict === 'acceptable') return 'claude_right';
  if (verdict === 'almost' || verdict === 'wrong') return 'claude_not_right';
  return null;
}

/** What 🎤 Say it again asks for: `answer` = the exercise's answer, `example` = an open-ended exercise's example. */
export interface SayAgainTarget {
  hanzi: string;
  pinyin?: string;
  kind: 'answer' | 'example';
}

const clean = (s: string | null | undefined): string => (s ?? '').trim();

function target(hanzi: string | null | undefined, pinyin: string | null | undefined, kind: SayAgainTarget['kind']): SayAgainTarget | null {
  const h = clean(hanzi);
  if (!h || !/\p{Script=Han}/u.test(h)) return null;
  const p = clean(pinyin);
  return p ? { hanzi: h, pinyin: p, kind } : { hanzi: h, kind };
}

/**
 * The sentence 🎤 Say it again practises on this exercise's answer screen, or null where there is no one
 * answer to say (`SAY_AGAIN_SKIPPED` says why per type).
 */
export function sayAgainTarget(ex: LessonExercise): SayAgainTarget | null {
  switch (ex.type) {
    case 'scramble': return target(ex.correct_order.join(''), null, 'answer');
    case 'choice': return target(ex.options[ex.correct]?.hanzi, ex.options[ex.correct]?.pinyin, 'answer');
    case 'translate': return target(ex.reference_hanzi, ex.reference_pinyin, 'answer');
    case 'listen_choice': return target(ex.audio.hanzi, ex.audio.pinyin, 'answer');
    case 'listen_translate': return target(ex.audio.hanzi, ex.audio.pinyin, 'answer');
    case 'write_typed': return target(ex.answer.hanzi, ex.answer.pinyin, 'answer');
    case 'write_handwriting': return target(ex.answer.hanzi, ex.answer.pinyin, 'answer');
    case 'dictation': return target(ex.audio.hanzi, ex.audio.pinyin, 'answer');
    case 'describe_image': return target(ex.reference_hanzi, ex.reference_pinyin, 'example');
    case 'speak': return target(ex.example?.hanzi, ex.example?.pinyin, 'example');
    case 'sentence_making': return target(ex.example?.hanzi, ex.example?.pinyin, 'example');
    case 'oral_expression': return target(ex.example?.hanzi, ex.example?.pinyin, 'example');
    default: return null;
  }
}

/** Why a type has no 🎤 Say it again (the PR table; docs). */
export const SAY_AGAIN_SKIPPED: Record<string, string> = {
  note: 'Not scored — nothing to answer.',
  match: 'Several word pairs, not one answer; each word plays when tapped.',
  conversation: 'Comprehension questions about a dialogue, often answered in English.',
  judge: 'Several sentences, one point each; every sentence has its 🔊.',
  gap_choice: 'Several sentences, one point each; every sentence has its 🔊.',
};

/**
 * Claude's corrected sentence as a second practice target: only when there is one, it is Chinese, and it
 * differs from what he said and from the target already offered (punctuation / spaces ignored).
 */
export function sayAgainFix(corrected: string | null | undefined, said: string | null | undefined, offered: string | null | undefined): string | null {
  const c = clean(corrected);
  if (!c || !/\p{Script=Han}/u.test(c)) return null;
  if (clean(said) && isExactHanziMatch(clean(said), c)) return null;
  if (clean(offered) && isExactHanziMatch(clean(offered), c)) return null;
  return c;
}
