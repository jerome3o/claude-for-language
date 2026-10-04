/**
 * The character dictionary (docs/STUDY_SESSION.md "Character sheet"): one record per Han
 * character, built ONCE from open data by `scripts/build-char-dict.ts` (CC-CEDICT, Make Me
 * a Hanzi, wordfreq), served by `GET /api/chars/:char` and cached on the device. It never
 * depends on the card being studied — the same 行 everywhere.
 */

/** Bump when the record shape or the build rules change: devices refetch their cache. */
export const CHAR_DICT_VERSION = 1;

/** How many shard files the dataset is split into (`charShard`). */
export const CHAR_DICT_SHARDS = 128;

/** How many frequent words a record carries. */
export const CHAR_WORDS_PER_CHAR = 20;

/** Most characters `GET /api/chars?c=` answers in one call. */
export const CHAR_BATCH_MAX = 100;

export interface CharWord {
  hanzi: string;
  /** Tone marks, syllables of one word joined (yínháng), 一 / 不 tone changes applied. */
  pinyin: string;
  /** A short English gloss (CC-CEDICT, first sense or two). */
  english: string;
}

export interface CharReading {
  pinyin: string;
  english: string;
}

export interface CharComponent {
  char: string;
  meaning: string | null;
}

export interface CharRecord {
  char: string;
  /** Readings, the most used first (weighted by the frequency of the words that use each). */
  readings: CharReading[];
  /** One-line English meaning of the character. */
  meaning: string;
  radical: string | null;
  radical_meaning: string | null;
  /** Ideographic description sequence (⿰亻尔), when known. */
  decomposition: string | null;
  components: CharComponent[];
  /** One line on how the character is built, when Make Me a Hanzi has one. */
  etymology: string | null;
  strokes: number | null;
  /** 1 = the most frequent character (from wordfreq); null = not ranked. */
  rank: number | null;
  /** The most frequent words containing the character, most frequent first. */
  words: CharWord[];
}

/** Which shard file holds a character: its code point modulo the shard count. */
export function charShard(char: string): number {
  const cp = char.codePointAt(0) ?? 0;
  return cp % CHAR_DICT_SHARDS;
}

/** The shard's file name in the worker's static assets (`worker/char-dict/`). */
export function charShardFile(shard: number): string {
  return `${String(shard).padStart(3, '0')}.dat`;
}
