import { describe, it, expect } from 'vitest';
import { hanziAnswerKey, normalizeNumbersToHanzi, stripAnswerPunctuation } from './numberHanzi';

describe('hanziAnswerKey (typed answer equivalence)', () => {
  const equal = (a: string, b: string) => hanziAnswerKey(a) === hanziAnswerKey(b);

  it('accepts digits typed in place of hanzi numbers', () => {
    expect(equal('7', '七')).toBe(true);
    expect(equal('彩虹有7个颜色', '彩虹有七个颜色')).toBe(true);
    expect(equal('12个', '十二个')).toBe(true);
  });

  it('ignores punctuation differences (missing trailing 。)', () => {
    expect(equal('彩虹有7个颜色', '彩虹有七个颜色。')).toBe(true);
    expect(equal('你好', '你好！')).toBe(true);
    expect(equal('你 好', '你好')).toBe(true);
  });

  it('treats 两 and 二 as equivalent', () => {
    expect(equal('二百', '两百')).toBe(true);
    expect(equal('200', '两百')).toBe(true);
  });

  it('handles larger numbers, decimals, and percentages', () => {
    expect(equal('1000', '一千')).toBe(true);
    expect(equal('1.5', '一点五')).toBe(true);
    expect(equal('50%', '百分之五十')).toBe(true);
  });

  it('still rejects genuinely different answers', () => {
    expect(equal('8', '七')).toBe(false);
    expect(equal('彩虹有6个颜色', '彩虹有七个颜色。')).toBe(false);
    expect(equal('你好', '你们好')).toBe(false);
  });
});

describe('stripAnswerPunctuation (punctuation-only difference detection)', () => {
  const punctuationOnly = (a: string, b: string) =>
    a !== b && stripAnswerPunctuation(a) === stripAnswerPunctuation(b);

  it('treats a missing trailing 。/！ as a punctuation-only difference', () => {
    expect(punctuationOnly('你好', '你好。')).toBe(true);
    expect(punctuationOnly('你好！', '你好')).toBe(true);
    expect(punctuationOnly('我爱你', '我，爱你。')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(punctuationOnly('你 好', '你好')).toBe(true);
  });

  it('does NOT treat number-equivalence as punctuation-only', () => {
    // Same hanziAnswerKey, but the characters genuinely differ (7 vs 七),
    // so this should still show the canonical form, not collapse to green.
    expect(punctuationOnly('7个', '七个')).toBe(false);
    expect(punctuationOnly('两百', '二百')).toBe(false);
  });

  it('does NOT treat genuinely different hanzi as punctuation-only', () => {
    expect(punctuationOnly('你好', '你们好')).toBe(false);
  });
});

describe('normalizeNumbersToHanzi', () => {
  it('converts digits inside CJK text', () => {
    expect(normalizeNumbersToHanzi('彩虹有7个颜色')).toBe('彩虹有七个颜色');
    expect(normalizeNumbersToHanzi('3月')).toBe('三月');
  });

  it('leaves text without numbers untouched', () => {
    expect(normalizeNumbersToHanzi('你好')).toBe('你好');
  });
});
