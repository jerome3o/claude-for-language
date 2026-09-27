/**
 * Package C "Paste a list" golden vectors from the web's own shared/import:
 * pinyin helpers, parseWordList (auto-detection + every override) and planImport.
 * Writes import.json into process.argv[2]; core ImportParityTest asserts the Kotlin matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseWordList, classifyCell, normalizeHanzi, type ColumnSeparator, type RowSeparator } from '../../../shared/import/parse';
import { toneNumbersToMarks, normalizePinyin, pinyinSyllableCount, segmentPinyin, hasToneInfo, stripTones } from '../../../shared/import/pinyin';
import { planImport, summarizePlan, type ExistingNote, type ExistingPolicy } from '../../../shared/import/plan';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: import <out-dir>');
mkdirSync(OUT, { recursive: true });

const pinyinInputs = [
  'ni3 hao3', 'ni3hao3', 'lv4', 'LV4', 'xie4xie5', 'dou1', 'liu2', 'gui4', 'xue2 sheng1', 'Bei3jing1', 'nǐ hǎo', 'hello', '  píng   guǒ ',
  'píngguǒ', "xi'an", "Xi'an", 'zhuangyuan', 'apple', 'yíhuìr', 'nǚ\'ér', 'nv3er2', 'er2', 'r', 'ê', 'an', 'ma', 'mama', 'zhong1guo2ren2',
  'ZHONG1', 'Ni3', 'nǐ3', 'a5', 'hao3!', 'hao3a', 'x5', 'lu:4', 'jiǔ', 'lüè', 'lve4', 'huār', 'wanr2', 'ping2-guo3', 'píng·guǒ', 'shi4, bu2 shi4',
  'Hello World', 'yī èr sān', 'iPhone', 'tian1 an1 men2', '', '  ', 'q', 'zh', 'chuang1hu', 'xiong2mao1', 'NI HAO', 'Nǐ Hǎo', 'ni3 hao3.', '“ni3”',
];
const pinyin = pinyinInputs.map((s) => ({
  s,
  marks: toneNumbersToMarks(s),
  norm: normalizePinyin(s),
  count: pinyinSyllableCount(s),
  seg: segmentPinyin(s),
  tone: hasToneInfo(s),
  strip: stripTones(s),
}));

const classify = [
  ['苹果', undefined], ['píngguǒ', undefined], ['pingguo', 2], ['pingguo', undefined], ['apple', undefined], ['hello (你好)', undefined],
  ['', undefined], ['  ', undefined], ['an', 1], ['an', undefined], ['mama', 2], ['123', undefined], ['。！', undefined], ['A苹果', undefined],
  ['ni hao', 2], ['ni hao', 3], ['Ni3', undefined], ['我每天吃一个苹果。', undefined],
].map(([cell, len]) => ({ cell, len: len ?? null, out: classifyCell(cell as string, len as number | undefined) }));

const normalize = ['苹果', ' 苹 果 ', '苹果。', '（苹果）', '“苹果”', 'a-b', '苹​果', '你好！', '《书》', 'Apple', '苹果﻿'].map((s) => ({ s, out: normalizeHanzi(s) }));

type Case = { text: string; col?: ColumnSeparator; custom?: string; row?: RowSeparator };
const cases: Case[] = [
  { text: '苹果\tpíngguǒ\tapple\n香蕉\txiāngjiāo\tbanana\n' },
  { text: 'Chinese\tPinyin\tEnglish\tSentence\n苹果\tpíng guǒ\tapple\t我每天吃一个苹果。' },
  { text: '苹果，píngguǒ，apple\n香蕉, xiāngjiāo, banana\n' },
  { text: '苹果 - apple\n香蕉：banana\n葡萄: grape' },
  { text: '苹果 píngguǒ apple\n香蕉 xiāng jiāo banana\n葡萄 grape\n西瓜 (xī guā) watermelon, a big one' },
  { text: '妈妈 mother\n安 an\n' },
  { text: '1. 苹果\n2、香蕉\n- 葡萄\n• 西瓜' },
  { text: '苹果 apple; 香蕉 banana; 葡萄 grape' },
  { text: '苹果\tping2guo3\tapple' },
  { text: 'apple\t苹果\tpíngguǒ\nbanana\t香蕉\txiāngjiāo' },
  { text: '苹果\tpíngguǒ\tapple\nhello\tworld\tagain\n苹果\tpíng guǒ\tapple (fruit)' },
  { text: '苹果|apple', col: 'pipe' },
  { text: '苹果 => apple', col: 'custom', custom: '=>' },
  { text: '   \n\n' },
  { text: '' },
  { text: '苹果' },
  { text: '苹果 píngguǒ apple 我喜欢吃苹果。' },
  { text: '打算 dǎsuàn to plan; to intend 你周末打算做什么？ 他打算明年去中国。' },
  { text: 'hanzi\tpinyin\tenglish\tnotes\n你好\tnǐ hǎo\thello\tA greeting\n谢谢\txièxie\tthank you\t' },
  { text: '你好\tnǐ hǎo\thello\t\n\t\t\t\n谢谢\txièxie\tthank you\tpolite' },
  { text: 'word | pinyin | meaning\n银行 | yínháng | bank\n邮局 | yóujú | post office\n| | |' },
  { text: '银行,yin2hang2,bank,我去银行。,Also: riverbank (河岸)\n邮局,you2ju2,post office,,' },
  { text: '① 银行 bank\n② 邮局 post office\n③ 超市 supermarket' },
  { text: '(1) 银行 yínháng\n(2) 邮局 yóujú' },
  { text: '一会儿 yíhuìr a moment\n差不多 chà bu duō almost\n〇 líng zero' },
  { text: '北京: Beijing\n上海 : Shanghai\nTime: 12:30\n时间：shíjiān' },
  { text: '银行 – bank\n邮局 — post office\n超市 - supermarket' },
  { text: '银行\r\n邮局\r\n\r\n超市' },
  { text: '银行; 邮局；超市' },
  { text: '银行; 邮局\n超市', row: 'semicolon' },
  { text: '银行 bank; money', row: 'newline' },
  { text: '银行\tbank', col: 'space' },
  { text: '银行 yínháng bank', col: 'tab' },
  { text: '银行,bank', col: 'colon' },
  { text: '银行 yínháng bank', col: 'custom', custom: '' },
  { text: '　银行　 yínháng 　bank​' },
  { text: '银行 yin hang bank\n安全 an quan safety\n马 ma horse\n妈 ma mom\n吗 ma' },
  { text: 'bank 银行\npost office 邮局 yóujú' },
  { text: '你好 hello (你好吗?)\nHello 你好' },
  { text: '中文\n汉字\n拼音' },
  { text: 'Chinese\nEnglish' },
  { text: '汉字\t拼音\t英文\n银行\tyínháng\tbank' },
  { text: 'Word\tMeaning\n苹果\tapple\n香蕉\tbanana\n葡萄\tgrape\n西瓜' },
  { text: '苹果\tapple\t我吃苹果。\t我也吃香蕉。\n香蕉\tbanana\t香蕉很甜。\t猴子吃香蕉。' },
  { text: '苹果\t\tapple\n\t香蕉\tbanana' },
  { text: 'píngguǒ\t苹果\napple\t苹果' },
  { text: '好 hǎo good; 好 hào to like' },
  { text: '𠀀 rare char\n𠮷 jí lucky' },
  { text: '你好, nǐ hǎo, hello, world\n谢谢, xièxie, thanks' },
  { text: '* 银行 yínháng bank\n- 邮局 yóujú post office\n· 超市 chāoshì supermarket' },
  { text: '12. 银行\n123) 邮局\n1234. 超市' },
];
const parses = cases.map((c) => {
  const res = parseWordList(c.text, { columnSeparator: c.col, customSeparator: c.custom, rowSeparator: c.row });
  return { input: c, out: res };
});

// ---- plans ----
const existing: ExistingNote[] = [
  { id: 'e1', hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple', fun_facts: null, sentence_clue: null },
  { id: 'e2', hanzi: '香蕉。', pinyin: 'xiāngjiāo', english: 'banana', fun_facts: 'Long and yellow', sentence_clue: '我吃香蕉。' },
  { id: 'e3', hanzi: '银行', pinyin: 'yínháng', english: 'bank', fun_facts: '银 silver + 行 business', sentence_clue: null },
  { id: 'e3b', hanzi: '银 行', pinyin: 'yín háng', english: 'bank (dup)' },
];
const planTexts = [
  '苹果\tpíngguǒ\tapple\n香蕉\txiāng jiāo\tbanana\n葡萄\tpútao\tgrape\n西瓜',
  '苹果\tpíng guǒ\tan apple\t我吃苹果。\tfruit\n银行\tyínháng\tbank\n邮局\t\tpost office\nhello\tworld\t!\n苹果\tpíngguǒ\tapple',
  '香蕉 xiāngjiāo  banana\n银行 yínháng bank 我去银行。',
];
const plans: unknown[] = [];
for (const text of planTexts) {
  const rows = parseWordList(text).rows;
  for (const policy of ['update', 'skip', 'duplicate'] as ExistingPolicy[]) {
    for (const excluded of [[], [0, 2]]) {
      const plan = planImport(rows, existing, policy, new Set(excluded));
      plans.push({ text, policy, excluded, plan, summary: summarizePlan(plan) });
    }
  }
}

writeFileSync(join(OUT, 'import.json'), JSON.stringify({ pinyin, classify, normalize, parses, existing, plans }));
console.log(`import: ${pinyin.length} pinyin, ${parses.length} pastes, ${plans.length} plans`);
