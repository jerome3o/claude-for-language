/**
 * "Related words" in the Word view (docs/LANGUAGE_EXPLORER.md): other words sharing a
 * character with this one, most common first — read from the character records' "Words with
 * 字" lists (on the device once the characters were looked up). Pure; ported to the Lab app
 * (core/…/explorer/RelatedWords.kt, parity-tested).
 */
import type { CharWord } from '../chars/types';

export interface RelatedWord {
  word: CharWord;
  /** The characters it shares with the explored word, in the explored word's order. */
  shared: string[];
  /** Sort key: the frequency rank, else after every ranked word by its place in the lists. */
  rank: number;
}

export const RELATED_WORDS_MAX = 12;
/** Unranked words sort after ranked ones: this + their best position in a character's list. */
export const UNRANKED_RELATED = 10_000_000;

/**
 * Words from `records` (one per character of `hanzi`) other than `hanzi` itself, each once,
 * ordered by `rankOf` (smaller = more common; null = unranked → by its best position in a
 * list), ties by more shared characters, then the hanzi. At most `limit`.
 */
export function relatedWords(
  hanzi: string,
  records: ReadonlyArray<{ char: string; words: readonly CharWord[] }>,
  rankOf: (hanzi: string) => number | null | undefined,
  limit = RELATED_WORDS_MAX,
): RelatedWord[] {
  const chars = [...hanzi];
  const byWord = new Map<string, { word: CharWord; shared: Set<string>; pos: number }>();
  for (const rec of records) {
    if (!chars.includes(rec.char)) continue;
    rec.words.forEach((w, pos) => {
      if (w.hanzi === hanzi) return;
      const cur = byWord.get(w.hanzi);
      if (cur) {
        cur.shared.add(rec.char);
        cur.pos = Math.min(cur.pos, pos);
      } else byWord.set(w.hanzi, { word: w, shared: new Set([rec.char]), pos });
    });
  }
  const out: RelatedWord[] = [...byWord.values()].map(({ word, shared, pos }) => {
    const r = rankOf(word.hanzi);
    return { word, shared: chars.filter((c, i) => shared.has(c) && chars.indexOf(c) === i), rank: r && r > 0 ? r : UNRANKED_RELATED + pos };
  });
  out.sort((a, b) => a.rank - b.rank || b.shared.length - a.shared.length || (a.word.hanzi < b.word.hanzi ? -1 : a.word.hanzi > b.word.hanzi ? 1 : 0));
  return out.slice(0, limit);
}
