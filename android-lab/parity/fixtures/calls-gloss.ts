/**
 * Package J golden vectors: the text board's tab-complete rules (shared/calls/gloss.ts).
 * Writes calls-gloss.json; checked by core/…/calls/CallsGlossParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findGlossSegment, formatGloss, glossCacheKey, glossChipLabel, oneLine, GLOSS_DEBOUNCE_MS, GLOSS_MAX_SEGMENT } from '../../../shared/calls/gloss';

const OUT = process.argv[2];
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
const r = rng(20260930);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const len = (s: string) => Array.from(s).length;

// Hand-picked lines (caret at the end unless given).
const fixed: Array<{ text: string; start?: number; end?: number; composing?: boolean }> = [
  { text: '你好' }, { text: '你好', composing: true }, { text: '你好', start: 0, end: 2 }, { text: 'hello' }, { text: '你好 ' }, { text: '' },
  { text: '。' }, { text: '你好，我叫小明。' }, { text: '“你好”' }, { text: '真的吗？' }, { text: 'Today we learned 苹果' },
  { text: 'I like 苹果 and 香蕉' }, { text: '你好 - nǐ hǎo - hello' }, { text: '你好 - nǐ hǎo - hello 谢谢' }, { text: '你好\n谢谢' },
  { text: '你好\n' }, { text: '你好\nhello', start: 2, end: 2 }, { text: '你好 - nǐ hǎo - hello', start: 2, end: 2 }, { text: '你好 -', start: 2, end: 2 },
  { text: '你好 — nǐ hǎo', start: 2, end: 2 }, { text: '你好吗', start: 2, end: 2 }, { text: '你好 world', start: 2, end: 2 }, { text: '你好  ', start: 2, end: 2 },
  { text: '你好　', start: 2, end: 2 }, { text: '你好 x', start: 2, end: 2 }, { text: '你好 ', start: 2, end: 2 },
  { text: '我'.repeat(50) }, { text: `${'我'.repeat(30)}，${'你'.repeat(20)}` }, { text: 'a𠀀好' }, { text: '〇' }, { text: '你好', start: 9, end: 9 },
  { text: '你好\n谢谢\n再见' }, { text: '你好\r\n谢谢' }, { text: `${'我'.repeat(30)}\n${'你'.repeat(5)}` }, { text: `${'。'.repeat(45)}好` },
];

const alphabet = ['你', '好', '谢', '咖', '啡', '𠀀', '。', '，', '“', '？', 'a', 'b', ' ', '\n', '-', ' - ', '—', '　', '\t', 'nǐ', '…', '1', '！'];
const random: typeof fixed = [];
for (let i = 0; i < 1500; i++) {
  const n = Math.floor(r() * 60);
  let text = '';
  for (let k = 0; k < n; k++) text += pick(alphabet);
  const L = len(text);
  const caret = r() < 0.5 ? L : Math.floor(r() * (L + 3));
  const sel = r() < 0.1 ? Math.floor(r() * (L + 1)) : caret;
  random.push({ text, start: Math.min(sel, caret), end: Math.max(sel, caret), composing: r() < 0.05 });
}

const checks = [...fixed, ...random].map((c) => {
  const end = c.end ?? len(c.text);
  const start = c.start ?? end;
  return { text: c.text, start, end, composing: !!c.composing, result: findGlossSegment(c.text, start, end, !!c.composing) };
});

const formats = [
  { pinyin: 'nǐ hǎo', english: 'hello' },
  { pinyin: 'nǐ\nhǎo\r\n', english: 'hello\r\nhi there friend\n\n' },
  { pinyin: '  wǒ  xiǎng ', english: '\tI want to　go ' },
  { pinyin: '', english: '' },
].map((g) => ({ ...g, format: formatGloss(g), chip: glossChipLabel(g), oneLine: oneLine(g.english) }));

const keys = [' 你好 ', '你好', ' 咖啡\n', 'é'].map((s) => ({ s, key: glossCacheKey(s) }));

writeFileSync(join(OUT, 'calls-gloss.json'), JSON.stringify({ debounce: GLOSS_DEBOUNCE_MS, maxSegment: GLOSS_MAX_SEGMENT, checks, formats, keys }));
