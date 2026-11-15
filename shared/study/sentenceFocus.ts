/**
 * Natural example sentences only (docs/STUDY_SESSION.md "Natural sentences"). Jerome, Nov 2026: "a few example
 * sentences … are used to build a sentence with some related or similar sounding word … they make kind of
 * contrived sentences."
 *
 * Until Nov 2026 the sentence-set generator HAD to write, for every word, one sentence around a different word
 * sharing a character with it (focus `shared_character`) and one around an easily-confused / similar-sounding
 * word (`contrast`). Those rows were built to squeeze a look-alike in, so their focus reliably marks them. They
 * stay stored (nothing is deleted) but:
 * - they are never a Sentence round or listening round exercise (`pickRoundExercises`, `pickListenRoundExercises`);
 * - they never count as "enough sentences" — the top-ups (`moreSentencesWanted`, `needsSentenceTopUp`, the
 *   homework pass, the server's listening top-up) count natural rows only, so such a word gets natural ones;
 * - the card's example list (and "Listen in context") shows them AFTER the natural ones (`naturalSentencesFirst`).
 * New sets are written with natural focuses only (`core`, `collocation`, `complex`).
 *
 * Pure; the Lab app's port is core `SentenceFocus.kt`, parity-tested (parity/fixtures/sentence-round.ts `natural`).
 */

/** The focus values of the sentences written around a look-alike / homophone — not natural usage. */
export const CONTRIVED_SENTENCE_FOCUSES: readonly string[] = ['shared_character', 'contrast'];

/** This sentence was written to squeeze in a word sharing a character / an easily-confused word. */
export function isContrivedSentence(focus: string | null | undefined): boolean {
  return !!focus && CONTRIVED_SENTENCE_FOCUSES.includes(focus);
}

/** The natural ones first, then the contrived ones, each group in its own order (stable). */
export function naturalSentencesFirst<T extends { focus?: string | null }>(rows: readonly T[]): T[] {
  return [...rows.filter((r) => !isContrivedSentence(r.focus)), ...rows.filter((r) => isContrivedSentence(r.focus))];
}

/** How many of these are natural sentences (what the top-ups count). */
export function naturalSentenceCount(rows: readonly { focus?: string | null }[]): number {
  return rows.filter((r) => !isContrivedSentence(r.focus)).length;
}
