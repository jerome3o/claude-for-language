/**
 * Word frequency for "Most common first" (new-card-order.ts): which new words are
 * the most useful to learn next. The data is a static list shipped with both apps
 * (no network during study): `shared/data/frequency/word-freq.txt`, built by
 * `scripts/build-word-freq.ts` from **wordfreq** `large_zh`
 * (https://github.com/rspeer/wordfreq, data licence CC BY-SA 4.0 — the same source
 * the character sheet uses; credited under Settings → About → Licences).
 *
 * Format (UTF-8 text):
 *   # comment lines
 *   #words
 *   的            one all-Han word per line, most frequent first (rank = line, 1-based)
 *   …
 *   #chars
 *   的一是…        characters, most frequent first (rank = position, 1-based)
 *
 * The web app loads it as a lazily imported chunk (frontend/src/services/wordFrequency.ts,
 * precached for offline); the Lab app reads the same file as a core resource
 * (core/…/WordFrequency.kt, parity-tested: both parse it to the same ranks).
 */
import { hanCharacters, isHanCodePoint } from '../progress/known';
import { hanText } from './novelty';

/** How many words / characters the shipped list keeps. */
export const WORD_FREQ_WORDS = 30_000;
export const WORD_FREQ_CHARS = 8_000;

/** A word not in the list ranks after every listed word: this + its rarest character's rank. */
export const UNKNOWN_WORD_BASE = 1_000_000;
/** A character not in the list. */
export const UNRANKED_CHAR = 100_000;
/** No Han characters at all: last. */
export const NO_HAN_RANK = 10_000_000;

export interface FrequencyIndex {
  /** word → rank (1 = most frequent). */
  words: ReadonlyMap<string, number>;
  /** character → rank (1 = most frequent). */
  chars: ReadonlyMap<string, number>;
}

/** Read the shipped list (see the format above). Unknown sections and blank lines are skipped. */
export function parseFrequencyList(text: string): FrequencyIndex {
  const words = new Map<string, number>();
  const chars = new Map<string, number>();
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '#words' || line === '#chars') {
      section = line;
      continue;
    }
    if (line === '' || line.startsWith('#')) continue;
    if (section === '#words') {
      if (!words.has(line)) words.set(line, words.size + 1);
    } else if (section === '#chars') {
      for (const ch of line) if (!chars.has(ch)) chars.set(ch, chars.size + 1);
    }
  }
  return { words, chars };
}

/** A character's rank (1 = most frequent); UNRANKED_CHAR when it isn't in the list. */
export function characterRank(ch: string, index: FrequencyIndex): number {
  return index.chars.get(ch) ?? UNRANKED_CHAR;
}

/**
 * Smaller = more common. A note whose Han text is a listed word gets that word's rank;
 * anything else (a rarer word, a phrase, a sentence) ranks after every listed word, by
 * its RAREST character (UNKNOWN_WORD_BASE + that character's rank, UNRANKED_CHAR when
 * the character isn't listed either). No Han characters → NO_HAN_RANK.
 */
export function frequencyRank(hanzi: string, index: FrequencyIndex): number {
  const text = hanText(hanzi);
  return frequencyRankOfText(text, hanCharacters(text), index);
}

/** frequencyRank from a note's Han text and its distinct characters (already worked out). */
export function frequencyRankOfText(text: string, chars: readonly string[], index: FrequencyIndex): number {
  if (text === '') return NO_HAN_RANK;
  const word = index.words.get(text);
  if (word !== undefined) return word;
  let rarest = 0;
  for (const ch of chars) rarest = Math.max(rarest, index.chars.get(ch) ?? UNRANKED_CHAR);
  return UNKNOWN_WORD_BASE + rarest;
}

function isAllHan(text: string): boolean {
  if (!text) return false;
  for (const ch of text) if (!isHanCodePoint(ch.codePointAt(0)!)) return false;
  return true;
}

const byFreqThenText = (a: [string, number], b: [string, number]) =>
  b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/**
 * The shipped list from a wordfreq table (word → frequency; shared/chars/build.ts
 * `parseWordfreq`). Words = the most frequent all-Han tokens; characters ranked by
 * Σ frequency × occurrences over every token (as the character dictionary does).
 */
export function buildFrequencyList(
  freq: ReadonlyMap<string, number>,
  options: { words?: number; chars?: number; header?: string[] } = {},
): string {
  const maxWords = options.words ?? WORD_FREQ_WORDS;
  const maxChars = options.chars ?? WORD_FREQ_CHARS;
  const words = [...freq.entries()].filter(([w]) => isAllHan(w)).sort(byFreqThenText).slice(0, maxWords);
  const charFreq = new Map<string, number>();
  for (const [w, f] of freq) {
    for (const ch of w) {
      if (!isHanCodePoint(ch.codePointAt(0)!)) continue;
      charFreq.set(ch, (charFreq.get(ch) ?? 0) + f);
    }
  }
  const chars = [...charFreq.entries()].sort(byFreqThenText).slice(0, maxChars);
  const header = (options.header ?? []).map(l => `# ${l}`);
  return [...header, '#words', ...words.map(([w]) => w), '#chars', chars.map(([c]) => c).join(''), ''].join('\n');
}
