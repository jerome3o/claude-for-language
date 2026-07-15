import { describe, it, expect } from 'vitest';
import { containsChinese } from './textLanguage';

describe('containsChinese', () => {
  it('detects pure Chinese sentences', () => {
    expect(containsChinese('我昨天去了商店买苹果')).toBe(true);
    expect(containsChinese('他把书放在桌子上了。')).toBe(true);
  });

  it('detects mixed input as Chinese', () => {
    expect(containsChinese('what does 把 mean?')).toBe(true);
    expect(containsChinese('我想 buy apples')).toBe(true);
  });

  it('treats pure English as not Chinese', () => {
    expect(containsChinese('I went to the store yesterday to buy apples')).toBe(false);
    expect(containsChinese("How do I say I'm running late?")).toBe(false);
  });

  it('ignores punctuation, digits, and pinyin', () => {
    expect(containsChinese('ni hao ma? 123!')).toBe(false);
    expect(containsChinese('nǐ hǎo')).toBe(false);
  });

  it('handles empty input', () => {
    expect(containsChinese('')).toBe(false);
    expect(containsChinese('   ')).toBe(false);
  });
});
