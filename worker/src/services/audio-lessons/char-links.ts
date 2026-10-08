/**
 * The facts behind each character's line in a sleep lesson (docs/AUDIO_LESSONS.md "Each
 * character"): for every character of a word, the learner's own words with it (VocabIndex),
 * else common words with it (the character dictionary's frequent words + the word dictionary's
 * wordfreq ranks, both static assets read through CHAR_DICT), else "a new character". The choice
 * is `pickCharLinks` (shared/audio-lesson/characters.ts); this only gathers its inputs. Without the
 * dictionary (tests, a missing binding) there are simply no common words.
 */
import { hanCharsOf, pickCharLinks, type CharLink, type CommonCharWord, type LearnerCharWord } from '@shared/audio-lesson';
import { getCharRecords, getWordRecords, type ShardLoader } from '../char-dict';
import type { CharRecord, WordRecord } from '@shared/chars/types';
import type { VocabIndex } from './vocab';

export type CharLinksFn = (words: Array<{ hanzi: string; pinyin?: string | null }>) => Promise<Record<string, CharLink[]>>;

/** Candidates per character looked up in the word dictionary (for their ranks). */
const CANDIDATES_PER_CHAR = 6;
/** Words per call (check_known_words takes 80). */
const MAX_WORDS = 80;

export function makeCharLinks(index: VocabIndex, loader: ShardLoader | null): CharLinksFn {
  return async (input) => {
    const words: Array<{ hanzi: string; pinyin: string | null }> = [];
    for (const w of input.slice(0, MAX_WORDS)) {
      const hanzi = (w.hanzi ?? '').trim();
      if (!hanzi || hanCharsOf(hanzi).length === 0 || words.some((x) => x.hanzi === hanzi)) continue;
      words.push({ hanzi, pinyin: w.pinyin ?? index.byHanzi.get(hanzi)?.pinyin ?? null });
    }
    const chars = [...new Set(words.flatMap((w) => hanCharsOf(w.hanzi)))];

    let charRecords: Record<string, CharRecord> = {};
    if (loader && chars.length) {
      try {
        charRecords = (await getCharRecords(loader, chars)).records;
      } catch (err) {
        console.warn('[audio-lessons] character dictionary unavailable:', err instanceof Error ? err.message : err);
      }
    }
    const learner = new Map<string, LearnerCharWord[]>();
    const common = new Map<string, CommonCharWord[]>();
    for (const c of chars) {
      learner.set(
        c,
        (index.byChar.get(c) ?? [])
          .filter((r) => r.tier >= 1)
          .slice(0, CANDIDATES_PER_CHAR)
          .map((r) => ({ hanzi: r.hanzi.trim(), pinyin: r.pinyin, english: r.english, tier: r.tier })),
      );
      common.set(
        c,
        (charRecords[c]?.words ?? []).slice(0, CANDIDATES_PER_CHAR).map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.english, rank: null })),
      );
    }

    // Ranks (and per-character syllables) from the word dictionary.
    const lookup = [...new Set([...learner.values(), ...common.values()].flat().map((w) => w.hanzi))].filter((h) => {
      const n = [...h].length;
      return n >= 2 && n <= 6 && hanCharsOf(h).length === n;
    });
    let wordRecords: Record<string, WordRecord> = {};
    if (loader && lookup.length) {
      try {
        wordRecords = (await getWordRecords(loader, lookup)).records;
      } catch (err) {
        console.warn('[audio-lessons] word dictionary unavailable:', err instanceof Error ? err.message : err);
      }
    }
    for (const list of learner.values()) for (const w of list) w.rank = wordRecords[w.hanzi]?.rank ?? null;
    for (const list of common.values()) {
      for (const w of list) {
        const rec = wordRecords[w.hanzi];
        w.rank = rec?.rank ?? null;
        w.syllables = rec?.syllables ?? null;
      }
    }

    const out: Record<string, CharLink[]> = {};
    for (const w of words) {
      out[w.hanzi] = pickCharLinks({
        word: w.hanzi,
        pinyin: w.pinyin,
        learnerWords: (c) => learner.get(c) ?? [],
        commonWords: (c) => common.get(c) ?? [],
        metChars: index.metChars,
      });
    }
    return out;
  };
}
