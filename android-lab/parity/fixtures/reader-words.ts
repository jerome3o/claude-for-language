/**
 * Reader word chips (shared/reader/words.ts). Writes reader-words.json; core
 * ReaderWordsParityTest asserts ReaderWords.kt matches exactly:
 * - isTappableWord over every segment of real-looking pages (hanzi, punctuation, quotes,
 *   Latin, digits, line breaks, full-width forms);
 * - wordsMatchText over good, stale and malformed segmentations;
 * - wordOffsets and sentenceAround at every segment of those pages.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { alignReaderWords, fallbackReaderWords, isTappableWord, sentenceAround, wordOffsets, wordsMatchText } from '../../../shared/reader/words';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: reader-words <out-dir>');
mkdirSync(OUT, { recursive: true });

const pages = [
  '早上好。我叫小徐，我三十五岁。今天我坐火车去上班。',
  '早上好！吴先生进了科技商店。\n小徐说："早上好！你昨天晚上休息得怎么样？"\n吴先生说："我睡得不长，但是睡得很好。"',
  '"我的移动硬盘坏了。"吴先生说。\n"我看看。"小徐说。"你的电脑硬件很老了。"',
  '她的邻居小徐说：「李老师，你昨天晚上休息得怎么样？」李老师笑了：「睡得不长，但是睡得很好。」',
  '我有WiFi……好吗？ 好！３０块钱（很便宜）。',
  '他说：“好的！”然后走了',
  '我们走吧',
  '？！',
  '  空格在前面。后面也有  ',
];

// Segmentations: the per-character fallback and a coarser "Claude" split (2–3 characters).
const segmentations = pages.flatMap((text) => {
  const coarse = (() => {
    const chars = Array.from(text);
    const proposed: Array<{ text: string }> = [];
    for (let i = 0; i < chars.length; i += 2 + (i % 3 === 0 ? 1 : 0)) proposed.push({ text: chars.slice(i, i + 2 + (i % 3 === 0 ? 1 : 0)).join('') });
    return alignReaderWords(text, proposed).words.map((w) => w.text);
  })();
  return [
    { text, words: fallbackReaderWords(text).map((w) => w.text) },
    { text, words: coarse },
  ];
});

const cases = segmentations.map(({ text, words }) => {
  const offsets = wordOffsets(words.map((t) => ({ text: t })));
  return {
    text,
    words,
    tappable: words.map((w) => isTappableWord(w)),
    offsets,
    sentences: words.map((w, i) => sentenceAround(text, offsets[i], offsets[i] + w.length)),
    sentencesAt: Array.from({ length: text.length }, (_, i) => sentenceAround(text, i)),
  };
});

const matches = [
  { words: ['你', '好'], text: '你好' },
  { words: ['你'], text: '你好' },
  { words: [], text: '' },
  { words: [], text: '你' },
  { words: ['你', '', '好'], text: '你好' },
  { words: ['你好', '。'], text: '你好！' },
  { words: ['a', 'b'], text: 'ab' },
].map((m) => ({ ...m, result: wordsMatchText(m.words.map((t) => ({ text: t })), m.text) }));

writeFileSync(join(OUT, 'reader-words.json'), JSON.stringify({ cases, matches }));
