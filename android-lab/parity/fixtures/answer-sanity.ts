/**
 * The answer screen's sanity rules (Jerome, Nov 2026: "✓ Also right — …but 因为 clause should come before the subject"
 * when his answer already put it first, with a tip comparing two identical strings and 我 painted red on a pure
 * reordering): normalizeAnswerCheck with the model answer (insaneTip / saneHeadline, shared/lesson/answerCheck.ts),
 * comparesIdenticalTexts, recommendsText, and answerMarks / sameCharacters (shared/lesson/feedback.ts). Writes
 * answer-sanity.json; checked by core/…/AnswerSanityParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  comparesIdenticalTexts, normalizeAnswerCheck, recommendsText, ANSWER_CHECK_VERSION, PLAIN_ACCEPTABLE_HEADLINE, PLAIN_CORRECT_HEADLINE,
  checkKey, correctedDisplay, forbidsCorrected, recommendedAt, recommendsWrongForm, wordsPinyinLine, neutralHeadline,
} from '../../../shared/lesson/answerCheck';
import { answerKey, answerMarks, markedChars, sameCharacters, REORDERED_NOTE } from '../../../shared/lesson/feedback';
import { digitsToHanzi } from '../../../shared/text/numberHanzi';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const answer = '因为这个问题，我睡不着觉。';
const model = '我因为这个问题睡不着觉。';
const selfCompare = '因为 (reason) typically comes before the subject, then the consequence. 因为这个问题 我睡不着觉 reads more naturally than 因为这个问题 我睡不着觉.';

const raws: Array<{ raw: unknown; answer: string; model: string | null }> = [
  { raw: { verdict: 'acceptable', headline: 'Correct meaning, but 因为 clause should come before the subject in formal style.', corrected: '', tips: [{ text: selfCompare, quote: '因为' }] }, answer, model },
  { raw: { verdict: 'acceptable', headline: 'Correct meaning, but 因为 clause should come before the subject in formal style.', corrected: '', tips: [{ text: selfCompare, quote: '因为' }] }, answer, model: null },
  { raw: { verdict: 'almost', headline: 'Fix the order.', corrected: '我因为这个问题睡不着。', tips: [{ text: selfCompare }, { text: 'Use 因为这个问题，我睡不着觉 here.' }, { text: '睡不着觉 is fine; 睡不着 alone also works.', quote: '睡不着觉' }] }, answer, model },
  { raw: { verdict: 'correct', headline: 'Correct, but try 再.', tips: [{ text: 'You could add 再 for emphasis.', quote: '再' }] }, answer: model, model },
  { raw: { verdict: 'correct', headline: 'Correct and natural — 很 is optional here.', tips: [{ text: '很 is optional inside a 即使 clause; 即使再便宜 stresses it.', quote: '即使便宜' }] }, answer: '即使便宜，我也不买。', model: '即使很便宜，我也不买。' },
  { raw: { verdict: 'acceptable', headline: 'Right, but 觉 is optional.', tips: [{ text: '因为这个问题，我睡不着觉 is natural.' }, { text: '睡不着 alone is enough; 觉 is optional.', quote: '睡不着觉' }] }, answer, model },
  { raw: { verdict: 'correct', headline: '因为这个问题我睡不着觉 is better than 因为这个问题，我睡不着觉.', tips: [] }, answer, model },
  { raw: { verdict: 'acceptable', headline: 'Fine — 因为这个问题，我睡不着觉 sounds more natural.', tips: [] }, answer, model },
  { raw: { verdict: 'wrong', headline: 'However, the meaning is lost.', tips: [{ text: 'Say 我因为这个问题睡不着觉 instead (VS 因为问题).' }] }, answer: '这个问题我很好', model },
  { raw: { verdict: 'acceptable', headline: 'Good, but… Butter.', tips: [{ text: 'Nothing to add — ok' }] }, answer, model },
  // Free speaking: a tip whose better version IS the whole transcript goes.
  { raw: { verdict: 'acceptable', headline: 'Clear, though shorter is fine.', cleaned: '你好，我是安妮。', corrected: '', tips: [{ text: 'Fine.', quote: '你好', fix: '你好，我是安妮' }] }, answer: '你好，我是安妮。', model: '你好！' },
  // Coherence (Nov 2026): Jerome's croissant — "not both" over a fix with both, his own 块多元 offered as a fix.
  { raw: { verdict: 'almost', headline: 'Use 钱 or 块 alone, not both together', corrected: '这个牛角包3块多钱', corrected_pinyin: 'zhège niú jiǎo bāo kuài duō qián', tips: [{ text: '3块多元: 块 and 元 are both money units; use 钱 instead (块多钱) or just 元 alone (块多元)', quote: '3块多元' }] }, answer: '这个牛角包 3块多元。', model: '这个牛角包三块多钱。' },
  { raw: { verdict: 'almost', headline: '块 and 元 are both units — use one.', corrected: '这个牛角包三块多钱。', tips: [{ text: '块多元 stacks two units: say 三块多钱 or 三元多.', quote: '块多元' }], alternative: { hanzi: '这个牛角包3块多元' } }, answer: '这个牛角包 3块多元。', model: '这个牛角包三块多钱。' },
  { raw: { verdict: 'wrong', headline: 'Or just say 三元', corrected: '', tips: [{ text: 'Avoid 牛角包 here', quote: '牛角包' }] }, answer: '这个牛角包三元', model: '这个牛角包三块多钱。' },
  { raw: { verdict: 'wrong', headline: 'Don’t use 三块多 — try 3块', corrected: '这个牛角包三块多钱', tips: [{ text: 'Say 也别着急 instead of 也不着急.' }] }, answer: '这个牛角包3块多元', model: null },
  { raw: { verdict: 'correct', headline: 'Use 钱 or 块 alone, not both together', corrected: '', tips: [] }, answer: '这个牛角包三块多钱。', model: '这个牛角包三块多钱。' },
];
const normalized = raws.map((c) => ({ ...c, check: normalizeAnswerCheck(c.raw, c.answer, c.model) }));

const lines = [
  selfCompare,
  '因为这个问题 我睡不着觉 reads more naturally than 因为这个问题，我睡不着觉.',
  '也不着急 is a statement; use 也别着急 instead.',
  '和 links nouns, not 和 actions',
  'Say 你好 — 你好 is fine',
  'notable: 你好 你好',
  '你好 vs 你好',
  'Say 因为这个问题，我睡不着觉 instead.',
  '→ 因为这个问题，我睡不着觉',
  '因为这个问题，我睡不着觉 sounds more natural.',
  '“因为这个问题，我睡不着觉” IS BETTER.',
  'Say 我因为这个问题睡不着觉 instead.',
  'reuse 因为这个问题，我睡不着觉',
  '因为这个问题，我睡不着觉 is morenatural',
];
const mine = '因为这个问题我睡不着觉';
const texts = lines.map((text) => ({ text, compares: comparesIdenticalTexts(text), recommends: recommendsText(text, mine) }));

const PAIRS: Array<[string, string]> = [
  [answer, model], ['这个问题让我睡不着。', model], ['我因为这个问题睡不着觉', model], ['', model], ['。', model],
  ['我我', '我'], ['好𠀀啊', '𠀀啊好！'], ['ＡＢＣ我们', 'abc 我们。'], ['你好', ''],
];
const VERDICTS = [null, 'correct', 'acceptable', 'almost', 'wrong'];
const marks = PAIRS.flatMap(([a, m]) => VERDICTS.map((v) => ({ answer: a, model: m, verdict: v, same: sameCharacters(a, m), marks: answerMarks(a, m, v) })));

// Coherence rules + digits read as numerals.
const croissant = { mine: checkKey('这个牛角包 3块多元。'), corrected: checkKey('这个牛角包3块多钱'), model: checkKey('这个牛角包三块多钱。') };
const coherenceLines = [
  '3块多元: 块 and 元 are both money units; use 钱 instead (块多钱) or just 元 alone (块多元)',
  'Use 钱 or 块 alone, not both together',
  'Use 元 or 块 alone, NOT BOTH',
  'Avoid 块多钱 here',
  "don't use “块多钱”",
  'Say 也别着急 instead of 也不着急.',
  'Use 别, not 块多元',
  'Wrong: use it. 块多元 is two units',
  '→ 块多元',
  'or 牛角包三块多元',
  'Keep 这个牛角包 — use 这个牛角包',
  '块 and 钱 can’t combine with 元',
  'try 块多元; 块多元 is wrong',
];
const coherence = coherenceLines.map((text) => ({
  text,
  recommended: Array.from(text.matchAll(/\p{Script=Han}+/gu), (m) => recommendedAt(text, m.index!)),
  wrongForm: recommendsWrongForm(text, croissant.mine, croissant.corrected, croissant.model),
  forbids: forbidsCorrected(text, croissant.corrected),
  forbidsNoFix: forbidsCorrected(text, ''),
}));
const numberTexts = ['这个牛角包 3块多元。', '2026年3月1.5%', '电话123456789', '我12岁', '３块', '0点', '10个人', '1,000元', '第2026届', '5.0', 'abc', ''];
const digits = numberTexts.map((text) => ({ text, hanzi: digitsToHanzi(text), key: checkKey(text), answerKey: answerKey(text), display: correctedDisplay(text) }));
const MARK_PAIRS: Array<[string, string]> = [
  ['这个牛角包 3块多元。', '这个牛角包三块多钱。'], ['我12岁', '我十二岁'], ['我13岁', '我十二岁'], ['2026年', '二〇二六年'],
  ['3个人', '三个人'], ['1.5公斤', '一点五公斤'], ['50%的人', '百分之五十的人'], ['三块', '3块'], ['我10岁了', '我十岁'],
];
const digitMarks = MARK_PAIRS.map(([a, m]) => ({
  answer: a, model: m,
  answerSide: markedChars(a, m, 'answer'), modelSide: markedChars(a, m, 'model'),
  marks: answerMarks(a, m),
}));
const wordLines = [
  [{ text: '这个', pinyin: 'zhège' }, { text: '牛角包', pinyin: 'niú jiǎo bāo' }, { text: '三块', pinyin: 'sānkuài' }, { text: '多', pinyin: 'duō' }, { text: '钱', pinyin: 'qián' }, { text: '。', pinyin: '' }],
  [{ text: '你好', pinyin: 'nǐhǎo' }, { text: '，', pinyin: '' }, { text: '世界', pinyin: 'shìjiè' }, { text: '！', pinyin: '' }],
  [{ text: '你好', pinyin: 'nǐhǎo' }, { text: '，', pinyin: '' }, { text: '世界', pinyin: '' }],
  [{ text: 'Annie', pinyin: '' }, { text: ' ', pinyin: '' }, { text: '来了', pinyin: 'láile' }, { text: '?', pinyin: '' }],
  [],
].map((words) => ({ words, line: wordsPinyinLine(words) }));
const neutral = (['almost', 'wrong'] as const).flatMap((v) => [true, false].map((fix) => ({ verdict: v, fix, headline: neutralHeadline(v, fix) })));

writeFileSync(join(OUT, 'answer-sanity.json'), JSON.stringify({
  version: ANSWER_CHECK_VERSION,
  croissant,
  coherence,
  digits,
  digitMarks,
  wordLines,
  neutral,
  plain: { correct: PLAIN_CORRECT_HEADLINE, acceptable: PLAIN_ACCEPTABLE_HEADLINE, reordered: REORDERED_NOTE },
  normalized,
  texts,
  mine,
  marks,
}, null, 1));
