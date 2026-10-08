/**
 * Deterministic word segmentation (shared/chinese/segment.ts). Writes segment.json;
 * core SegmenterParityTest asserts chinese/Segmenter.kt matches exactly:
 *  - rankCost over a spread of ranks;
 *  - the SHIPPED dictionary (word-freq.txt + segment-words.txt): size, longest word and the cost of
 *    every 97th word;
 *  - every text of shared/chinese/__fixtures__/corpus.txt (Ask Claude-style explanations, chat
 *    lines, reader pages, the repo's sentences) plus rule / edge cases: the segments, and their
 *    pinyin through the app's auto-pinyin (pinyin-pro + the 一 / 不 tone changes = the Lab's
 *    ToneChange.autoPinyin);
 *  - textRuns' kinds over awkward characters.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { applyYiBuToneChanges } from '../../../shared/pinyin/toneChange';
import { parseFrequencyList } from '../../../shared/decks/frequency';
import { buildSegmentDictionary, parseSegmentWords, rankCost, segmentChinese, textRuns } from '../../../shared/chinese/segment';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: segment <out-dir>');
mkdirSync(OUT, { recursive: true });
let root = OUT;
while (!existsSync(join(root, 'android-lab', 'parity')) && dirname(root) !== root) root = dirname(root);
if (!existsSync(join(root, 'android-lab', 'parity'))) throw new Error(`repo root not found above ${OUT}`);

const dict = buildSegmentDictionary(
  parseFrequencyList(readFileSync(join(root, 'shared/data/frequency/word-freq.txt'), 'utf8')).words,
  parseSegmentWords(readFileSync(join(root, 'shared/data/frequency/segment-words.txt'), 'utf8')),
);

const autoPinyin = (text: string) => applyYiBuToneChanges(text, pinyin(text, { toneType: 'symbol', type: 'string' }));

const corpus = readFileSync(join(root, 'shared/chinese/__fixtures__/corpus.txt'), 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.replace(/\\n/g, '\n'));

const edge = [
  '', ' ', '\n', '？！', 'hello world', '我们明天去银行取钱', '他是中国人', '看看', '高高兴兴', '看一看', '去不去', '不用不用',
  '聊天儿', '他儿子', '第十二个', '一二三四五六七八九十一二三', '第', '三本书', '十二月二十五号', '的的', '了了', '一不一',
  '𠀀𠀁好', '😀我😀', '　全角空格　', '３０块钱', 'Ａ股', '〇一二', '々', '我用WiFi上网，30块钱。', 'ǎ拼音', 'café咖啡',
  '你好 再见', '﻿好', '……', '——好', '「没想」', '《红楼梦》', '1. 这份工作', '中華人民共和國', '龘靐齉',
];

const texts = [...corpus, ...edge];
const cases = texts.map((text) => ({
  text,
  words: segmentChinese(text, dict, { pinyinOf: autoPinyin }).map((w) => [w.text, w.pinyin]),
}));

const keys = [...dict.costs.keys()];
const sample = keys.filter((_, i) => i % 97 === 0).map((w) => [w, dict.costs.get(w)!]);

const ranks = [1, 2, 3, 10, 99, 100, 101, 570, 1000, 2999, 3000, 30_000, 50_432, 99_999, 100_000, 123_456];

const runChars = '我a1，。 \n　好々〇Ａ３😀 ﻿—…«»éǎ\t-_';
const runs = textRuns(runChars).map((r) => [r.kind, r.text]);

writeFileSync(
  join(OUT, 'segment.json'),
  JSON.stringify({
    costs: ranks.map((r) => [r, rankCost(r)]),
    dictionary: { size: dict.costs.size, maxLength: dict.maxLength, sample },
    cases,
    runs: { text: runChars, runs },
  }),
);
