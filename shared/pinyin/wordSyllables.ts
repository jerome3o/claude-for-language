/**
 * A word's pinyin, one syllable per character (docs/LANGUAGE_EXPLORER.md "Pinyin per character").
 *
 * The explorer's Word view colours a chip per character by its syllable's tone, and its header
 * shows the word's pinyin. That pinyin often comes from somewhere that can be wrong — a reader
 * chip's segment (Claude's), a card — and a greedy split of joined pinyin can cut it wrongly:
 * 吴侬软语 "wúnóngkuǎnyǔ" was split wún | óng | kuǎn | yǔ ("wun" passes the loose syllable test).
 *
 * - `alignWordSyllables` cuts the pinyin into EXACTLY one syllable per Han character (a syllable
 *   ending in r may also cover a following 儿: nǎr), choosing among every possible cut the one with
 *   the fewest syllables that aren't a reading of their character (`fits`), then the fewest cuts
 *   that start a syllable with a vowel inside a word without an apostrophe (wú|nóng, not wún|óng).
 * - `checkWordPinyin` puts the device's own readings to work: a syllable no reading of its
 *   character allows (软 kuǎn) is replaced by the device's reading of that character (the app's
 *   auto-pinyin: pinyin-pro + the 一 / 不 rule), only that syllable changing; pinyin that can't be
 *   lined up at all — or is mostly wrong — gives way to the device's reading of the whole word.
 *   A trusted source (the dictionaries) is only cut, never corrected.
 *
 * Pure: the readings and the auto-pinyin are passed in (web: pinyin-pro's `polyphonic` + the
 * character records on the device, `autoPinyin`; Lab: `Pinyin.readings`, `ToneChange.autoPinyin`).
 * Ported to the Lab app (core/…/WordSyllables.kt, parity-tested in parity/fixtures/explorer.ts).
 */
import { isHanCodePoint } from '../progress/known';
import { isPinyinSyllable, syllableTone, toneless } from './toneChange';

/** Every reading one character can have ("行" → xíng, háng, …), tone-marked. */
export type ReadingsOf = (ch: string) => readonly string[];

/** What the device knows by itself about how characters are read. */
export interface DevicePinyin {
  readings?: ReadingsOf;
  /** The device's own pinyin of a text (the app's auto-pinyin). */
  auto?: (text: string) => string;
}

/** The Han characters of a text, one string per code point. */
export function hanChars(text: string): string[] {
  return Array.from(text).filter((ch) => isHanCodePoint(ch.codePointAt(0)!));
}

const LETTER = /[a-zA-ZüÜvVāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/;
const MARKED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/g;
/** A syllable starting with a vowel (lower-cased first). */
const VOWEL_START = /^[aoeiuüāáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜ]/;
/** Syllables that take an apostrophe inside a word (Xī'ān). */
const APOSTROPHE_START = /^[aoeāáǎàōóǒòēéěè]/;
const MAX_LEN = 7;

/** Readings in everyday use the dictionaries leave out (the worker's pinyin check has the same). */
const COLLOQUIAL: Record<string, string[]> = { 一: ['yāo'], 喂: ['wéi'] };

/**
 * Is `syllable` a reading the character at `i` can have? Neutral tone fits any tone of the same
 * syllable; 一 / 不 only need to be yi / bu (their tone is the 一 / 不 rule's); a reduplicated
 * character may take a first tone (好好 hǎohāo). A character the readings know nothing about fits
 * anything — it can't be judged.
 */
export function readingFits(chars: readonly string[], i: number, syllable: string, readings: readonly string[]): boolean {
  const ch = chars[i];
  const base = toneless(syllable);
  if (ch === '一') return base === 'yi' || base === 'yao';
  if (ch === '不') return base === 'bu';
  const known = [...readings, ...(COLLOQUIAL[ch] ?? [])].filter((r) => isPinyinSyllable(r));
  if (!known.length) return true;
  const tone = syllableTone(syllable);
  if (known.some((r) => toneless(r) === base && (tone === 5 || syllableTone(r) === tone))) return true;
  return i > 0 && chars[i - 1] === ch && tone === 1 && known.some((r) => toneless(r) === base);
}

export interface AlignedWordPinyin {
  /** One syllable per character (an erhua 儿 gets "r"). */
  syllables: string[];
  /** Where each character's syllable is in the NFC pinyin: [start, end). */
  spans: Array<[number, number]>;
  /** Indexes of the characters whose syllable `fits` rejected. */
  misfits: number[];
}

interface Pick {
  text: string;
  start: number;
  end: number;
  misfit: boolean;
}

interface Best {
  cost: number;
  picks: Pick[];
}

function onePiece(piece: string): boolean {
  return isPinyinSyllable(piece) && (piece.match(MARKED)?.length ?? 0) <= 1;
}

function isErhua(piece: string): boolean {
  const base = toneless(piece);
  return base.length > 1 && base.endsWith('r') && base !== 'er' && isPinyinSyllable(piece.slice(0, -1));
}

/**
 * Cut `pinyin` into one syllable per character of `chars`, or null when it can't be (tone numbers,
 * not pinyin, too few / too many syllables). Spaces, apostrophes, hyphens and punctuation only
 * separate. Among the cuts, the fewest syllables `fits` rejects (2 each), then the fewest
 * syllables starting with a vowel inside a word (1 each); ties keep the longest-first cut.
 */
export function alignWordSyllables(
  chars: readonly string[],
  pinyin: string,
  fits?: (i: number, syllable: string) => boolean,
): AlignedWordPinyin | null {
  const p = pinyin.normalize('NFC');
  if (!chars.length || /[0-9]/.test(p)) return null;
  const tokens: Array<{ start: number; text: string }> = [];
  for (let i = 0; i < p.length; ) {
    if (!LETTER.test(p[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < p.length && LETTER.test(p[j])) j++;
    tokens.push({ start: i, text: p.slice(i, j) });
    i = j;
  }
  if (!tokens.length) return null;

  const memo = new Map<string, Best | null>();
  const go = (t: number, pos: number, ci: number): Best | null => {
    if (t === tokens.length) return ci === chars.length ? { cost: 0, picks: [] } : null;
    const tok = tokens[t];
    if (pos === tok.text.length) return go(t + 1, 0, ci);
    if (ci >= chars.length) return null;
    const key = `${t}:${pos}:${ci}`;
    if (memo.has(key)) return memo.get(key)!;
    let best: Best | null = null;
    const at = tok.start + pos;
    for (let len = Math.min(MAX_LEN, tok.text.length - pos); len >= 1; len--) {
      const piece = tok.text.slice(pos, pos + len);
      if (!onePiece(piece)) continue;
      const penalty = pos > 0 && VOWEL_START.test(piece.toLowerCase()) ? 1 : 0;
      const plainMisfit = !!fits && !fits(ci, piece);
      const rest = go(t, pos + len, ci + 1);
      if (rest) {
        const cost = penalty + (plainMisfit ? 2 : 0) + rest.cost;
        if (!best || cost < best.cost) best = { cost, picks: [{ text: piece, start: at, end: at + len, misfit: plainMisfit }, ...rest.picks] };
      }
      if (chars[ci + 1] === '儿' && isErhua(piece)) {
        const base = piece.slice(0, -1);
        const misfit = !!fits && !fits(ci, base);
        const after = go(t, pos + len, ci + 2);
        if (after) {
          const cost = penalty + (misfit ? 2 : 0) + after.cost;
          if (!best || cost < best.cost) {
            best = {
              cost,
              picks: [
                { text: base, start: at, end: at + len - 1, misfit },
                { text: piece.slice(-1), start: at + len - 1, end: at + len, misfit: false },
                ...after.picks,
              ],
            };
          }
        }
      }
    }
    memo.set(key, best);
    return best;
  };
  const best = go(0, 0, 0);
  if (!best) return null;
  return {
    syllables: best.picks.map((x) => x.text),
    spans: best.picks.map((x) => [x.start, x.end] as [number, number]),
    misfits: best.picks.flatMap((x, i) => (x.misfit ? [i] : [])),
  };
}

/** The device's own syllable for each character (its auto-pinyin of the word), or null. */
export function deviceSyllables(chars: readonly string[], auto?: (text: string) => string): string[] | null {
  if (!auto || !chars.length) return null;
  let out: string;
  try {
    out = auto(chars.join(''));
  } catch {
    return null;
  }
  const parts = out.normalize('NFC').trim().split(/\s+/).filter((s) => s.length > 0);
  return parts.length === chars.length && parts.every((s) => isPinyinSyllable(s)) ? parts : null;
}

/** Syllables written as one word, an apostrophe before a/o/e inside it ("Xī'ān", "wúnóngruǎnyǔ"). */
export function joinWordSyllables(syllables: readonly string[]): string {
  return syllables.map((s, i) => (i > 0 && APOSTROPHE_START.test(s.toLowerCase()) ? `'${s}` : s)).join('');
}

export type WordPinyinHow = 'as_given' | 'corrected' | 'device' | 'none';

export interface CheckedWordPinyin {
  /** The pinyin to show for the word. */
  pinyin: string;
  /** One syllable per Han character, or null when none could be lined up. */
  syllables: string[] | null;
  /** as_given = the pinyin was right (or nothing better is known); corrected = impossible syllables replaced; device = the device's reading of the word. */
  how: WordPinyinHow;
}

/** `word` with an upper-case first letter when `like` has one. */
function keepCapital(like: string, word: string): string {
  return like.length > 0 && like[0] !== like[0].toLowerCase() && word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * The word's pinyin checked against its characters (see the file comment). `trust` = a dictionary's
 * pinyin: cut the way that fits, never corrected.
 */
export function checkWordPinyin(hanzi: string, pinyin: string | null | undefined, device: DevicePinyin = {}, trust = false): CheckedWordPinyin {
  const chars = hanChars(hanzi);
  const given = (pinyin ?? '').trim();
  if (!chars.length) return { pinyin: given, syllables: null, how: given ? 'as_given' : 'none' };
  const readings = device.readings;
  const fits = readings ? (i: number, s: string) => readingFits(chars, i, s, readings(chars[i])) : undefined;
  const fromDevice = (): CheckedWordPinyin | null => {
    const dev = deviceSyllables(chars, device.auto);
    return dev ? { pinyin: joinWordSyllables(dev), syllables: dev, how: 'device' } : null;
  };

  if (!given) return fromDevice() ?? { pinyin: '', syllables: null, how: 'none' };
  const aligned = alignWordSyllables(chars, given, fits);
  if (aligned && (trust || !aligned.misfits.length)) return { pinyin: given, syllables: aligned.syllables, how: 'as_given' };
  if (!aligned) return (trust ? null : fromDevice()) ?? { pinyin: given, syllables: null, how: 'as_given' };

  const dev = deviceSyllables(chars, device.auto);
  if (!dev) return { pinyin: given, syllables: aligned.syllables, how: 'as_given' };
  // Mostly wrong: more likely another word's pinyin than a slip — the device's reading of the word.
  if (aligned.misfits.length * 2 > chars.length) return { pinyin: joinWordSyllables(dev), syllables: dev, how: 'device' };

  let out = given.normalize('NFC');
  const syllables = [...aligned.syllables];
  for (const i of [...aligned.misfits].sort((a, b) => aligned.spans[b][0] - aligned.spans[a][0])) {
    const [start, end] = aligned.spans[i];
    let rep = keepCapital(out.slice(start, end), dev[i]);
    if (start > 0 && LETTER.test(out[start - 1]) && APOSTROPHE_START.test(rep.toLowerCase())) rep = `'${rep}`;
    out = out.slice(0, start) + rep + out.slice(end);
    syllables[i] = dev[i];
  }
  return { pinyin: out, syllables, how: 'corrected' };
}
