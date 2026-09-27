/**
 * Package C (Decks tab) golden vectors, from the web app's own TypeScript:
 *   - shared/decks/queue.ts   moveInOrder / moveToIndex / indexUnderPointer (deck queue moves, drag)
 *   - shared/decks/search.ts  stripTones / noteMatches (the local card search)
 *   - shared/decks/defaults.ts pickDeckSettings (deck settings validation)
 * Writes decks.json into process.argv[2]; core DecksParityTest asserts the Kotlin matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { moveInOrder, moveToIndex, indexUnderPointer, QUEUE_MOVES, type RectLike } from '../../../shared/decks/queue';
import { noteMatches, stripTones } from '../../../shared/decks/search';
import { pickDeckSettings } from '../../../shared/decks/defaults';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: decks <out-dir>');
mkdirSync(OUT, { recursive: true });

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
const rand = rng(20260928);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

// ---- queue moves ----
const moves: unknown[] = [];
for (let n = 0; n <= 6; n++) {
  const ids = Array.from({ length: n }, (_, i) => `d${i}`);
  for (const id of [...ids, 'missing']) {
    for (const to of QUEUE_MOVES) moves.push({ ids, id, to, out: moveInOrder(ids, id, to) });
    for (let index = -1; index <= n; index++) moves.push({ ids, id, index, out: moveToIndex(ids, id, index) });
  }
}

// ---- pointer → card (grid of 2 columns like the Decks tab, and a 1-column list) ----
const pointer: unknown[] = [];
for (let c = 0; c < 300; c++) {
  const cols = pick([1, 2]);
  const count = int(0, 9);
  const w = pick([150, 180.5, 390]);
  const h = pick([64, 88.25, 120]);
  const gap = pick([0, 4, 8.5]);
  const rects: RectLike[] = Array.from({ length: count }, (_, i) => ({
    left: 16 + (i % cols) * (w + gap),
    top: 100 + Math.floor(i / cols) * (h + gap),
    width: w,
    height: h,
  }));
  const x = Math.round((rand() * (cols * (w + gap) + 60) - 20) * 100) / 100;
  const y = Math.round((rand() * (Math.ceil(count / cols) * (h + gap) + 200) + 20) * 100) / 100;
  pointer.push({ rects, x, y, out: indexUnderPointer(rects, x, y) });
}
// Exact edges and ties.
const edge: RectLike[] = [{ left: 0, top: 0, width: 100, height: 50 }, { left: 0, top: 50, width: 100, height: 50 }];
for (const [x, y] of [[0, 0], [100, 50], [50, 50], [50, 100], [50, 101], [-10, 50], [200, 75], [50, -5]]) {
  pointer.push({ rects: edge, x, y, out: indexUnderPointer(edge, x, y) });
}

// ---- search ----
const notes = [
  { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行取钱。' },
  { hanzi: '绿色', pinyin: 'lǜsè', english: 'Green', sentence_clue: null },
  { hanzi: '女儿', pinyin: 'nǚ\'ér', english: 'daughter' },
  { hanzi: '你好', pinyin: 'Nǐ Hǎo', english: 'hello / hi', sentence_clue: '你好，老师！' },
  { hanzi: '', pinyin: '', english: '' },
  { hanzi: null, pinyin: undefined, english: null },
  { hanzi: '中国', pinyin: 'zhōngguó', english: 'China', sentence_clue: 'I LOVE 中国' },
  { hanzi: 'ÉCOLE', pinyin: 'xuéxiào', english: 'School (Café)', sentence_clue: '' },
  { hanzi: '一会儿', pinyin: 'yíhuìr', english: 'a moment' },
  { hanzi: '差不多', pinyin: 'chàbuduō', english: 'almost; about the same' },
];
const rawQueries = [
  '', 'y', 'yin', 'yinhang', 'yínháng', 'YIN', 'bank', 'BANK', '银', '银行', '行',
  'lv', 'lü', 'lu', 'lüse', 'lǜ', 'nu', 'nü', "nu'er", 'ni hao', 'nǐ hǎo', 'hello', '/', '取钱', 'green',
  'china', '中', 'love', 'cafe', 'café', 'école', 'ecole', 'school', 'moment', 'yihuir', 'chabuduo', 'about', ';',
  ' ', '  ni ', 'ǎ', 'x', 'zz', 'Ü',
];
const search: unknown[] = [];
for (const raw of rawQueries) {
  const q = raw.trim().toLowerCase();
  const qs = stripTones(q);
  search.push({ raw, q, stripped: qs, matches: notes.map((n) => noteMatches(n, q, qs)) });
}
const strip = ['Nǐ Hǎo', 'LǙSÈ', 'nǚ', 'ÀÉÎÕÜ', 'ǖǘǚǜ', '汉字', 'Straße', 'İstanbul', 'ﬁ', 'é'].map((s) => ({ s, out: stripTones(s) }));

// ---- deck settings ----
const settingsCases: Array<Record<string, unknown> | null> = [
  null,
  {},
  { new_cards_per_day: 5, secondary_cards_per_day: 10 },
  { new_cards_per_day: '7', secondary_cards_per_day: ' 3 ' },
  { new_cards_per_day: -1, secondary_cards_per_day: 1001 },
  { new_cards_per_day: 2.5, secondary_cards_per_day: 2.4999 },
  { new_cards_per_day: '', secondary_cards_per_day: 'abc' },
  { new_cards_per_day: 0, secondary_cards_per_day: 0 },
  { new_cards_per_day: 1000, secondary_cards_per_day: '1000' },
  { new_cards_per_day: null, secondary_cards_per_day: undefined, unknown_key: 3 },
  { request_retention: 0.85, maximum_interval: 365.6 },
  { request_retention: 0.69 },
  { request_retention: '0.97' },
  { learning_steps: '1 10', relearning_steps: ' 10 ' },
  { learning_steps: '1,10', relearning_steps: '' },
  { learning_steps: '1.5  10.25' },
  { new_cards_per_day: true },
  { new_cards_per_day: '1e2' },
  { new_cards_per_day: '0x10' },
  { new_cards_per_day: 'Infinity' },
  { new_cards_per_day: '12abc' },
  { new_cards_per_day: 3.5 },
  { new_cards_per_day: 4.5 },
  { new_cards_per_day: -0.4 },
];
const settings = settingsCases.map((input) => ({ input, out: pickDeckSettings(input) }));

writeFileSync(join(OUT, 'decks.json'), JSON.stringify({ moves, pointer, search: { notes, cases: search, strip }, settings }));
console.log(`decks: ${moves.length} moves, ${pointer.length} pointer cases, ${search.length} searches, ${settings.length} settings cases`);
