/**
 * Multiple-choice option rules (shared/cards/multipleChoice.ts): which options are real
 * characters (never a pinyin "xi"), row clean-up, compact grid threshold, the next row to
 * scroll to after a pick. Writes multiple-choice.json; core McOptionsParityTest asserts the
 * Kotlin port (core/McOptions.kt) matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  isHanziOption,
  sanitizeMcRow,
  mcChoiceRowCount,
  isMcCompact,
  nextUnansweredRow,
  type McRow,
} from '../../../shared/cards/multipleChoice';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: multiple-choice <out-dir>');
mkdirSync(OUT, { recursive: true });

const options = ['习', 'xi', 'Xí', 'xí', ' 席 ', '席', '', ' ', '﻿羽﻿', ' 刁', '学习', '1', '，', '。', 'a', '𠀀', '㐀', '鿿', '习\u0085', 'ｘ', '🙂'];
const corrects = ['习', '学', '，', 'hello', '𠀀', '好的', ''];
const hanzi = corrects.flatMap((correct) => options.map((option) => ({ option, correct, result: isHanziOption(option, correct) })));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(11);
const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];

const rows: McRow[] = [
  // The row from the bug report: a pinyin syllable among the characters.
  { correct: '习', options: ['学', '刁', '习', 'xi', '羽'] },
  { correct: '，', options: ['，'] },
  { correct: 'OK', options: ['OK', 'ok'] },
  { correct: '习', options: ['xi', 'Xí'] },
  { correct: '好', options: ['好', '好', ' 妤', '奻 ', '女'] },
  { correct: '好', options: [] },
];
for (let i = 0; i < 300; i++) {
  const n = Math.floor(r() * 7);
  rows.push({ correct: pick(corrects), options: Array.from({ length: n }, () => pick(options)) });
}
const sanitized = rows.map((row) => ({ row, result: sanitizeMcRow(row) }));

const grids: unknown[] = [];
for (let g = 0; g < 120; g++) {
  const len = 1 + Math.floor(r() * 14);
  const grid = Array.from({ length: len }, () => pick(rows));
  const selections = grid.map((row) => (r() < 0.4 && row.options.length > 0 ? pick(row.options) : null));
  const picked = Math.floor(r() * len);
  grids.push({
    rows: grid,
    selections,
    picked,
    choiceRows: mcChoiceRowCount(grid),
    compact: isMcCompact(grid),
    next: nextUnansweredRow(grid, selections, picked),
  });
}

writeFileSync(join(OUT, 'multiple-choice.json'), JSON.stringify({ hanzi, sanitized, grids }, null, 1));
