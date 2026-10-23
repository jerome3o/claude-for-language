/**
 * The deterministic pinyin check: line a pinyin string up with its Chinese (one syllable per Han
 * character; a word + 儿 may be one syllable, nǎr) and test each syllable against the readings its
 * character can have — pinyin-pro's dictionary, and for a character it doesn't accept, the character
 * dictionary's CC-CEDICT readings (`charReadings`, worker assets). No model call, no network.
 *
 * Two users:
 * - the call board's tab-complete (services/calls/gloss-pinyin.ts, `checkGlossPinyin`), which
 *   replaces a whole wrong word and applies the 一 / 不 rule to its line;
 * - authored lessons and readers (`checkAuthoredPinyin` + `checkSpecPinyin`, below). The rules:
 *   1. A syllable that IS a possible reading of its character is never changed, whatever the word
 *      dictionary says (大人 dàrén stays; 还 hái / huán, 得 de / dé / děi, 长 cháng / zhǎng all stay
 *      — choosing between real readings needs a reader of the sentence, not a dictionary).
 *   2. Only an IMPOSSIBLE syllable is replaced — one no reading of its character allows (扶梯
 *      "fúqī" → "fútī", 休息 "xiūxí" → "xiūxi": 息 is never xí). Only that syllable changes; the
 *      word dictionary's reading of its word, else pinyin-pro's reading in this sentence, picks the
 *      replacement. Everything else — spacing, punctuation, capitals, line breaks — stays byte for byte.
 *   3. Alternatives listed on purpose ("piāo / piào", "zhè ge / zhèi ge") are checked one by one and
 *      never collapsed.
 *   4. A line whose syllables can't be lined up with the characters is NEVER rebuilt. One missing
 *      syllable is put back only when it is clearly safe (one clause short by one, the gap at one
 *      place only, and the missing character has one reading); anything else is left as written and
 *      reported as a warning ("needs a look").
 *   The hanzi is never touched.
 *
 * Neutral tones: a syllable without a mark is fine when the character has that syllable with any
 * tone (东西 dōngxi, 觉得 juéde) — the neutral tone is a property of the word. 一 / 不 only need to be
 * yi / bu: their tone is the 一 / 不 rule's.
 */

import { pinyin as pinyinPro, segment as pinyinSegment, OutputFormat } from 'pinyin-pro';
import { pinyinSyllables, syllableTone, toneless } from '@shared/pinyin/toneChange';
import type { PinyinFix, PinyinWarning, PinyinWordFix } from '@shared/pinyin/fixes';
import { isChinesePunct, isHanChar } from '@shared/calls';
import { glossReadingSources } from './calls/gloss-sources';
import { fillGap, gapCount } from '@shared/lesson/types';

export type { PinyinFix, PinyinWarning, PinyinWordFix } from '@shared/pinyin/fixes';

export interface PinyinReadingSources {
  /** CC-CEDICT readings of characters pinyin-pro doesn't accept a syllable for (asked only for those). */
  charReadings?: (chars: string[]) => Promise<Record<string, string[]>>;
  /** The dictionary pinyin of whole words (2–6 characters), e.g. 银行 → yínháng. */
  wordPinyin?: (words: string[]) => Promise<Record<string, string>>;
}

/** A pinyin word: its place in the pinyin string and the characters its syllables cover. */
export interface PinyinWord {
  start: number;
  end: number;
  text: string;
  syllables: string[];
  /** Where each syllable starts inside `text`. */
  offsets: number[];
  /** Index of the first Han character it covers, and one past the last. */
  hanFrom: number;
  hanTo: number;
  /** Han indexes of a 儿 folded into the syllable before it (nǎr). */
  erhua: number[];
}

/** One syllable lined up with its character. */
export interface PinyinSlot {
  /** Index into the words. */
  word: number;
  /** Index of the syllable inside its word. */
  index: number;
  /** Index of its Han character. */
  han: number;
  ch: string;
  /** The syllable as written, without a folded 儿's r. */
  syllable: string;
  erhua: boolean;
}

/** Does syllable `s` fit the Han character at index `h`? Used to choose how a word is cut into syllables. */
export type SlotFits = (h: number, syllable: string) => boolean;

const WORD_RE = /[\p{L}\p{M}'’]+/gu;

const readingCache = new Map<string, string[]>();

/** Readings pinyin-pro knows for one character ("行" → xíng, háng, hàng, héng). */
export function proReadings(ch: string): string[] {
  let r = readingCache.get(ch);
  if (r) return r;
  try {
    r = pinyinPro(ch, { multiple: true, type: 'array' }) as string[];
  } catch {
    r = [];
  }
  if (readingCache.size > 20000) readingCache.clear();
  readingCache.set(ch, r);
  return r;
}

/** Is `syllable` a reading `ch` can have, given its readings? */
export function syllableFits(ch: string, syllable: string, readings: readonly string[]): boolean {
  const base = toneless(syllable);
  if (ch === '一') return base === 'yi';
  if (ch === '不') return base === 'bu';
  const tone = syllableTone(syllable);
  return readings.some((r) => toneless(r) === base && (tone === 5 || syllableTone(r) === tone));
}

// ---------------------------------------------------------------------------------------------
// Lining syllables up with characters
// ---------------------------------------------------------------------------------------------

interface RawWord {
  start: number;
  end: number;
  text: string;
}

function rawWords(pinyin: string): RawWord[] {
  return [...pinyin.matchAll(WORD_RE)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, text: m[0] }));
}

const APOSTROPHES = new Set(["'", '’']);
const TONE_MARKED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/g;
const MAX_CUTS = 24;

function oneSyllable(piece: string): boolean {
  const s = pinyinSyllables(piece);
  return !!s && s.length === 1 && s[0] === piece && (piece.match(TONE_MARKED)?.length ?? 0) <= 1;
}

const cutCache = new Map<string, Array<Array<{ at: number; text: string }>>>();

/**
 * Every way to cut a pinyin word into syllables (at most MAX_CUTS), longest-first cut first:
 * "dàrén" → dàr|én, dà|rén; "réngōng" → réng|ōng, rén|gōng; "Xī'ān" → Xī|ān.
 */
export function wordCuts(text: string): Array<Array<{ at: number; text: string }>> {
  const hit = cutCache.get(text);
  if (hit) return hit;
  const memo = new Map<number, Array<Array<{ at: number; text: string }>>>();
  const go = (i: number): Array<Array<{ at: number; text: string }>> => {
    if (i === text.length) return [[]];
    const known = memo.get(i);
    if (known) return known;
    const out: Array<Array<{ at: number; text: string }>> = [];
    const start = APOSTROPHES.has(text[i]) ? i + 1 : i;
    if (start === text.length) out.push([]);
    for (let len = Math.min(7, text.length - start); len >= 1 && out.length < MAX_CUTS; len--) {
      const piece = text.slice(start, start + len);
      if (!oneSyllable(piece)) continue;
      for (const rest of go(start + len)) {
        out.push([{ at: start, text: piece }, ...rest]);
        if (out.length >= MAX_CUTS) break;
      }
    }
    memo.set(i, out);
    return out;
  };
  const cuts = go(0);
  if (cutCache.size > 5000) cutCache.clear();
  cutCache.set(text, cuts);
  return cuts;
}

/** Pieces a word may only be cut into where the author marked it (an apostrophe) or where it fits. */
const VOWEL_START = /^[aoeiuüāáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜ]/i;
const unmarkedPiece = (s: string) => VOWEL_START.test(s) || toneless(s) === 'r';

const isErhuaSyllable = (s: string) => {
  const base = toneless(s);
  return base.length > 1 && base.endsWith('r') && base !== 'er';
};

/**
 * Line the words up with the characters: choose how each word is cut into syllables (and whether a
 * syllable ending in r takes a following 儿) so the syllables cover the characters exactly, with as
 * few syllables as possible that `fits` rejects. Null when no cut covers them.
 */
function alignWords(han: readonly string[], raw: readonly RawWord[], fits?: SlotFits): { words: PinyinWord[]; cost: number } | null {
  const cuts = raw.map((w) => wordCuts(w.text));
  if (cuts.some((c) => !c.length)) return null;
  const memo = new Map<number, { words: PinyinWord[]; cost: number } | null>();
  const from = (wi: number, h: number): { words: PinyinWord[]; cost: number } | null => {
    if (wi === raw.length) return h === han.length ? { words: [], cost: 0 } : null;
    if (han.length - h < raw.length - wi) return null;
    const key = wi * (han.length + 1) + h;
    if (memo.has(key)) return memo.get(key)!;
    let best: { words: PinyinWord[]; cost: number } | null = null;
    for (const cut of cuts[wi]) {
      const walk = (si: number, hh: number, cost: number, erhua: number[]): void => {
        if (si === cut.length) {
          const rest = from(wi + 1, hh);
          if (!rest) return;
          if (best && best.cost <= cost + rest.cost) return;
          const w = raw[wi];
          best = {
            cost: cost + rest.cost,
            words: [{ start: w.start, end: w.end, text: w.text, syllables: cut.map((c) => c.text), offsets: cut.map((c) => c.at), hanFrom: h, hanTo: hh, erhua }, ...rest.words],
          };
          return;
        }
        if (hh >= han.length) return;
        const s = cut[si].text;
        // A syllable starting with a vowel inside a word with no apostrophe before it ("Xīān") is a
        // cut the author didn't mark: taken only when it fits its character, so a cut can never
        // invent a syllable to cover a missing one ("shuō" → shu|ō).
        const unmarked = si > 0 && unmarkedPiece(s) && !APOSTROPHES.has(raw[wi].text[cut[si].at - 1]);
        const plainFits = !fits || fits(hh, s);
        if (plainFits || !unmarked) walk(si + 1, hh + 1, cost + (plainFits ? 0 : 1), erhua);
        if (han[hh + 1] === '儿' && isErhuaSyllable(s)) {
          const foldFits = !fits || fits(hh, s.replace(/r$/i, ''));
          if (foldFits || !unmarked) walk(si + 1, hh + 2, cost + (foldFits ? 0 : 1), [...erhua, hh + 1]);
        }
      };
      walk(0, h, 0, []);
    }
    memo.set(key, best);
    return best;
  };
  return from(0, 0);
}

/**
 * Line the pinyin's words / syllables up with the Han characters, or null when they don't line up.
 * With `fits`, a word that can be cut more than one way ("dàrén": dàr|én or dà|rén) is cut the way
 * that fits its characters best.
 */
export function alignPinyin(han: readonly string[], pinyin: string, fits?: SlotFits): PinyinWord[] | null {
  return alignWords(han, rawWords(pinyin), fits)?.words ?? null;
}

/** Every syllable with its character, in order. */
export function pinyinSlots(han: readonly string[], words: readonly PinyinWord[]): PinyinSlot[] {
  const slots: PinyinSlot[] = [];
  words.forEach((w, wi) => {
    let h = w.hanFrom;
    w.syllables.forEach((s, si) => {
      const erhua = w.erhua.includes(h + 1);
      slots.push({ word: wi, index: si, han: h, ch: han[h], syllable: erhua ? s.replace(/r$/i, '') : s, erhua });
      h += erhua ? 2 : 1;
    });
  });
  return slots;
}

/** The slots no reading of their character allows (pinyin-pro first, then the character dictionary). */
export async function impossibleSlots(slots: readonly PinyinSlot[], sources: PinyinReadingSources = {}): Promise<PinyinSlot[]> {
  let suspect = slots.filter((s) => !syllableFits(s.ch, s.syllable, proReadings(s.ch)));
  if (suspect.length && sources.charReadings) {
    const extra = await sources.charReadings([...new Set(suspect.map((s) => s.ch))]).catch(() => ({}) as Record<string, string[]>);
    suspect = suspect.filter((s) => !syllableFits(s.ch, s.syllable, [...proReadings(s.ch), ...(extra[s.ch] ?? [])]));
  }
  return suspect;
}

/** pinyin-pro's reading of every Han character in this text (context-aware), or null. */
export function contextReadings(han: readonly string[]): string[] | null {
  try {
    const arr = pinyinPro(han.join(''), { type: 'array' }) as string[];
    return arr.length === han.length ? arr : null;
  } catch {
    return null;
  }
}

const PUNCT_PINYIN: Record<string, string> = { '，': ',', '、': ',', '？': '?', '！': '!', '；': ';', '：': ':' };

/** The whole line from pinyin-pro, word by word ("他长大了" → "tā zhǎngdà le"). Used by the board gloss only. */
export function pinyinProLine(hanzi: string): string {
  let out = '';
  try {
    const segs = pinyinSegment(hanzi, { format: OutputFormat.AllSegment }) as Array<{ origin: string; result: string }>;
    for (const s of segs) {
      if (Array.from(s.origin).some(isHanChar)) out += (out ? ' ' : '') + s.result.replace(/\s+/g, '');
      else {
        const p = Array.from(s.origin).map((ch) => PUNCT_PINYIN[ch] ?? '').join('');
        out += p;
      }
    }
  } catch {
    out = (pinyinPro(hanzi.replace(/[^\p{Script=Han}]/gu, ''), { type: 'array' }) as string[]).join(' ');
  }
  return out.trim();
}

/** `word` with an upper-case first letter when `like` has one. */
export function keepCapital(like: string, word: string): string {
  return like[0] && like[0] !== like[0].toLowerCase() && word ? word[0].toUpperCase() + word.slice(1) : word;
}

// ---------------------------------------------------------------------------------------------
// Authored content: lessons, library lessons, readers
// ---------------------------------------------------------------------------------------------

/** Characters a line may carry and still be lined up: Han, Chinese / ASCII punctuation, spaces. */
const ASCII_PUNCT = new Set(Array.from(`.,!?;:'"()[]-~/…|`));

function checkable(hanzi: string): boolean {
  const chars = Array.from(hanzi);
  return chars.some(isHanChar) && chars.every((ch) => isHanChar(ch) || isChinesePunct(ch) || ASCII_PUNCT.has(ch) || /\s/.test(ch));
}

/**
 * Readings in everyday use that the dictionaries leave out: 一 said yāo in numbers (phone / room /
 * bus numbers: 幺), 喂 wéi answering the phone.
 */
const COLLOQUIAL: Record<string, string[]> = { 一: ['yāo'], 喂: ['wéi'] };

function colloquialFits(ch: string, syllable: string): boolean {
  const extra = COLLOQUIAL[ch];
  return !!extra && extra.some((r) => toneless(r) === toneless(syllable) && (syllableTone(syllable) === 5 || syllableTone(r) === syllableTone(syllable)));
}

/**
 * A reduplicated character whose second syllable is said in the first tone — the colloquial
 * 好好(儿) hǎohāo(r), 慢慢 mànmān, 快快 kuàikuāi: fine when the character has that syllable with any tone.
 */
function reduplicationFits(han: readonly string[], h: number, syllable: string, readings: readonly string[]): boolean {
  return h > 0 && han[h - 1] === han[h] && syllableTone(syllable) === 1 && readings.some((r) => toneless(r) === toneless(syllable));
}

/** A stand-in character any syllable fits (where an extra syllable could sit). */
const WILDCARD = '\u0000';

/** The authored check's idea of "this syllable can be right" before the character dictionary is asked. */
function authoredFits(han: readonly string[]): SlotFits {
  return (h, s) => {
    const ch = han[h];
    if (ch === WILDCARD) return true;
    const readings = proReadings(ch);
    return syllableFits(ch, s, readings) || colloquialFits(ch, s) || reduplicationFits(han, h, s, readings);
  };
}

export interface AuthoredPinyinResult {
  pinyin: string;
  /** null = unchanged. */
  reason: PinyinFix['reason'] | null;
  words: PinyinWordFix[];
  /** Why the pinyin was left as written though something looks wrong (present only when there is one). */
  warnings?: string[];
}

const UNCHANGED = (pinyin: string): AuthoredPinyinResult => ({ pinyin, reason: null, words: [] });

interface LineResult extends AuthoredPinyinResult {
  /** False when the syllables couldn't be lined up with the characters. */
  aligned: boolean;
}

/** `「说得真好」` quoted for a warning. */
const q = (s: string) => `“${s}”`;

/**
 * Fix the impossible syllables of an aligned line (rule 2). Only those syllables change.
 */
async function fixReadings(han: readonly string[], nfc: string, words: readonly PinyinWord[], sources: PinyinReadingSources): Promise<AuthoredPinyinResult> {
  const slots = pinyinSlots(han, words);
  const bad = (await impossibleSlots(slots, sources)).filter(
    (s) => !colloquialFits(s.ch, s.syllable) && !reduplicationFits(han, s.han, s.syllable, proReadings(s.ch)),
  );
  if (!bad.length) return UNCHANGED(nfc);
  // Many syllables off at once: the pinyin is more likely out of step with the characters (or
  // belongs to other text) than wrong syllable by syllable — not a thing to fix by dictionary.
  if (bad.length >= 3 && bad.length * 3 > slots.length) {
    return { ...UNCHANGED(nfc), warnings: [`${bad.length} of ${slots.length} syllables aren't readings of their characters (${bad.map((s) => `${s.ch} ${s.syllable}`).slice(0, 6).join(', ')}) — left as written`] };
  }

  // The replacement for each bad syllable: the dictionary's reading of its word at that place, else
  // pinyin-pro's reading of the character in this sentence. Only that syllable changes.
  const badWords = [...new Set(bad.map((s) => s.word))];
  const spanOf = (wi: number) => han.slice(words[wi].hanFrom, words[wi].hanTo).join('');
  const lookup = badWords
    .filter((wi) => !words[wi].erhua.length)
    .map(spanOf)
    .filter((w) => Array.from(w).length >= 2 && Array.from(w).length <= 6);
  const dict = lookup.length && sources.wordPinyin ? await sources.wordPinyin([...new Set(lookup)]).catch(() => ({}) as Record<string, string>) : {};
  const context = contextReadings(han);

  const fixesByWord = new Map<number, string>();
  for (const wi of badWords) {
    const w = words[wi];
    const span = spanOf(wi);
    const fromDict = !w.erhua.length && dict[span] ? syllablesFor(Array.from(span), dict[span]) : null;
    let cursor = 0;
    let text = '';
    let changed = false;
    w.syllables.forEach((syl, si) => {
      const at = w.offsets[si];
      text += w.text.slice(cursor, at);
      let out = syl;
      const slot = bad.find((s) => s.word === wi && s.index === si);
      if (slot) {
        const local = slot.han - w.hanFrom;
        const candidate = fromDict?.[local] ?? context?.[slot.han];
        if (candidate) {
          out = keepCapital(syl, candidate.toLowerCase()) + (slot.erhua ? 'r' : '');
          if (out !== syl) changed = true;
        }
      }
      text += out;
      cursor = at + syl.length;
    });
    text += w.text.slice(cursor);
    if (changed && text !== w.text) fixesByWord.set(wi, text);
  }
  if (!fixesByWord.size) return UNCHANGED(nfc);

  let out = nfc;
  const fixes: PinyinWordFix[] = [];
  for (const wi of [...fixesByWord.keys()].sort((a, b) => b - a)) {
    const w = words[wi];
    const to = fixesByWord.get(wi)!;
    out = out.slice(0, w.start) + to + out.slice(w.end);
    fixes.unshift({ hanzi: spanOf(wi), from: w.text, to });
  }
  return { pinyin: out, reason: 'reading', words: fixes };
}

/** One syllable per character of `chars`, cut the way that fits them ("tūrán" → tū, rán), or null. */
function syllablesFor(chars: string[], pinyin: string): string[] | null {
  const a = alignWords(chars, rawWords(pinyin.normalize('NFC')), authoredFits(chars));
  const syls = a?.words.flatMap((w) => w.syllables) ?? null;
  return syls && syls.length === chars.length ? syls : null;
}

interface HanClause {
  /** Indexes into `han`. */
  from: number;
  to: number;
}

/** The runs of Han characters between punctuation / line breaks. */
function hanClauses(hanzi: string): HanClause[] {
  const out: HanClause[] = [];
  let h = 0;
  let open: HanClause | null = null;
  for (const ch of Array.from(hanzi)) {
    if (isHanChar(ch)) {
      if (!open) {
        open = { from: h, to: h };
        out.push(open);
      }
      h++;
      open.to = h;
    } else if (!/[ \t]/.test(ch)) open = null;
  }
  return out;
}

/** The runs of pinyin words between punctuation / line breaks (spaces and hyphens don't break). */
function wordClauses(pinyin: string, raw: readonly RawWord[]): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  raw.forEach((w, i) => {
    const between = i === 0 ? '' : pinyin.slice(raw[i - 1].end, w.start);
    if (i === 0 || /[^ \t\-‐–]/.test(between)) out.push({ from: i, to: i + 1 });
    else out[out.length - 1].to = i + 1;
  });
  return out;
}

/** All readings of a character (pinyin-pro + character dictionary), NFC, lower case, distinct. */
function allReadings(ch: string, extra: Record<string, string[]>): string[] {
  return [...new Set([...proReadings(ch), ...(extra[ch] ?? [])].map((r) => r.normalize('NFC').toLowerCase()))];
}

/**
 * The syllables don't line up. Find the clause(s) where they don't, say what looks wrong, and put
 * back ONE missing syllable when that is clearly safe (rule 4). Never rebuilds anything.
 */
async function repairCount(hanzi: string, han: readonly string[], nfc: string, sources: PinyinReadingSources): Promise<LineResult> {
  // Read the IPA ɡ as g (same length: positions in `probe` are positions in `nfc`).
  const probe = nfc.replace(/ɡ/g, 'g');
  const raw = rawWords(probe);
  const hc = hanClauses(hanzi);
  const pc = wordClauses(probe, raw);
  const total = raw.reduce((n, w) => n + (wordCuts(w.text)[0]?.length ?? 0), 0);
  const unchanged = (warnings: string[]): LineResult => ({ ...UNCHANGED(nfc), warnings, aligned: false });
  const generic = `the syllables don't line up with the characters (${han.length} character(s), ${total} syllable(s)) — left as written`;
  if (hc.length !== pc.length) return unchanged([generic]);

  const failing = hc
    .map((c, i) => ({ c, w: pc[i] }))
    .filter(({ c, w }) => {
      const arr = han.slice(c.from, c.to);
      return !alignWords(arr, raw.slice(w.from, w.to), authoredFits(arr));
    });
  if (!failing.length) return unchanged([generic]);

  // The failing clauses' characters' readings, with the character dictionary's.
  const chars = [...new Set(failing.flatMap(({ c }) => han.slice(c.from, c.to)))];
  const extra = sources.charReadings ? await sources.charReadings(chars).catch(() => ({}) as Record<string, string[]>) : {};
  const fitsOn = (arr: readonly string[]): SlotFits => {
    const f = authoredFits(arr);
    return (h, s) => arr[h] === WILDCARD || f(h, s) || syllableFits(arr[h], s, extra[arr[h]] ?? []);
  };

  const warnings: string[] = [];
  let insertion: { at: number; text: string; ch: string; reading: string } | null = null;
  for (const { c, w } of failing) {
    const cHan = han.slice(c.from, c.to);
    const cWords = raw.slice(w.from, w.to);
    const clauseHan = cHan.join('');
    const stretch = probe.slice(cWords[0].start, cWords[cWords.length - 1].end);
    const n = cHan.length;
    const cleanly = (arr: string[]) => {
      const a = alignWords(arr, cWords, fitsOn(arr));
      return a && a.cost === 0 ? a.words : null;
    };

    // One syllable missing: leave out each character in turn; does everything else then fit?
    const gaps: Array<{ k: number; words: PinyinWord[]; arr: string[] }> = [];
    for (let k = 0; k < n; k++) {
      const arr = [...cHan.slice(0, k), ...cHan.slice(k + 1)];
      const words = cleanly(arr);
      if (words) gaps.push({ k, words, arr });
    }
    // One syllable extra: a stand-in character at each place in turn.
    const extras = new Set<string>();
    for (let k = 0; k <= n; k++) {
      const arr = [...cHan.slice(0, k), WILDCARD, ...cHan.slice(k)];
      const words = cleanly(arr);
      const slot = words && pinyinSlots(arr, words).find((s) => s.han === k);
      if (slot) extras.add(slot.syllable);
    }

    if (extras.size) {
      warnings.push(
        extras.size === 1
          ? `an extra syllable ${q([...extras][0])} in ${q(clauseHan)} (${stretch}) — left as written`
          : `one syllable too many in ${q(clauseHan)} (${stretch}) — left as written`,
      );
      continue;
    }
    if (!gaps.length) {
      warnings.push(`the syllables don't line up with the characters in ${q(clauseHan)} (${stretch}) — left as written`);
      continue;
    }
    const missing = [...new Set(gaps.map((g) => cHan[g.k]))];
    const reason = `one syllable missing${missing.length === 1 ? ` for ${missing[0]}` : ''} in ${q(clauseHan)} (${stretch})`;
    if (gaps.length !== 1) {
      warnings.push(`${reason} — left as written`);
      continue;
    }
    const { k, words, arr } = gaps[0];
    const ch = cHan[k];
    const readings = allReadings(ch, extra);
    const slots = pinyinSlots(arr, words);
    const place = (han: number) => {
      const slot = slots.find((s) => s.han === han);
      if (!slot) return null;
      const word = words[slot.word];
      return { start: word.start + word.offsets[slot.index], text: word.syllables[slot.index], word: slot.word };
    };
    const prev = k > 0 ? place(k - 1) : null;
    const next = k < arr.length ? place(k) : null;
    // Clearly safe only: the character has ONE reading (so nothing has to be guessed), it is no
    // tone-change character, nothing else in the line is off, and it goes between syllables (or
    // after the last one, or before a lower-case first one).
    const unsafe =
      readings.length !== 1 || ch === '一' || ch === '不' || ch === '儿' || clauseHan.includes('儿') || failing.length > 1 ||
      (!prev && !next) || (!prev && !!next && next.text[0] !== next.text[0].toLowerCase());
    if (unsafe) {
      warnings.push(`${reason} — left as written`);
      continue;
    }
    const reading = readings[0];
    if (prev && next && prev.word === next.word) {
      insertion = { at: next.start, text: (/^[aoeāáǎàōóǒòēéěè]/.test(reading) ? "'" : '') + reading, ch, reading };
    } else if (prev) insertion = { at: prev.start + prev.text.length, text: ` ${reading}`, ch, reading };
    else insertion = { at: next!.start, text: `${reading} `, ch, reading };
  }
  if (warnings.length || !insertion) return unchanged(warnings.length ? warnings : [generic]);

  const patched = nfc.slice(0, insertion.at) + insertion.text + nfc.slice(insertion.at);
  const after = await checkLine(hanzi, patched, sources, false);
  if (!after.aligned) return unchanged([generic]);
  return {
    pinyin: after.pinyin,
    reason: 'syllable_count',
    words: [{ hanzi: insertion.ch, from: '', to: insertion.reading }, ...after.words],
    aligned: true,
  };
}

/** One line (or one alternative of it) against the whole hanzi. */
async function checkLine(hanzi: string, nfc: string, sources: PinyinReadingSources, repair = true): Promise<LineResult> {
  const han = Array.from(hanzi).filter(isHanChar);
  // The IPA "ɡ" some sources print looks like g and means g: read it as g (same length, so every
  // position below is a position in `nfc` too).
  const probe = nfc.replace(/ɡ/g, 'g');
  const aligned = alignWords(han, rawWords(probe), authoredFits(han));
  if (!aligned) return repair ? repairCount(hanzi, han, nfc, sources) : { ...UNCHANGED(nfc), aligned: false };
  const r = await fixReadings(han, nfc, aligned.words, sources);
  return { ...r, aligned: true };
}

/** Separators that only ever list alternatives in a pinyin field ("piāo / piào"). */
const ALT_ALWAYS = /(\s*[/／|｜]\s*)/;
/** Separators that list alternatives only when the hanzi has no such punctuation ("zhè ge; zhèi ge"). */
const ALT_MAYBE = /(\s*[;；,，]\s*)/;

/** Check each alternative on its own and put the field back together with the author's separators. */
async function checkAlternatives(hanzi: string, parts: string[], sources: PinyinReadingSources): Promise<LineResult> {
  const out: string[] = [];
  const words: PinyinWordFix[] = [];
  const warnings: string[] = [];
  let changed = false;
  let allAligned = true;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1 || !parts[i].trim()) {
      out.push(parts[i]);
      continue;
    }
    const r = await checkLine(hanzi, parts[i], sources);
    out.push(r.pinyin);
    words.push(...r.words);
    if (r.reason) changed = true;
    if (!r.aligned) allAligned = false;
    for (const w of r.warnings ?? []) warnings.push(`alternative ${q(parts[i].trim())}: ${w}`);
  }
  const base = { aligned: allAligned, ...(warnings.length ? { warnings } : {}) };
  if (!changed) return { pinyin: parts.join(''), reason: null, words: [], ...base };
  return { pinyin: out.join(''), reason: 'reading', words, ...base };
}

/**
 * Check authored pinyin against its hanzi and correct only what is impossible (see the file
 * comment). Never throws: a dictionary that can't be read just means pinyin-pro alone decides.
 * Skipped (unchanged): blank pinyin or hanzi, hanzi without Han characters, and hanzi mixing in
 * Latin letters or digits (A: 你好, 3个人) — those can't be lined up syllable by syllable.
 */
export async function checkAuthoredPinyin(hanzi: string, pinyin: string, sources: PinyinReadingSources = {}): Promise<AuthoredPinyinResult> {
  if (!hanzi?.trim() || !pinyin?.trim() || !checkable(hanzi)) return UNCHANGED(pinyin);
  const nfc = pinyin.normalize('NFC');
  // A word that isn't pinyin syllables (嗯 ǹg, hm, an English word) — can't be judged.
  for (const w of rawWords(nfc.replace(/ɡ/g, 'g'))) if (!wordCuts(w.text).length) return UNCHANGED(pinyin);

  const strip = ({ aligned: _aligned, ...r }: LineResult): AuthoredPinyinResult => (r.reason ? r : { ...UNCHANGED(pinyin), ...(r.warnings?.length ? { warnings: r.warnings } : {}) });

  // Alternatives listed on purpose ("piāo / piào"): each one on its own, never collapsed.
  if (ALT_ALWAYS.test(nfc) && !/[/／|｜]/.test(hanzi)) return strip(await checkAlternatives(hanzi, nfc.split(ALT_ALWAYS), sources));

  const whole = await checkLine(hanzi, nfc, sources);
  if (!whole.aligned && ALT_MAYBE.test(nfc) && !/[;；,，、]/.test(hanzi)) {
    // "zhè ge, zhèi ge" for 这个: alternatives when every part lines up on its own.
    const alt = await checkAlternatives(hanzi, nfc.split(ALT_MAYBE), sources);
    if (alt.aligned) return strip(alt);
  }
  return strip(whole);
}

/** hanzi-key → pinyin-key pairs a lesson / reader / plan object can carry. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['hanzi', 'pinyin'],
  ['reference_hanzi', 'reference_pinyin'],
  ['content_chinese', 'content_pinyin'],
  ['sentence_clue', 'sentence_clue_pinyin'],
];

/** A gap_choice sentence: its pinyin is the FULL sentence's, so it is checked against the sentence with the answer in the gap. */
const GAP_SENTENCE = 'sentence';

function gapFilledHanzi(obj: Record<string, unknown>): string | undefined {
  const sentence = obj.sentence;
  const answer = obj.answer;
  if (typeof sentence !== 'string' || typeof answer !== 'string' || gapCount(sentence) !== 1) return undefined;
  return fillGap(sentence, answer);
}

function pairsOf(obj: Record<string, unknown>): ReadonlyArray<readonly [string, string]> {
  return typeof obj.sentence === 'string' && typeof obj.answer === 'string' ? [...PAIRS, [GAP_SENTENCE, 'pinyin']] : PAIRS;
}

const PLURALS: Record<string, string> = {
  sections: 'section', exercises: 'exercise', lines: 'line', pages: 'page', options: 'option', pairs: 'pair', words: 'word',
  hints: 'hint', sentences: 'sentence', vocabulary_used: 'vocabulary', questions: 'question', points: 'point', items: 'item',
};

function label(key: string, index: number | null, node: unknown): string {
  const type = node && typeof node === 'object' && typeof (node as { type?: unknown }).type === 'string' ? ` (${(node as { type: string }).type})` : '';
  if (index === null) return key.replace(/_/g, ' ') + type;
  return `${PLURALS[key] ?? key.replace(/s$/, '')} ${index + 1}${type}`;
}

/**
 * Run `checkAuthoredPinyin` over every hanzi + pinyin pair of a spec (any JSON: a lesson, a
 * reader, an audio-lesson plan), writing the corrected pinyin IN PLACE. Returns the fixes made and
 * the lines left as written that need a look.
 */
export async function checkSpecPinyin(spec: unknown, sources: PinyinReadingSources = {}): Promise<{ fixes: PinyinFix[]; warnings: PinyinWarning[] }> {
  const fixes: PinyinFix[] = [];
  const warnings: PinyinWarning[] = [];
  const visit = async (node: unknown, path: string, where: string[]): Promise<void> => {
    if (Array.isArray(node)) return;
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [hk, pk] of pairsOf(obj)) {
      // A judge exercise's WRONG sentence (correct: false) is a deliberate mistake — left as written;
      // its correction is checked like any sentence.
      if (hk === 'hanzi' && obj.correct === false) continue;
      const hz = hk === GAP_SENTENCE ? gapFilledHanzi(obj) : obj[hk];
      const py = obj[pk];
      if (typeof hz !== 'string' || typeof py !== 'string' || !py.trim()) continue;
      const r = await checkAuthoredPinyin(hz, py, sources);
      const at = { path: path ? `${path}.${pk}` : pk, where: where.join(' · ') || 'top', hanzi: hz };
      for (const detail of r.warnings ?? []) warnings.push({ ...at, pinyin: py, detail });
      if (!r.reason) continue;
      obj[pk] = r.pinyin;
      fixes.push({ ...at, before: py, after: r.pinyin, reason: r.reason, words: r.words });
    }
    // A multiple-choice exercise's wrong options are distractors, sometimes on purpose with the wrong
    // tones (押金 "yàjǐn" next to "yājīn"): only the right answer is checked.
    const correct = typeof obj.correct === 'number' ? obj.correct : null;
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (key === 'options' && correct !== null && i !== correct) continue;
          await visit(value[i], `${path ? `${path}.` : ''}${key}[${i}]`, [...where, label(key, i, value[i])]);
        }
      } else if (value && typeof value === 'object') {
        await visit(value, `${path ? `${path}.` : ''}${key}`, [...where, label(key, null, value)]);
      }
    }
  };
  await visit(spec, '', []);
  return { fixes, warnings };
}

/** `checkSpecPinyin`, the fixes only (the write paths: lessons, library lessons, readers, plans). */
export async function fixSpecPinyin(spec: unknown, sources: PinyinReadingSources = {}): Promise<PinyinFix[]> {
  return (await checkSpecPinyin(spec, sources)).fixes;
}

/** Log how often the check fires (counts only — no content in the logs). */
export function logPinyinFixes(what: string, fixes: readonly PinyinFix[]): void {
  if (fixes.length) console.log(`[pinyin-check] ${what}: ${fixes.length} pinyin line(s) corrected`);
}

/** The dictionaries for a worker request / queue job (pinyin-pro alone without the CHAR_DICT binding). */
export function pinyinSources(env: { CHAR_DICT?: Fetcher }): PinyinReadingSources {
  return glossReadingSources(env.CHAR_DICT);
}
