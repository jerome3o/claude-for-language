/**
 * Building the word-tag lexicon (shared/data/word-tags/word-tags.txt) from open data — pure
 * functions, run by `scripts/build-word-tags.ts` and unit-tested in word-tags-build.test.ts.
 * The apps never import this file: they read the built text with `parseWordTagLexicon`
 * (word-tags.ts). Sources and licences: shared/data/word-tags/README.md.
 *
 * - Part of speech: HanLP 1.x CoreNatureDictionary (Apache-2.0; tag counts from an annotated
 *   corpus), jieba dict.txt (MIT) when HanLP lacks the word, and CC-CEDICT "classifier for …" /
 *   "(idiom)" senses. HanLP's `vi` (intransitive verb) is NOT trusted: it marks 喜欢, 叫, 从事,
 *   推进 and 停 intransitive, so it counts as a plain verb; only the curated separable verbs
 *   (which never take an object) say so.
 * - Register, measure words, traditional form: CC-CEDICT (CC BY-SA 4.0) gloss annotations of the
 *   word's main entry, overridden by the curated list (word-tags-curated.ts).
 * - HSK level: complete-hsk-vocabulary (MIT), the HSK 3.0 (2021) levels only.
 */
import { toneNumbersToMarks } from '../import/pinyin';
import type { CedictEntry } from '../chars/build';
import { REGISTER, REGISTER_CODES, SEPARABLE_VERBS } from './word-tags-curated';

export type PosCounts = Array<readonly [tag: string, count: number]>;

/** HanLP `CoreNatureDictionary.txt`: "word<TAB>tag<TAB>count[<TAB>tag<TAB>count…]". */
export function parseHanlpDict(text: string): Map<string, PosCounts> {
  const out = new Map<string, PosCounts>();
  for (const line of text.split('\n')) {
    const p = line.replace(/\r$/, '').split('\t');
    if (p.length < 3 || !p[0]) continue;
    const counts: Array<readonly [string, number]> = [];
    for (let i = 1; i + 1 < p.length; i += 2) {
      const n = Number(p[i + 1]);
      if (p[i] && Number.isFinite(n)) counts.push([p[i], n]);
    }
    if (counts.length) out.set(p[0], counts);
  }
  return out;
}

/** jieba `dict.txt`: "word freq tag" (one tag per word). */
export function parseJiebaDict(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p.length >= 3 && p[0]) out.set(p[0], p[2]);
  }
  return out;
}

/**
 * Our part-of-speech codes (what the built file stores), for one HanLP / jieba / ICTCLAS tag.
 * `vn` (verb used as a noun) counts as both; `ad` / `an` likewise. Morpheme tags (ng, vg, ag…),
 * punctuation and unclassified tags give nothing. Proper-noun tags give 'nr'.
 */
export function posCodesForTag(tag: string): string[] {
  const t = tag.trim();
  if (!t) return [];
  if (t === 'i' || t === 'l' || t === 'j' || t === 'e' || t === 'o' || t === 't' || t === 'f' || t === 's' || t === 'h' || t === 'k') return [t];
  if (/^(nr|ns|nt)/.test(t) || t === 'nz') return ['nr'];
  if (t === 'ng' || t === 'nx' || t === 'Ng') return [];
  if (t.startsWith('n')) return ['n'];
  if (t === 'vn') return ['v', 'n'];
  if (t === 'vg' || t === 'Vg') return [];
  if (t.startsWith('v')) return ['v'];
  if (t === 'ad') return ['a', 'd'];
  if (t === 'an') return ['a', 'n'];
  if (t === 'a' || t === 'al' || t === 'b' || t === 'bl' || t === 'z') return ['a'];
  if (t === 'd' || t === 'dl' || t === 'df') return ['d'];
  if (t === 'm' || t === 'mq') return ['m'];
  if (t === 'q' || t === 'qv' || t === 'qt') return ['q'];
  if (/^ry/.test(t)) return ['ry'];
  if (t === 'r' || t === 'rr' || /^rz/.test(t)) return ['r'];
  if (t === 'p' || t === 'pba' || t === 'pbei') return ['p'];
  if (t === 'c' || t === 'cc') return ['c'];
  if (t === 'y' || /^u/.test(t)) return ['u'];
  return [];
}

/** A second part of speech is shown only when it has at least this share of the first's count. */
export const SECOND_POS_SHARE = 0.2;

/**
 * The word's parts of speech (≤ 2 codes, most frequent first) from tag counts (verb counts pool
 * v / vn / vi …). `allowProper` = false drops proper-noun tags
 * (CC-CEDICT has a common entry for the word, so a name tag is noise: 一路平安 "nz").
 */
export function posFromCounts(counts: PosCounts, allowProper = true): string[] {
  const total = new Map<string, number>();
  for (const [tag, n] of counts) {
    for (const code of posCodesForTag(tag)) {
      if (code === 'nr' && !allowProper) continue;
      total.set(code, (total.get(code) ?? 0) + n);
    }
  }
  const ranked = [...total.entries()].filter(([, n]) => n > 0); // Map keeps first-seen order on ties
  ranked.sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];
  const out: string[] = [];
  const top = ranked[0][1];
  for (const [code, n] of ranked.slice(0, 2)) {
    if (out.length === 1 && n < top * SECOND_POS_SHARE) break;
    out.push(code);
  }
  return out;
}

// ── CC-CEDICT annotations ────────────────────────────────────────────────────

const REGISTER_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcoll\b|\bcolloquial/i, 'C'],
  [/\binformal\b/i, 'I'],
  [/\bslang\b/i, 'S'],
  [/\bvulgar|\boffensive|\btaboo|\bobscene|\bswear|\binsult|\brude\b/i, 'R'],
  [/\bderog|\bpejorative|\bdisparaging/i, 'D'],
  [/\bhumorous|\bjocular|\bfacetious|\bplayful/i, 'H'],
  [/\beuphemis/i, 'E'],
  [/\bpolite|\bcourteous|\bhonorific|\brespectful|\bdeferential|^humble\b/i, 'P'],
  // "old", "written" and "humble" also describe things ("of an old person"): only as the note's first word.
  [/\bformal\b|^written\b/i, 'F'],
  [/\bliterary|\bclassical\b/i, 'L'],
  [/^(old|archaic|dated|obsolete|arch\.)(\W|$)/i, 'O'],
  [/\bdialect/i, 'G'],
  [/\bTw\b|\bTaiwan\b/, 'T'],
  [/\bCantonese\b|\bHK\b/, 'K'],
];

/**
 * Register codes in ONE gloss: every parenthetical note's FIRST register word ("(courteous, as
 * opposed to informal 你)" → polite only), plus "dialectal equivalent of …" → regional.
 * "(lit.)" is "literally" in CC-CEDICT, never "literary".
 */
export function registerInGloss(gloss: string): string[] {
  const out: string[] = [];
  const add = (c: string) => {
    if (!out.includes(c)) out.push(c);
  };
  if (/^dialectal (equivalent|variant)\b/i.test(gloss.trim())) add('G');
  for (const m of gloss.matchAll(/\(([^()]*)\)/g)) {
    const note = m[1].trim();
    // "(lit.)" = literally; "(Taiwan pr. [han4])" = a pronunciation note, not usage.
    // "(informal or geographical term)" hedges between two readings: not a label.
    if (/^lit\.?$/i.test(note) || /\bpr\./.test(note) || /\sor\s/.test(note)) continue;
    let best: { at: number; code: string } | null = null;
    for (const [re, code] of REGISTER_WORDS) {
      const hit = re.exec(note);
      if (hit && (best === null || hit.index < best.at)) best = { at: hit.index, code };
    }
    if (best) add(best.code);
  }
  return out;
}

const isClassifierGloss = (g: string) => /^CL:/.test(g.trim());

/**
 * The entry's register codes: the labels on its FIRST sense only (measure-word lines aside).
 * Later senses are other meanings — 牛's "(slang) awesome", 机场's slang sense, 第's literary
 * senses, 博士's "(old)" ones — and say nothing about the word as a card teaches it.
 */
export function registerFromGlosses(glosses: readonly string[]): string[] {
  const first = glosses.find((g) => !isClassifierGloss(g));
  return first ? registerInGloss(first) : [];
}

export interface MeasureWord {
  char: string;
  pinyin: string;
}

/** "CL:本[ben3],冊|册[ce4]" senses → [{ 本, běn }, { 册, cè }] (simplified form, tone marks). */
export function measuresFromGlosses(glosses: readonly string[]): MeasureWord[] {
  const out: MeasureWord[] = [];
  for (const g of glosses) {
    const t = g.trim();
    if (!isClassifierGloss(t)) continue;
    for (const item of t.slice(3).split(',')) {
      const m = /^\s*(?:[^|[\]]+\|)?([^|[\],\s]+)\[([^\]]+)\]/.exec(item);
      if (!m) continue;
      const pinyin = toneNumbersToMarks(m[2].trim().toLowerCase().replace(/u:/g, 'ü')).replace(/5$/, '');
      if (!out.some((x) => x.char === m[1])) out.push({ char: m[1], pinyin });
    }
  }
  return out;
}

const isProperNoun = (pinyin: string) => /(^|\s)[A-Z]/.test(pinyin);
const SKIPPABLE = /^(surname |variant of|old variant|archaic variant|unofficial variant|erhua variant|Japanese variant|used in |see |abbr\. for)/i;
const onlySkippable = (e: CedictEntry) => e.glosses.filter((g) => !isClassifierGloss(g)).every((g) => SKIPPABLE.test(g.replace(/^\(bound form\)\s*/i, '').trim()));

/**
 * A headword's main CC-CEDICT entry — the word dictionary's rule (shared/chars/build.ts
 * buildWordDict): the first plain entry, else a proper noun, else variants / surnames.
 */
export function mainEntry(entries: readonly CedictEntry[], preferredPinyin?: string | null): CedictEntry | null {
  let best: { e: CedictEntry; score: number } | null = null;
  for (const e of entries) {
    let score = onlySkippable(e) ? 4 : isProperNoun(e.pinyin) ? 2 : 0;
    // A character's most used reading (the character dictionary's first) beats file order: 着 → zhe5, 吗 → ma5.
    if (score === 0 && preferredPinyin && entryPinyin(e) !== preferredPinyin) score = 1;
    if (!best || score < best.score) best = { e, score };
  }
  return best?.e ?? null;
}

/** "zhe5" → "zhe", "ma3" → "mǎ": an entry's pinyin as tone-marked text, lower case, no spaces. */
export function entryPinyin(e: CedictEntry): string {
  return e.pinyin
    .trim()
    .toLowerCase()
    .replace(/u:/g, 'ü')
    .split(/\s+/)
    .map((s) => toneNumbersToMarks(s).replace(/5$/, ''))
    .join('');
}

/** HSK 3.0 level per word from complete-hsk-vocabulary's complete.json ("new-1" … "new-7" = 7–9). */
export function hskLevels(entries: ReadonlyArray<{ simplified: string; level?: readonly string[] }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    for (const l of e.level ?? []) {
      const m = /^new-([1-7])$/.exec(l);
      if (!m) continue;
      const n = Number(m[1]);
      const prev = out.get(e.simplified);
      if (prev === undefined || n < prev) out.set(e.simplified, n);
    }
  }
  return out;
}

export interface WordTagRow {
  hanzi: string;
  pos: string[];
  register: string;
  measures: MeasureWord[];
  hsk: number | null;
  trad: string | null;
  separable: string | null;
}

export interface WordTagInputs {
  /** CC-CEDICT entries grouped by simplified headword. */
  cedict: Map<string, CedictEntry[]>;
  hanlp: Map<string, PosCounts>;
  jieba: Map<string, string>;
  hsk: Map<string, number>;
  /** The words and characters to cover (the word dictionary's headwords, the frequency list…). */
  words: Iterable<string>;
  /** A character's most used reading, tone marks (the character dictionary's first reading). */
  readings?: Map<string, string>;
  /** Words whose traditional form is worth its bytes (common words, HSK words, characters); all when absent. */
  tradWords?: Set<string>;
}

/** Problems with the curated input (unknown codes, non-Han words, duplicates). */
export function curatedProblems(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const han = /^\p{Script=Han}+$/u;
  for (const [w, codes] of REGISTER) {
    if (!han.test(w)) problems.push(`register: "${w}" is not all Han`);
    if (seen.has(`r:${w}`)) problems.push(`register: "${w}" listed twice`);
    seen.add(`r:${w}`);
    for (const c of codes) if (!REGISTER_CODES.includes(c)) problems.push(`register: "${w}" has unknown code ${c}`);
  }
  for (const [w, ex] of SEPARABLE_VERBS) {
    if (!han.test(w)) problems.push(`separable: "${w}" is not all Han`);
    if (seen.has(`s:${w}`)) problems.push(`separable: "${w}" listed twice`);
    seen.add(`s:${w}`);
    // The example must use both halves of the verb (睡觉 → 睡…觉).
    const chars = [...w];
    const first = ex.indexOf(chars[0]);
    if (first < 0 || ex.indexOf(chars[chars.length - 1], first + 1) < 0) problems.push(`separable: example "${ex}" doesn't split "${w}"`);
  }
  return problems;
}

/**
 * A headword's register: the main entry's codes that EVERY other plain reading shares too — a
 * card doesn't say which reading it teaches, so 吗 (ma5 particle; ma2 "(coll.) what?") gets none.
 */
export function entriesRegister(main: CedictEntry, entries: readonly CedictEntry[]): string[] {
  const codes = registerFromGlosses(main.glosses);
  const others = entries.filter((e) => e !== main && !isProperNoun(e.pinyin) && !onlySkippable(e));
  return codes.filter((c) => others.every((e) => registerFromGlosses(e.glosses).includes(c)));
}

/** One headword's row (null when there is nothing to say about it). */
export function wordTagRow(hanzi: string, inputs: Omit<WordTagInputs, 'words'>): WordTagRow | null {
  const entries = inputs.cedict.get(hanzi) ?? [];
  const main = mainEntry(entries, inputs.readings?.get(hanzi));
  const commonEntry = entries.some((e) => !isProperNoun(e.pinyin) && !onlySkippable(e));
  const curated = new Map(REGISTER.map(([w, c]) => [w, c] as const));
  const separable = new Map(SEPARABLE_VERBS.map(([w, ex]) => [w, ex] as const));

  // HanLP first (corpus counts); jieba's single tag when HanLP has nothing usable (一, 行).
  let pos = posFromCounts(inputs.hanlp.get(hanzi) ?? [], !commonEntry);
  if (pos.length === 0 && inputs.jieba.has(hanzi)) pos = posFromCounts([[inputs.jieba.get(hanzi)!, 1]], !commonEntry);
  const glosses = main?.glosses ?? [];
  const isIdiom = glosses.some((g) => /\(idiom\)/i.test(g)) || pos.includes('i');
  if (isIdiom) pos = ['i'];
  else if ([...hanzi].length === 1 && pos[0] !== 'n' && !pos.includes('q') && glosses.some((g) => /^classifier for\b/i.test(g.trim()))) {
    // 本 (HanLP: pronoun only) is first of all the measure word for books; 水's "classifier for washings" is not.
    pos = ['q', ...pos].slice(0, 2);
  }
  if (separable.has(hanzi) && !pos.includes('v')) pos = ['v', ...pos].slice(0, 2);

  // A single character's first CC-CEDICT sense is often an archaic meaning of what is today a
  // morpheme (派 "(literary) tributary", 码 "(archaic) agate"): characters get curated labels only.
  const fromDict = main && [...hanzi].length > 1 ? entriesRegister(main, entries).join('') : '';
  const register = curated.has(hanzi) ? curated.get(hanzi)! : fromDict;
  let measures = main ? measuresFromGlosses(main.glosses) : [];
  if (measures.length === 0 && main) {
    const key = main.pinyin.toLowerCase();
    for (const e of entries) if (e !== main && e.pinyin.toLowerCase() === key) measures = measures.concat(measuresFromGlosses(e.glosses));
  }
  const trad = main && main.trad !== hanzi && (!inputs.tradWords || inputs.tradWords.has(hanzi)) ? main.trad : null;
  const row: WordTagRow = {
    hanzi,
    pos,
    register,
    // A measure word belongs to a noun: 地 (the particle) doesn't show 地's "CL:片".
    measures: pos.length === 0 || pos.some((p) => p === 'n' || p === 'nr') ? measures.slice(0, 3) : [],
    hsk: inputs.hsk.get(hanzi) ?? null,
    trad,
    separable: separable.get(hanzi) ?? null,
  };
  const empty = !row.pos.length && !row.register && !row.measures.length && row.hsk === null && !row.trad && !row.separable;
  return empty ? null : row;
}

/** One line of the built file: "hanzi\tpos\tregister\tmeasures\thsk\ttrad\tseparable", trailing blanks trimmed. */
export function formatWordTagRow(r: WordTagRow): string {
  const cols = [
    r.hanzi,
    r.pos.join(','),
    r.register,
    r.measures.map((m) => `${m.char}:${m.pinyin}`).join(','),
    r.hsk === null ? '' : String(r.hsk),
    r.trad ?? '',
    r.separable ?? '',
  ];
  while (cols.length > 1 && cols[cols.length - 1] === '') cols.pop();
  return cols.join('\t');
}

/** The whole file: header comments, `#words` (sorted by code point), `#markers`. */
export function buildWordTagFile(inputs: WordTagInputs, header: readonly string[]): { text: string; rows: WordTagRow[] } {
  const wanted = new Set<string>(inputs.words);
  for (const [w] of REGISTER) wanted.add(w);
  for (const [w] of SEPARABLE_VERBS) wanted.add(w);
  for (const w of inputs.hsk.keys()) wanted.add(w);
  const rows: WordTagRow[] = [];
  for (const w of [...wanted].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const r = wordTagRow(w, inputs);
    if (r) rows.push(r);
  }
  const markers = REGISTER.filter(([, , m]) => m === 'marker').map(([w, c]) => `${w}\t${c}`);
  markers.push('^请\tP');
  const text = [...header.map((h) => `# ${h}`), '#words', ...rows.map(formatWordTagRow), '#markers', ...markers, ''].join('\n');
  return { text, rows };
}
