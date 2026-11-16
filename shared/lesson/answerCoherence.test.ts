import { describe, it, expect } from 'vitest';
import {
  checkKey, correctedDisplay, forbidsCorrected, normalizeAnswerCheck, recommendedAt, recommendsWrongForm, wordsPinyinLine,
  NEUTRAL_ALMOST_HEADLINE, NEUTRAL_WRONG_NO_FIX_HEADLINE, answerCheckCacheText,
} from './answerCheck';
import { answerKey, answerMarks, markedChars } from './feedback';
import { digitsToHanzi } from '../text/numberHanzi';

// Jerome's croissant (Nov 2026): "This croissant was just over three yuan." He said 这个牛角包 3块多元。
const answer = '这个牛角包 3块多元。';
const model = '这个牛角包三块多钱。';
const raw = {
  verdict: 'almost',
  headline: 'Use 钱 or 块 alone, not both together',
  corrected: '这个牛角包3块多钱',
  corrected_pinyin: 'zhège niú jiǎo bāo kuài duō qián',
  tips: [{ text: '3块多元: 块 and 元 are both money units; use 钱 instead (块多钱) or just 元 alone (块多元)', quote: '3块多元' }],
};

describe('the croissant check is made coherent', () => {
  it('keeps the verdict and the fix, gives a neutral headline and drops the tip offering his own 块多元', () => {
    const c = normalizeAnswerCheck(raw, answer, model);
    expect(c.verdict).toBe('almost');
    expect(c.headline).toBe(NEUTRAL_ALMOST_HEADLINE);
    expect(c.corrected).toBe('这个牛角包3块多钱');
    expect(c.tips).toEqual([]);
    expect(c.suggested).toBe('missed_it');
  });

  it('a coherent check of the same answer is left alone', () => {
    const good = {
      verdict: 'almost',
      headline: '块 and 元 are both units — use one.',
      corrected: '这个牛角包三块多钱。',
      tips: [{ text: '块多元 stacks two units: say 三块多钱 or 三元多.', quote: '块多元' }],
    };
    const c = normalizeAnswerCheck(good, answer, model);
    expect(c.headline).toBe(good.headline);
    expect(c.tips).toHaveLength(1);
  });

  it('the corrected line is shown with numerals; its pinyin comes from the words', () => {
    expect(correctedDisplay('这个牛角包3块多钱')).toBe('这个牛角包三块多钱');
    expect(wordsPinyinLine([
      { text: '这个', pinyin: 'zhège' }, { text: '牛角包', pinyin: 'niújiǎobāo' }, { text: '三块', pinyin: 'sānkuài' },
      { text: '多', pinyin: 'duō' }, { text: '钱', pinyin: 'qián' }, { text: '。', pinyin: '' },
    ])).toBe('zhège niújiǎobāo sānkuài duō qián.');
    expect(wordsPinyinLine([{ text: '你好', pinyin: 'nǐ hǎo' }, { text: '，', pinyin: '' }, { text: '世界', pinyin: '' }])).toBe('');
  });

  it('"You said" never marks 3 against 三', () => {
    expect(answerKey(answer)).toBe(checkKey(answer));
    expect(answerKey(answer)).toBe('这个牛角包三块多元');
    const shown = markedChars(answer, model, 'answer');
    expect(shown.find((c) => c.ch === '3')!.hit).toBe(true);
    expect(shown.filter((c) => !c.hit).map((c) => c.ch)).toEqual(['元']);
    expect(markedChars(answer, model, 'model').filter((c) => !c.hit).map((c) => c.ch)).toEqual(['钱']);
    expect(answerMarks('这个牛角包3块多钱', model)).toEqual({ marks: false, note: null });
    expect(answerMarks('3个人', '三个人')).toEqual({ marks: false, note: null });
  });

  it('a digit run is one unit: 12 against 十二, 2026年 read digit by digit', () => {
    expect(markedChars('我12岁', '我十二岁', 'answer').every((c) => c.hit)).toBe(true);
    expect(markedChars('我13岁', '我十二岁', 'answer').filter((c) => !c.hit).map((c) => c.ch)).toEqual(['1', '3']);
    expect(digitsToHanzi('2026年3月1.5%')).toBe('二〇二六年三月百分之一点五');
    expect(digitsToHanzi('电话123456789')).toBe('电话123456789');
  });

  it('caches 3 and 三 as one answer', () => {
    const input = { prompt_en: 'x', model_answer: model, answer, exercise_type: 'translate' };
    expect(answerCheckCacheText(input)).toBe(answerCheckCacheText({ ...input, answer: '这个牛角包三块多元' }));
  });
});

describe('the coherence rules', () => {
  it('recommendedAt: the last cue in the clause decides', () => {
    const t = 'use 钱 instead (块多钱) or just 元 alone (块多元)';
    expect(recommendedAt(t, t.lastIndexOf('块多元'))).toBe(true);
    expect(recommendedAt('Say 也别着急 instead of 也不着急', 'Say 也别着急 instead of 也不着急'.lastIndexOf('也不着急'))).toBe(false);
    expect(recommendedAt('块多元: stacks two units', 0)).toBe(false);
    expect(recommendedAt('Use 别, not 不着急', 'Use 别, not 不着急'.indexOf('不着急'))).toBe(false);
    expect(recommendedAt('Wrong: use it. 块多元 is two units', 'Wrong: use it. 块多元 is two units'.indexOf('块多元'))).toBe(false);
  });

  it('recommendsWrongForm: only his own text that the fix and the model left out', () => {
    const mine = checkKey(answer);
    const fixed = checkKey('这个牛角包3块多钱');
    expect(recommendsWrongForm('or just 元 alone (块多元)', mine, fixed, checkKey(model))).toBe(true);
    expect(recommendsWrongForm('use 钱 instead (块多钱)', mine, fixed, checkKey(model))).toBe(false);
    expect(recommendsWrongForm('Keep 这个牛角包 — use 这个牛角包', mine, fixed, checkKey(model))).toBe(false);
  });

  it('forbidsCorrected: "not both" over items the fix has, "avoid X" where the fix has X', () => {
    const fixed = checkKey('这个牛角包3块多钱');
    expect(forbidsCorrected('Use 钱 or 块 alone, not both together', fixed)).toBe(true);
    expect(forbidsCorrected('Use 元 or 块 alone, not both together', fixed)).toBe(false);
    expect(forbidsCorrected('Avoid 块多钱 here', fixed)).toBe(true);
    expect(forbidsCorrected('Avoid 块多元 here', fixed)).toBe(false);
    expect(forbidsCorrected('Use 钱 or 块 alone, not both together', '')).toBe(false);
  });

  it('a wrong check without a fix gets its own neutral headline; right checks are never touched', () => {
    const wrong = normalizeAnswerCheck({ verdict: 'wrong', headline: 'Avoid 牛角包 — try 这个牛角包', corrected: '', tips: [] }, '这个牛角包三元', model);
    expect(wrong.headline).not.toBe(NEUTRAL_WRONG_NO_FIX_HEADLINE); // nothing to contradict without a fix
    const wrong2 = normalizeAnswerCheck({ verdict: 'wrong', headline: 'Or just say 三元', corrected: '', tips: [] }, '这个牛角包三元', model);
    expect(wrong2.headline).toBe(NEUTRAL_WRONG_NO_FIX_HEADLINE);
    const right = normalizeAnswerCheck({ verdict: 'correct', headline: 'Use 钱 or 块 alone, not both together', corrected: '', tips: [] }, model, model);
    expect(right.headline).toBe('Use 钱 or 块 alone, not both together');
  });
});
