/**
 * Deterministic Chinese word segmentation (docs/LANGUAGE_EXPLORER.md "Word chips without an
 * LLM"): Chinese text → word segments that concatenate back to the text exactly (the reader
 * words invariant, shared/reader/words.ts), made on the device in well under a millisecond per
 * message, with no network and no model.
 *
 * The algorithm is jieba's, on the word lists both apps already ship:
 *  1. **Dictionary** — `word-freq.txt` (wordfreq large_zh: the 30,000 most frequent all-Han
 *     tokens, rank = line) plus `segment-words.txt` (the word dictionary's other CC-CEDICT
 *     headwords with their wordfreq rank, `scripts/build-segment-words.ts`). A word's cost is
 *     its negative log-probability under Zipf's law: `WORD_COST_BASE + 1000 · ln(rank)`, in
 *     integer milli-nats so sums are exact and both apps break ties the same way.
 *  2. **DAG** — every dictionary word that starts at each character of a run of Han characters
 *     (up to the longest word), plus a few modest rules (`ruleCandidates`): numbers with a
 *     measure word (三本, 第一次, 十二月), reduplication (看看, 高高兴兴), A一A / A不A
 *     (看一看, 去不去), and a word + 儿 (聊天儿). Every single character is always a
 *     candidate (unknown ones expensive).
 *  3. **DP** — from the end of the run back, the path with the smallest total cost (= the most
 *     probable sentence); equal costs prefer the longer word.
 * Everything that isn't Han — punctuation, Latin letters and digits, spaces, line breaks — is
 * its own segment, grouped exactly like `fallbackReaderWords`, and never a chip.
 *
 * ICU / `Intl.Segmenter` was considered and rejected: its dictionary differs between Node
 * (CI), browsers and Android versions, so the web and Lab apps would drift apart; this one is
 * ported line for line to `android-lab/core/…/chinese/Segmenter.kt` and parity-tested over a
 * corpus of real Ask Claude replies, chat lines and reader pages
 * (`android-lab/parity/fixtures/segment.ts`).
 */
import { isHanCodePoint } from '../progress/known';
import type { ReaderWord } from '../reader/words';

/** The cost every word pays (≈ −ln p of the most frequent word, 的, in wordfreq zh). */
export const WORD_COST_BASE = 3300;
/**
 * Extra cost of a list word that is not a dictionary headword: wordfreq's tokens come from
 * jieba and include glued pairs (这是, 我要, 是因为) that would make poor chips.
 */
export const COMPOUND_EXTRA = 3500;
/** Rank given to a Han character that is in neither list. */
export const UNKNOWN_CHAR_RANK = 100_000;
/** Rank given to a number (+ measure word) the rules put together. */
export const NUMBER_RANK = 1_000;
/** Extra cost of a reduplication (AA, AABB) over its base word. */
export const REDUP_EXTRA = 700;
/** Extra cost of A一A / A不A over A. */
export const A_YI_A_EXTRA = 1_500;
/** Extra cost of a dictionary word + 儿 (聊天儿, 玩儿) over the word. */
export const ERHUA_EXTRA = 3_000;
/** Longest word looked up (in characters). */
export const MAX_WORD_LENGTH = 8;

/** Numerals the number rule joins (〇 is not a Han code point here, so it is left out). */
export const NUMERALS = '零一二两三四五六七八九十百千万亿';
/** Measure words (and 号 / 月 for dates) a number takes with it: 三本, 两次, 十二月. */
export const MEASURE_WORDS = '个本只次天年岁块张位件条点种杯瓶碗双家辆篇句遍月号元斤米层节支首份部门封间座把台场顿趟周课';
/** Characters never doubled into one word by the AA / A一A / A不A rules. */
export const REDUP_STOP = '的了是不一在和吗呢吧啊也就都我你他她它很这那有';

export interface SegmentDictionary {
  /** word (≥ 1 character) → cost in milli-nats. */
  costs: ReadonlyMap<string, number>;
  /** Longest word in `costs`, in code points (≤ MAX_WORD_LENGTH). */
  maxLength: number;
}

/** A word's cost from its frequency rank (1 = most frequent). */
export function rankCost(rank: number): number {
  return WORD_COST_BASE + Math.round(1000 * Math.log(Math.max(1, rank)));
}

const UNKNOWN_CHAR_COST = rankCost(UNKNOWN_CHAR_RANK);
const NUMBER_COST = rankCost(NUMBER_RANK);

function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export interface SegmentWords {
  /** Dictionary words not in the word-freq list → their wordfreq rank. */
  ranked: Map<string, number>;
  /** Words of the word-freq list that are not dictionary headwords (jieba tokens). */
  compounds: Set<string>;
}

/**
 * `segment-words.txt` (format in `buildSegmentWords`). After `#ranked` each line is
 * `word<TAB>step`: the words in rank order, each rank written as the step from the previous
 * word's rank (the first from 0), which keeps the file small. After `#compounds`, one word
 * per line.
 */
export function parseSegmentWords(text: string): SegmentWords {
  const ranked = new Map<string, number>();
  const compounds = new Set<string>();
  let section = '';
  let rank = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '#ranked' || line === '#compounds') {
      section = line;
      continue;
    }
    if (line === '' || line.startsWith('#')) continue;
    if (section === '#compounds') {
      compounds.add(line);
      continue;
    }
    if (section !== '#ranked') continue;
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const step = Number(line.slice(tab + 1));
    if (!Number.isInteger(step) || step < 0) continue;
    rank += step;
    const word = line.slice(0, tab);
    if (rank >= 1 && !ranked.has(word)) ranked.set(word, rank);
  }
  return { ranked, compounds };
}

/**
 * The segmenter's dictionary: the word-freq list's words (rank = line; + COMPOUND_EXTRA for
 * the jieba compounds) and the extra dictionary words (their wordfreq rank).
 */
export function buildSegmentDictionary(
  listed: ReadonlyMap<string, number>,
  extra: SegmentWords = { ranked: new Map(), compounds: new Set() },
): SegmentDictionary {
  const costs = new Map<string, number>();
  let maxLength = 1;
  const add = (word: string, cost: number) => {
    if (costs.has(word)) return;
    const len = codePointLength(word);
    if (len < 1 || len > MAX_WORD_LENGTH) return;
    costs.set(word, cost);
    if (len > maxLength) maxLength = len;
  };
  for (const [w, r] of listed) add(w, rankCost(r) + (extra.compounds.has(w) ? COMPOUND_EXTRA : 0));
  for (const [w, r] of extra.ranked) add(w, rankCost(r));
  return { costs, maxLength };
}

function isAllHan(w: string): boolean {
  for (const ch of w) if (!isHanCodePoint(ch.codePointAt(0)!)) return false;
  return w.length > 0;
}

/**
 * The file `scripts/build-segment-words.ts` writes, from the word dictionary's headwords
 * (→ wordfreq rank) and the word-freq list:
 *   #ranked     headwords (2–8 Han characters) not in the list, by rank, as rank steps
 *   #compounds  list words (2+ characters) that are not headwords, in list order
 */
export function buildSegmentWords(
  headwords: ReadonlyMap<string, number>,
  listed: ReadonlyMap<string, number>,
  header: string[] = [],
): string {
  const rows = [...headwords.entries()].filter(([w, r]) => {
    if (listed.has(w) || !Number.isInteger(r) || r < 1) return false;
    const len = codePointLength(w);
    return len >= 2 && len <= MAX_WORD_LENGTH && isAllHan(w);
  });
  rows.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let prev = 0;
  const lines = rows.map(([w, r]) => {
    const line = `${w}\t${r - prev}`;
    prev = r;
    return line;
  });
  const compounds = [...listed.entries()]
    .filter(([w]) => codePointLength(w) >= 2 && !headwords.has(w))
    .sort((a, b) => a[1] - b[1])
    .map(([w]) => w);
  return [...header.map((l) => `# ${l}`), '#ranked', ...lines, '#compounds', ...compounds, ''].join('\n');
}


function singleCost(ch: string, dict: SegmentDictionary): number {
  return dict.costs.get(ch) ?? UNKNOWN_CHAR_COST;
}

/**
 * The rules' extra DAG edges from position `i` of a Han run: [length, cost] pairs.
 * Numbers (optional 第 + numerals + optional measure word, at least two characters),
 * AA / AABB reduplication and A一A / A不A.
 */
export function ruleCandidates(chars: readonly string[], i: number, dict: SegmentDictionary): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = chars.length;
  // Numbers.
  let j = i;
  if (chars[j] === '第') j++;
  const numStart = j;
  while (j < n && j - numStart < MAX_WORD_LENGTH && NUMERALS.includes(chars[j])) j++;
  if (j > numStart) {
    if (j - i >= 2) out.push([j - i, NUMBER_COST]);
    if (j < n && MEASURE_WORDS.includes(chars[j])) out.push([j + 1 - i, NUMBER_COST]);
  }
  const a = chars[i];
  if (!REDUP_STOP.includes(a)) {
    // AABB: 高高兴兴 (AB is a word).
    if (i + 3 < n && chars[i + 1] === a && chars[i + 2] === chars[i + 3] && chars[i + 2] !== a) {
      const ab = dict.costs.get(a + chars[i + 2]);
      if (ab !== undefined) out.push([4, ab + REDUP_EXTRA]);
    }
    // AA: 看看, 天天.
    if (i + 1 < n && chars[i + 1] === a) out.push([2, singleCost(a, dict) + REDUP_EXTRA]);
    // A一A, A不A: 看一看, 去不去 — not inside a repeated pair (不用不用 is 不用|不用).
    const mid = chars[i + 1];
    if (i + 2 < n && chars[i + 2] === a && (mid === '一' || mid === '不') && !(i > 0 && chars[i - 1] === mid)) {
      out.push([3, singleCost(a, dict) + A_YI_A_EXTRA]);
    }
  }
  return out;
}

/**
 * One run of Han characters → its words (the DP over the DAG). The run's characters joined
 * back are the run exactly.
 */
export function segmentHanRun(run: string, dict: SegmentDictionary): string[] {
  const chars = Array.from(run);
  const n = chars.length;
  if (n === 0) return [];
  const best = new Array<number>(n + 1).fill(0);
  const step = new Array<number>(n + 1).fill(1);
  for (let i = n - 1; i >= 0; i--) {
    // Rules can reach past the longest dictionary word (第 + numerals + a measure word).
    const maxLen = Math.min(MAX_WORD_LENGTH + 2, n - i);
    const lookup = Math.min(dict.maxLength, maxLen);
    // Cost of the edge of each length from i (dictionary or rule, the cheaper).
    const edge = new Array<number>(maxLen + 1).fill(Infinity);
    let w = '';
    for (let len = 1; len <= lookup; len++) {
      w += chars[i + len - 1];
      const c = dict.costs.get(w);
      if (c !== undefined) edge[len] = c;
    }
    // Erhua: a dictionary word + 儿 (longest first, so 儿 never chains).
    for (let len = lookup; len >= 1; len--) {
      if (edge[len] !== Infinity && len + 1 <= maxLen && chars[i + len] === '儿') {
        edge[len + 1] = Math.min(edge[len + 1], edge[len] + ERHUA_EXTRA);
      }
    }
    if (edge[1] === Infinity) edge[1] = UNKNOWN_CHAR_COST;
    for (const [len, c] of ruleCandidates(chars, i, dict)) {
      if (len <= maxLen && c < edge[len]) edge[len] = c;
    }
    let bestCost = Infinity;
    let bestLen = 1;
    for (let len = maxLen; len >= 1; len--) {
      if (edge[len] === Infinity) continue;
      const total = edge[len] + best[i + len];
      if (total < bestCost) {
        bestCost = total;
        bestLen = len;
      }
    }
    best[i] = bestCost;
    step[i] = bestLen;
  }
  const out: string[] = [];
  for (let i = 0; i < n; i += step[i]) out.push(chars.slice(i, i + step[i]).join(''));
  return out;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** JS `\s`, spelled out so the Kotlin port matches it exactly. */
export function isSpaceChar(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

type Kind = 'han' | 'latin' | 'punct' | 'space';

function kindOf(ch: string): Kind {
  if (isHanCodePoint(ch.codePointAt(0)!)) return 'han';
  if (isSpaceChar(ch)) return 'space';
  return LETTER_OR_DIGIT.test(ch) ? 'latin' : 'punct';
}

/** The text split into runs of one kind (Han, Latin letters / digits, punctuation, spaces). */
export function textRuns(text: string): Array<{ kind: Kind; text: string }> {
  const out: Array<{ kind: Kind; text: string }> = [];
  for (const ch of text) {
    const kind = kindOf(ch);
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += ch;
    else out.push({ kind, text: ch });
  }
  return out;
}

export interface SegmentOptions {
  /**
   * Pinyin of a run of Han characters, one syllable per character separated by spaces (the
   * app's auto-pinyin: pinyin-pro + the 一 / 不 tone changes). Each word gets its syllables
   * joined ("wǒmen"). Omitted = every segment's pinyin is ''.
   */
  pinyinOf?: (hanRun: string) => string;
}

/**
 * Text → word segments (`ReaderWord`s: text, pinyin, gloss '') that concatenate to the text
 * exactly. Han runs are segmented with the dictionary; everything else keeps its runs.
 */
export function segmentChinese(text: string, dict: SegmentDictionary, options: SegmentOptions = {}): ReaderWord[] {
  const out: ReaderWord[] = [];
  for (const run of textRuns(text)) {
    if (run.kind !== 'han') {
      out.push({ text: run.text, pinyin: '', gloss: '' });
      continue;
    }
    const words = segmentHanRun(run.text, dict);
    const syllables = runSyllables(run.text, options.pinyinOf);
    let at = 0;
    for (const w of words) {
      const len = codePointLength(w);
      out.push({ text: w, pinyin: syllables ? syllables.slice(at, at + len).join('') : '', gloss: '' });
      at += len;
    }
  }
  return out;
}

function runSyllables(run: string, pinyinOf: SegmentOptions['pinyinOf']): string[] | null {
  if (!pinyinOf) return null;
  let raw = '';
  try {
    raw = pinyinOf(run);
  } catch {
    return null;
  }
  const syllables = raw.trim().split(/\s+/).filter(Boolean);
  return syllables.length === codePointLength(run) ? syllables : null;
}

/** Just the segment texts (tests, parity). */
export function segmentTexts(text: string, dict: SegmentDictionary): string[] {
  return segmentChinese(text, dict).map((w) => w.text);
}
