/**
 * How each character of an answer is marked on the back of the card. Colour alone
 * isn't enough to read it, so every mark also has a shape:
 * - `correct`: green, no underline
 * - `wrong`:   red + a solid underline (a wrong character, or an extra one past the end)
 * - `missing`: a muted "?" + a dashed underline (a character not typed / a row left blank)
 *
 * The Lab app mirrors this in `ui/study/AnswerMarks.kt` (`AnswerMarks.typedDiff`).
 */
export type DiffMark = 'correct' | 'wrong' | 'missing';

export interface DiffCell {
  /** The character shown ('' for a missing one — rendered as "?"). */
  char: string;
  mark: DiffMark;
}

export interface TypedAnswerDiff {
  /** What was typed, position by position, followed by one `missing` cell per character short. */
  typed: DiffCell[];
  /** The expected answer; `matched` where the typed character at that position was right. */
  expected: { char: string; matched: boolean }[];
}

/**
 * Position-by-position diff of a typed answer against the expected hanzi
 * (Anki-style, by code point). Characters past the end of the expected answer
 * are `wrong` (extra); positions the answer didn't reach are `missing`.
 */
export function typedAnswerDiff(userAnswer: string, correctAnswer: string): TypedAnswerDiff {
  const user = [...userAnswer];
  const target = [...correctAnswer];
  const typed: DiffCell[] = [];
  const expected: { char: string; matched: boolean }[] = [];
  const max = Math.max(user.length, target.length);
  for (let i = 0; i < max; i++) {
    const u = user[i];
    const c = target[i];
    const matched = u !== undefined && u === c;
    if (u !== undefined) typed.push({ char: u, mark: matched ? 'correct' : 'wrong' });
    else typed.push({ char: '', mark: 'missing' });
    if (c !== undefined) expected.push({ char: c, matched });
  }
  return { typed, expected };
}
