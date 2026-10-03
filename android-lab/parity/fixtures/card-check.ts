/**
 * Word-check golden vectors (shared/cards/check.ts) for core/CardCheck.kt: the cost estimate
 * (label + usd compared exactly), formatUsd, parseCheckIssues over good / junk JSON,
 * liveCheckIssues, samePinyin, toneChangeIssue, checkKindLabel and deckCheckSummary.
 * Writes card-check.json; CardCheckParityTest asserts the Kotlin port matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkKindLabel,
  deckCheckSummary,
  estimateCheckCost,
  formatUsd,
  liveCheckIssues,
  parseCheckIssues,
  samePinyin,
  toneChangeIssue,
  type CheckKind,
  type DeckCheckProposal,
  type DeckCheckStatus,
  type NoteCheckIssue,
} from '../../../shared/cards/check';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: card-check <out-dir>');
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

const wordCounts = [0, 1, 2, 39, 40, 41, 79, 80, 81, 100, 319, 320, 400, 1000, 2500, 12345];
for (let i = 0; i < 200; i++) wordCounts.push(int(0, 5000));
wordCounts.push(3.7, -4, 0.2);
const estimates = wordCounts.map(w => ({ words: w, ...estimateCheckCost(w) }));

const usds = [0, 0.001, 0.0099, 0.01, 0.015, 0.0249, 0.025, 0.035, 0.045, 0.105, 1.2, 1.005, 12.345, 99.995];
for (let i = 0; i < 100; i++) usds.push(rand() * rand() * 5);
const usd = usds.map(u => ({ usd: u, out: formatUsd(u) }));

const good: NoteCheckIssue = { id: 'a', field: 'pinyin', kind: 'tones', current: 'yin hang', proposed: 'yínháng', reason: 'x' };
const raws: string[] = [
  JSON.stringify([good]),
  JSON.stringify([good, { id: 1 }, null, 'x', 3, []]),
  JSON.stringify([{ ...good, field: 'hanzi' }, { ...good, kind: 'other' }, { ...good, reason: 5 }, { ...good, id: 'b', field: 'english', kind: 'gloss', current: 'banana', proposed: 'apple' }]),
  JSON.stringify([{ ...good, extra: true }]),
  JSON.stringify({ issues: [good] }),
  JSON.stringify('[]'),
  'nope', '', '[', 'null', '[]', '42', 'true', '{}',
  JSON.stringify([{ id: 'c', field: 'pinyin', kind: 'tone_change', current: 'yī gè', proposed: 'yí gè', reason: '一 changes tone' }, { ...good, current: null }]),
];
const parsed = raws.map(raw => ({ raw, out: parseCheckIssues(raw) }));

const live: unknown[] = [];
const notes = [
  { hanzi: '银行', pinyin: 'yin hang', english: 'bank' },
  { hanzi: '银行', pinyin: ' yin hang ', english: 'bank ' },
  { hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
  { hanzi: '苹果', pinyin: 'píngguǒ', english: 'banana' },
  { hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple' },
];
const issues: NoteCheckIssue[] = [
  good,
  { id: 'b', field: 'english', kind: 'gloss', current: 'banana', proposed: 'apple', reason: 'y' },
  { id: 'c', field: 'english', kind: 'gloss', current: ' bank', proposed: 'river bank', reason: 'z' },
];
for (const n of notes) live.push({ note: n, issues, out: liveCheckIssues(issues, n).map(i => i.id) });

const pairs: Array<[string, string]> = [['Yí gè', 'yígè'], ['yī gè', 'yí gè'], ["xī'ān", 'xīān'], ['nǐ-hǎo', 'nǐ hǎo'], ['a·b', 'ab'], ['Ní', 'ní'], ['  wǒ ', 'wǒ'], ['wǒ’men', 'wǒmen']];
const same = pairs.map(([a, b]) => ({ a, b, out: samePinyin(a, b) }));

const words: Array<[string, string]> = [
  ['不是', 'bù shì'], ['不好', 'bù hǎo'], ['一样', 'yī yàng'], ['一不小心', 'yī bù xiǎo xīn'], ['不一样', 'bù yī yàng'],
  ['你好', 'nǐ hǎo'], ['一个', 'yí gè'], ['看一看', 'kàn yī kàn'], ['一天', 'yí tiān'], ['要不要', 'yào bù yào'], ['一个', 'yi1 ge4'],
];
const tone = words.map(([hanzi, pinyin]) => ({ hanzi, pinyin, out: toneChangeIssue({ hanzi, pinyin, english: 'x' }) }));

const kinds = (['tone_change', 'tones', 'reading', 'gloss'] as CheckKind[]).map(k => ({ kind: k, out: checkKindLabel(k) }));

const STATUSES: DeckCheckStatus[] = ['queued', 'running', 'done', 'failed'];
const summaries: unknown[] = [];
for (let i = 0; i < 120; i++) {
  const total = pick([0, 1, 2, 5, 40, 319]);
  const status = pick(STATUSES);
  const proposals: DeckCheckProposal[] = Array.from({ length: pick([0, 0, 1, 2, 3, 7]) }, (_, k) => ({
    id: `p${k}`, note_id: `n${k}`, hanzi: '一个', field: 'pinyin', kind: 'tone_change', current: 'yī gè', proposed: 'yí gè', reason: 'r',
    ...(rand() < 0.4 ? { applied: true } : rand() < 0.2 ? { applied: false } : {}),
  }));
  const job = { status, total, checked: Math.min(total, int(0, total)), proposals };
  summaries.push({ job, out: deckCheckSummary(job) });
}

writeFileSync(join(OUT, 'card-check.json'), JSON.stringify({ estimates, usd, parsed, live, same, tone, kinds, summaries }));
console.log(`card-check: ${estimates.length} estimates, ${summaries.length} summaries`);
