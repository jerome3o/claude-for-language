import { describe, it, expect } from 'vitest';
import { isHanziOption, sanitizeMcRow, mcChoiceRowCount, isMcCompact, nextUnansweredRow, MC_COMPACT_AFTER_ROWS } from './multipleChoice';

describe('isHanziOption', () => {
  it('accepts one character standing in for one character', () => {
    expect(isHanziOption('羽', '习')).toBe(true);
    expect(isHanziOption('㐀', '习')).toBe(true);
  });

  it('never accepts pinyin, latin letters, digits, punctuation or blanks', () => {
    for (const bad of ['xi', 'xí', 'Xi', 'x', '1', '，', '。', '', ' ', 'ｘ', '🙂']) {
      expect(isHanziOption(bad, '习')).toBe(false);
    }
  });

  it('needs as many characters as the answer character', () => {
    expect(isHanziOption('学习', '习')).toBe(false);
    expect(isHanziOption('学习', '好的')).toBe(true);
  });
});

describe('sanitizeMcRow', () => {
  it('drops the pinyin "xi" the model offered for 习 (the bug report row)', () => {
    expect(sanitizeMcRow({ correct: '习', options: ['学', '刁', '习', 'xi', '羽'] })).toEqual({
      correct: '习',
      options: ['学', '刁', '习', '羽'],
    });
  });

  it('trims, dedupes and always offers the correct character', () => {
    expect(sanitizeMcRow({ correct: '好', options: [' 妤', '妤', '女 ', 'hao'] })).toEqual({
      correct: '好',
      options: ['妤', '女', '好'],
    });
  });

  it('a row left with no distractor becomes a given row', () => {
    expect(sanitizeMcRow({ correct: '习', options: ['xi', 'Xí'] })).toEqual({ correct: '习', options: ['习'] });
  });

  it('leaves punctuation and English rows alone', () => {
    expect(sanitizeMcRow({ correct: '，', options: ['，'] })).toEqual({ correct: '，', options: ['，'] });
    expect(sanitizeMcRow({ correct: 'OK', options: ['OK', 'ok'] })).toEqual({ correct: 'OK', options: ['OK', 'ok'] });
  });
});

describe('grid helpers', () => {
  const row = (correct: string) => ({ correct, options: [correct, '口', '日'] });
  const sentence = [...'我们一边吃晚饭，一边练习'].map((c) => (c === '，' ? { correct: c, options: [c] } : row(c)));

  it('counts only the rows to pick and goes compact past the threshold', () => {
    expect(mcChoiceRowCount(sentence)).toBe(11);
    expect(isMcCompact(sentence)).toBe(true);
    expect(isMcCompact(sentence.slice(0, MC_COMPACT_AFTER_ROWS))).toBe(false);
  });

  it('points at the next unanswered row, skipping given rows and wrapping round', () => {
    const sel: (string | null)[] = sentence.map((r) => (r.options.length === 1 ? r.correct : null));
    sel[6] = '饭';
    expect(nextUnansweredRow(sentence, sel, 6)).toBe(8); // row 7 is the comma
    const almost: (string | null)[] = sentence.map((r) => r.correct);
    almost[2] = null;
    expect(nextUnansweredRow(sentence, almost, 10)).toBe(2);
    expect(nextUnansweredRow(sentence, sentence.map((r) => r.correct), 3)).toBeNull();
  });
});
