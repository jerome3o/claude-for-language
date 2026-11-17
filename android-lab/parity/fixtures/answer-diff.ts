/**
 * The slim answer feedback (shared/cards/answer-diff.ts): his answer lined up with the expected one character by
 * character, the one-line summary, the line a surface shows, the screen-reader label. Writes answer-diff.json;
 * core AnswerDiffParityTest asserts AnswerDiff.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerDiff, answerDiffLabel, answerDiffLine, answerDiffSummary, answerDiffTone, firstSentence, ANSWER_DIFF_VERDICT,
  ANSWER_DIFF_EMPTY, ANSWER_DIFF_FAR, ANSWER_DIFF_ORDER, ANSWER_DIFF_RIGHT, ANSWER_DIFF_WORDED, ANSWER_DIFF_YOU_SAID, ANSWER_DIFF_YOUR_ANSWER,
} from '../../../shared/cards/answer-diff';

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
];
const HEADLINES = [null, '', 'A different sentence. Use 去 for going.', 'Almost — the 即使…也 is right, but make it a command and keep it short so it reads naturally in Chinese conversation every day.'];

const cases = PAIRS.map(([said, expected]) => {
  const d = answerDiff(said, expected);
  const summary = answerDiffSummary(d);
  const lines = [] as unknown[];
  for (const accepted of [false, true]) for (const headline of HEADLINES) lines.push({ accepted, headline, line: answerDiffLine({ diff: d, accepted, headline }) });
  return { said, expected, diff: d, summary, tone: answerDiffTone(d), toneAccepted: answerDiffTone(d, true), lines, label: answerDiffLabel(d, summary), labelSaid: answerDiffLabel(d, summary, ANSWER_DIFF_YOU_SAID) };
});
const sentences = ['', '  Almost.  Then more. ', 'No end mark here', 'Short! And more', '你说得对。但是……', 'x'.repeat(120), `${'y'.repeat(88)}  z`]
  .map((text) => ({ text, first: firstSentence(text), first20: firstSentence(text, 20) }));

writeFileSync(join(OUT, 'answer-diff.json'), JSON.stringify({
  cases, sentences, verdicts: ANSWER_DIFF_VERDICT,
  copy: {
    right: ANSWER_DIFF_RIGHT, worded: ANSWER_DIFF_WORDED, order: ANSWER_DIFF_ORDER, far: ANSWER_DIFF_FAR, empty: ANSWER_DIFF_EMPTY,
    youSaid: ANSWER_DIFF_YOU_SAID, yourAnswer: ANSWER_DIFF_YOUR_ANSWER,
  },
}, null, 1));
