/**
 * Claude's check of a lesson answer (shared/lesson/answerCheck.ts): answerCheckApplies, the cache
 * text, normalizeAnswerCheck over raw replies (the shape rules), the chip, the suggestion,
 * tipSegments, askQuickQuestions and exactAnswerCheck (the model answer itself → a local check). Writes lesson-answer-check.json; checked by
 * core/…/LessonAnswerCheckParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerCheckApplies, answerCheckCacheText, answerCheckChip, askQuickQuestions, exactAnswerCheck, normalizeAnswerCheck, suggestedFor, tipSegments,
  ANSWER_CHECK_VERDICTS,
} from '../../../shared/lesson/answerCheck';
import {
  scrambleCheckInput, scrambleLocalVerdict, scrambleOrderText, scrambleOutcome, scrambleSentence, scrambleSpokenSentence,
} from '../../../shared/lesson/scrambleCheck';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const types = ['translate', 'listen_translate', 'read_aloud', 'scramble', 'sentence_making', 'dictation'];
const answers = ['即使便宜，我也不买。', "I won't buy it", '', '   ', '。', '我也不买 ok', '　你好　', null];
const applies = types.flatMap((t) => answers.map((a) => ({ type: t, answer: a, applies: answerCheckApplies(t, a) })));

const inputs = [
  { prompt_en: "Even if it's cheap, I won't buy it.", model_answer: '即使很便宜，我也不买。', answer: '即使便宜，我也不买。', exercise_type: 'translate' },
  { prompt_en: "  EVEN if it's cheap,\nI won't buy it. ", model_answer: '即使很便宜，我也不买。', answer: '即使便宜 我也不买', exercise_type: 'translate', input: 'typed' },
  { prompt_en: 'The doctor told me to take medicine and rest well.', model_answer: '医生让我吃药，好好休息。', answer: '医生让我吃药和好好休息。', exercise_type: 'translate', input: 'spoken', focus: '  Linking ACTIONS ' },
  { prompt_en: 'Ｆｕｌｌ　ｗｉｄｔｈ', model_answer: '你好！', answer: '你　好', exercise_type: 'listen_translate', input: 'edited', focus: '' },
  // Meaning checks (Hard mode's "Sentences by ear"): the Chinese heard, the English model, his English.
  { prompt_en: '我昨天没去银行。', model_answer: "I didn't go to the bank yesterday.", answer: '  I WENT to the bank… yesterday!', exercise_type: 'listen_translate', input: 'spoken' },
  { prompt_en: ' 你好 ', model_answer: 'Ｈｅｌｌｏ!', answer: 'hello — there', exercise_type: 'listen_translate', input: 'typed' },
  { prompt_en: '我去银行。', model_answer: 'I go to the bank.', answer: 'Je vais à la banque 2', exercise_type: 'listen_translate', input: 'edited' },
  // Word orders (shared/lesson/scrambleCheck.ts): no input mode, no focus; the tiles' spaces aside.
  { prompt_en: ' As soon as the child SAW the cake,  he cheered up. ', model_answer: '孩子 一看见 蛋糕 就 高兴起来了', answer: '一看见 蛋糕 孩子 就 高兴起来了', exercise_type: 'scramble', input: 'typed', focus: '一…就' },
  { prompt_en: 'I finished my homework.', model_answer: '我 把 作业 做完了', answer: '作业 我 把 做完了。', exercise_type: 'scramble', input: 'spoken' },
];
const cacheTexts = inputs.map((input) => ({ input, text: answerCheckCacheText(input) }));

const answer = '即使你不记得这些词，也不着急，就多练习。';
const raws: unknown[] = [
  { verdict: 'almost', headline: ' Make it a command. ', corrected: '即使你不记得这些词，也别着急，你就多练习吧。', corrected_pinyin: 'jíshǐ  nǐ', tips: [{ text: 'a', quote: '也不着急' }, { text: 'b', quote: 'abc' }, 'c', { text: 'd' }], alternative: { hanzi: '多练习就好了。', english: 'Just practise more.', pinyin: 'duō liànxí' } },
  { verdict: 'correct', headline: 'ok', corrected: '即使你不记得这些词', tips: [], alternative: { hanzi: answer } },
  { verdict: 'acceptable', headline: 'fine', corrected: '', tips: [{ text: '' }, null, 5, { text: 'x'.repeat(300), quote: '也'.repeat(80) }] },
  { verdict: 'wrong', headline: 'x', corrected: '即使你不记得这些词，也不着急，就多练习！', corrected_pinyin: 'p', alternative: { hanzi: 'english only' } },
  { verdict: 'wrong', headline: 'x', corrected: 'english only', alternative: ['多练习'] },
  { verdict: 'great', headline: 'x' },
  { verdict: 'almost', headline: '   ' },
  { verdict: 'almost', headline: 'h', tips: 'not a list', alternative: { hanzi: '别着急。', english: 7 } },
  null,
  [],
  'almost',
];
const normalized = raws.map((raw) => {
  try {
    return { raw, answer, check: normalizeAnswerCheck(raw, answer), error: false };
  } catch {
    return { raw, answer, check: null, error: true };
  }
});

const tips = [
  { text: '也不着急 is a statement; use 别.', quote: '也不着急' },
  { text: '和 links nouns, not 和 actions', quote: '和' },
  { text: 'Use a comma.', quote: '和' },
  { text: '' },
  { text: 'Say 𠀀 or 你好 — fine!' },
  { text: '再再再', quote: '再再' },
];

const exactModel = '车站就在我家对面。';
const exactCases = [
  { exercise_type: 'translate', model_answer: exactModel, answer: '车站就在我家对面。' },
  { exercise_type: 'translate', model_answer: exactModel, answer: ' 车站 就在我家对面 ！' },
  { exercise_type: 'listen_translate', model_answer: exactModel, answer: '车站就在我家对面.' },
  { exercise_type: 'translate', model_answer: '（你好）', answer: '你好' },
  { exercise_type: 'translate', model_answer: exactModel, answer: '车站在我家对面。' },
  { exercise_type: 'translate', model_answer: exactModel, answer: '车站就在我家对面吗' },
  { exercise_type: 'translate', model_answer: '你好！', answer: '你好～' },
  { exercise_type: 'translate', model_answer: exactModel, answer: '' },
  { exercise_type: 'sentence_making', model_answer: exactModel, answer: exactModel },
  { exercise_type: 'listen_translate', model_answer: 'The station', answer: 'The station' },
  // Meaning checks: his English = the sentence's English, case / punctuation / spacing aside.
  { exercise_type: 'listen_translate', model_answer: "I didn't go to the bank yesterday.", answer: "  i DIDN'T go to the bank, yesterday " },
  { exercise_type: 'listen_translate', model_answer: "I didn't go to the bank yesterday.", answer: 'I went to the bank yesterday' },
  { exercise_type: 'listen_translate', model_answer: 'The station', answer: '123' },
  { exercise_type: 'listen_translate', model_answer: 'The station', answer: '车站' },
  { exercise_type: 'translate', model_answer: 'The station', answer: 'The station' },
  { exercise_type: 'listen_translate', model_answer: 'Ｃａｆé 2', answer: 'café   2!' },
].map((input) => ({ input, check: exactAnswerCheck(input) }));

// Word order (scramble): the device's verdict, the check input, the answer screen per check state.
const cake = {
  english: 'As soon as the child saw the cake, he cheered up.',
  tiles: ['高兴起来了', '孩子', '就', '蛋糕', '一看见'],
  correct_order: ['孩子', '一看见', '蛋糕', '就', '高兴起来了'],
};
const jerome = ['一看见', '蛋糕', '孩子', '就', '高兴起来了'];
const scrambleLocal = [
  { picked: cake.correct_order, alts: null },
  { picked: jerome, alts: null },
  { picked: jerome, alts: [jerome] },
  { picked: ['孩子 ', '一看见', '蛋糕', '就', '高兴起来了'], alts: [] },
  { picked: jerome.slice(1), alts: null },
  { picked: ['就', '孩子', '一看见', '蛋糕', '高兴起来了'], alts: [jerome] },
].map((c) => ({ ...c, verdict: scrambleLocalVerdict(c.picked, cake.tiles, cake.correct_order, c.alts) }));
const scrambleInputs = [
  { english: cake.english, correct_order: cake.correct_order, picked: jerome, focus: ' 一…就 ' },
  { english: cake.english, correct_order: cake.correct_order, picked: [' 一 看见 ', '蛋糕', '', '孩子', '就', '高兴起来了'], focus: null },
  { english: '  ', correct_order: cake.correct_order, picked: jerome, focus: null },
  { english: 'a b', correct_order: ['a', 'b'], picked: ['b', 'a'], focus: null },
].map((c) => ({ ...c, input: scrambleCheckInput(c, c.picked, c.focus), sentence: scrambleSentence(c.picked), text: scrambleOrderText(c.picked) }));
const mk = (verdict: string, headline: string) => normalizeAnswerCheck({ verdict, headline, corrected: '', tips: [] }, jerome.join(''));
const statuses: Array<unknown> = [
  null,
  { status: 'checking' },
  { status: 'unavailable' },
  ...['correct', 'acceptable', 'almost', 'wrong'].map((v) => ({ status: 'done', check: mk(v, `${v} — 一…就`) })),
];
const scrambleOutcomes = (['right', 'unexpected'] as const).flatMap((local) => [true, false].flatMap((same) => statuses.map((status) => {
  const outcome = scrambleOutcome(local, status as never, same);
  return { local, same, status, outcome, spoken: scrambleSpokenSentence(outcome, jerome, cake.correct_order) };
})));

writeFileSync(join(OUT, 'lesson-answer-check.json'), JSON.stringify({
  scrambleLocal,
  scrambleInputs,
  scrambleOutcomes,
  applies,
  cacheTexts,
  normalized,
  chips: ANSWER_CHECK_VERDICTS.map((v) => ({ verdict: v, chip: answerCheckChip(v), suggested: suggestedFor(v) })),
  tips: tips.map((tip) => ({ tip, result: tipSegments(tip) })),
  exact: exactCases,
  quick: [null, 'correct', 'acceptable', 'almost', 'wrong'].map((v) => ({ verdict: v, questions: askQuickQuestions(v as 'correct' | null) })),
}, null, 1));
