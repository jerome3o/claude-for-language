/**
 * Claude's check of a lesson answer (shared/lesson/answerCheck.ts): answerCheckApplies, the cache
 * text, normalizeAnswerCheck over raw replies (the shape rules), the chip, the suggestion,
 * tipSegments and askQuickQuestions. Writes lesson-answer-check.json; checked by
 * core/…/LessonAnswerCheckParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerCheckApplies, answerCheckCacheText, answerCheckChip, askQuickQuestions, normalizeAnswerCheck, suggestedFor, tipSegments,
  ANSWER_CHECK_VERDICTS,
} from '../../../shared/lesson/answerCheck';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const types = ['translate', 'listen_translate', 'sentence_making', 'dictation'];
const answers = ['即使便宜，我也不买。', "I won't buy it", '', '   ', '。', '我也不买 ok', '　你好　', null];
const applies = types.flatMap((t) => answers.map((a) => ({ type: t, answer: a, applies: answerCheckApplies(t, a) })));

const inputs = [
  { prompt_en: "Even if it's cheap, I won't buy it.", model_answer: '即使很便宜，我也不买。', answer: '即使便宜，我也不买。', exercise_type: 'translate' },
  { prompt_en: "  EVEN if it's cheap,\nI won't buy it. ", model_answer: '即使很便宜，我也不买。', answer: '即使便宜 我也不买', exercise_type: 'translate', input: 'typed' },
  { prompt_en: 'The doctor told me to take medicine and rest well.', model_answer: '医生让我吃药，好好休息。', answer: '医生让我吃药和好好休息。', exercise_type: 'translate', input: 'spoken', focus: '  Linking ACTIONS ' },
  { prompt_en: 'Ｆｕｌｌ　ｗｉｄｔｈ', model_answer: '你好！', answer: '你　好', exercise_type: 'listen_translate', input: 'edited', focus: '' },
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

writeFileSync(join(OUT, 'lesson-answer-check.json'), JSON.stringify({
  applies,
  cacheTexts,
  normalized,
  chips: ANSWER_CHECK_VERDICTS.map((v) => ({ verdict: v, chip: answerCheckChip(v), suggested: suggestedFor(v) })),
  tips: tips.map((tip) => ({ tip, result: tipSegments(tip) })),
  quick: [null, 'correct', 'acceptable', 'almost', 'wrong'].map((v) => ({ verdict: v, questions: askQuickQuestions(v as 'correct' | null) })),
}, null, 1));
