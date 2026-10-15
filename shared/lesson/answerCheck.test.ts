import { describe, it, expect } from 'vitest';
import {
  answerCheckApplies, answerCheckCacheText, answerCheckChip, normalizeAnswerCheck, parseAnswerCheck, pickAnswerCheckInput,
  suggestedFor, tipSegments,
} from './answerCheck';
import { sanitizeAttemptData } from './attempt';

describe('answerCheckApplies', () => {
  it('only Chinese answers to translate / listen_translate', () => {
    expect(answerCheckApplies('translate', '即使便宜，我也不买。')).toBe(true);
    expect(answerCheckApplies('listen_translate', '我也不买')).toBe(true);
    expect(answerCheckApplies('listen_translate', "I won't buy it")).toBe(false);
    expect(answerCheckApplies('translate', '  ')).toBe(false);
    expect(answerCheckApplies('translate', null)).toBe(false);
    expect(answerCheckApplies('sentence_making', '我也不买')).toBe(false);
    expect(answerCheckApplies('dictation', '我也不买')).toBe(false);
  });
});

describe('answerCheckCacheText', () => {
  const base = { prompt_en: "Even if it's cheap,  I won't buy it.", model_answer: '即使很便宜，我也不买。', answer: '即使便宜，我也不买。', exercise_type: 'translate' };
  it('ignores punctuation / spacing of the answers, keeps the mode', () => {
    expect(answerCheckCacheText(base)).toBe(answerCheckCacheText({ ...base, answer: '即使便宜 我也不买', prompt_en: "even if it's cheap, i won't buy it." }));
    expect(answerCheckCacheText({ ...base, input: 'spoken' })).not.toBe(answerCheckCacheText(base));
    expect(answerCheckCacheText({ ...base, input: 'edited' })).toBe(answerCheckCacheText(base));
    expect(answerCheckCacheText({ ...base, answer: '即使很便宜，我也不买。' })).not.toBe(answerCheckCacheText(base));
  });
});

describe('pickAnswerCheckInput', () => {
  it('needs a prompt, a model answer and a Chinese answer', () => {
    expect(pickAnswerCheckInput({})).toEqual({ problems: ['prompt_en is required', 'model_answer is required', 'answer is required'] });
    expect(pickAnswerCheckInput({ prompt_en: 'x', model_answer: '你好', answer: 'hello' })).toEqual({ problems: ['answer has no Chinese to check'] });
    const ok = pickAnswerCheckInput({ prompt_en: ' x ', model_answer: '你好', answer: '您好', input: 'spoken', focus: '', exercise_type: 'listen_translate' });
    expect(ok).toEqual({ input: { prompt_en: 'x', model_answer: '你好', model_pinyin: undefined, answer: '您好', exercise_type: 'listen_translate', input: 'spoken', focus: undefined } });
  });
});

describe('normalizeAnswerCheck', () => {
  const answer = '即使你不记得这些词，也不着急，就多练习。';
  it('keeps an almost with its fix and up to three Chinese-quoting tips', () => {
    const c = normalizeAnswerCheck({
      verdict: 'almost', headline: ' Make it a command. ', corrected: '即使你不记得这些词，也别着急，你就多练习吧。', corrected_pinyin: 'x',
      tips: [{ text: 'a', quote: '也不着急' }, { text: 'b', quote: 'abc' }, 'c', { text: 'd' }, { text: '' }],
      alternative: { hanzi: '多练习就好了。', english: 'Just practise more.' },
    }, answer);
    expect(c).toEqual({
      verdict: 'almost', headline: 'Make it a command.', corrected: '即使你不记得这些词，也别着急，你就多练习吧。', corrected_pinyin: 'x',
      tips: [{ text: 'a', quote: '也不着急' }, { text: 'b' }, { text: 'c' }],
      alternative: { hanzi: '多练习就好了。', english: 'Just practise more.' },
      suggested: 'missed_it',
    });
  });
  it('drops a correction on a correct answer, a no-op correction and an alternative that says nothing new', () => {
    expect(normalizeAnswerCheck({ verdict: 'correct', headline: 'ok', corrected: '我也不买', tips: [] }, '我也不买。').corrected).toBe('');
    const noop = normalizeAnswerCheck({ verdict: 'wrong', headline: 'x', corrected: '我也不买！', corrected_pinyin: 'wǒ', alternative: { hanzi: '我也不买' } }, '我也不买。');
    expect(noop.corrected).toBe('');
    expect(noop.corrected_pinyin).toBe('');
    expect(noop.alternative).toBeUndefined();
  });
  it('throws without a verdict or headline; parse returns null', () => {
    expect(() => normalizeAnswerCheck({ verdict: 'great', headline: 'x' }, '')).toThrow();
    expect(() => normalizeAnswerCheck({ verdict: 'correct', headline: '' }, '')).toThrow();
    expect(parseAnswerCheck(null, '')).toBeNull();
  });
});

describe('chips and suggestion', () => {
  it('maps verdicts', () => {
    expect(answerCheckChip('correct')).toEqual({ label: '✓ Correct', tone: 'good' });
    expect(answerCheckChip('acceptable')).toEqual({ label: '✓ Also right', tone: 'good' });
    expect(answerCheckChip('almost')).toEqual({ label: '~ Almost', tone: 'warn' });
    expect(answerCheckChip('wrong')).toEqual({ label: '✗ Not quite', tone: 'bad' });
    expect(suggestedFor('acceptable')).toBe('got_it');
    expect(suggestedFor('almost')).toBe('missed_it');
  });
});

describe('tipSegments', () => {
  it('keeps the quote as one segment, other Chinese by character', () => {
    expect(tipSegments({ text: '也不着急 is a statement; use 别.', quote: '也不着急' })).toEqual({
      quoteInText: true,
      segments: [
        { text: '也不着急', han: true, quote: true },
        { text: ' is a statement; use ', han: false, quote: false },
        { text: '别', han: true, quote: false },
        { text: '.', han: false, quote: false },
      ],
    });
    const two = tipSegments({ text: '和 links nouns, not 和 actions', quote: '和' });
    expect(two.segments.filter((s) => s.quote)).toHaveLength(2);
    expect(two.segments.map((s) => s.text).join('')).toBe('和 links nouns, not 和 actions');
    expect(tipSegments({ text: 'Use a comma.', quote: '和' })).toEqual({ quoteInText: false, segments: [{ text: 'Use a comma.', han: false, quote: false }] });
    expect(tipSegments({ text: '' }).segments).toEqual([]);
  });
});

describe('attempt data keeps the check and every try', () => {
  it('sanitizes check + tries', () => {
    const check = { verdict: 'almost', headline: 'x', corrected: '医生让我吃药，好好休息。', corrected_pinyin: 'yīshēng', tips: [{ text: 't', quote: '和' }] };
    const data = sanitizeAttemptData({
      started_at: 's', duration_ms: 1,
      exercises: [{ section: 0, index: 0, type: 'translate', correct: false, points: 0, max_points: 1, duration_ms: 1, answer: {
        text: '医生让我吃药和好好休息。', input: 'spoken', self_assessed: true, check,
        tries: [{ text: '医生让我吃药和休息', input: 'typed', check: { verdict: 'nope' } }, { text: '' }, 'x'],
      } }],
    });
    const a = data!.exercises[0].answer!;
    expect(a.check?.verdict).toBe('almost');
    expect(a.check?.suggested).toBe('missed_it');
    expect(a.tries).toEqual([{ text: '医生让我吃药和休息', input: 'typed' }]);
  });
});
