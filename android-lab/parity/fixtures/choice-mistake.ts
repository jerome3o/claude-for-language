/**
 * Golden vectors for "which sentence is wrong?" choices (shared/lesson/choiceMistake.ts): question detection
 * (English / Chinese, the conservative exclusions), which option is the mistake, what a pick / 🎤 Say it again / the
 * prefetch speak per correction state, the correction call's input + cache text, reply normalisation and the authoring
 * warning. Writes choice-mistake.json; checked by core/…/ChoiceMistakeParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  choiceAsksForWrong, choiceCorrectionCacheText, choiceCorrectionInput, choiceCorrectionWarnings, choicePickSpeech,
  choiceSayAgainSentence, choiceTtsTexts, initialChoiceCorrection, isWrongOption, needsChoiceCorrection,
  normalizeChoiceCorrection, questionAsksForWrong, type ChoiceCorrection,
} from '../../../shared/lesson/choiceMistake';
import { exerciseTtsTexts, type ChoiceExerciseSpec } from '../../../shared/lesson/types';
import { sayAgainTarget } from '../../../shared/lesson/feedback';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: choice-mistake <out-dir>');
mkdirSync(OUT, { recursive: true });

const QUESTIONS = [
  'Which sentence is wrong?', 'Which sentence is incorrect?', 'Which one is NOT correct?', "Which of these isn't correct?",
  'Which of these isn’t right?', 'Which sentence has a mistake?', 'Which sentence contains an error?',
  'Which sentence uses 了 incorrectly?', 'Which sentence uses了incorrectly?', 'Which one is ungrammatical?', 'Find the mistake.',
  'Spot the error!', 'Pick the wrong sentence', 'Choose the incorrect option.', 'WHICH IS WRONG', 'whichever is wrong',
  'Which sentence is correct?', 'Which one fits?', 'Which sentence has no mistakes?', 'Which sentence is not wrong?',
  'Choose the correct sentence (one has a mistake).', 'Which one is the right answer?', 'Which is not the correct sentence?',
  'Which statement is wrong according to the dialogue?', 'Based on the text, which is wrong?', 'Your friend asks what is wrong. What do you say?',
  'Which sentence is wrong? Then say the correct version.', 'Is 了 in the right place?\nWhich sentence is wrong?', 'Which one? It is wrong.',
  'Which one is error-free?', 'Which has nothing wrong?', 'Which sentence has errors', 'which one is unnatural',
  '哪个句子是错的？', '哪句话有错误？', '哪一个不对？', '下面哪个句子有语病？', '哪个用法不正确？', '找出病句。', '选出错误的句子',
  '指出有问题的句子', '哪个句子是正确的？', '哪个句子没有错误？', '哪个说法不错？', '根据对话，哪个说法是错的？', '选出正确的句子',
  '哪个是对的？', '哪些句子不自然？', '错的是哪个？', '', '   ', 'wrong', 'Which', '哪个', 'mistake',
];

const questions = QUESTIONS.map((q) => ({ q, asks: questionAsksForWrong(q) }));

const BASE: ChoiceExerciseSpec = {
  type: 'choice',
  question: 'Which sentence is wrong?',
  options: [{ hanzi: '我昨天买了一本书。' }, { hanzi: '他了去北京。', english: 'He went to Beijing.' }, { hanzi: '我吃了饭。', pinyin: 'Wǒ chī le fàn.' }],
  correct: 1,
  explanation: '了 never goes before the verb.',
};

const EXERCISES: ChoiceExerciseSpec[] = [
  BASE,
  { ...BASE, correction: { hanzi: ' 他去北京了。 ', pinyin: ' Tā qù Běijīng le. ', english: 'He went to Beijing.' } },
  { ...BASE, question: 'Look closely.', correction: { hanzi: '他去北京了。' } },
  { ...BASE, question: 'Look closely.', correction: { hanzi: '   ' } },
  { ...BASE, correct: 0, question: '哪个句子是错的？' },
  { ...BASE, question: 'Which sentence is correct?', correct: 0 },
  { type: 'choice', question: 'Your friend looks tired. What do you say?', options: [{ hanzi: '你累了吗？' }, { hanzi: 'hello' }], correct: 0 },
  { type: 'choice', question: 'Which is wrong?', options: [{ hanzi: 'cat' }, { hanzi: 'dog' }], correct: 1 },
  { type: 'choice', question: 'Which is wrong?', options: [{ hanzi: '好' }], correct: 3 },
  { type: 'choice', question: 'Which is wrong?', options: [{ hanzi: ' 好 ' }, { hanzi: ' ' }, { hanzi: '对' }], correct: 0, explanation: '  ' },
];

const STATES: Array<ChoiceCorrection | null> = [
  null,
  { status: 'loading' },
  { status: 'unchanged' },
  { status: 'unavailable', offline: true },
  { status: 'unavailable', offline: false },
  { status: 'none' },
  { status: 'ready', source: 'fetched', correction: { hanzi: '他去了北京。', pinyin: 'Tā qù le Běijīng.' } },
];

const exercises = EXERCISES.map((ex) => ({
  exercise: ex,
  asks: choiceAsksForWrong(ex),
  needs: needsChoiceCorrection(ex),
  initial: initialChoiceCorrection(ex),
  tts: choiceTtsTexts(ex),
  exerciseTts: exerciseTtsTexts(ex),
  sayAgain: sayAgainTarget(ex),
  input: choiceCorrectionInput(ex),
  states: STATES.map((state) => ({
    state,
    wrong: ex.options.map((_, i) => isWrongOption(ex, i, state ?? undefined)),
    picks: ex.options.map((_, i) => choicePickSpeech(ex, i, state ?? undefined)),
    sayAgain: choiceSayAgainSentence(ex, state ?? undefined),
  })),
}));

const cacheTexts = [
  { question: ' Which is wrong? ', sentence: ' 他了去北京。 ' },
  { question: '', sentence: '他了去北京。' },
].map((input) => ({ input, text: choiceCorrectionCacheText(input) }));

const REPLIES: Array<{ raw: unknown; sentence: string }> = [
  { raw: { hanzi: '他去北京了。', english: 'He went.' }, sentence: '他了去北京。' },
  { raw: { correction: { hanzi: ' 他去北京了 ', pinyin: ' tā ' } , unchanged: false, cached: true }, sentence: '他了去北京。' },
  { raw: { hanzi: '他了去北京', already_correct: false }, sentence: '他了去北京。' },
  { raw: { already_correct: true }, sentence: ' 他了去北京。 ' },
  { raw: { correction: { hanzi: '他了去北京。' }, unchanged: true }, sentence: '他了去北京。' },
  { raw: { hanzi: '' }, sentence: '他了去北京。' },
  { raw: { hanzi: 'abc' }, sentence: '他了去北京。' },
  { raw: null, sentence: '他了去北京。' },
  { raw: { hanzi: 3 }, sentence: '他了去北京。' },
];
const replies = REPLIES.map(({ raw, sentence }) => {
  try {
    return { raw, sentence, result: normalizeChoiceCorrection(raw, sentence) };
  } catch {
    return { raw, sentence, result: null };
  }
});

const warnings = choiceCorrectionWarnings({ title: 't', sections: [{ exercises: EXERCISES }, { exercises: [BASE] }] });

writeFileSync(join(OUT, 'choice-mistake.json'), JSON.stringify({ questions, exercises, cacheTexts, replies, warnings }));
