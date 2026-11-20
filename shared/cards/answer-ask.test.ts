import { describe, expect, it } from 'vitest';
import { answerDiff, answerDiffPinyin } from './answer-diff';
import { answerAskOffered, answerAskQuestion } from './answer-why';

describe('answerAskOffered — the "💬 Ask Claude" fallback', () => {
  const more = { tips: ['x'], corrected: null, alternative: null };
  it('only for a not-right answer with nothing to explain it, where a thread can be opened', () => {
    expect(answerAskOffered({ tone: 'wrong', why: null, more: null, canAsk: true })).toBe(true);
    expect(answerAskOffered({ tone: 'close', why: null, more: null, canAsk: true })).toBe(true);
    expect(answerAskOffered({ tone: 'right', why: null, more: null, canAsk: true })).toBe(false);
    expect(answerAskOffered({ tone: 'wrong', why: 'Use 侮辱.', more: null, canAsk: true })).toBe(false);
    expect(answerAskOffered({ tone: 'wrong', why: null, more, canAsk: true })).toBe(false);
    expect(answerAskOffered({ tone: 'wrong', why: null, more: null, canAsk: false })).toBe(false);
  });
});

describe('answerAskQuestion', () => {
  it('names what he was asked, what he said and the answer', () => {
    expect(answerAskQuestion({ said: '他打了我', expected: '他侮辱了我', prompt: 'He insulted me' }))
      .toBe('I was asked to say “He insulted me”. I said “他打了我” but the answer is “他侮辱了我”. What did I get wrong?');
    expect(answerAskQuestion({ said: '他打了我', expected: '他侮辱了我', prompt: 'He insulted me.' }))
      .toBe('I was asked to say “He insulted me.” I said “他打了我” but the answer is “他侮辱了我”. What did I get wrong?');
    expect(answerAskQuestion({ said: '我得书', expected: '我的书', spoken: false })).toBe('I wrote “我得书” but the answer is “我的书”. What did I get wrong?');
  });
});

describe('answerDiffPinyin — his syllables under "You said"', () => {
  it('marks his wrong / extra syllables, skips what he left out and punctuation', () => {
    expect(answerDiffPinyin(answerDiff('他捂住了我。', '他侮辱了我'))).toEqual([
      { text: 'tā', kind: 'ok' }, { text: 'wǔ', kind: 'sound' }, { text: 'zhù', kind: 'wrong' }, { text: 'le', kind: 'ok' }, { text: 'wǒ', kind: 'ok' },
    ]);
    expect(answerDiffPinyin(answerDiff('他是', '她是谁'))?.map((s) => s.text)).toEqual(['tā', 'shì']);
    // Digits are read as the number (3 → sān).
    expect(answerDiffPinyin(answerDiff('我有3个', '我有三个'))?.map((s) => s.text)).toEqual(['wǒ', 'yǒu', 'sān', 'gè']);
  });

  it('null when nothing Chinese was said', () => {
    expect(answerDiffPinyin(answerDiff('hello', '你好'))).toBeNull();
  });
});
