import { describe, expect, it } from 'vitest';
import { FREQUENCY_DECAL_KEY, RARE_CHAR_RANK, RARE_WORD_RANK, frequencyKeyLine, frequencyTier } from './index';

describe('frequencyTier', () => {
  it('marks the top 100 / 1,000 / 2,000 at their edges', () => {
    expect(frequencyTier(1)).toBe('top100');
    expect(frequencyTier(100)).toBe('top100');
    expect(frequencyTier(101)).toBe('top1000');
    expect(frequencyTier(1000)).toBe('top1000');
    expect(frequencyTier(1001)).toBe('top2000');
    expect(frequencyTier(2000)).toBe('top2000');
  });

  it('leaves the middle band unmarked and greys words beyond 10,000', () => {
    expect(frequencyTier(2001)).toBeNull();
    expect(frequencyTier(RARE_WORD_RANK)).toBeNull();
    expect(frequencyTier(RARE_WORD_RANK + 1)).toBe('rare');
    expect(frequencyTier(29_999)).toBe('rare');
  });

  it('uses the 3,500 common characters as the cutoff for characters', () => {
    expect(frequencyTier(50, 'char')).toBe('top100');
    expect(frequencyTier(1500, 'char')).toBe('top2000');
    expect(frequencyTier(RARE_CHAR_RANK, 'char')).toBeNull();
    expect(frequencyTier(RARE_CHAR_RANK + 1, 'char')).toBe('rare');
    expect(frequencyTier(RARE_CHAR_RANK + 1, 'word')).toBeNull();
  });

  it('treats a missing / invalid rank as not in the list (rare)', () => {
    for (const r of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(frequencyTier(r)).toBe('rare');
      expect(frequencyTier(r, 'char')).toBe('rare');
    }
  });

  it('has a one-line key in tier order', () => {
    expect(FREQUENCY_DECAL_KEY.map((k) => k.tier)).toEqual(['top100', 'top1000', 'top2000', 'rare']);
    expect(frequencyKeyLine()).toBe('purple top 100 · green top 1,000 · yellow top 2,000 · grey rare');
  });
});
