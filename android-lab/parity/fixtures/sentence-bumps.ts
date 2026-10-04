/**
 * The Coach's "⚡ Study … today" chip golden vectors, from the web app's own TypeScript
 * (shared/decks/sentence-bumps.ts): which note the sentence IS, else the notes inside it in
 * picker order — over hand-picked sentences and seeded random notes / sentences (spaces,
 * punctuation, duplicates across decks, single characters inside and outside longer words).
 * Writes sentence-bumps.json; core SentenceBumpsParityTest asserts SentenceBumps.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addToTodayLabel, sentenceBumps } from '../../../shared/decks/sentence-bumps';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sentence-bumps <out-dir>');
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
const rand = rng(20261004);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const WORDS = ['一对', '可爱', '情侣', '吃', '外卖', '小吃', '好', '你好', '大学', '大学生', '学生', '银行', '去', '我', '我们', '一起', '吧', '的', '在', '喝茶', '茶', '中国人', '中国', '人'];
const PUNCT = ['', '', '。', '，', '！', '？', ' ', '“', '”'];

type N = { id: string; hanzi: string };
const cases: Array<{ text: string; notes: N[]; max?: number }> = [
  { text: '一对可爱的情侣在吃外卖。', notes: ['吃', '可爱', '情侣', '外卖', '一对', '咖啡'].map((h, i) => ({ id: `a${i}`, hanzi: h })) },
  { text: '我们一起吃外卖吧！', notes: [{ id: 'w', hanzi: '外卖' }, { id: 's', hanzi: '我们一起吃外卖吧' }] },
  { text: '这个小吃很好', notes: [{ id: 'c', hanzi: '吃' }, { id: 'x', hanzi: '小吃' }, { id: 'h', hanzi: '好' }] },
  { text: '我吃这个小吃', notes: [{ id: 'c', hanzi: '吃' }, { id: 'x', hanzi: '小吃' }] },
  { text: '我去银行', notes: [{ id: 'd1', hanzi: '银行' }, { id: 'd2', hanzi: ' 银行。' }] },
  { text: '。', notes: [{ id: 'p', hanzi: '。' }] },
  { text: '', notes: [{ id: 'e', hanzi: '你好' }] },
  { text: '一二三四五', notes: [...'一二三四五'].map((c, i) => ({ id: `n${i}`, hanzi: c })), max: 3 },
];
for (let i = 0; i < 300; i++) {
  const text = Array.from({ length: int(1, 7) }, () => pick(WORDS) + pick(PUNCT)).join('');
  const notes: N[] = Array.from({ length: int(0, 12) }, (_, j) => ({
    id: `r${i}-${j}`,
    hanzi: rand() < 0.1 ? text.replace(/[。，！？ ]/g, pick(['', ' '])) : pick(PUNCT) + pick(WORDS) + pick(PUNCT),
  }));
  cases.push({ text, notes, ...(rand() < 0.1 ? { max: int(0, 4) } : {}) });
}

const out = cases.map(c => {
  const r = sentenceBumps(c.text, c.notes, c.max);
  return { ...c, exact: r.exact?.id ?? null, words: r.words.map(w => w.id) };
});
const labels = [0, 1, 2, 7].map(n => ({ n, label: addToTodayLabel(n) }));

writeFileSync(join(OUT, 'sentence-bumps.json'), JSON.stringify({ cases: out, labels }));
console.log(`sentence-bumps: ${out.length} cases`);
