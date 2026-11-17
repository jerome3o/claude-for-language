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
import { diffHanzi, isExactHanziMatch, normalizeHanziAnswer } from './answer-check';
import { DIGIT_RUN, digitRunToHanzi, digitsToHanzi } from '../text/numberHanzi';
import { choiceSayAgainSentence } from './choiceMistake';

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
    case 'choice': {
      // A "which is wrong?" choice practises its correction — never the mistake (shared/lesson/choiceMistake.ts);
      // an older one without it has no target until the device has fetched one (the views pass it in then).
      const said = choiceSayAgainSentence(ex);
      return target(said?.hanzi, said?.pinyin, 'answer');
    }
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

/** One character of a sentence as shown, marked by the device's diff; punctuation / spaces are always `hit`. */
export interface ShownChar {
  ch: string;
  /** In the other sentence (answer side) / got by his answer (model side). */
  hit: boolean;
}

/**
 * The device's diff on the sentence AS WRITTEN (`diffHanzi` drops punctuation and spaces): `side` 'answer' =
 * his answer, its characters the model doesn't have marked; 'model' = the model answer, the characters his
 * answer missed marked. Punctuation, spaces and symbols are kept, never marked.
 */
export function markedChars(answer: string, model: string, side: 'answer' | 'model'): ShownChar[] {
  // Digits are read as Chinese numerals first: a spoken 3块 IS 三块, never a red 3.
  const d = diffHanzi(digitsToHanzi(answer), digitsToHanzi(model)); // (full-width digits stay digits: shown 1:1)
  const marks = side === 'answer' ? d.typed : d.expected;
  const text = side === 'answer' ? answer : model;
  let k = 0;
  return shownUnits(text).flatMap((u) => {
    const n = Array.from(u.norm).length;
    let hit = true;
    for (let i = 0; i < n; i++) {
      const m = marks[k++];
      if (m && !m.hit) hit = false;
    }
    return Array.from(u.shown).map((ch) => ({ ch, hit: n === 0 ? true : hit }));
  });
}

/**
 * The comparison key of an answer: digits as Chinese numerals, then whitespace / punctuation dropped
 * (这个牛角包 3块多元 = 这个牛角包三块多元). Lab `LessonFeedback.answerKey`.
 */
export function answerKey(s: string): string {
  return normalizeHanziAnswer(digitsToHanzi(s.normalize('NFKC')));
}

/** The text as shown, in units: a digit run is ONE unit (all its numerals marked together), every other character its own. */
function shownUnits(text: string): Array<{ shown: string; norm: string }> {
  const out: Array<{ shown: string; norm: string }> = [];
  const pushChars = (part: string) => {
    for (const ch of Array.from(part)) out.push({ shown: ch, norm: normalizeHanziAnswer(ch) });
  };
  let at = 0;
  for (const m of text.matchAll(DIGIT_RUN)) {
    const start = m.index!;
    pushChars(text.slice(at, start));
    out.push({ shown: m[0], norm: normalizeHanziAnswer(digitRunToHanzi(m[0], text.charAt(start + m[0].length))) });
    at = start + m[0].length;
  }
  pushChars(text.slice(at));
  return out;
}

/**
 * Claude's corrected sentence as a second practice target: only when there is one, it is Chinese, and it
 * differs from what he said and from the target already offered (punctuation / spaces ignored).
 */
export function sayAgainFix(corrected: string | null | undefined, said: string | null | undefined, offered: string | null | undefined): string | null {
  // Digits as numerals (a fix 3块多钱 IS the model answer 三块多钱 — nothing new to practise; shown with numerals).
  const c = digitsToHanzi(clean(corrected));
  if (!c || !/\p{Script=Han}/u.test(c)) return null;
  if (clean(said) && isExactHanziMatch(digitsToHanzi(clean(said)), c)) return null;
  if (clean(offered) && isExactHanziMatch(digitsToHanzi(clean(offered)), c)) return null;
  return c;
}

/** The neutral line under "You said" when his answer is the model answer's characters in another order. */
export const REORDERED_NOTE = 'Same characters, different word order';

/** Whether to mark "You said" / the model answer with the device's diff, or show a neutral note instead. */
export interface AnswerMarks {
  marks: boolean;
  note: string | null;
}

/** The same characters, each as often (punctuation / spaces ignored), in any order. */
export function sameCharacters(answer: string, model: string): boolean {
  const sorted = (s: string) => Array.from(normalizeHanziAnswer(s)).sort().join('');
  const a = sorted(answer);
  return a.length > 0 && a === sorted(model);
}

/**
 * The device's character marks on "You said" and the model answer (`markedChars`), or not. Jerome said
 * 因为这个问题，我睡不着觉 for 我因为这个问题睡不着觉 and both rows painted 我 red — a pure reordering read as "you got 我
 * wrong" under a ✓ verdict. So: no marks when it IS the model answer; a reordering of the same characters gets the
 * neutral `REORDERED_NOTE` instead; digits count as their numerals (3 = 三, `answerKey`); and once Claude's check says correct / acceptable (`verdict`) the marks go — a
 * right answer is never painted as errors. Otherwise (no verdict yet, almost, wrong) the marks show.
 */
export function answerMarks(answer: string, model: string, verdict?: string | null): AnswerMarks {
  const a = answerKey(answer);
  const m = answerKey(model);
  if (!a || !m || a === m) return { marks: false, note: null };
  if (sameCharacters(a, m)) return { marks: false, note: REORDERED_NOTE };
  if (verdict === 'correct' || verdict === 'acceptable') return { marks: false, note: null };
  return { marks: true, note: null };
}
