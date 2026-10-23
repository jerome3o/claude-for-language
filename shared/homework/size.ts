/**
 * How big a piece of homework is, at a glance (Jerome: "indication of how long homework is /
 * how many exercises there are"): Home's homework rows and the Mini Lessons page say
 * "18 exercises · ~12 min", "5 questions · ~4 min" (a revision), "12 words", "6 pages".
 *
 * The time is an estimate per exercise type (seconds, from how long each takes in practice —
 * reading a note, a tap-to-choose, typing a translation, a recorded answer, a conversation's
 * dialogue + questions). Pure; the Lab app's port (core/…/HomeworkSize.kt) is parity-tested.
 */

/** Seconds one exercise of each type takes, roughly. Unknown types: DEFAULT_EXERCISE_SECONDS. */
export const EXERCISE_SECONDS: Readonly<Record<string, number>> = Object.freeze({
  note: 40,
  scramble: 30,
  choice: 20,
  translate: 50,
  match: 45,
  describe_image: 60,
  speak: 40,
  listen_choice: 20,
  listen_translate: 50,
  sentence_making: 75,
  write_typed: 35,
  write_handwriting: 60,
  dictation: 45,
  oral_expression: 60,
  conversation: 120,
  judge: 45,
  gap_choice: 40,
});

export const DEFAULT_EXERCISE_SECONDS = 40;

/** Minutes for a list of exercise types, rounded, at least 1 (0 types = 0). */
export function exerciseMinutes(types: readonly string[]): number {
  if (types.length === 0) return 0;
  let s = 0;
  for (const t of types) s += EXERCISE_SECONDS[t] ?? DEFAULT_EXERCISE_SECONDS;
  return Math.max(1, Math.floor(s / 60 + 0.5));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "18 exercises · ~12 min" — every exercise of a lesson (notes too). */
export function lessonSizeLabel(types: readonly string[]): string {
  if (types.length === 0) return '';
  return `${plural(types.length, 'exercise', 'exercises')} · ~${exerciseMinutes(types)} min`;
}

/**
 * "5 questions · ~4 min" — a revision: `questions` = its scored exercises, `types` = every
 * exercise it plays (with the context notes) for the time.
 */
export function revisionSizeLabel(questions: number, types: readonly string[]): string {
  if (questions <= 0) return '';
  return `${plural(questions, 'question', 'questions')} · ~${exerciseMinutes(types)} min`;
}

/** "12 words" (a deck pass). */
export function deckSizeLabel(words: number): string {
  return words > 0 ? plural(words, 'word', 'words') : '';
}

/** "6 pages" (a reader). */
export function readerSizeLabel(pages: number): string {
  return pages > 0 ? plural(pages, 'page', 'pages') : '';
}
