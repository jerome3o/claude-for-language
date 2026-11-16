/**
 * Grammar structures as designed "pattern cards" (docs/STUDY_SESSION.md "Structure cards").
 *
 * A mini lesson's `note` may carry `patterns` — each structure as ordered pieces (FIXED words
 * like 除了 / 还 / 起来了 and SLOTS like Noun / Verb), its meaning and examples mapped onto the
 * pieces so both apps colour each part of the example like the piece it fills. Lessons written
 * before that carry the same structures as free text ("① 除了 + 名词／动词短语 +（以外），主语 +
 * 还 + 动词" + an English line + "→ meaning"); `structureNoteView` parses those deterministically
 * into the same cards, matches the note's example sentences to them, and returns null when there
 * is nothing it understands (the note then renders as plain text, as before).
 *
 * Pure; the Lab app's core/…/LessonPatterns.kt is parity-tested against it
 * (android-lab/parity/fixtures/lesson-patterns.ts).
 */
import type { LessonPattern, LessonSentence, NoteExercise, PatternExample, PatternExamplePart, PatternPiece } from './types';

// ---------------------------------------------------------------- characters

/** Han characters (BMP; enough for every structure / example we write). */
export function isHanChar(c: string): boolean {
  const code = c.charCodeAt(0);
  return (code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff);
}

function hasHan(s: string): boolean {
  for (const c of s) if (isHanChar(c)) return true;
  return false;
}

function isLatinLetter(c: string): boolean {
  const code = c.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

const SPACE_CHARS = ' \t 　';
const PUNCT_CHARS = '，,。.！!？?；;：:、…—–-（）()「」“”"\'‘’《》〈〉·～~';

function isSpace(c: string): boolean {
  return SPACE_CHARS.includes(c);
}

function isPunctChar(c: string): boolean {
  return PUNCT_CHARS.includes(c) || isSpace(c);
}

/** Only punctuation / spaces (a "，" piece, the "。" after an example). */
export function isPunctuation(text: string): boolean {
  if (!text) return false;
  for (const c of text) if (!isPunctChar(c)) return false;
  return true;
}

function trimSpaces(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (isSpace(s[a]) || s[a] === '\r')) a++;
  while (b > a && (isSpace(s[b - 1]) || s[b - 1] === '\r')) b--;
  return s.slice(a, b);
}

// ---------------------------------------------------------------- roles / colours

/** How many slot colours there are; slot n gets colour `n % SLOT_TONES`. */
export const SLOT_TONES = 5;

/** A piece's colour role: 'fixed' (all fixed words share one strong colour), 'punct' (plain),
 * or 's0'…'s4' (each slot its own colour, by its order among the slots). */
export type PieceTone = 'fixed' | 'punct' | 's0' | 's1' | 's2' | 's3' | 's4';

export function isSlotPiece(p: PatternPiece): boolean {
  return typeof p.slot === 'string' && p.slot.trim().length > 0;
}

/** The colour role of every piece, in order. */
export function pieceTones(pieces: PatternPiece[]): PieceTone[] {
  let slot = 0;
  return pieces.map((p) => {
    if (isSlotPiece(p)) return `s${slot++ % SLOT_TONES}` as PieceTone;
    return isPunctuation(p.hanzi ?? '') ? 'punct' : 'fixed';
  });
}

// ---------------------------------------------------------------- slot classes

export type SlotClass = 'number' | 'measure' | 'adjective' | 'verb' | 'noun' | 'subject' | 'other';

/** Chinese grammar terms → [English label, class]. */
const ZH_TERMS: Record<string, [string, SlotClass]> = {
  名词: ['Noun', 'noun'], 名词短语: ['Noun phrase', 'noun'], 动词: ['Verb', 'verb'], 动词短语: ['Verb phrase', 'verb'],
  形容词: ['Adjective', 'adjective'], 形容词短语: ['Adjective phrase', 'adjective'], 量词: ['Measure word', 'measure'],
  代词: ['Pronoun', 'noun'], 人称代词: ['Pronoun', 'noun'], 副词: ['Adverb', 'other'], 介词: ['Preposition', 'other'],
  连词: ['Conjunction', 'other'], 助词: ['Particle', 'other'], 方位词: ['Location word', 'other'], 疑问词: ['Question word', 'other'],
  能愿动词: ['Modal verb', 'verb'], 离合词: ['Separable verb', 'verb'], 趋向动词: ['Direction verb', 'verb'],
  主语: ['Subject', 'subject'], 宾语: ['Object', 'noun'], 谓语: ['Predicate', 'verb'], 补语: ['Complement', 'other'],
  结果补语: ['Result complement', 'other'], 趋向补语: ['Direction complement', 'other'], 状语: ['Adverbial', 'other'], 定语: ['Attribute', 'other'],
  数: ['Number', 'number'], 数词: ['Number', 'number'], 数字: ['Number', 'number'], 数量: ['Amount', 'number'], 数量词: ['Amount', 'number'],
  整十数: ['Round number', 'number'], 个位数: ['Single digit', 'number'], 整数: ['Whole number', 'number'],
  时间: ['Time', 'other'], 时间词: ['Time word', 'other'], 时间段: ['Length of time', 'other'], 时段: ['Length of time', 'other'], 时间点: ['Point in time', 'other'],
  地点: ['Place', 'noun'], 地方: ['Place', 'noun'], 处所: ['Place', 'noun'], 人: ['Person', 'noun'], 某人: ['Someone', 'noun'],
  东西: ['Thing', 'noun'], 事情: ['Thing', 'noun'], 事: ['Thing', 'noun'], 结果: ['Result', 'other'], 程度: ['Degree', 'other'], 方向: ['Direction', 'other'],
  句子: ['Clause', 'other'], 小句: ['Clause', 'other'], 分句: ['Clause', 'other'], 原因: ['Reason', 'other'], 目的: ['Purpose', 'other'],
  动作: ['Action', 'verb'], 情况: ['Situation', 'other'], 问题: ['Question', 'other'],
};

/** Latin shorthands (V, Adj, sb…) → [English label, class]. Keys are lower case. */
const LATIN_TERMS: Record<string, [string, SlotClass]> = {
  v: ['Verb', 'verb'], verb: ['Verb', 'verb'], vp: ['Verb phrase', 'verb'], adj: ['Adjective', 'adjective'], adjective: ['Adjective', 'adjective'],
  n: ['Noun', 'noun'], noun: ['Noun', 'noun'], np: ['Noun phrase', 'noun'], o: ['Object', 'noun'], obj: ['Object', 'noun'], object: ['Object', 'noun'],
  s: ['Subject', 'subject'], subj: ['Subject', 'subject'], subject: ['Subject', 'subject'], sb: ['Someone', 'noun'], someone: ['Someone', 'noun'],
  sth: ['Something', 'noun'], something: ['Something', 'noun'], num: ['Number', 'number'], number: ['Number', 'number'],
  m: ['Measure word', 'measure'], mw: ['Measure word', 'measure'], measure: ['Measure word', 'measure'], 'measure word': ['Measure word', 'measure'],
  classifier: ['Measure word', 'measure'], place: ['Place', 'noun'], time: ['Time', 'other'], adv: ['Adverb', 'other'],
};

function englishClass(label: string): SlotClass | null {
  const l = label.toLowerCase();
  if (/\b(number|digit|amount)\b/.test(l)) return 'number';
  if (/\b(measure|classifier)\b/.test(l)) return 'measure';
  if (/\badjective\b|\badj\b/.test(l)) return 'adjective';
  if (/\bverb\b|^v$/.test(l)) return 'verb';
  if (/\bsubject\b/.test(l)) return 'subject';
  if (/\b(noun|object|place|person|someone|something|thing)\b/.test(l)) return 'noun';
  return null;
}

/** What kind of words a slot takes (drives how an example is cut into the slots). */
export function slotClass(p: PatternPiece): SlotClass {
  for (const term of splitAlternatives(p.zh ?? '')) {
    const hit = ZH_TERMS[term];
    if (hit) return hit[1];
  }
  for (const term of splitAlternatives(p.slot ?? '')) {
    const latin = LATIN_TERMS[term.toLowerCase()];
    if (latin) return latin[1];
    const zh = ZH_TERMS[term];
    if (zh) return zh[1];
  }
  return englishClass(p.slot ?? '') ?? 'other';
}

function splitAlternatives(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(/[／/|]/)) {
    const t = trimSpaces(raw);
    if (t) out.push(t);
  }
  return out;
}

const NUMERAL_CHARS = '零〇一二两三四五六七八九十百千万亿几半0123456789';
function isNumeral(c: string): boolean {
  return NUMERAL_CHARS.includes(c);
}

/** Measure words, longest first where one is a prefix of another. */
const MEASURE_WORDS = [
  '公斤', '公里', '个', '位', '本', '张', '只', '条', '件', '块', '岁', '年', '天', '斤', '次', '遍', '杯', '瓶', '碗', '双', '把', '支',
  '辆', '家', '层', '篇', '首', '部', '台', '份', '种', '点', '分', '秒', '毛', '角', '元', '米', '号', '周', '节', '套', '盒', '包',
  '口', '间', '座', '棵', '朵', '封', '顿', '场', '趟', '下', '页', '句', '课', '刻', '升', '克',
];

// ---------------------------------------------------------------- aligning an example

export interface AlignedExample {
  /** The example cut into parts (concatenate to its hanzi); `piece` = the pattern piece filled. */
  parts: PatternExamplePart[];
  /** Every required fixed word was found, in order. */
  matched: boolean;
  /** How well it fits: 2 × fixed characters found + slots whose words look right. */
  score: number;
}

function fixedAlternatives(p: PatternPiece): string[] {
  const text = p.hanzi ?? '';
  if (isPunctuation(text)) {
    const t = trimSpaces(text);
    if (t === '，' || t === ',') return ['，', ','];
    return t ? [t] : [];
  }
  return splitAlternatives(text);
}

/** The earliest occurrence of any alternative at or after `from` (and starting before `before`). */
function findFixed(text: string, alts: string[], from: number, before: number): [number, number] | null {
  let best: [number, number] | null = null;
  for (const a of alts) {
    if (!a) continue;
    const at = text.indexOf(a, from);
    if (at < 0 || at >= before) continue;
    if (!best || at < best[0] || (at === best[0] && a.length > best[1])) best = [at, a.length];
  }
  return best;
}

/** Where a word / break ends a subject before an adjective / verb ("咖啡馆里|热闹", "他最近|胖"). */
const PREDICATE_MARKERS = ['最近', '现在', '已经', '越来越', '里', '的', '很', '都', '也', '就', '还', '又', '更', '太', '真', '了'];
const TOPIC_WORDS = ['天气', '我们', '你们', '他们', '她们', '大家', '天', '我', '你', '他', '她', '它'];
const FINAL_PARTICLES = '吗呢吧啊呀了';

/** After the last punctuation mark. */
function afterLastPunct(s: string): number {
  let i = s.length;
  while (i > 0 && !isPunctChar(s[i - 1])) i--;
  return i;
}

/** Up to the first punctuation mark. */
function beforeFirstPunct(s: string): number {
  let i = 0;
  while (i < s.length && !isPunctChar(s[i])) i++;
  return i;
}

function numeralRunEnd(s: string, from: number, to: number): number {
  let i = from;
  while (i < to && isNumeral(s[i])) i++;
  return i;
}

function numeralRunStart(s: string, from: number, to: number): number {
  let i = to;
  while (i > from && isNumeral(s[i - 1])) i--;
  return i;
}

function measureAt(s: string, at: number, to: number): number {
  for (const m of MEASURE_WORDS) if (at + m.length <= to && s.startsWith(m, at)) return m.length;
  return at < to ? 1 : 0;
}

function measureEndingAt(s: string, from: number, end: number): number {
  for (const m of MEASURE_WORDS) if (end - m.length >= from && s.startsWith(m, end - m.length)) return m.length;
  return end > from ? 1 : 0;
}

/** The predicate at the end of a stretch before a fixed word: cut after the last marker, then a leading topic word. */
function predicateStart(s: string, from: number, end: number): number {
  let start = from;
  for (const m of PREDICATE_MARKERS) {
    const at = s.lastIndexOf(m, end - 1);
    if (at >= from && at + m.length < end && at + m.length > start) start = at + m.length;
  }
  for (const t of TOPIC_WORDS) {
    if (s.startsWith(t, start) && start + t.length < end) {
      start += t.length;
      break;
    }
  }
  return start;
}

function slotFits(cls: SlotClass, text: string): boolean {
  if (!text) return false;
  if (cls === 'number') {
    for (const c of text) if (!isNumeral(c)) return false;
    return true;
  }
  if (cls === 'measure') return MEASURE_WORDS.includes(text);
  return false;
}

type Span = { start: number; end: number; piece: number };

/**
 * Cut an example into the pattern's pieces: the fixed words are found in order (an optional one
 * where it fits), and the stretches between them go to the slots between them — a number slot
 * takes a run of numerals, a measure-word slot one measure word, a slot at the start the predicate
 * before the first fixed word, a slot at the end everything up to the punctuation (less a final
 * 吗 / 了…). Text it can't place stays plain. Deterministic, best effort.
 */
export function alignPatternExample(pieces: PatternPiece[], hanzi: string): AlignedExample {
  const plain: AlignedExample = { parts: hanzi ? [{ text: hanzi }] : [], matched: false, score: 0 };
  const isSlot = pieces.map(isSlotPiece);
  const fixedIdx = pieces.map((_, i) => i).filter((i) => !isSlot[i]);
  const required = fixedIdx.filter((i) => !pieces[i].optional);
  if (!hanzi || required.length === 0) return plain;

  // 1. Required fixed words, in order (earliest occurrence).
  const pos = new Map<number, [number, number]>();
  let from = 0;
  for (const i of required) {
    const hit = findFixed(hanzi, fixedAlternatives(pieces[i]), from, hanzi.length);
    if (!hit) return plain;
    pos.set(i, hit);
    from = hit[0] + hit[1];
  }
  // 2. Optional fixed words: next to a neighbour when no slot is between, else inside the gap.
  for (const i of fixedIdx) {
    if (!pieces[i].optional) continue;
    let prev = -1;
    for (let k = i - 1; k >= 0; k--) if (pos.has(k)) { prev = k; break; }
    let next = -1;
    for (let k = i + 1; k < pieces.length; k++) if (pos.has(k)) { next = k; break; }
    const gapStart = prev >= 0 ? pos.get(prev)![0] + pos.get(prev)![1] : 0;
    const gapEnd = next >= 0 ? pos.get(next)![0] : hanzi.length;
    const slotBefore = isSlot.slice(prev + 1, i).some(Boolean);
    const slotAfter = isSlot.slice(i + 1, next >= 0 ? next : pieces.length).some(Boolean);
    const alts = fixedAlternatives(pieces[i]);
    let hit: [number, number] | null = null;
    if (!slotAfter && next >= 0) {
      for (const a of alts) if (a && gapEnd - a.length >= gapStart && hanzi.startsWith(a, gapEnd - a.length)) { hit = [gapEnd - a.length, a.length]; break; }
    } else if (!slotBefore && prev >= 0) {
      for (const a of alts) if (a && hanzi.startsWith(a, gapStart) && gapStart + a.length <= gapEnd) { hit = [gapStart, a.length]; break; }
    } else {
      hit = findFixed(hanzi, alts, gapStart, gapEnd);
      if (hit && hit[0] + hit[1] > gapEnd) hit = null;
    }
    if (hit) pos.set(i, hit);
  }

  // 3. Slots between the matched fixed words.
  const spans: Span[] = [];
  let score = 0;
  const anchors = [...pos.keys()].sort((a, b) => a - b);
  for (const i of anchors) {
    const [at, len] = pos.get(i)!;
    spans.push({ start: at, end: at + len, piece: i });
    if (!isPunctuation(hanzi.slice(at, at + len))) score += 2 * len;
  }
  const add = (start: number, end: number, piece: number) => {
    if (end <= start) return;
    spans.push({ start, end, piece });
    if (slotFits(slotClass(pieces[piece]), hanzi.slice(start, end))) score += 1;
  };
  const slotsBetween = (a: number, b: number) => {
    const out: number[] = [];
    for (let k = a + 1; k < b; k++) if (isSlot[k]) out.push(k);
    return out;
  };

  // Leading slots (before the first matched fixed word), cut from the right.
  const first = anchors[0];
  {
    const slots = slotsBetween(-1, first);
    let end = pos.get(first)![0];
    const lineStart = afterLastPunct(hanzi.slice(0, end));
    for (let k = slots.length - 1; k >= 0 && end > lineStart; k--) {
      const piece = slots[k];
      const cls = slotClass(pieces[piece]);
      let start: number;
      if (cls === 'number') start = numeralRunStart(hanzi, lineStart, end);
      else if (cls === 'measure') start = end - measureEndingAt(hanzi, lineStart, end);
      else if (k === 0) start = cls === 'adjective' || cls === 'verb' ? predicateStart(hanzi, lineStart, end) : lineStart;
      else break;
      if (start >= end) break;
      add(start, end, piece);
      end = start;
    }
  }
  // Middle slots, cut from the left.
  for (let a = 0; a + 1 < anchors.length; a++) {
    const slots = slotsBetween(anchors[a], anchors[a + 1]);
    let start = pos.get(anchors[a])![0] + pos.get(anchors[a])![1];
    const end = pos.get(anchors[a + 1])![0];
    for (let k = 0; k < slots.length && start < end; k++) {
      const piece = slots[k];
      const cls = slotClass(pieces[piece]);
      const left = slots.length - k;
      let stop: number;
      if (k === slots.length - 1) stop = end;
      else if (cls === 'number') stop = numeralRunEnd(hanzi, start, end);
      else if (cls === 'measure') stop = start + measureAt(hanzi, start, end);
      else if (end - start === left) stop = start + 1;
      else break;
      if (stop <= start) break;
      add(start, stop, piece);
      start = stop;
    }
  }
  // Trailing slots (after the last matched fixed word), cut from the left up to the punctuation.
  const last = anchors[anchors.length - 1];
  {
    const slots = slotsBetween(last, pieces.length);
    let start = pos.get(last)![0] + pos.get(last)![1];
    let end = start + beforeFirstPunct(hanzi.slice(start));
    while (end > start + 1 && FINAL_PARTICLES.includes(hanzi[end - 1])) end--;
    if (end === start + 1 && FINAL_PARTICLES.includes(hanzi[start]) && slots.length > 0) end = start;
    for (let k = 0; k < slots.length && start < end; k++) {
      const piece = slots[k];
      const cls = slotClass(pieces[piece]);
      let stop: number;
      if (k === slots.length - 1) stop = end;
      else if (cls === 'number') stop = numeralRunEnd(hanzi, start, end);
      else if (cls === 'measure') stop = start + measureAt(hanzi, start, end);
      else if (end - start === slots.length - k) stop = start + 1;
      else break;
      if (stop <= start) break;
      add(start, stop, piece);
      start = stop;
    }
  }

  spans.sort((x, y) => x.start - y.start);
  const parts: PatternExamplePart[] = [];
  let at = 0;
  const pushPlain = (text: string) => {
    if (!text) return;
    const prev = parts[parts.length - 1];
    if (prev && prev.piece === undefined) prev.text += text;
    else parts.push({ text });
  };
  for (const s of spans) {
    if (s.start < at) continue; // never overlap (defensive)
    pushPlain(hanzi.slice(at, s.start));
    const text = hanzi.slice(s.start, s.end);
    if (isPunctuation(text)) pushPlain(text);
    else parts.push({ text, piece: s.piece });
    at = s.end;
  }
  pushPlain(hanzi.slice(at));
  return { parts, matched: true, score };
}

/** An author's `parts` when they spell the example exactly and point at real pieces, else null. */
export function validExampleParts(example: PatternExample, pieceCount: number): PatternExamplePart[] | null {
  const parts = example.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  let joined = '';
  for (const p of parts) {
    if (!p || typeof p.text !== 'string') return null;
    if (p.piece !== undefined && p.piece !== null && !(Number.isInteger(p.piece) && p.piece >= 0 && p.piece < pieceCount)) return null;
    joined += p.text;
  }
  return joined === example.hanzi ? parts.map((p) => (typeof p.piece === 'number' ? { text: p.text, piece: p.piece } : { text: p.text })) : null;
}

/** The parts an example is shown with: the author's, else aligned. */
export function examplePartsFor(pattern: LessonPattern, example: PatternExample): PatternExamplePart[] {
  return validExampleParts(example, pattern.pieces.length) ?? alignPatternExample(pattern.pieces, example.hanzi).parts;
}

// ---------------------------------------------------------------- teaching text blocks

export type NoteBlockKind = 'heading' | 'text' | 'wrong' | 'right';
export interface NoteBlock {
  kind: NoteBlockKind;
  text: string;
}

const WRONG_MARKS = ['✗', '✘', '×', '❌'];
const RIGHT_MARKS = ['✓', '✔', '✅'];

function markOf(line: string, marks: string[]): string | null {
  for (const m of marks) if (line.startsWith(m)) return trimSpaces(line.slice(m.length));
  return null;
}

function isHeadingLine(line: string): boolean {
  if (markOf(line, WRONG_MARKS) !== null || markOf(line, RIGHT_MARKS) !== null) return false;
  if (hasHan(line)) {
    if (line.length > 8) return false;
    for (const c of line) if (isPunctChar(c)) return false;
    return true;
  }
  if (line.length > 40) return false;
  const lastChar = line[line.length - 1];
  return !'.:,;'.includes(lastChar);
}

/**
 * Teaching text as blocks: paragraphs (blank-line separated, line breaks kept), a short first
 * line over more lines as a heading ("Usage", "Common mistake"), and "✗ …" / "✓ …" lines as
 * wrong / right rows.
 */
export function noteTextBlocks(text: string | undefined | null): NoteBlock[] {
  const out: NoteBlock[] = [];
  if (!text) return out;
  const paragraphs: string[][] = [];
  let cur: string[] = [];
  for (const raw of text.split('\n')) {
    const line = trimSpaces(raw);
    if (!line) {
      if (cur.length) paragraphs.push(cur);
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) paragraphs.push(cur);
  for (const lines of paragraphs) {
    let start = 0;
    if (lines.length >= 2 && isHeadingLine(lines[0])) {
      out.push({ kind: 'heading', text: lines[0] });
      start = 1;
    }
    let buf: string[] = [];
    const flush = () => {
      if (buf.length) out.push({ kind: 'text', text: buf.join('\n') });
      buf = [];
    };
    for (let i = start; i < lines.length; i++) {
      const wrong = markOf(lines[i], WRONG_MARKS);
      const right = wrong === null ? markOf(lines[i], RIGHT_MARKS) : null;
      if (wrong !== null) { flush(); out.push({ kind: 'wrong', text: wrong }); }
      else if (right !== null) { flush(); out.push({ kind: 'right', text: right }); }
      else buf.push(lines[i]);
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------- parsing free-text structures

const NUMBER_MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const MAX_RAW_PIECE = 14;

/** "① …" → ["①", "…"]; "1. …" / "1) …" / "- …" too. */
function stripNumbering(line: string): [string, string] {
  const t = trimSpaces(line);
  if (t && NUMBER_MARKS.includes(t[0])) return [t[0], trimSpaces(t.slice(1))];
  let i = 0;
  while (i < t.length && t[i] >= '0' && t[i] <= '9') i++;
  if (i > 0 && i < t.length && '.)、'.includes(t[i])) return ['', trimSpaces(t.slice(i + 1))];
  if (t && '-•·*'.includes(t[0]) && t.length > 1 && isSpace(t[1])) return ['', trimSpaces(t.slice(1))];
  return ['', t];
}

function splitPlus(s: string): string[] {
  return s.split(/[+＋]/).map(trimSpaces);
}

type RawToken = { kind: 'text' | 'optional' | 'punct'; text: string };

/** One "+"-separated piece → tokens: （optional）, punctuation, text. */
function tokenizePiece(raw: string): RawToken[] {
  const out: RawToken[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    const t = trimSpaces(buf);
    if (t) out.push({ kind: 'text', text: t });
    buf = '';
  };
  while (i < raw.length) {
    const c = raw[i];
    if (c === '（' || c === '(') {
      const close = raw.indexOf(c === '（' ? '）' : ')', i + 1);
      const alt = raw.indexOf(c === '（' ? ')' : '）', i + 1);
      const end = close >= 0 ? close : alt;
      if (end > i) {
        flush();
        const inner = trimSpaces(raw.slice(i + 1, end));
        if (inner) out.push({ kind: 'optional', text: inner });
        i = end + 1;
        continue;
      }
    }
    if ('，,；;：:'.includes(c)) {
      flush();
      out.push({ kind: 'punct', text: c === ',' ? '，' : c });
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Splits "V不V" / "V了" into Latin and Chinese runs. */
function scriptRuns(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let latin: boolean | null = null;
  for (const c of text) {
    const isL = isLatinLetter(c);
    if (latin !== null && isL !== latin && buf) {
      out.push(buf);
      buf = '';
    }
    latin = isL;
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

function zhTerm(t: string): [string, SlotClass] | null {
  const hit = ZH_TERMS[t];
  if (hit) return hit;
  if (t.length >= 2 && (t.endsWith('词') || t.endsWith('短语'))) return [t, 'other'];
  return null;
}

/** A run of the Chinese pattern line → one piece. */
function pieceFromRun(run: string, optional: boolean): PatternPiece {
  const opt = optional ? { optional: true } : {};
  const alts = splitAlternatives(run);
  if (alts.length > 0 && alts.every((a) => isLatinLetter(a[0]))) {
    const labels = alts.map((a) => LATIN_TERMS[a.toLowerCase()]?.[0] ?? a);
    return { slot: labels.join(' / '), ...opt };
  }
  if (alts.length > 0 && alts.every((a) => zhTerm(a) !== null)) {
    return { slot: alts.map((a) => zhTerm(a)![0]).join(' / '), zh: run, ...opt };
  }
  return { hanzi: run, ...opt };
}

function piecesOfToken(tok: RawToken): PatternPiece[] {
  if (tok.kind === 'punct') return [{ hanzi: tok.text }];
  const optional = tok.kind === 'optional';
  const runs = hasHan(tok.text) || tok.text.includes('／') ? scriptRuns(tok.text) : [tok.text];
  return runs.map((r) => pieceFromRun(r, optional));
}

/** "Round number (tens, hundreds…)" → "Round number". */
function stripRemarks(s: string): string {
  let out = '';
  let depth = 0;
  for (const c of s) {
    if (c === '(' || c === '（') depth++;
    else if (c === ')' || c === '）') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  let t = trimSpaces(out);
  while (t && '，,;；:：'.includes(t[t.length - 1])) t = trimSpaces(t.slice(0, -1));
  return t;
}

/** The Chinese pattern line → pieces (null when it isn't one); the English line, when it lines up, labels them. */
export function parsePatternLine(line: string, englishLine?: string | null): { marker: string; pieces: PatternPiece[] } | null {
  const [marker, rest] = stripNumbering(line);
  if (!hasHan(rest) || !/[+＋]/.test(rest)) return null;
  const last = rest[rest.length - 1];
  if (last === '。' || last === '.') return null;
  const raws = splitPlus(rest);
  if (raws.length < 2 || raws.some((r) => !r || r.length > MAX_RAW_PIECE)) return null;
  const tokens = raws.map((r) => tokenizePiece(r));
  const en = englishLine ? splitPlus(englishLine) : null;
  const enTokens = en && en.length === raws.length ? en.map((r) => tokenizePiece(r)) : null;
  const pieces: PatternPiece[] = [];
  tokens.forEach((toks, r) => {
    const eToks = enTokens?.[r];
    const aligned = eToks && eToks.length === toks.length && eToks.every((e, k) => e.kind === toks[k].kind);
    const meaningful = toks.filter((t) => t.kind !== 'punct');
    toks.forEach((tok, k) => {
      const made = piecesOfToken(tok);
      let english: string | null = null;
      if (aligned) english = eToks![k].kind === 'punct' ? null : stripRemarks(eToks![k].text) || eToks![k].text;
      else if (eToks && meaningful.length === 1 && meaningful[0] === tok) english = stripRemarks(en![r]);
      if (english && made.length === 1) {
        const p = made[0];
        if (isSlotPiece(p)) p.slot = english;
        else if (!isPunctuation(p.hanzi ?? '')) p.english = english;
      }
      pieces.push(...made);
    });
  });
  if (!pieces.some((p) => !isSlotPiece(p) && !isPunctuation(p.hanzi ?? '') && !p.optional)) return null;
  return { marker, pieces };
}

function isEnglishPatternLine(line: string): boolean {
  return !hasHan(line) && /[+＋]/.test(line);
}

function meaningOf(line: string): string | null {
  for (const m of ['→', '⇒', '=>', '->', '=']) if (line.startsWith(m)) return trimSpaces(line.slice(m.length));
  return null;
}

export interface StructureCard {
  pattern: LessonPattern;
  /** The examples with their parts (author's, or aligned). */
  examples: Array<LessonSentence & { parts: PatternExamplePart[] }>;
  /** Teaching text shown under the card (usage, the common mistake…). */
  blocks: NoteBlock[];
}

export interface StructureNoteView {
  /** 'spec' = the note's `patterns`; 'parsed' = read from free-text structure lines. */
  source: 'spec' | 'parsed';
  /** Text before the first structure. */
  intro: NoteBlock[];
  cards: StructureCard[];
  /** Example sentences that belong to no card (shown after the cards). */
  extras: LessonSentence[];
}

/** Free-text structures in a note body → cards (no examples yet); null when there are none. */
export function parseStructureText(body: string): { intro: NoteBlock[]; cards: Array<{ pattern: LessonPattern; blocks: NoteBlock[] }> } | null {
  const lines = body.split('\n');
  const intro: string[] = [];
  const cards: Array<{ pattern: LessonPattern; text: string[] }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = trimSpaces(lines[i]);
    const nextLine = i + 1 < lines.length ? trimSpaces(lines[i + 1]) : '';
    const english = nextLine && isEnglishPatternLine(nextLine) ? nextLine : null;
    const parsed = line ? parsePatternLine(line, english) : null;
    if (!parsed) {
      (cards.length ? cards[cards.length - 1].text : intro).push(lines[i]);
      i++;
      continue;
    }
    const pattern: LessonPattern = { pieces: parsed.pieces };
    if (parsed.marker) pattern.name = parsed.marker;
    i++;
    if (english) i++;
    // The meaning ("→ …") right under it.
    while (i < lines.length && trimSpaces(lines[i])) {
      const m = meaningOf(trimSpaces(lines[i]));
      if (m === null) break;
      if (!pattern.meaning && m) pattern.meaning = m;
      i++;
    }
    cards.push({ pattern, text: [] });
  }
  if (!cards.length) return null;
  return {
    intro: noteTextBlocks(intro.join('\n')),
    cards: cards.map((c) => ({ pattern: c.pattern, blocks: noteTextBlocks(c.text.join('\n')) })),
  };
}

/**
 * The structure cards of a note: its `patterns`, else the structures parsed from its text with
 * the note's example sentences matched to them (in order when there is one per structure, else
 * by best fit; a lone structure takes them all). Null = nothing structured → plain note.
 */
/** A sentence as the views carry it (the web's exercise sentences allow null pinyin / english). */
type LooseSentence = { hanzi: string; pinyin?: string | null; english?: string | null };

function cleanSentence(s: LooseSentence): LessonSentence {
  return { hanzi: s.hanzi, ...(s.pinyin ? { pinyin: s.pinyin } : {}), ...(s.english ? { english: s.english } : {}) };
}

export function structureNoteView(note: {
  body?: string | null;
  sentences?: readonly LooseSentence[] | null;
  patterns?: NoteExercise['patterns'] | null;
}): StructureNoteView | null {
  const sentences = (note.sentences ?? []).filter((s) => s && typeof s.hanzi === 'string' && s.hanzi.trim()).map(cleanSentence);
  const patterns = (note.patterns ?? []).filter((p) => p && Array.isArray(p.pieces) && p.pieces.length > 0);
  if (patterns.length > 0) {
    return {
      source: 'spec',
      intro: noteTextBlocks(note.body),
      cards: patterns.map((p) => ({
        pattern: p,
        examples: (p.examples ?? []).filter((e) => e && typeof e.hanzi === 'string' && e.hanzi.trim()).map((e) => ({
          hanzi: e.hanzi, ...(e.pinyin ? { pinyin: e.pinyin } : {}), ...(e.english ? { english: e.english } : {}), parts: examplePartsFor(p, e),
        })),
        blocks: noteTextBlocks(p.note),
      })),
      extras: sentences,
    };
  }
  if (!note.body) return null;
  const parsed = parseStructureText(note.body);
  if (!parsed) return null;
  const cards: StructureCard[] = parsed.cards.map((c) => ({ pattern: c.pattern, examples: [], blocks: c.blocks }));
  const extras: LessonSentence[] = [];
  const sentence = (s: LessonSentence, parts: PatternExamplePart[]) => ({
    hanzi: s.hanzi, ...(s.pinyin ? { pinyin: s.pinyin } : {}), ...(s.english ? { english: s.english } : {}), parts,
  });
  const aligned = sentences.map((s) => cards.map((c) => alignPatternExample(c.pattern.pieces, s.hanzi)));
  if (cards.length === 1) {
    sentences.forEach((s, i) => cards[0].examples.push(sentence(s, aligned[i][0].parts)));
  } else if (sentences.length === cards.length && aligned.every((row, i) => row[i].matched)) {
    sentences.forEach((s, i) => cards[i].examples.push(sentence(s, aligned[i][i].parts)));
  } else {
    sentences.forEach((s, i) => {
      let best = -1;
      for (let c = 0; c < cards.length; c++) {
        if (!aligned[i][c].matched) continue;
        if (best < 0 || aligned[i][c].score > aligned[i][best].score) best = c;
      }
      if (best >= 0) cards[best].examples.push(sentence(s, aligned[i][best].parts));
      else extras.push(s);
    });
  }
  return { source: 'parsed', intro: parsed.intro, cards, extras };
}

/** The pattern as one line of text (exports, the editor): "除了 + [Noun] + (以外) + ， + [Subject] + 还 + [Verb]". */
export function patternLine(pieces: PatternPiece[]): string {
  return pieces
    .map((p) => {
      const t = isSlotPiece(p) ? `[${trimSpaces(p.slot!)}]` : trimSpaces(p.hanzi ?? '');
      return p.optional ? `(${t})` : t;
    })
    .filter(Boolean)
    .join(' + ');
}

/** A short name for a pattern: its own, else the fixed words with "…" where slots go ("除了…还…"). */
export function patternName(pattern: LessonPattern): string {
  const own = trimSpaces(pattern.name ?? '');
  if (own && !(own.length === 1 && NUMBER_MARKS.includes(own))) return own;
  let out = '';
  let gap = false;
  for (const p of pattern.pieces) {
    if (isSlotPiece(p) || p.optional) {
      gap = true;
      continue;
    }
    const t = trimSpaces(p.hanzi ?? '');
    if (!t || isPunctuation(t)) continue;
    if (gap && out) out += '…';
    else if (gap && !out) out += '…';
    out += t;
    gap = false;
  }
  if (gap && out) out += '…';
  return out;
}

/** The pattern as the editor's one-line text ("除了 + 名词／动词短语 + （以外） + ， + 主语 + 还 + 动词"), which
 * `parsePatternLine` reads back into the same pieces. */
export function patternEditText(pieces: PatternPiece[]): string {
  return pieces
    .map((p) => {
      const t = trimSpaces(isSlotPiece(p) ? (p.zh && trimSpaces(p.zh) ? p.zh : p.slot!) : p.hanzi ?? '');
      return p.optional && t ? `（${t}）` : t;
    })
    .filter(Boolean)
    .join(' + ');
}

/** After the editor re-reads the pattern text: keep each piece's pinyin / gloss / label from before. */
export function mergePieceDetails(next: PatternPiece[], prev: PatternPiece[]): PatternPiece[] {
  const used = new Set<number>();
  return next.map((p) => {
    const at = prev.findIndex((q, k) => {
      if (used.has(k) || isSlotPiece(q) !== isSlotPiece(p)) return false;
      if (!isSlotPiece(p)) return (q.hanzi ?? '') === (p.hanzi ?? '');
      return p.zh ? q.zh === p.zh : (q.slot ?? '') === (p.slot ?? '');
    });
    if (at < 0) return p;
    used.add(at);
    const q = prev[at];
    const out: PatternPiece = { ...p };
    if (isSlotPiece(p)) out.slot = q.slot;
    else {
      if (q.pinyin && !p.pinyin) out.pinyin = q.pinyin;
      if (q.english && !p.english) out.english = q.english;
    }
    return out;
  });
}
