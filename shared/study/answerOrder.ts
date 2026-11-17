/**
 * The answer side's example sentences follow the question side (docs/STUDY_SESSION.md "The answer side
 * keeps the question's order"). Jerome, Nov 2026: "I struggle to find the sentence in the answer side of a
 * card … every time there's a new [order], the answer should match the question side."
 *
 * The question side shows sentences in a per-showing order — "Listen in context" on a listening card (fresh
 * first, shuffled per showing, `pickListenRows`) and the Sentence round's exercises (`pickRoundExercises`) —
 * while the answer side's list is in the canonical order (the card's own sentence, then the set by position).
 * So the answer side puts the sentences the question side showed FIRST, in exactly the order they were shown,
 * then the rest in their usual order. The card's own sentence ("From the card") keeps its badge wherever it
 * lands: where it was on the question side when it was shown, else first of the rest (its usual place).
 *
 * The showing's order is fixed while the card is up, kept by the resume point (`listen_shown`, `round_log`),
 * and made afresh only by a new showing of the card — so nothing reorders on the answer side.
 *
 * Pure; the Lab app's port (core `AnswerOrder.kt`) is parity-tested (parity/fixtures/answer-order.ts).
 */

/**
 * `keys` (the answer side's rows, canonical order) with the `shown` ones first in the order shown. A shown key
 * that is not (or no longer) a row is skipped; a key shown twice counts once, at its first place; rows keep
 * their canonical order otherwise. No shown keys → `keys` as they are.
 */
export function answerSentenceOrder(keys: readonly string[], shown: readonly string[]): string[] {
  const present = new Set(keys);
  const first: string[] = [];
  const placed = new Set<string>();
  for (const k of shown) {
    if (!present.has(k) || placed.has(k)) continue;
    placed.add(k);
    first.push(k);
  }
  if (first.length === 0) return keys.slice();
  return [...first, ...keys.filter((k) => !placed.has(k))];
}

/**
 * Everything the question side showed on this showing, in the order he met it: the listening card's "Listen in
 * context" rows first (the question itself), then the Sentence round's sentences (between question and
 * answer; their outlined marks say how each went). Duplicates are left to `answerSentenceOrder`.
 */
export function questionSentenceKeys(listenShown: readonly string[] | null | undefined, roundKeys: readonly string[] | null | undefined): string[] {
  return [...(listenShown ?? []), ...(roundKeys ?? [])];
}
