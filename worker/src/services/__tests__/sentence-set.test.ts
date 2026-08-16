import { describe, it, expect } from 'vitest';
import {
  clampSentenceCount,
  normalizeGeneratedSentences,
  SENTENCE_SET_DEFAULT_COUNT,
  SENTENCE_SET_MIN_COUNT,
  SENTENCE_SET_MAX_COUNT,
} from '../sentence-set';

describe('clampSentenceCount', () => {
  it('defaults when no count is given', () => {
    expect(clampSentenceCount(undefined)).toBe(SENTENCE_SET_DEFAULT_COUNT);
  });

  it('defaults on non-numeric input', () => {
    expect(clampSentenceCount(NaN)).toBe(SENTENCE_SET_DEFAULT_COUNT);
    expect(clampSentenceCount(0)).toBe(SENTENCE_SET_DEFAULT_COUNT);
  });

  it('clamps to the supported range', () => {
    expect(clampSentenceCount(1)).toBe(SENTENCE_SET_MIN_COUNT);
    expect(clampSentenceCount(50)).toBe(SENTENCE_SET_MAX_COUNT);
  });

  it('passes through in-range counts', () => {
    expect(clampSentenceCount(5)).toBe(5);
    expect(clampSentenceCount(10)).toBe(10);
  });

  it('rounds fractional counts', () => {
    expect(clampSentenceCount(6.4)).toBe(6);
  });
});

describe('normalizeGeneratedSentences', () => {
  it('keeps well-formed sentences in order', () => {
    const result = normalizeGeneratedSentences(
      [
        { hanzi: '我明白了。', pinyin: 'Wǒ míngbai le.', translation: 'I understand.', focus: 'core' },
        {
          hanzi: '明天我就明白了。',
          pinyin: 'Míngtiān wǒ jiù míngbai le.',
          translation: "Tomorrow I'll understand.",
          focus: 'shared_character',
          focus_note: '明天 shares 明 with 明白',
        },
      ],
      6
    );

    expect(result).toHaveLength(2);
    expect(result[0].focus).toBe('core');
    expect(result[1].focus).toBe('shared_character');
    expect(result[1].focusNote).toBe('明天 shares 明 with 明白');
  });

  it('drops entries with no hanzi', () => {
    const result = normalizeGeneratedSentences(
      [{ hanzi: '  ' }, { hanzi: '我懂。', focus: 'core' }, {}],
      6
    );
    expect(result).toHaveLength(1);
    expect(result[0].hanzi).toBe('我懂。');
  });

  it('coerces an unknown focus to core', () => {
    const result = normalizeGeneratedSentences([{ hanzi: '我懂。', focus: 'nonsense' }], 6);
    expect(result[0].focus).toBe('core');
  });

  it('never returns more sentences than requested', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ hanzi: `第${i}句。` }));
    expect(normalizeGeneratedSentences(raw, 5)).toHaveLength(5);
  });

  it('handles a missing sentences array', () => {
    expect(normalizeGeneratedSentences(undefined, 6)).toEqual([]);
  });

  it('normalizes whitespace and empty optional fields', () => {
    const result = normalizeGeneratedSentences(
      [{ hanzi: ' 我  明白 ', pinyin: '  ', translation: undefined }],
      6
    );
    expect(result[0].hanzi).toBe('我 明白');
    expect(result[0].pinyin).toBe('');
    expect(result[0].translation).toBe('');
    expect(result[0].focusNote).toBeNull();
  });
});
