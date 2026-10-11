/**
 * Package J golden vectors: the text board's tab-complete rules (shared/calls/gloss.ts).
 * Writes calls-gloss.json; checked by core/…/calls/CallsGlossParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  findGlossSegment,
  formatGloss,
  glossCacheKey,
  glossChipLabel,
  glossDirectionOf,
  glossStoreKey,
  oneLine,
  GLOSS_CACHE_VERSION,
  GLOSS_DEBOUNCE_MS,
  GLOSS_MAX_EN_CHARS,
  GLOSS_MAX_EN_WORDS,
  GLOSS_MAX_SEGMENT,
  GLOSS_MIN_EN_LETTERS,
} from '../../../shared/calls/gloss';

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
  // English → Chinese: words, phrases, mixed lines, numbers, punctuation, abbreviations, gloss tails, pinyin.
  { text: 'apple' }, { text: 'to take a shower' }, { text: "don't worry" }, { text: 'ice-cream' }, { text: '3 apples' }, { text: 'COVID-19' },
  { text: 'OK' }, { text: 'TV' }, { text: 'I' }, { text: 'a' }, { text: '2026' }, { text: 'hello ' }, { text: 'hello.' }, { text: 'Good. See you tomorrow' },
  { text: 'Hi, how are you' }, { text: 'one two three four five six seven eight nine' }, { text: 'one two three four five six seven eight' },
  { text: 'x'.repeat(61) }, { text: 'x'.repeat(60) }, { text: '我喜欢apple' }, { text: '我喜欢 green tea' }, { text: 'apple 苹果' }, { text: '我有3' },
  { text: 'nǐ hǎo' }, { text: 'wǒ xiǎng' }, { text: 'xia\u030cng' }, { text: 'café' }, { text: 'apple - 苹果 - píngguǒ' }, { text: 'of - 的 - de' },
  { text: '你好 - ni hao - hello there' }, { text: '好 — hao' }, { text: '好 –  hao' }, { text: 'well -done' }, { text: "'tis fine" }, { text: '  - ok' },
  { text: 'hello\nworld' }, { text: '你好\nok' }, { text: 'apple', start: 2, end: 2 }, { text: 'apple pie', start: 5, end: 5 }, { text: 'apple - x', start: 5, end: 5 },
  { text: 'hello\tthere' }, { text: 'it’s OK' }, { text: 'Ａbc' }, { text: 'ªbc' }, { text: 'ok', composing: true },
];

const alphabet = ['你', '好', '谢', '咖', '啡', '𠀀', '。', '，', '“', '？', 'a', 'b', ' ', '\n', '-', ' - ', '—', '　', '\t', 'nǐ', '…', '1', '！',
  'apple', 'OK', 'I', ' tea', "'", '’', '.', ',', 'ǎ', 'é', '\u030c', '–', 'x', 'Z', '9'];
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

const enFormats = [
  { chinese: '苹果', pinyin: 'píngguǒ' },
  { chinese: '洗\n澡', pinyin: ' xǐ\r\nzǎo ' },
  { chinese: '', pinyin: '' },
].map((g) => ({ ...g, format: formatGloss(g), chip: glossChipLabel(g) }));

const formats = [
  { pinyin: 'nǐ hǎo', english: 'hello' },
  { pinyin: 'nǐ\nhǎo\r\n', english: 'hello\r\nhi there friend\n\n' },
  { pinyin: '  wǒ  xiǎng ', english: '\tI want to　go ' },
  { pinyin: '', english: '' },
].map((g) => ({ ...g, format: formatGloss(g), chip: glossChipLabel(g), oneLine: oneLine(g.english) }));

const keys = [' 你好 ', '你好', ' 咖啡\n', 'é', ' apple '].map((s) => ({ s, key: glossCacheKey(s), zh: glossStoreKey(s, 'zh'), en: glossStoreKey(s, 'en'), direction: glossDirectionOf(s) }));

writeFileSync(join(OUT, 'calls-gloss.json'), JSON.stringify({
    debounce: GLOSS_DEBOUNCE_MS,
    maxSegment: GLOSS_MAX_SEGMENT,
    maxEnWords: GLOSS_MAX_EN_WORDS,
    maxEnChars: GLOSS_MAX_EN_CHARS,
    minEnLetters: GLOSS_MIN_EN_LETTERS,
    cacheVersion: GLOSS_CACHE_VERSION,
    checks,
    formats,
    enFormats,
    keys,
  }));
