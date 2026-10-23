/**
 * The two per-sentence exercises — "Judge each sentence" (judge) and "Choose the word for the
 * gap" (gap_choice): how an answer is marked, and the words the player shows. Pure and offline
 * (no model): every sentence is checked against what the author wrote. The Lab app's port
 * (core/…/JudgeGap.kt) is parity-tested against it (android-lab/parity/fixtures/lesson-judge-gap.ts).
 *
 * Jerome (Oct 2026): mini lessons kept asking "which sentence in this list is wrong?" — one
 * pick from a list. Judging EVERY sentence tests the structure on each one; the gap exercise is
 * what his tutor gives him for near-synonyms (刚 vs 刚才).
 */
import type { GapChoiceExerciseSpec, JudgeExerciseSpec } from './types';
import { gapItemOptions } from './types';

export const JUDGE_DEFAULT_QUESTION = 'Correct or incorrect?';
export const GAP_DEFAULT_QUESTION = 'Choose the word for each gap';

/** The two buttons of a judge row. Icon AND words — never colour alone (Jerome is red / green colour-blind). */
export const JUDGE_CORRECT_LABEL = '✓ Correct';
export const JUDGE_INCORRECT_LABEL = '✗ Incorrect';

/** Per sentence: did the learner judge it right? null = not judged yet. */
export function judgeResults(
  ex: Pick<JudgeExerciseSpec, 'sentences'>,
  judged: ReadonlyArray<boolean | null | undefined>,
): Array<boolean | null> {
  return ex.sentences.map((s, i) => {
    const j = judged[i];
    return typeof j === 'boolean' ? j === s.correct : null;
  });
}

/** Per sentence: did the learner pick the answer? null = nothing picked yet. */
export function gapResults(
  ex: Pick<GapChoiceExerciseSpec, 'items'>,
  picks: ReadonlyArray<string | null | undefined>,
): Array<boolean | null> {
  return ex.items.map((item, i) => {
    const p = picks[i];
    return typeof p === 'string' && p !== '' ? p.trim() === item.answer.trim() : null;
  });
}

/** Check opens once every sentence has an answer. */
export function allAnswered(results: ReadonlyArray<boolean | null>): boolean {
  return results.length > 0 && results.every(r => r !== null);
}

/** "All 5 right" / "4 of 5 right" / "0 of 3 right". */
export function itemsScoreLine(results: ReadonlyArray<boolean | null>): string {
  const total = results.length;
  const right = results.filter(r => r === true).length;
  if (total > 0 && right === total) return total === 1 ? '✓ Right' : `✓ All ${total} right`;
  return `${right} of ${total} right`;
}

/** The line under a judged sentence after Check. */
export function judgeFeedback(sentenceCorrect: boolean, judgedRight: boolean): string {
  const what = sentenceCorrect ? 'this sentence is correct' : 'this sentence has a mistake';
  return judgedRight ? `✓ Right — ${what}` : `✗ Not quite — ${what}`;
}

/** The line under a gapped sentence after Check. */
export function gapFeedback(answer: string, pick: string | null | undefined): string {
  const p = (pick ?? '').trim();
  if (p === answer.trim()) return `✓ ${answer}`;
  return p ? `✗ You chose ${p} — it’s ${answer}` : `✗ It’s ${answer}`;
}

/** The options a gapped sentence shows (its own, else the exercise's), in the author's order. */
export function gapOptionsFor(ex: Pick<GapChoiceExerciseSpec, 'options' | 'items'>, index: number): string[] {
  const item = ex.items[index];
  return item ? gapItemOptions(ex, item) : [];
}
