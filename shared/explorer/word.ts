/**
 * The Word view's facts (docs/LANGUAGE_EXPLORER.md): the word's pinyin / meaning merged from
 * the sources the device has, each character with its syllable and tone, and how common it is.
 * Pure; ported to the Lab app (core/…/explorer/ExplorerWord.kt, parity-tested).
 */
import type { CharWord, WordRecord } from '../chars/types';
import { pinyinSyllables, syllableTone } from '../pinyin/toneChange';
import { isHanCodePoint } from '../progress/known';

export interface WordChar {
  char: string;
  /** This character's syllable in the word, when the pinyin lines up with the characters. */
  syllable: string | null;
  /** 1–4, 5 = neutral; null when the syllable is unknown. */
  tone: number | null;
}

/** Each Han character of the word with its syllable (from `syllables`, else split from `pinyin`). */
export function wordChars(hanzi: string, pinyin: string | null | undefined, syllables?: readonly string[] | null): WordChar[] {
  const chars = [...hanzi].filter((ch) => isHanCodePoint(ch.codePointAt(0)!));
  let syl: readonly string[] | null = syllables && syllables.length === chars.length ? syllables : null;
  if (!syl && pinyin) {
    const split = pinyinSyllables(pinyin.trim());
    if (split && split.length === chars.length) syl = split;
  }
  return chars.map((char, i) => {
    const s = syl ? syl[i] : null;
    return { char, syllable: s, tone: s ? syllableTone(s) : null };
  });
}

export type FrequencyTier = 'top' | 'common' | 'uncommon' | 'rare';

/** Words ranked up to here are "common" (the HSK-ish core); beyond, "uncommon". */
export const COMMON_WORD_RANK = 5000;
/** Up to here the label names the rank ("#570 most common word"). */
export const NAMED_WORD_RANK = 30000;

/**
 * "#570 most common word" (≤ 30,000, tier top ≤ 1,000 / common ≤ 5,000 / uncommon), else
 * "Rare word" — from the shipped word-freq list's ranking.
 */
export function wordFrequencyLabel(rank: number | null | undefined): { text: string; tier: FrequencyTier } {
  if (!rank || rank < 1) return { text: 'Rare word', tier: 'rare' };
  const tier: FrequencyTier = rank <= 1000 ? 'top' : rank <= COMMON_WORD_RANK ? 'common' : rank <= NAMED_WORD_RANK ? 'uncommon' : 'rare';
  if (rank > NAMED_WORD_RANK) return { text: 'Rare word', tier };
  return { text: `#${rank.toLocaleString('en-US')} most common word`, tier };
}

export interface WordNoteLike {
  hanzi: string;
  pinyin?: string | null;
  english?: string | null;
}

export type WordSource = 'dictionary' | 'char_dict' | 'your_card' | 'context' | 'none';

export interface ResolvedWord {
  hanzi: string;
  pinyin: string;
  english: string;
  /** Dictionary senses (may be empty). */
  senses: string[];
  syllables: string[] | null;
  rank: number | null;
  /** Where the pinyin / meaning came from. */
  source: WordSource;
}

/**
 * Pinyin and meaning, dictionary first: the word dictionary's record, else the entry in a
 * character record's "Words with 字" list, else the learner's own card, else what the place it
 * was tapped in said (a reader chip's gloss). `rank` (the shipped list) wins over the record's.
 */
export function resolveWord(
  hanzi: string,
  sources: {
    record?: WordRecord | null;
    charWords?: readonly CharWord[];
    notes?: readonly WordNoteLike[];
    hint?: { pinyin?: string; gloss?: string };
    rank?: number | null;
  },
): ResolvedWord {
  const rank = sources.rank ?? sources.record?.rank ?? null;
  const rec = sources.record;
  if (rec && rec.hanzi === hanzi) {
    return { hanzi, pinyin: rec.pinyin, english: rec.english, senses: [...rec.senses], syllables: [...rec.syllables], rank, source: 'dictionary' };
  }
  const cw = sources.charWords?.find((w) => w.hanzi === hanzi);
  if (cw) return { hanzi, pinyin: cw.pinyin, english: cw.english, senses: [], syllables: null, rank, source: 'char_dict' };
  const note = sources.notes?.find((n) => n.hanzi.trim() === hanzi && (n.pinyin || n.english));
  if (note) return { hanzi, pinyin: note.pinyin ?? '', english: note.english ?? '', senses: [], syllables: null, rank, source: 'your_card' };
  const hint = sources.hint;
  if (hint && (hint.pinyin || hint.gloss)) {
    return { hanzi, pinyin: hint.pinyin ?? '', english: hint.gloss ?? '', senses: [], syllables: null, rank, source: 'context' };
  }
  return { hanzi, pinyin: '', english: '', senses: [], syllables: null, rank, source: 'none' };
}
