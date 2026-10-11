/**
 * A lesson's written answer that was spoken (shared/lesson/spoken-check.ts): lessonSpokenCheck over
 * transcripts × expected answers × sources, lessonAnswerCorrect with diffHanzi, answerInputLabel.
 * Writes lesson-spoken.json; checked by core/…/LessonSpokenParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { answerInputLabel, lessonAnswerCorrect, lessonSpokenCheck } from '../../../shared/lesson/spoken-check';
import { diffHanzi } from '../../../shared/lesson/answer-check';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const pairs: Array<[string, string, string[]]> = [
  ['在见', '再见', []], ['再见！', '再见', []], ['他长得很好。', '长得', []], ['买', '卖', []], ['猫', '狗', []],
  ['我想要一杯咖啡', '我想要一杯咖啡。', []], ['我想要一杯咖啡', '我要一杯咖啡', ['我想要一杯咖啡']], ['我想要一杯卡飞', '我想要一杯咖啡', []],
  ['你好', '您好', []], ['泥好', '你好', ['您好']], ['我有7个', '我有七个', []], ['', '你好', []], ['  ', '你好', []],
  ['hello', '你好', []], ['我今天去银行了', '银行', []], ['我今天去因行了', '银行', []], ['衣个', '一个', []], ['他是我的朋友', '她是我的朋友', []],
  ['蛋糕被妹妹吃掉了', '蛋糕被妹妹吃掉了。', []], ['蛋糕被妹妹吃了', '蛋糕被妹妹吃掉了。', []],
];
const sources = ['spoken', 'edited', 'typed', null] as const;

const cases = pairs.flatMap(([answer, expected, alternatives]) => sources.map((source) => {
  const r = lessonSpokenCheck(answer, expected, alternatives, source);
  const strict = diffHanzi(answer, expected, alternatives).correct;
  return { answer, expected, alternatives, source, verdict: r.verdict, accepted: r.accepted, note: r.note, strict, correct: lessonAnswerCorrect(strict, r) };
}));

writeFileSync(join(OUT, 'lesson-spoken.json'), JSON.stringify({
  cases,
  labels: (['spoken', 'edited', 'typed', null, 'x'] as const).flatMap((i) => [undefined, 'Wrote'].map((t) => ({
    input: i, typed_label: t ?? null, label: answerInputLabel(i as 'spoken', t),
  }))),
}, null, 1));
