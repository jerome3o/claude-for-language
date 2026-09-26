import { describe, it, expect } from 'vitest';
import { noteMatches, stripTones, type SearchableNote } from './noteSearch';

const note = { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行取钱。' };
const m = (q: string, n: SearchableNote = note) => noteMatches(n, q.trim().toLowerCase());

describe('noteMatches', () => {
  it('matches hanzi by substring', () => {
    expect(m('银')).toBe(true);
    expect(m('银行')).toBe(true);
    expect(m('行')).toBe(true);
    expect(m('饭')).toBe(false);
  });

  it('matches english case-insensitively and pinyin with or without tones', () => {
    expect(m('Bank')).toBe(true);
    expect(m('yínháng')).toBe(true);
    expect(m('yinhang')).toBe(true);
    expect(m('YIN')).toBe(true);
  });

  it('matches the card sentence', () => {
    expect(m('取钱')).toBe(true);
  });

  it('never throws on a note with missing fields', () => {
    expect(m('银', { hanzi: '银', pinyin: null, english: undefined })).toBe(true);
    expect(m('x', { hanzi: null, pinyin: null, english: null })).toBe(false);
    expect(m('')).toBe(false);
  });
});

describe('stripTones', () => {
  it('removes combining tone marks and lower-cases', () => {
    expect(stripTones('Yínháng')).toBe('yinhang');
    expect(stripTones('nǚ')).toBe('nu');
  });
});
