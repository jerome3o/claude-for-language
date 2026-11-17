import { describe, it, expect } from 'vitest';
import { looksLikeChinese } from './messageTools';

describe('looksLikeChinese', () => {
  it('detects hanzi', () => {
    expect(looksLikeChinese('你好')).toBe(true);
    expect(looksLikeChinese('hello')).toBe(false);
    expect(looksLikeChinese('hello 你好')).toBe(true);
  });
});
