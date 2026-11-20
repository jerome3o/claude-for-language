/**
 * The slim answer feedback (shared/cards/answer-diff.ts): his answer lined up with the expected one character by
 * character, the one-line summary, the line a surface shows, the screen-reader label. Writes answer-diff.json;
 * core AnswerDiffParityTest asserts AnswerDiff.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerDiff, answerDiffLabel, answerDiffLine, answerDiffPinyin, answerDiffSummary, answerDiffTone, firstSentence, ANSWER_DIFF_VERDICT,
  ANSWER_DIFF_EMPTY, ANSWER_DIFF_FAR, ANSWER_DIFF_ORDER, ANSWER_DIFF_RIGHT, ANSWER_DIFF_WORDED, ANSWER_DIFF_YOU_SAID, ANSWER_DIFF_YOUR_ANSWER,
  readAloudResultLine,
} from '../../../shared/cards/answer-diff';
import { judgeReadAloud } from '../../../shared/reader/readAloud';
import {
  answerAskOffered, answerAskQuestion, answerMore, answerWhy, deviceWhy, ANSWER_ASK_CLAUDE, ANSWER_WHY_ALTERNATIVE, ANSWER_WHY_CORRECTED, ANSWER_WHY_LESS, ANSWER_WHY_MAX, ANSWER_WHY_MORE,
  ANSWER_WHY_STOCK, type AnswerWhyCheck,
} from '../../../shared/cards/answer-why';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: answer-diff <out-dir>');
mkdirSync(OUT, { recursive: true });

const PAIRS: [string, string][] = [
  ['我明天去北京', '我明天去北京。'],
  ['我去成读', '我去成都'],
  ['我明天去北京了', '我明天去北京。'],
  ['我明天去北', '我明天去北京。'],
  ['我得书', '我的书'],
  ['明天我去北京', '我明天去北京'],
  ['我早上喝咖啡，因为工作不困。', '我早上喝咖啡是为了上班不困。'],
  ['我有3本书', '我有三本书'],
  ['我有三本书', '我有3本书'],
  ['我12岁', '我十二岁。'],
  ['由', '油'],
  ['', '你好'],
  ['。', '你好'],
  ['你好', ''],
  ['我越学中文，越觉得英语很繁琐', '我越学中文，越觉得英文很繁琐。'],
  ['他的书', '我的书呢'],
  ['我很喜欢你', '我喜欢你'],
  ['你好吗', '我很好'],
  ['朗', '狼'],
  ['银航', '银行'],
  ['妈骂', '马麻'],
  ['妈骂妈', '马麻马'],
  ['他们昨天在家看电影', '我明天去北京'],
  ['我去北京', '我们明天一起去北京吧'],
  ['ABC 你好', '你好'],
  ['我是学生', '我是一个学生。'],
  ['我两本书', '我二本书'],
  ['一生救了他的命', '救'],
  ['因为这个问题，我睡不着觉', '我因为这个问题睡不着觉'],
  ['這是我的書', '这是我的书'],
  ['我喜欢喝茶和咖啡', '我喜欢喝咖啡'],
  ['银行几点开始营业', '银行几点开门？'],
  ['你好啊我是小明', '你好，我是小明。'],
  ['我去北京了吗', '我去北京。'],
  // Pinyin under "You said" (his syllables, marked like his characters).
  ['他捂住了我。', '他侮辱了我'],
  ['我们去了北京了', '我们去北京'],
  ['我不是一个学生', '我是学生'],
  ['我dou去', '我都去'],
  ['hello', '你好'],
  ['我有12个', '我有十三个'],
  // A recogniser's punctuation is never a difference.
  ['“我去”', '我去'],
  ['我去～', '我去。'],
  ['我去——北京', '我去北京'],
];
const HEADLINES = [null, '', 'A different sentence. Use 去 for going.', 'Almost — the 即使…也 is right, but make it a command and keep it short so it reads naturally in Chinese conversation every day.'];

const cases = PAIRS.map(([said, expected]) => {
  const d = answerDiff(said, expected);
  const summary = answerDiffSummary(d);
  const lines = [] as unknown[];
  for (const accepted of [false, true]) for (const headline of HEADLINES) lines.push({ accepted, headline, line: answerDiffLine({ diff: d, accepted, headline }) });
  return { said, expected, diff: d, pinyin: answerDiffPinyin(d), summary, tone: answerDiffTone(d), toneAccepted: answerDiffTone(d, true), lines, label: answerDiffLabel(d, summary), labelSaid: answerDiffLabel(d, summary, ANSWER_DIFF_YOU_SAID) };
});
const sentences = ['', '  Almost.  Then more. ', 'No end mark here', 'Short! And more', '你说得对。但是……', 'x'.repeat(120), `${'y'.repeat(88)}  z`]
  .map((text) => ({ text, first: firstSentence(text), first20: firstSentence(text, 20) }));

const READINGS: [string, string][] = [
  ['我去成都，都是好地方。', '我去成读，读是好地方。'],
  ['我去成都，都是好地方。', '我去成都，都是好地方。'],
  ['我去成都，都是好地方。', '我去成都'],
  ['我去成都，都是好地方。', '我去成都，是好地方了'],
  ['小明在巴黎。他很喜欢吃面包，每天早上都去面包店。', '小明在巴黎他很喜欢吃包子每天都去面包店'],
  ['他有12本书。', '他有十二本书'],
  ['他有12本书。', '他有十三本书'],
  ['今天很冷。', ''],
  ['今天很冷。', '明天很热啊'],
];
const readings = READINGS.map(([page, said]) => ({ page, said, line: readAloudResultLine(judgeReadAloud(page, said)) }));

// The one "why" sentence + what "Explain more" opens (shared/cards/answer-why.ts).
const CHECKS: (AnswerWhyCheck | null)[] = [
  null,
  { headline: 'Correct — 一个 is optional here. Both are natural.', tips: [] },
  { headline: 'Exactly right — nice!', tips: [] },
  { headline: 'Nearly — compare with the corrected version.', tips: [{ text: '得 needs a complement after the verb; 好 alone isn’t enough.' }, { text: 'Say 说得很好.' }], corrected: '他说得很好。' },
  { headline: 'Not quite — have another go.', tips: [] },
  { headline: '  ', tips: [{ text: '  ' }], corrected: '我们都去北京了吗', alternative: '我们都去过北京吗' },
  { headline: `Tone: 买 mǎi is third tone, you said mài (sell) — ${'and that changes the meaning completely, which matters a lot here '.repeat(2)}`, tips: [{ text: 'Practise 买 vs 卖.' }] },
  { headline: 'Use 她, not 他.', tips: [{ text: 'Use 她, not 他.' }, { text: 'The story is about a woman.' }, { text: 'a' }, { text: 'b' }, { text: 'c' }], alternative: '她很高' },
  { headline: 'Different wording, same meaning — that works', tips: [{ text: '' }], corrected: '这是一个真实的故事。' },
];
const WHY_PAIRS: [string, string][] = [
  ['这是一个真实的故事。', '这是真实的故事。'],
  ['由', '油'],
  ['我有3本书', '我有三本书'],
  ['他说的很好', '他说得很好'],
  ['他们豆去北京很了', '我们都去北京了吗'],
  ['我们都去北京了吗', '我们都去北京了吗'],
  ['妈骂妈马', '马麻马麻'],
  ['我们都去北京了', '我们都去过北京吗。'],
];
const whys = WHY_PAIRS.flatMap(([said, expected]) => CHECKS.map((check) => {
  const diff = answerDiff(said, expected);
  const line = answerDiffLine({ diff, accepted: false, headline: check?.headline });
  const why = answerWhy({ diff, check, line });
  const whyNoLine = answerWhy({ diff, check });
  return { said, expected, check, line, why, whyNoLine, device: deviceWhy(diff), more: answerMore(check, why, said), moreNoWhy: answerMore(check, null), moreExpected: answerMore(check, why, said, expected) };
}));

// A WRITTEN answer (typed / handwritten): judged by the characters — a homophone or another tone is wrong.
const WRITTEN_PAIRS: [string, string][] = [
  ...PAIRS,
  ['图书官', '图书馆'],
  ['打蒜', '打算'],
  ['你好', '你好吗'],
  ['谢谢你', '谢谢'],
  ['我是读书', '我是都书'],
];
const written = WRITTEN_PAIRS.map(([said, expected]) => {
  const d = answerDiff(said, expected, { written: true });
  return { said, expected, diff: d, summary: answerDiffSummary(d), tone: answerDiffTone(d) };
});

// The 💬 Ask Claude fallback: when it is offered, and the question it asks.
const asks = (['right', 'close', 'wrong'] as const).flatMap((tone) => [null, 'Use 侮辱 for insult.'].flatMap((why) =>
  [null, { tips: ['x'], corrected: null, alternative: null }].flatMap((more) => [true, false].map((canAsk) =>
    ({ tone, why, more: more !== null, canAsk, offered: answerAskOffered({ tone, why, more, canAsk }) })))));
const ASK_QUESTIONS: { said: string; expected: string; prompt?: string | null; spoken?: boolean }[] = [
  { said: '他捂住了我', expected: '他侮辱了我', prompt: 'He insulted me' },
  { said: '他打了我', expected: '他侮辱了我', prompt: 'He insulted me.' },
  { said: '你去哪儿', expected: '你去哪里？', prompt: 'Where are you going?' },
  { said: '我  去 ', expected: '我去。', prompt: null },
  { said: '我得书', expected: '我的书', prompt: '  my  book ', spoken: false },
  { said: '你好', expected: '您好', spoken: true },
];
const askQuestions = ASK_QUESTIONS.map((q) => ({ ...q, question: answerAskQuestion(q) }));

writeFileSync(join(OUT, 'answer-diff.json'), JSON.stringify({
  cases, written, asks, askQuestions, askLabel: ANSWER_ASK_CLAUDE, sentences, readings, verdicts: ANSWER_DIFF_VERDICT, whys,
  whyCopy: { max: ANSWER_WHY_MAX, more: ANSWER_WHY_MORE, less: ANSWER_WHY_LESS, corrected: ANSWER_WHY_CORRECTED, alternative: ANSWER_WHY_ALTERNATIVE, stock: ANSWER_WHY_STOCK },
  copy: {
    right: ANSWER_DIFF_RIGHT, worded: ANSWER_DIFF_WORDED, order: ANSWER_DIFF_ORDER, far: ANSWER_DIFF_FAR, empty: ANSWER_DIFF_EMPTY,
    youSaid: ANSWER_DIFF_YOU_SAID, yourAnswer: ANSWER_DIFF_YOUR_ANSWER,
  },
}, null, 1));
