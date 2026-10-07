/**
 * Building the character dictionary from open data — pure functions, run by
 * `scripts/build-char-dict.ts` (and unit-tested on a tiny fixture in build.test.ts):
 *
 * - **CC-CEDICT** (CC BY-SA 4.0): readings per character, the words containing it, their
 *   pinyin (tone numbers → marks) and a short English gloss.
 * - **Make Me a Hanzi** `dictionary.txt` (LGPL-3.0, from Unihan + CJKlib): definition,
 *   radical, decomposition, etymology hint, stroke count (`matches.length`).
 * - **wordfreq** `large_zh` (data CC BY-SA 4.0): word frequency → word order and the
 *   character frequency rank (Σ word frequency × occurrences).
 */
import { isHanCodePoint } from '../progress/known';
import { toneNumbersToMarks } from '../import/pinyin';
import { applyYiBuToneChanges } from '../pinyin/toneChange';
import {
  CHAR_WORDS_PER_CHAR,
  type CharComponent,
  type CharReading,
  type CharRecord,
  type CharWord,
  type WordRecord,
} from './types';

export interface CedictEntry {
  trad: string;
  simp: string;
  /** As written in CC-CEDICT: "yin2 hang2". */
  pinyin: string;
  glosses: string[];
}

export interface HanziEntry {
  char: string;
  definition: string | null;
  pinyin: string[];
  decomposition: string | null;
  radical: string | null;
  etymology: { type?: string; hint?: string; phonetic?: string; semantic?: string } | null;
  strokes: number | null;
}

/** word → relative frequency (any scale; only the order matters). */
export type WordFreq = Map<string, number>;

const CEDICT_LINE = /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/\s*$/;

export function parseCedict(text: string): CedictEntry[] {
  const out: CedictEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = CEDICT_LINE.exec(line.trim());
    if (!m) continue;
    out.push({ trad: m[1], simp: m[2], pinyin: m[3], glosses: m[4].split('/').filter(Boolean) });
  }
  return out;
}

export function parseMakeMeAHanzi(text: string): Map<string, HanziEntry> {
  const out = new Map<string, HanziEntry>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: {
      character?: string; definition?: string; pinyin?: string[]; decomposition?: string;
      radical?: string; etymology?: HanziEntry['etymology']; matches?: unknown[];
    };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row.character) continue;
    out.set(row.character, {
      char: row.character,
      definition: row.definition?.trim() || null,
      pinyin: Array.isArray(row.pinyin) ? row.pinyin : [],
      decomposition: row.decomposition && row.decomposition !== '？' ? row.decomposition : null,
      radical: row.radical || null,
      etymology: row.etymology ?? null,
      strokes: Array.isArray(row.matches) && row.matches.length > 0 ? row.matches.length : null,
    });
  }
  return out;
}

/**
 * wordfreq's cBpack: `[header, bucket0, bucket1, …]` where every word in bucket i has a
 * frequency of 10^(−i/100). Returns word → frequency.
 */
export function parseWordfreq(decoded: unknown): WordFreq {
  const out: WordFreq = new Map();
  if (!Array.isArray(decoded)) throw new Error('wordfreq: expected a list');
  for (let i = 1; i < decoded.length; i++) {
    const bucket = decoded[i];
    if (!Array.isArray(bucket)) continue;
    const freq = Math.pow(10, -(i - 1) / 100);
    for (const w of bucket) {
      if (typeof w === 'string' && !out.has(w)) out.set(w, freq);
    }
  }
  return out;
}

function isAllHan(text: string): boolean {
  if (!text) return false;
  for (const ch of text) if (!isHanCodePoint(ch.codePointAt(0)!)) return false;
  return true;
}

/** "得[de2]" → "得", "無|无[wu2]" → "无": CC-CEDICT's cross-references read as plain hanzi. */
function stripCedictRefs(text: string): string {
  return text
    .replace(/[^\s|[\]()]+\|([^\s[\]()]+)\[[^\]]*\]/g, '$1')
    .replace(/\[[^\]]*\]/g, '');
}

const SKIP_GLOSS = /^(surname |variant of|old variant|archaic variant|unofficial variant|erhua variant|Japanese variant|used in |see |CL:|abbr\. for|\(old\)|\(Tw\)|\(dialect\)|\(Cantonese\))/i;

/** The English to show for an entry: its first one or two real senses, short. */
export function cleanGloss(glosses: readonly string[], max = 60): string {
  const senses: string[] = [];
  for (const raw of glosses) {
    let g = stripCedictRefs(raw).replace(/^\(bound form\)\s*/i, '').replace(/^\(literary\)\s*/i, '').trim();
    // "(of a process etc) to proceed" → "to proceed": a leading usage note, when a sense follows.
    const qualified = /^\([^()]*\)\s+(\S.*)$/.exec(g);
    if (qualified && !SKIP_GLOSS.test(g)) g = qualified[1];
    if (!g || SKIP_GLOSS.test(g)) continue;
    g = g.replace(/\s+/g, ' ');
    if (!senses.includes(g)) senses.push(g);
    if (senses.length === 2) break;
  }
  if (senses.length === 0) {
    // Only skip-worthy senses (e.g. "variant of 瞭"): keep the first, references stripped.
    const first = glosses[0] ? stripCedictRefs(glosses[0]).trim() : '';
    if (first) senses.push(first);
  }
  let out = senses.join('; ');
  if (out.length > max) {
    const cut = senses[0].length <= max ? senses[0] : `${senses[0].slice(0, max - 1).trimEnd()}…`;
    out = cut;
  }
  return out;
}

/** True when every sense of the entry is a variant / surname / cross-reference. */
function onlySkippableSenses(glosses: readonly string[]): boolean {
  return glosses.every((g) => SKIP_GLOSS.test(stripCedictRefs(g).replace(/^\(bound form\)\s*/i, '').trim()));
}

/** Proper nouns in CC-CEDICT have capitalised pinyin ("Bei3 jing1"). */
function isProperNoun(pinyin: string): boolean {
  return /(^|\s)[A-Z]/.test(pinyin);
}

/**
 * CC-CEDICT syllables → one word's pinyin with tone marks: "yin2 hang2" → "yínháng",
 * "Xi1 an1" → "xī'ān", "lu:4" → "lǜ", "dian3 r5" → "diǎnr"; then the 一 / 不 tone changes.
 */
export function cedictWordPinyin(hanzi: string, pinyin: string): string {
  const syllables = pinyin.trim().toLowerCase().replace(/u:/g, 'ü').split(/\s+/).filter(Boolean);
  let out = '';
  for (const s of syllables) {
    if (s === 'r5' || s === 'r') {
      out += 'r';
      continue;
    }
    const marked = toneNumbersToMarks(s).replace(/5$/, '');
    const plain = marked.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (out && /^[aeo]/.test(plain)) out += "'";
    out += marked;
  }
  return applyYiBuToneChanges(hanzi, out);
}

/** One syllable as tone marks ("xing2" → "xíng"). */
function syllableMarks(s: string): string {
  return cedictWordPinyin('', s);
}

export interface BuildInputs {
  cedict: readonly CedictEntry[];
  hanzi: ReadonlyMap<string, HanziEntry>;
  freq: WordFreq;
}

export interface BuildOptions {
  /** Characters ranked up to here are always included (beyond Make Me a Hanzi's set). */
  maxRank?: number;
  wordsPerChar?: number;
}

interface WordCandidate {
  hanzi: string;
  freq: number;
  entry: CedictEntry;
}

/** The first meaning of a Make Me a Hanzi definition, short ("person; people" → "person"). */
function shortDefinition(def: string | null | undefined, max = 40): string | null {
  if (!def) return null;
  const first = def.split(/[;]/)[0].trim();
  if (!first) return null;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

function etymologyLine(e: HanziEntry['etymology']): string | null {
  if (!e) return null;
  if (e.type === 'pictophonetic') {
    const parts: string[] = [];
    if (e.semantic) parts.push(`${e.semantic}${e.hint ? ` (${e.hint})` : ''} gives the meaning`);
    else if (e.hint) parts.push(e.hint);
    if (e.phonetic) parts.push(`${e.phonetic} gives the sound`);
    return parts.length ? parts.join(', ') : null;
  }
  return e.hint?.trim() || null;
}

const IDS_OPERATOR = /[\u2ff0-\u2fff？]/;

/**
 * Every record of the dictionary, sorted by character. A character is included when Make
 * Me a Hanzi knows it (≈ 9,500, every common character) or its frequency rank is within
 * `maxRank`.
 */
export function buildCharDict(inputs: BuildInputs, options: BuildOptions = {}): CharRecord[] {
  const maxRank = options.maxRank ?? 8000;
  const perChar = options.wordsPerChar ?? CHAR_WORDS_PER_CHAR;
  const { cedict, hanzi, freq } = inputs;

  // Character frequency: Σ over wordfreq tokens of frequency × occurrences.
  const charFreq = new Map<string, number>();
  for (const [w, f] of freq) {
    for (const ch of w) {
      if (!isHanCodePoint(ch.codePointAt(0)!)) continue;
      charFreq.set(ch, (charFreq.get(ch) ?? 0) + f);
    }
  }
  const ranked = [...charFreq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const rank = new Map<string, number>();
  ranked.forEach(([ch], i) => rank.set(ch, i + 1));

  // Single-character entries (readings) and the best entry per multi-character word.
  const charEntries = new Map<string, CedictEntry[]>();
  const wordEntry = new Map<string, CedictEntry>();
  for (const e of cedict) {
    const chars = [...e.simp];
    if (!isAllHan(e.simp)) continue;
    if (chars.length === 1) {
      const list = charEntries.get(e.simp);
      if (list) list.push(e);
      else charEntries.set(e.simp, [e]);
      continue;
    }
    if (chars.length > 4 || isProperNoun(e.pinyin) || onlySkippableSenses(e.glosses)) continue;
    if (e.pinyin.trim().split(/\s+/).length !== chars.length) continue;
    if (!wordEntry.has(e.simp)) wordEntry.set(e.simp, e);
  }

  // Words containing each character, most frequent first.
  const wordsByChar = new Map<string, WordCandidate[]>();
  for (const [w, entry] of wordEntry) {
    const f = freq.get(w);
    if (!f) continue;
    const seen = new Set<string>();
    for (const ch of w) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      const list = wordsByChar.get(ch);
      const cand = { hanzi: w, freq: f, entry };
      if (list) list.push(cand);
      else wordsByChar.set(ch, [cand]);
    }
  }
  for (const list of wordsByChar.values()) {
    list.sort((a, b) => b.freq - a.freq || (a.hanzi < b.hanzi ? -1 : a.hanzi > b.hanzi ? 1 : 0));
  }

  const include = new Set<string>();
  for (const ch of hanzi.keys()) if (isHanCodePoint(ch.codePointAt(0)!)) include.add(ch);
  for (const [ch, r] of rank) if (r <= maxRank) include.add(ch);

  const records: CharRecord[] = [];
  for (const ch of [...include].sort()) {
    const h = hanzi.get(ch);
    const allWords = wordsByChar.get(ch) ?? [];

    // Readings: CC-CEDICT's lower-case entries, weighted by the words that use each one.
    const readingWeight = new Map<string, number>();
    for (const cand of allWords) {
      const syl = cand.entry.pinyin.trim().toLowerCase().split(/\s+/);
      [...cand.hanzi].forEach((c, i) => {
        if (c !== ch || !syl[i]) return;
        const key = syl[i].replace(/u:/g, 'ü');
        readingWeight.set(key, (readingWeight.get(key) ?? 0) + cand.freq);
      });
    }
    const readingEntries = (charEntries.get(ch) ?? []).filter((e) => !isProperNoun(e.pinyin));
    const byReading = new Map<string, { english: string; order: number; skippable: boolean }>();
    readingEntries.forEach((e, order) => {
      const key = e.pinyin.trim().toLowerCase().replace(/u:/g, 'ü');
      const prev = byReading.get(key);
      const skippable = onlySkippableSenses(e.glosses);
      if (prev && !(prev.skippable && !skippable)) return;
      byReading.set(key, { english: cleanGloss(e.glosses), order, skippable });
    });
    let readings: CharReading[] = [...byReading.entries()]
      .filter(([, v], _i, all) => !v.skippable || all.every(([, o]) => o.skippable))
      .sort((a, b) => (readingWeight.get(b[0]) ?? 0) - (readingWeight.get(a[0]) ?? 0) || a[1].order - b[1].order)
      .slice(0, 3)
      .map(([key, v]) => ({ pinyin: syllableMarks(key), english: v.english }));
    if (readings.length === 0 && h && h.pinyin.length > 0) {
      readings = h.pinyin.slice(0, 3).map((p) => ({ pinyin: p, english: shortDefinition(h.definition, 60) ?? '' }));
    }

    const meaning = (h?.definition && h.definition.length <= 80 ? h.definition : shortDefinition(h?.definition, 80))
      ?? readings[0]?.english
      ?? '';

    const components: CharComponent[] = [];
    if (h?.decomposition) {
      for (const c of h.decomposition) {
        if (IDS_OPERATOR.test(c) || c === ch || components.some((x) => x.char === c)) continue;
        components.push({ char: c, meaning: shortDefinition(hanzi.get(c)?.definition) });
      }
    }

    const words: CharWord[] = allWords.slice(0, perChar).map((cand) => ({
      hanzi: cand.hanzi,
      pinyin: cedictWordPinyin(cand.hanzi, cand.entry.pinyin),
      english: cleanGloss(cand.entry.glosses),
    }));

    if (!h && readings.length === 0 && words.length === 0) continue;

    records.push({
      char: ch,
      readings,
      meaning,
      radical: h?.radical ?? null,
      radical_meaning: h?.radical && h.radical !== ch ? shortDefinition(hanzi.get(h.radical)?.definition) : null,
      decomposition: h?.decomposition ?? null,
      components,
      etymology: etymologyLine(h?.etymology ?? null),
      strokes: h?.strokes ?? null,
      rank: rank.get(ch) ?? null,
      words,
    });
  }
  return records;
}

// ── The word dictionary (docs/LANGUAGE_EXPLORER.md) ─────────────────────────

export interface WordBuildOptions {
  /** Keep the most frequent this many words (by wordfreq). */
  maxWords?: number;
  /** Longest word kept, in characters. */
  maxLength?: number;
}

/** "yin2 hang2" → ["yín", "háng"] for 银行, 一 / 不 tone changes applied. */
export function cedictSyllables(hanzi: string, pinyin: string): string[] {
  const raw = pinyin.trim().toLowerCase().replace(/u:/g, 'ü').split(/\s+/).filter(Boolean);
  const marked = raw.map((s) => (s === 'r5' ? 'r' : toneNumbersToMarks(s).replace(/5$/, '')));
  return applyYiBuToneChanges(hanzi, marked.join(' ')).split(' ');
}

/** Cleaned senses of an entry (skippable ones dropped), at most `max`. */
export function cleanSenses(glosses: readonly string[], max = 4): string[] {
  const out: string[] = [];
  for (const g of glosses) {
    if (SKIP_GLOSS.test(g.replace(/^\(bound form\)\s*/i, '').trim())) continue;
    const s = cleanGloss([g], 90);
    if (!s || out.includes(s) || SKIP_GLOSS.test(s)) continue;
    out.push(s);
    if (out.length === max) break;
  }
  return out;
}

/**
 * The word records: every all-Han CC-CEDICT word of 2..maxLength characters that wordfreq
 * has seen, the `maxWords` most frequent. Per word the first entry that isn't a proper noun
 * or only variants / surnames wins (a proper noun — 中国, 北京 — when it is all there is).
 * `rank` follows the shipped word-freq list's ranking (all-Han tokens, frequency then text).
 */
export function buildWordDict(inputs: Pick<BuildInputs, 'cedict' | 'freq'>, options: WordBuildOptions = {}): WordRecord[] {
  const maxWords = options.maxWords ?? 60_000;
  const maxLength = options.maxLength ?? 6;
  const { cedict, freq } = inputs;

  const ranked = [...freq.entries()].filter(([w]) => isAllHan(w)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const rank = new Map<string, number>();
  ranked.forEach(([w], i) => rank.set(w, i + 1));

  const best = new Map<string, { entry: CedictEntry; score: number }>();
  for (const e of cedict) {
    const n = [...e.simp].length;
    if (n < 2 || n > maxLength || !isAllHan(e.simp) || !freq.has(e.simp)) continue;
    if (e.pinyin.trim().split(/\s+/).length !== n) continue;
    // 0 = a plain entry, 1 = proper noun, 2 = only variants / surnames.
    const score = onlySkippableSenses(e.glosses) ? 2 : isProperNoun(e.pinyin) ? 1 : 0;
    const prev = best.get(e.simp);
    if (!prev || score < prev.score) best.set(e.simp, { entry: e, score });
  }

  const words = [...best.keys()].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || (a < b ? -1 : 1)).slice(0, maxWords);
  return words.map((hanzi) => {
    const { entry } = best.get(hanzi)!;
    const syllables = cedictSyllables(hanzi, entry.pinyin);
    return {
      hanzi,
      pinyin: cedictWordPinyin(hanzi, entry.pinyin),
      syllables,
      english: cleanGloss(entry.glosses),
      senses: cleanSenses(entry.glosses),
      rank: rank.get(hanzi) ?? null,
    };
  });
}
