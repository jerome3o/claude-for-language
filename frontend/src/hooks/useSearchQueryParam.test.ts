import { describe, it, expect } from 'vitest';
import { readSearchQueryParam, writeSearchQueryParam } from './useSearchQueryParam';

describe('readSearchQueryParam', () => {
  it('reads ?q= from a query string', () => {
    expect(readSearchQueryParam('?q=%E4%BD%A0%E5%A5%BD')).toBe('你好');
  });

  it('accepts URLSearchParams too', () => {
    expect(readSearchQueryParam(new URLSearchParams('q=ni%20hao&tab=words'))).toBe('ni hao');
  });

  it('returns an empty string when q is absent or blank', () => {
    expect(readSearchQueryParam('')).toBe('');
    expect(readSearchQueryParam('?tab=words')).toBe('');
    expect(readSearchQueryParam('?q=%20%20')).toBe('');
  });
});

describe('writeSearchQueryParam', () => {
  it('sets q and keeps the other params', () => {
    const next = writeSearchQueryParam('?tab=words', '谢谢');
    expect(next.get('q')).toBe('谢谢');
    expect(next.get('tab')).toBe('words');
  });

  it('removes q when the value is empty', () => {
    const next = writeSearchQueryParam('?q=old&tab=words', '   ');
    expect(next.has('q')).toBe(false);
    expect(next.get('tab')).toBe('words');
  });

  it('does not mutate the input params', () => {
    const original = new URLSearchParams('q=old');
    writeSearchQueryParam(original, 'new');
    expect(original.get('q')).toBe('old');
  });
});
