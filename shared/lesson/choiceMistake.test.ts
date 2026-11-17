import { describe, expect, it } from 'vitest';
import {
  choiceAsksForWrong,
  choiceCorrectionCacheText,
  choiceCorrectionInput,
  choiceCorrectionWarnings,
  choiceOptionSpeakable,
  choicePickSpeech,
  choiceSayAgainSentence,
  choiceTtsTexts,
  initialChoiceCorrection,
  isWrongOption,
  needsChoiceCorrection,
  normalizeChoiceCorrection,
  pickChoiceCorrectionInput,
  questionAsksForWrong,
  type ChoiceCorrection,
} from './choiceMistake';
import { exerciseTtsTexts, type ChoiceExerciseSpec } from './types';
import { sayAgainTarget } from './feedback';
import { validateLessonSpec } from './validate';
import { lessonSoftWarnings } from './introWarnings';
import { LESSON_EXERCISE_DOC } from './doc';

export const ASKS_WRONG_QUESTIONS = [
  'Which sentence is wrong?',
  'Which sentence is incorrect?',
  'Which one is NOT correct?',
  "Which of these isn't correct?",
  'Which sentence has a mistake?',
  'Which sentence contains an error?',
  'Which sentence uses 了 incorrectly?',
  'Which one is ungrammatical?',
  'Find the mistake.',
  'Spot the error!',
  'Pick the wrong sentence',
  'Choose the incorrect option.',
  '哪个句子是错的？',
  '哪句话有错误？',
  '哪一个不对？',
  '下面哪个句子有语病？',
  '哪个用法不正确？',
  '找出病句。',
  '选出错误的句子',
  '指出有问题的句子',
  'Is 了 in the right place? Which sentence is wrong?',
];

export const NOT_WRONG_QUESTIONS = [
  'Your friend looks tired. What do you say?',
  'Which sentence is correct?',
  'Which one fits?',
  'Which sentence has no mistakes?',
  'Which sentence is not wrong?',
  'Choose the correct sentence (one has a mistake).',
  'Which one is the right answer?',
  'Which statement is wrong according to the dialogue?',
  'Your friend asks what is wrong. What do you say?',
  '哪个句子是正确的？',
  '哪个句子没有错误？',
  '哪个说法不错？',
  '根据对话，哪个说法是错的？',
  '选出正确的句子',
  '',
];

const wrongChoice: ChoiceExerciseSpec = {
  type: 'choice',
  question: 'Which sentence is wrong?',
  options: [
    { hanzi: '我昨天买了一本书。' },
    { hanzi: '他了去北京。', english: 'He went to Beijing.' },
    { hanzi: '我吃了饭。' },
  ],
  correct: 1,
  explanation: '了 never goes before the verb.',
};

const withCorrection: ChoiceExerciseSpec = {
  ...wrongChoice,
  correction: { hanzi: ' 他去北京了。 ', pinyin: 'Tā qù Běijīng le.', english: 'He went to Beijing.' },
};

const ordinary: ChoiceExerciseSpec = {
  type: 'choice',
  question: 'Your friend looks tired. What do you say?',
  options: [{ hanzi: '你累了吗？' }, { hanzi: '你饿了吗？' }],
  correct: 0,
};

describe('questionAsksForWrong', () => {
  it.each(ASKS_WRONG_QUESTIONS)('asks for the wrong one: %s', (q) => expect(questionAsksForWrong(q)).toBe(true));
  it.each(NOT_WRONG_QUESTIONS)('does not: %s', (q) => expect(questionAsksForWrong(q)).toBe(false));
});

describe('which text is spoken', () => {
  it('an ordinary choice speaks every option, as before', () => {
    expect(choiceAsksForWrong(ordinary)).toBe(false);
    expect(initialChoiceCorrection(ordinary)).toEqual({ status: 'none' });
    expect(choicePickSpeech(ordinary, 0)).toBe('你累了吗？');
    expect(choicePickSpeech(ordinary, 1)).toBe('你饿了吗？');
    expect(choiceTtsTexts(ordinary)).toEqual(['你累了吗？', '你饿了吗？']);
    expect(choiceSayAgainSentence(ordinary)).toEqual({ hanzi: '你累了吗？' });
  });

  it('the spec correction is the explicit marker and is what is spoken', () => {
    const marked = { ...withCorrection, question: 'Look at the sentences.' };
    expect(choiceAsksForWrong(marked)).toBe(true);
    const state = initialChoiceCorrection(marked);
    expect(state).toEqual({ status: 'ready', source: 'spec', correction: { hanzi: '他去北京了。', pinyin: 'Tā qù Běijīng le.', english: 'He went to Beijing.' } });
    expect(choicePickSpeech(marked, 1, state)).toBe('他去北京了。');
    // A right sentence he picked by mistake is still spoken (it is good Chinese).
    expect(choicePickSpeech(marked, 0, state)).toBe('我昨天买了一本书。');
    expect(choiceOptionSpeakable(marked, 1, state)).toBe(false);
    expect(choiceOptionSpeakable(marked, 0, state)).toBe(true);
    expect(choiceSayAgainSentence(marked, state)?.hanzi).toBe('他去北京了。');
    expect(needsChoiceCorrection(marked)).toBe(false);
  });

  it('an older lesson without correction never speaks the mistake', () => {
    const loading = initialChoiceCorrection(wrongChoice);
    expect(loading).toEqual({ status: 'loading' });
    expect(needsChoiceCorrection(wrongChoice)).toBe(true);
    expect(choicePickSpeech(wrongChoice, 1, loading)).toBe('');
    expect(choiceSayAgainSentence(wrongChoice, loading)).toBeNull();
    const offline: ChoiceCorrection = { status: 'unavailable', offline: true };
    expect(choicePickSpeech(wrongChoice, 1, offline)).toBe('');
    expect(choiceOptionSpeakable(wrongChoice, 1, offline)).toBe(false);
    const fetched: ChoiceCorrection = { status: 'ready', source: 'fetched', correction: { hanzi: '他去了北京。' } };
    expect(choicePickSpeech(wrongChoice, 1, fetched)).toBe('他去了北京。');
  });

  it('a false alarm (the server found nothing wrong) is an ordinary sentence again', () => {
    const unchanged: ChoiceCorrection = { status: 'unchanged' };
    expect(isWrongOption(wrongChoice, 1, unchanged)).toBe(false);
    expect(choicePickSpeech(wrongChoice, 1, unchanged)).toBe('他了去北京。');
  });

  it('prefetch / pre-generation: no wrong sentence, the correction instead', () => {
    expect(choiceTtsTexts(wrongChoice)).toEqual(['我昨天买了一本书。', '我吃了饭。']);
    expect(choiceTtsTexts(withCorrection)).toEqual(['我昨天买了一本书。', '我吃了饭。', '他去北京了。']);
    expect(exerciseTtsTexts(withCorrection)).not.toContain('他了去北京。');
  });

  it('🎤 Say it again practises the correction, never the mistake', () => {
    expect(sayAgainTarget(wrongChoice)).toBeNull();
    expect(sayAgainTarget(withCorrection)).toEqual({ hanzi: '他去北京了。', pinyin: 'Tā qù Běijīng le.', kind: 'answer' });
    expect(sayAgainTarget(ordinary)?.hanzi).toBe('你累了吗？');
  });
});

describe('the correction call', () => {
  it('builds the input from the exercise', () => {
    expect(choiceCorrectionInput(wrongChoice)).toEqual({
      question: 'Which sentence is wrong?',
      sentence: '他了去北京。',
      others: ['我昨天买了一本书。', '我吃了饭。'],
      explanation: '了 never goes before the verb.',
    });
    expect(choiceCorrectionCacheText({ question: ' Which sentence is wrong? ', sentence: '他了去北京。' })).toBe('choice-correction|v1|Which sentence is wrong?|他了去北京。');
  });

  it('validates a request body', () => {
    expect(pickChoiceCorrectionInput({})).toEqual({ problems: ['sentence is required'] });
    expect(pickChoiceCorrectionInput({ sentence: 'hello' })).toEqual({ problems: ['sentence must be Chinese'] });
    expect(pickChoiceCorrectionInput({ question: 'Which is wrong?', sentence: ' 他了去北京。', others: ['a', 3, ''] })).toEqual({
      input: { question: 'Which is wrong?', sentence: '他了去北京。', others: ['a'] },
    });
  });

  it('normalises replies', () => {
    expect(normalizeChoiceCorrection({ hanzi: '他去北京了。', english: 'He went.' }, '他了去北京。')).toEqual({
      correction: { hanzi: '他去北京了。', english: 'He went.' }, unchanged: false,
    });
    expect(normalizeChoiceCorrection({ correction: { hanzi: '他去北京了' } }, '他了去北京。').unchanged).toBe(false);
    expect(normalizeChoiceCorrection({ hanzi: '他了去北京', already_correct: false }, '他了去北京。')).toEqual({ correction: { hanzi: '他了去北京。' }, unchanged: true });
    expect(normalizeChoiceCorrection({ already_correct: true }, '他了去北京。').unchanged).toBe(true);
    expect(() => normalizeChoiceCorrection({ hanzi: '' }, '他了去北京。')).toThrow();
  });
});

describe('authoring', () => {
  it('validates the correction', () => {
    const spec = (ex: ChoiceExerciseSpec) => ({ title: 't', sections: [{ exercises: [ex] }] });
    expect(validateLessonSpec(spec(withCorrection))).toEqual([]);
    expect(validateLessonSpec(spec({ ...wrongChoice, correction: { hanzi: '他了去北京' } }))[0]).toMatch(/must fix the wrong option/);
    expect(validateLessonSpec(spec({ ...wrongChoice, correction: { hanzi: '' } }))[0]).toMatch(/correction/);
    // Without one it is still saved (older lessons) — a soft warning says to add it.
    expect(validateLessonSpec(spec(wrongChoice))).toEqual([]);
    expect(choiceCorrectionWarnings(spec(wrongChoice))).toHaveLength(1);
    expect(lessonSoftWarnings(spec(wrongChoice))[0]).toMatch(/correction/);
    expect(choiceCorrectionWarnings(spec(withCorrection))).toEqual([]);
    expect(choiceCorrectionWarnings(spec(ordinary))).toEqual([]);
  });

  it('the spec doc tells authors', () => {
    expect(LESSON_EXERCISE_DOC).toMatch(/MUST give "correction"/);
  });
});
