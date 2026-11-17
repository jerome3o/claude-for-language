/**
 * Simple example sentences (docs/STUDY_SESSION.md "Listen in context"). Jerome, Nov 2026: "some of the
 * sentences are too complicated — relatively simple sentences." A cheap, deterministic yardstick:
 *
 * - at most SIMPLE_SENTENCE_MAX_HAN Han characters (or the word's own length + SIMPLE_SENTENCE_WORD_ROOM,
 *   for a long word or a sentence card);
 * - at most ONE clause break inside (，；; or a 。！？ that isn't the end) — "一个短句" or two short halves
 *   (因为…所以…) at most.
 *
 * Used twice: the sentence generator drops NEW sentences that break it (`simpleSentenceProblems`, worker
 * services/sentence-set.ts — stored sentences are never deleted), and "Listen in context" prefers the simple
 * ones among sentences equally fresh (`isSimpleSentence`, listenContext.ts `pickListenRows`).
 *
 * Pure; the Lab app's port is core `ListenContext.isSimple` (parity-tested in parity/fixtures/listen-context.ts).
 */

/** A new sentence has at most this many Han characters… */
export const SIMPLE_SENTENCE_MAX_HAN = 16;
/** …or the word's own characters + this many (a long word / a sentence card). */
export const SIMPLE_SENTENCE_WORD_ROOM = 8;
/** At most this many clause breaks inside a sentence. */
export const SIMPLE_SENTENCE_MAX_BREAKS = 1;

const HAN = /\p{Script=Han}/u;

/** Han characters in the text (by code point). */
export function hanCount(text: string | null | undefined): number {
  let n = 0;
  for (const ch of text ?? '') if (HAN.test(ch)) n++;
  return n;
}

const BREAKS = new Set(['，', ',', '；', ';', '。', '！', '？', '!', '?']);
const END = new Set(['。', '！', '？', '!', '?', '…', '”', '"', '」', '）', ')', '~', '～', '.']);

/** Clause breaks INSIDE the sentence: ，；; anywhere, 。！？ only before the end. */
export function clauseBreaks(text: string | null | undefined): number {
  const chars = [...(text ?? '').trim()];
  let end = chars.length;
  while (end > 0 && (END.has(chars[end - 1]) || /\s/.test(chars[end - 1]))) end--;
  let n = 0;
  for (let i = 0; i < end; i++) if (BREAKS.has(chars[i])) n++;
  return n;
}

/** The most Han characters a sentence for this word may have. */
export function simpleSentenceMaxHan(word?: string | null): number {
  return Math.max(SIMPLE_SENTENCE_MAX_HAN, hanCount(word) + SIMPLE_SENTENCE_WORD_ROOM);
}

export type SimpleSentenceProblem = 'too_long' | 'too_many_clauses';

/** What makes this sentence not simple ([] = simple). */
export function simpleSentenceProblems(hanzi: string, word?: string | null): SimpleSentenceProblem[] {
  const out: SimpleSentenceProblem[] = [];
  if (hanCount(hanzi) > simpleSentenceMaxHan(word)) out.push('too_long');
  if (clauseBreaks(hanzi) > SIMPLE_SENTENCE_MAX_BREAKS) out.push('too_many_clauses');
  return out;
}

export function isSimpleSentence(hanzi: string, word?: string | null): boolean {
  return simpleSentenceProblems(hanzi, word).length === 0;
}
