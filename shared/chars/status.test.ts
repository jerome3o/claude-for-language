import { describe, it, expect } from 'vitest';
import { addOwnCardLabel, charChipLabel, charOwnCards, charWordRows, charWordsSummary, isSingleHan, ownCardLine, OWN_CARD_BADGE, wordInCard } from './status';

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

describe("a character's own card", () => {
  const notes = [
    { id: 'a', hanzi: '性' },
    { id: 'b', hanzi: '人性' }, // a word with 性 is not 性's own card
    { id: 'c', hanzi: '人。' }, // punctuation ignored
    { id: 'd', hanzi: '性' },
  ];
  const cards = [
    { note_id: 'a', queue: 1, stability: 2 },
    { note_id: 'b', queue: 2, stability: 99 },
    { note_id: 'c', queue: 2, stability: 30 },
    { note_id: 'd', queue: 0, stability: 0 },
  ];

  it('known / in_decks / none per character; words and non-Han never match', () => {
    const own = charOwnCards(['人', '性', '品', '人性', 'a', ''], notes, cards);
    expect(own['人']).toEqual({ status: 'known', note_ids: ['c'] });
    expect(own['性']).toEqual({ status: 'in_decks', note_ids: ['a', 'd'] });
    expect(own['品']).toEqual({ status: 'none', note_ids: [] });
    expect(own['人性']).toEqual({ status: 'none', note_ids: [] });
    expect(own['a']).toEqual({ status: 'none', note_ids: [] });
    expect(own['']).toEqual({ status: 'none', note_ids: [] });
    expect(isSingleHan('性')).toBe(true);
    expect(isSingleHan('人性')).toBe(false);
    expect(isSingleHan('。')).toBe(false);
  });

  it('the status line, add label, badge and chip label', () => {
    expect(ownCardLine('性', 'in_decks', ['HSK 5', 'HSK 5', 'Food'])).toBe('📚 You have 性 as a card in HSK 5, Food');
    expect(ownCardLine('人', 'known', [])).toBe('✓ Known — you have 人 as a card in your decks');
    expect(ownCardLine('品', 'none', ['x'])).toBe('');
    expect(addOwnCardLabel('品')).toBe('+ Add 品 as a card');
    expect(OWN_CARD_BADGE).toEqual({ known: '✓', in_decks: '📚', none: '' });
    expect(charChipLabel('性', 'xìng', 'in_decks')).toBe('The character 性, xìng — you have it as a card');
    expect(charChipLabel('人', null, 'known')).toBe('The character 人 — you have it as a card, known');
    expect(charChipLabel('品', 'pǐn', 'none')).toBe('The character 品, pǐn');
  });
});
