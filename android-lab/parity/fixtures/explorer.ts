/**
 * The language explorer's golden vectors (docs/LANGUAGE_EXPLORER.md), from the web app's own
 * TypeScript (shared/explorer): the stack reducer over seeded action sequences, breadcrumbs,
 * itemForText, wordChars, wordFrequencyLabel, resolveWord, relatedWords and the explorable
 * segments (by word / by character). Writes explorer.json; core ExplorerParityTest asserts
 * the Kotlin ports (core/…/explorer/) match exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  breadcrumbTrail,
  charSegments,
  explorableSegments,
  explorerReducer,
  EXPLORER_MAX_DEPTH,
  itemForText,
  relatedWords,
  resolveWord,
  wordChars,
  wordFrequencyLabel,
  type ExplorerAction,
  type ExplorerItem,
} from '../../../shared/explorer';
import { WORD_BATCH_MAX, WORD_DICT_VERSION } from '../../../shared/chars/types';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: explorer <out-dir>');
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
const rand = rng(20261007);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const CHARS = ['银', '行', '子', '孩', '学', '生', '好', '一', '不', '𠀀'];
const WORDS = ['银行', '银子', '孩子', '学生', '行人', '自行车', '不行', '一样', '好学'];
const HINTS = [undefined, 'yínháng', 'bank', ''];

function randomItem(): ExplorerItem {
  if (rand() < 0.45) return { kind: 'char', char: pick(CHARS) };
  const item: ExplorerItem = { kind: 'word', hanzi: pick(WORDS) };
  const p = pick(HINTS);
  const g = pick(HINTS);
  const s = pick([undefined, '我去银行。', '']);
  if (p) item.pinyin = p;
  if (g) item.gloss = g;
  if (s) item.sentence = s;
  return item;
}

function randomAction(): ExplorerAction {
  const r = rand();
  if (r < 0.1) return { type: 'open', item: randomItem() };
  if (r < 0.7) return { type: 'push', item: randomItem() };
  if (r < 0.82) return { type: 'pop' };
  if (r < 0.95) return { type: 'popTo', index: int(-1, 8) };
  return { type: 'close' };
}

// Stack sequences (incl. one that runs past the depth cap).
const sequences: Array<{ actions: ExplorerAction[]; stacks: ExplorerItem[][] }> = [];
for (let i = 0; i < 120; i++) {
  const actions = Array.from({ length: int(1, 40) }, randomAction);
  let s: ExplorerItem[] = [];
  const stacks: ExplorerItem[][] = [];
  for (const a of actions) {
    s = explorerReducer(s, a);
    stacks.push(s);
  }
  sequences.push({ actions, stacks });
}
{
  const actions: ExplorerAction[] = Array.from({ length: EXPLORER_MAX_DEPTH + 6 }, (_, i) => ({ type: 'push', item: { kind: 'char', char: String.fromCodePoint(0x4e00 + i) } }));
  actions.push({ type: 'push', item: { kind: 'char', char: String.fromCodePoint(0x4e00 + 10) } });
  let s: ExplorerItem[] = [];
  const stacks: ExplorerItem[][] = [];
  for (const a of actions) stacks.push((s = explorerReducer(s, a)));
  sequences.push({ actions, stacks });
}

const crumbs = Array.from({ length: 60 }, () => {
  const stack = Array.from({ length: int(0, 9) }, randomItem);
  const max = int(1, 6);
  return { stack, max, trail: breadcrumbTrail(stack, max) };
});
crumbs.push({ stack: [], max: 4, trail: breadcrumbTrail([]) });

const TEXTS = ['银', '银行', '银行，', '，!', '', ' 学 生 ', 'Tom', '我是Tom。', '𠀀', '一个'];
const forText = TEXTS.flatMap((text) => [
  { text, hint: {}, item: itemForText(text) },
  { text, hint: { pinyin: 'yínháng', gloss: '', sentence: '我去银行。' }, item: itemForText(text, { pinyin: 'yínháng', gloss: '', sentence: '我去银行。' }) },
]);

const CHAR_CASES: Array<[string, string | null, string[] | null]> = [
  ['银行', 'yínháng', null],
  ['银行', 'yín háng', null],
  ['一个', 'yíge', ['yí', 'ge']],
  ['银行', 'bank', null],
  ['银行', '', null],
  ['银行', null, null],
  ['自行车', 'zìxíngchē', ['zì', 'xíng']],
  ['自行车', 'zì xíng chē', null],
  ['一会儿', 'yíhuìr', null],
  ['你好！', 'nǐ hǎo', null],
  ['西安', "Xī'ān", null],
  ['妈妈', 'māma', null],
  ['女儿', 'nǚ’ér', null],
  ['绿色', 'lǜsè', null],
  ['学生', 'xue2sheng5', null],
  ['银行', '  yínháng  ', null],
  ['一样', 'yíyàng', ['', 'yàng']],
];
const chars = CHAR_CASES.map(([hanzi, pinyin, syllables]) => ({ hanzi, pinyin, syllables, out: wordChars(hanzi, pinyin, syllables) }));

const ranks = [null, 0, -3, 1, 570, 999, 1000, 1001, 2915, 5000, 5001, 15658, 29999, 30000, 30001, 51006, 1234567];
const freq = ranks.map((rank) => ({ rank, out: wordFrequencyLabel(rank) }));

const record = { hanzi: '银行', pinyin: 'yínháng', syllables: ['yín', 'háng'], english: 'bank', senses: ['bank', 'banking'], rank: 570 };
const resolveCases = [
  { hanzi: '银行', sources: { record, rank: 600 } },
  { hanzi: '银行', sources: { record } },
  { hanzi: '银行', sources: { record: { ...record, rank: null } } },
  { hanzi: '银子', sources: { record, charWords: [{ hanzi: '银子', pinyin: 'yínzi', english: 'silver' }] } },
  { hanzi: '银行', sources: { charWords: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank (cw)' }], notes: [{ hanzi: '银行', pinyin: 'x', english: 'y' }] } },
  { hanzi: '银行', sources: { notes: [{ hanzi: '银行 ', pinyin: 'yínháng', english: 'a bank' }] } },
  { hanzi: '银行', sources: { notes: [{ hanzi: '银行', pinyin: '', english: '' }, { hanzi: '银行', pinyin: null, english: 'second' }] } },
  { hanzi: '银行', sources: { hint: { gloss: 'the bank' } } },
  { hanzi: '银行', sources: { hint: { pinyin: 'yínháng' }, rank: 12 } },
  { hanzi: '银行', sources: { hint: { pinyin: '', gloss: '' } } },
  { hanzi: '银行', sources: {} },
];
const resolved = resolveCases.map((c) => ({ ...c, out: resolveWord(c.hanzi, c.sources as never) }));

// Related words: seeded character lists.
const POOL = ['银行', '银子', '收银', '自行车', '行人', '不行', '一行', '孩子', '子女', '学生', '好学', '学子', '行为', '银行卡'];
const related = Array.from({ length: 120 }, () => {
  const hanzi = pick(WORDS);
  const recChars = [...new Set(Array.from({ length: int(0, 4) }, () => pick([...hanzi, ...hanzi, ...hanzi, '学', '𠀀'])))];
  const records = recChars.map((char) => ({
    char,
    words: Array.from({ length: int(0, 8) }, () => {
      const h = pick(POOL);
      return { hanzi: h, pinyin: '', english: h + '?' };
    }),
  }));
  const rankMap: Record<string, number | null> = {};
  for (const h of POOL) rankMap[h] = pick([null, 0, int(1, 40000), int(1, 40000), 500]);
  const limit = pick([12, 12, 3, 0, 20]);
  const out = relatedWords(hanzi, records, (h) => rankMap[h], limit);
  return { hanzi, records, ranks: rankMap, limit, out: out.map((r) => ({ hanzi: r.word.hanzi, english: r.word.english, shared: r.shared, rank: r.rank })) };
});

// Explorable segments.
const SEG_TEXTS = [
  { text: '我去银行。', segments: [{ text: '我', pinyin: 'wǒ', gloss: 'I' }, { text: '去', pinyin: 'qù', gloss: 'go' }, { text: '银行', pinyin: 'yínháng', gloss: 'bank' }, { text: '。' }] },
  { text: '银行', segments: [{ text: '银' }] },
  { text: '我是Tom。', segments: null },
  { text: '“你好！”他说。\n好的', segments: [{ text: '“' }, { text: '你好', pinyin: 'nǐ hǎo', gloss: '' }, { text: '！”' }, { text: '他', pinyin: null, gloss: 'he' }, { text: '说', pinyin: 'shuō', gloss: 'say' }, { text: '。\n' }, { text: '好的', pinyin: 'hǎo de', gloss: 'OK' }] },
  { text: '𠀀子 ok', segments: [{ text: '𠀀子' }, { text: ' ok' }] },
  { text: '', segments: [] },
  { text: 'abc', segments: [{ text: 'abc' }] },
];
const segments = SEG_TEXTS.map(({ text, segments: segs }) => ({
  text,
  segments: segs,
  chars: charSegments(text),
  words: explorableSegments(text, segs, (s, e) => `${s}:${e}:${text}`),
  words_no_sentence: explorableSegments(text, segs),
}));

writeFileSync(
  join(OUT, 'explorer.json'),
  JSON.stringify({
    constants: { max_depth: EXPLORER_MAX_DEPTH, word_dict_version: WORD_DICT_VERSION, word_batch_max: WORD_BATCH_MAX },
    sequences,
    crumbs,
    for_text: forText,
    chars,
    freq,
    resolved,
    related,
    segments,
  }),
);
console.log(`explorer: ${sequences.length} sequences, ${related.length} related cases`);
