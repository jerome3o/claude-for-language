/**
 * Parse a pasted word list — from a spreadsheet, a Word table, a WeChat
 * message, a hand-typed list — into rows of hanzi / pinyin / English (+ an
 * optional example sentence and notes). Zero-config by default: separators
 * and column roles are detected; the caller can override the separators.
 *
 * Detection, in order:
 *   rows     newline; a single line splits on ; / ；
 *   columns  tab → | → , / ， → ： : — – " - " → whitespace with a script-boundary split
 *   roles    per cell by script: Han → hanzi (second Han cell → sentence),
 *            Latin that segments into pinyin syllables → pinyin, other Latin →
 *            English (a second one → notes). With a consistent number of cells
 *            the roles are voted per column so a spreadsheet paste stays aligned.
 */
import { hasToneInfo, normalizePinyin, pinyinSyllableCount } from './pinyin';

export type ColumnSeparator = 'auto' | 'tab' | 'comma' | 'pipe' | 'colon' | 'space' | 'custom';
export type RowSeparator = 'auto' | 'newline' | 'semicolon';
export type CellRole = 'hanzi' | 'pinyin' | 'english' | 'sentence' | 'notes' | 'ignore';
export type RowProblem = 'no_chinese' | 'duplicate_in_paste';

export interface ParseOptions {
  columnSeparator?: ColumnSeparator;
  customSeparator?: string;
  rowSeparator?: RowSeparator;
}

export interface ParsedRow {
  /** 0-based index in the paste (after header removal). */
  index: number;
  raw: string;
  hanzi: string;
  pinyin: string;
  english: string;
  sentence: string;
  notes: string;
  /** Pinyin / translation for `sentence` when something supplied them (Claude, pinyin-pro); optional. */
  sentencePinyin?: string;
  sentenceTranslation?: string;
  problems: RowProblem[];
}

export interface ParseResult {
  rows: ParsedRow[];
  detected: {
    columnSeparator: Exclude<ColumnSeparator, 'auto'>;
    rowSeparator: Exclude<RowSeparator, 'auto'>;
    /** Column roles when the paste had a consistent column layout, else []. */
    columns: CellRole[];
    headerDropped: boolean;
  };
}

const HAN = /\p{Script=Han}/u;
const HAN_RUN = /[\p{Script=Han}〇々]+/gu;
const BULLET = /^\s*(?:[-•*·▪◦]|\d{1,3}[.、)）:]|\(\d{1,3}\)|[①-⑳])\s*/u;
const HEADER_WORDS = /^(hanzi|han\s?zi|chinese|characters?|simplified|traditional|汉字|漢字|中文|词语|生词|单词|词|word|words|term|pinyin|拼音|english|meaning|definition|translation|意思|英文|英语|释义|sentence|example|例句|例子|notes?|备注|笔记|fun\s?facts?)$/i;

export function normalizeHanzi(text: string): string {
  return text.normalize('NFC').replace(/[\s​-‍﻿]/g, '').replace(/[。，、！？：；“”‘’（）()\[\]【】《》.,!?;:'"-]/g, '');
}

function clean(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hanShare(text: string): number {
  const letters = text.replace(/[\s\d\p{P}]/gu, '');
  if (!letters) return 0;
  const han = (letters.match(/\p{Script=Han}/gu) || []).length;
  return han / letters.length;
}

/** Classify one cell by its script. `hanziLength` lets toneless pinyin be recognised by syllable count. */
export function classifyCell(cell: string, hanziLength?: number): CellRole {
  const text = clean(cell);
  if (!text) return 'ignore';
  const share = hanShare(text);
  if (share >= 0.5) return 'hanzi';
  if (share > 0) return 'english'; // mixed, e.g. "hello (你好)" — keep as meaning
  const syllables = pinyinSyllableCount(text);
  if (syllables !== null) {
    if (hasToneInfo(text)) return 'pinyin';
    if (hanziLength !== undefined && syllables === hanziLength && hanziLength > 0) return 'pinyin';
  }
  return 'english';
}

function detectRowSeparator(text: string, wanted: RowSeparator): Exclude<RowSeparator, 'auto'> {
  if (wanted !== 'auto') return wanted;
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length <= 1 && /[;；]/.test(text)) return 'semicolon';
  return 'newline';
}

function splitRows(text: string, sep: Exclude<RowSeparator, 'auto'>): string[] {
  const parts = sep === 'semicolon' ? text.split(/[;；]/) : text.split(/\r?\n/);
  return parts.map(p => p.replace(BULLET, '').trim()).filter(Boolean);
}

function countIn(lines: string[], re: RegExp): number {
  return lines.filter(l => re.test(l)).length;
}

function detectColumnSeparator(lines: string[], wanted: ColumnSeparator): Exclude<ColumnSeparator, 'auto'> {
  if (wanted !== 'auto') return wanted;
  const n = lines.length || 1;
  if (countIn(lines, /\t/) / n >= 0.5) return 'tab';
  if (countIn(lines, /\|/) / n >= 0.5) return 'pipe';
  if (countIn(lines, /[,，]/) / n >= 0.6) return 'comma';
  if (countIn(lines, /\s[-—–]\s|[：]|(?<=\p{Script=Han})\s*:\s*/u) / n >= 0.6) return 'colon';
  return 'space';
}

function splitCells(line: string, sep: Exclude<ColumnSeparator, 'auto'>, custom: string): string[] {
  switch (sep) {
    case 'tab':
      return line.split('\t');
    case 'pipe':
      return line.split('|');
    case 'comma':
      return line.split(/[,，]/);
    case 'colon':
      return line.split(/\s[-—–]\s|[：]|(?<=\p{Script=Han})\s*:\s*|(?<=\S)\s*:\s+/u);
    case 'custom':
      return custom ? line.split(custom) : [line];
    case 'space':
      return scriptSplit(line);
  }
}

/**
 * "苹果 píngguǒ apple", "苹果(píng guǒ) apple", "苹果 apple 我吃苹果。" — no real
 * separator, so cut at script boundaries: the first Han run is the word, the
 * pinyin-looking Latin tokens that follow are pinyin (as many as the word has
 * characters), the rest of the Latin is English, a later Han run is a sentence.
 */
function scriptSplit(line: string): string[] {
  const text = clean(line).replace(/[()（）\[\]【】]/g, ' ');
  const hanRuns: string[] = text.match(HAN_RUN) || [];
  const word = hanRuns[0];
  if (!word) return [text];
  const rest = text.replace(word, ' ').trim();
  const sentence = hanRuns.slice(1).filter(r => r.length > 1);
  let latin = rest;
  for (const s of hanRuns.slice(1)) latin = latin.replace(s, ' ');
  latin = latin.replace(/[。，！？：；]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = latin ? latin.split(' ') : [];
  const pinyinTokens: string[] = [];
  let syllables = 0;
  let i = 0;
  while (i < tokens.length && syllables < word.length) {
    const t = tokens[i] ?? '';
    const count = pinyinSyllableCount(t);
    if (count === null) break;
    if (!hasToneInfo(t) && syllables + count > word.length) break;
    pinyinTokens.push(t);
    syllables += count;
    i++;
  }
  // Toneless tokens that only pass because "ma" or "an" happen to be syllables
  // are English when they do not add up to the whole word.
  const pinyinOk = pinyinTokens.length > 0 && (pinyinTokens.some(hasToneInfo) || syllables === word.length);
  const pinyin = pinyinOk ? pinyinTokens.join(' ') : '';
  const english = (pinyinOk ? tokens.slice(i) : tokens).join(' ');
  const cells: string[] = [word, pinyin, english];
  if (sentence.length) cells.push(sentence.join(''));
  return cells;
}

function isHeader(cells: string[]): boolean {
  const named = cells.map(clean).filter(Boolean);
  if (named.length === 0) return false;
  const matches = named.filter(c => HEADER_WORDS.test(c)).length;
  return matches >= Math.max(1, Math.ceil(named.length * 0.6)) && !named.some(c => HAN.test(c) && !HEADER_WORDS.test(c));
}

/** Vote a role per column index over all rows with the modal cell count. */
function voteColumns(rowsCells: string[][]): CellRole[] {
  const counts = new Map<number, number>();
  for (const cells of rowsCells) counts.set(cells.length, (counts.get(cells.length) || 0) + 1);
  let width = 0;
  let best = 0;
  for (const [w, c] of counts) if (c > best || (c === best && w > width)) { width = w; best = c; }
  if (width < 2 || best < Math.max(1, rowsCells.length * 0.5)) return [];
  const aligned = rowsCells.filter(c => c.length === width);
  const votes: Map<CellRole, number>[] = Array.from({ length: width }, () => new Map());
  for (const cells of aligned) {
    const hanIdx = cells.findIndex(c => classifyCell(c) === 'hanzi');
    const hanziLength = hanIdx >= 0 ? normalizeHanzi(cells[hanIdx]).length : undefined;
    cells.forEach((cell, i) => {
      const role = classifyCell(cell, hanziLength);
      if (role === 'ignore') return;
      votes[i].set(role, (votes[i].get(role) || 0) + 1);
    });
  }
  const roles: CellRole[] = votes.map(v => {
    let role: CellRole = 'ignore';
    let n = 0;
    for (const [r, c] of v) if (c > n) { role = r; n = c; }
    return role;
  });
  // Uniqueness: one hanzi (later Han columns are sentences), one pinyin, one
  // English (later ones are notes).
  const seen = new Set<CellRole>();
  return roles.map(r => {
    if (r === 'ignore') return r;
    if (seen.has(r)) {
      if (r === 'hanzi') return seen.has('sentence') ? 'notes' : (seen.add('sentence'), 'sentence');
      if (r === 'english' || r === 'pinyin') return seen.has('notes') ? 'ignore' : (seen.add('notes'), 'notes');
      return 'ignore';
    }
    seen.add(r);
    return r;
  });
}

function assignByScript(cells: string[]): Record<CellRole, string> {
  const out: Record<CellRole, string> = { hanzi: '', pinyin: '', english: '', sentence: '', notes: '', ignore: '' };
  const cleaned = cells.map(clean).filter(Boolean);
  const hanIdx = cleaned.findIndex(c => classifyCell(c) === 'hanzi');
  const hanziLength = hanIdx >= 0 ? normalizeHanzi(cleaned[hanIdx]).length : undefined;
  for (const cell of cleaned) {
    let role = classifyCell(cell, hanziLength);
    if (role === 'hanzi' && out.hanzi) role = out.sentence ? 'notes' : 'sentence';
    if (role === 'pinyin' && out.pinyin) role = 'english';
    if (role === 'english' && out.english) role = out.notes ? 'notes' : 'notes';
    if (role === 'ignore') continue;
    out[role] = out[role] ? `${out[role]} ${cell}` : cell;
  }
  return out;
}

function finishRow(index: number, raw: string, fields: Record<CellRole, string>): ParsedRow {
  const problems: RowProblem[] = [];
  const hanzi = clean(fields.hanzi);
  if (!hanzi || !HAN.test(hanzi)) problems.push('no_chinese');
  return {
    index,
    raw,
    hanzi,
    pinyin: normalizePinyin(fields.pinyin),
    english: clean(fields.english),
    sentence: clean(fields.sentence),
    notes: clean(fields.notes),
    problems,
  };
}

export function parseWordList(text: string, options: ParseOptions = {}): ParseResult {
  const rowSeparator = detectRowSeparator(text, options.rowSeparator ?? 'auto');
  let lines = splitRows(text, rowSeparator);
  const columnSeparator = detectColumnSeparator(lines, options.columnSeparator ?? 'auto');
  const custom = options.customSeparator ?? '';
  let rowsCells = lines.map(l => splitCells(l, columnSeparator, custom).map(clean));

  let headerDropped = false;
  if (rowsCells.length > 1 && isHeader(rowsCells[0])) {
    headerDropped = true;
    rowsCells = rowsCells.slice(1);
    lines = lines.slice(1);
  }

  const columns = columnSeparator === 'space' ? [] : voteColumns(rowsCells);
  const rows: ParsedRow[] = rowsCells.map((cells, i) => {
    let fields: Record<CellRole, string>;
    if (columns.length && cells.length === columns.length) {
      fields = { hanzi: '', pinyin: '', english: '', sentence: '', notes: '', ignore: '' };
      cells.forEach((cell, c) => {
        const role = columns[c];
        if (role === 'ignore' || !cell) return;
        fields[role] = fields[role] ? `${fields[role]} ${cell}` : cell;
      });
      // A pasted spreadsheet sometimes has a hanzi column that is empty for a
      // row while another cell carries the word — fall back for that row.
      if (!fields.hanzi) fields = assignByScript(cells);
    } else if (columnSeparator === 'space') {
      fields = assignByScript(cells);
    } else {
      fields = assignByScript(cells);
    }
    return finishRow(i, lines[i], fields);
  });

  // Same word twice in one paste: the last occurrence wins, earlier ones are
  // flagged so the preview can say so (and the planner skips them).
  const lastByHanzi = new Map<string, number>();
  for (const r of rows) {
    if (!r.problems.includes('no_chinese')) lastByHanzi.set(normalizeHanzi(r.hanzi), r.index);
  }
  for (const r of rows) {
    if (r.problems.includes('no_chinese')) continue;
    if (lastByHanzi.get(normalizeHanzi(r.hanzi)) !== r.index) r.problems.push('duplicate_in_paste');
  }

  return { rows, detected: { columnSeparator, rowSeparator, columns, headerDropped } };
}
