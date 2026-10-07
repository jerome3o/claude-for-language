/**
 * The explorer's quick drills (shared/explorer/drill.ts): mulberry32 doubles, shuffles,
 * buildDrill over many seeds / pools / targets / maxima, shortGloss and drillScoreLine.
 * Writes explorer-drill.json; core DrillParityTest asserts the Kotlin port
 * (core/…/explorer/Drill.kt) matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildDrill, drillScoreLine, DRILL_MAX, DRILL_MIN, DRILL_OPTIONS, seededRandom, shortGloss, shuffled, type DrillTarget } from '../../../shared/explorer';
import type { CharWord } from '../../../shared/chars/types';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: explorer-drill <out-dir>');
mkdirSync(OUT, { recursive: true });

// The random source itself: many seeds (incl. 0, negatives, past 2^31 / 2^32), 12 doubles each.
const SEEDS = [0, 1, 2, 7, 42, 1234567, 2147483646, 2147483647, 2147483648, 4294967295, 4294967296, -1, -123456, 1759859495123 % 2147483647];
const random = SEEDS.map((seed) => {
  const r = seededRandom(seed);
  return { seed, values: Array.from({ length: 12 }, () => r()) };
});

const shuffles = Array.from({ length: 40 }, (_, i) => {
  const items = Array.from({ length: i % 9 }, (_, k) => `x${k}`);
  return { seed: i * 7919 + 3, items, out: shuffled(items, seededRandom(i * 7919 + 3)) };
});

const W = (hanzi: string, pinyin: string, english: string): CharWord => ({ hanzi, pinyin, english });
const ALL: CharWord[] = [
  W('进行', 'jìnxíng', 'to carry out'),
  W('举行', 'jǔxíng', 'to hold (a meeting)'),
  W('行为', 'xíngwéi', 'behaviour'),
  W('自行车', 'zìxíngchē', 'bicycle'),
  W('银子', 'yínzi', 'silver; money'),
  W('银行卡', 'yínhángkǎ', 'bank card'),
  W('银色', 'yínsè', 'silver (colour)'),
  W('收银台', 'shōuyíntái', 'checkout counter'),
  W('不行', 'bùxíng', "won't do; no way"),
  W('行业', 'hángyè', 'industry'),
  W('旅行', 'lǚxíng', 'to travel'),
  W('一行', 'yìxíng', 'a party (of travellers)'),
  W('孩子', 'háizi', 'child'),
  W('学生', 'xuéshēng', 'student'),
  W('好学', 'hàoxué', 'eager to learn'),
  W('银牌', 'yínpái', 'silver medal'),
  W('', 'x', 'empty hanzi'),
  W('空', 'kōng', ''),
  W('同义', 'tóngyì', 'bank'),
  W('同音', 'yínháng', '  money ; cash'),
];

const TARGETS: DrillTarget[] = [
  { kind: 'word', word: W('银行', 'yínháng', 'bank; banking'), syllables: ['yín', 'háng'] },
  { kind: 'word', word: W('银行', 'yínháng', 'bank') },
  { kind: 'word', word: W('银行', '', 'bank') },
  { kind: 'word', word: W('银行', 'yínháng', '') },
  { kind: 'word', word: W('自行车', 'zìxíngchē', 'bicycle'), syllables: null },
  { kind: 'word', word: W('一会儿', 'yíhuìr', 'a moment') },
  { kind: 'word', word: W('妈妈', 'māma', 'mum') },
  { kind: 'word', word: W('好', 'hǎo', 'good') },
  { kind: 'word', word: W('𠀀子', 'xx zi', 'odd') },
  { kind: 'char', char: '行' },
  { kind: 'char', char: '银' },
  { kind: 'char', char: '子' },
  { kind: 'char', char: '学' },
  { kind: 'char', char: '龘' },
];

function rng(seed: number) {
  const r = seededRandom(seed);
  return {
    int: (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)],
  };
}
const g = rng(20261007);

// Pools are indices into ALL: a word picked twice is the SAME object (buildDrill compares by identity).
const drills: Array<{ target: DrillTarget; pool: number[]; seed: number; max: number | null; out: unknown }> = [];
for (const target of TARGETS) {
  // The full pool, the pool in other orders and sizes, a few maxima.
  for (let k = 0; k < 14; k++) {
    const size = g.int(0, ALL.length);
    const idx = Array.from({ length: size }, () => g.int(0, ALL.length - 1));
    const pool = idx.map((i) => ALL[i]);
    const seed = g.int(0, 2147483646);
    const max = g.pick([null, null, null, 3, 4, 6, 8, 1, 0, 2]);
    drills.push({ target, pool: idx, seed, max, out: max === null ? buildDrill(target, pool, seed) : buildDrill(target, pool, seed, max) });
  }
  drills.push({ target, pool: ALL.map((_, i) => i), seed: 1, max: null, out: buildDrill(target, ALL, 1) });
}

const glosses = ['bank; banking', 'bank', '  money ; cash', '', ';x', 'a;b;c', ' wide　; x', 'to hold (a meeting)'].map((s) => ({ s, out: shortGloss(s) }));
const scores: Array<[number, number]> = [[5, 5], [3, 5], [1, 5], [0, 5], [0, 0], [2, 3], [3, 3], [4, 6], [3, 4]];
const scoreLines = scores.map(([c, t]) => ({ correct: c, total: t, out: drillScoreLine(c, t) }));

writeFileSync(
  join(OUT, 'explorer-drill.json'),
  JSON.stringify({ all: ALL, constants: { max: DRILL_MAX, min: DRILL_MIN, options: DRILL_OPTIONS }, random, shuffles, drills, glosses, scores: scoreLines }),
);
console.log(`explorer-drill: ${drills.length} drills`);
