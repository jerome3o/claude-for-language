import { describe, it, expect } from 'vitest';
import { charWordRows, charWordsSummary, wordInCard } from './status';

const words = [
  { hanzi: '进行', pinyin: 'jìnxíng', english: 'to proceed' },
  { hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
  { hanzi: '行业', pinyin: 'hángyè', english: 'industry' },
  { hanzi: '银行卡', pinyin: 'yínhángkǎ', english: 'bank card' },
];

describe('character sheet word statuses', () => {
  it('known = a mature card, in decks = any other note, none = no note', () => {
    const notes = [
      { id: 'n1', hanzi: '进行' },
      { id: 'n2', hanzi: '银行。' }, // punctuation ignored
      { id: 'n3', hanzi: '银行' },   // same word in another deck
      { id: 'n4', hanzi: '咖啡' },
    ];
    const cards = [
      { note_id: 'n1', queue: 2, stability: 30 },  // mastered
      { note_id: 'n2', queue: 2, stability: 10 },  // familiar
      { note_id: 'n3', queue: 0, stability: 0 },   // new
      { note_id: 'n4', queue: 2, stability: 99 },
    ];
    const rows = charWordRows(words, notes, cards);
    expect(rows.map((r) => [r.word.hanzi, r.status, r.note_ids])).toEqual([
      ['进行', 'known', ['n1']],
      ['银行', 'in_decks', ['n2', 'n3']],
      ['行业', 'none', []],
      ['银行卡', 'none', []],
    ]);
    expect(charWordsSummary(rows)).toBe('1 of 4 known · 1 in your decks');
  });

  it('a learning card in review with stability ≤ 21 is not known; relearning never', () => {
    const rows = charWordRows(words.slice(0, 1), [{ id: 'a', hanzi: '进行' }], [
      { note_id: 'a', queue: 2, stability: 21 },
      { note_id: 'a', queue: 3, stability: 50 },
    ]);
    expect(rows[0].status).toBe('in_decks');
  });

  it('puts the card on screen first, the rest in frequency order', () => {
    const rows = charWordRows(words, [], [], '我去银行');
    expect(rows.map((r) => [r.word.hanzi, r.current])).toEqual([
      ['银行', true], ['进行', false], ['行业', false], ['银行卡', false],
    ]);
    expect(wordInCard('银行卡', '银行')).toBe(false);
    expect(wordInCard('银行', null)).toBe(false);
  });

  it('lists a spelling once', () => {
    const rows = charWordRows([...words, { hanzi: '银行', pinyin: '', english: '' }], [], []);
    expect(rows).toHaveLength(4);
    expect(charWordsSummary(rows)).toBe('0 of 4 known');
  });
});
