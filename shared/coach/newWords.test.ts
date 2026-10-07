import { describe, it, expect } from 'vitest';
import { addNewWordsButton, newWordCards, newWordsInSentence, COACH_NEW_WORDS_LABEL } from './newWords';

const words = [
  { hanzi: '我', pinyin: 'wǒ', gloss: 'I' },
  { hanzi: '昨天', pinyin: 'zuótiān', gloss: 'yesterday' },
  { hanzi: '去', pinyin: 'qù', gloss: 'go' },
  { hanzi: '了', pinyin: 'le', gloss: '(done)' },
  { hanzi: '银行', pinyin: 'yínháng', gloss: 'bank' },
  { hanzi: '。', pinyin: '', gloss: '' },
  { hanzi: 'app', pinyin: '', gloss: 'app' },
  { hanzi: '银 行', pinyin: 'yínháng', gloss: 'bank again' },
];

describe('newWordsInSentence', () => {
  it('words not in any deck, sentence order; known (normalised), particles, punctuation, Latin and repeats left out', () => {
    expect(newWordsInSentence(words, ['我', ' 去！', '学生']).map((w) => w.hanzi)).toEqual(['昨天', '银行']);
  });
  it('nothing new → empty (no chip)', () => {
    expect(newWordsInSentence(words, ['我', '昨天', '去', '银行'])).toEqual([]);
  });
  it('caps the list', () => {
    expect(newWordsInSentence(words, [], 1).map((w) => w.hanzi)).toEqual(['我']);
  });
});

describe('newWordCards / labels', () => {
  it('the sentence becomes the example only when it contains the word and is more than it', () => {
    const cards = newWordCards([{ hanzi: '银行', pinyin: 'yínháng', gloss: 'bank' }, { hanzi: '书', pinyin: 'shū', gloss: 'book' }], { hanzi: '我去银行。', pinyin: 'wǒ qù yínháng.', translation: 'I go to the bank.' });
    expect(cards[0]).toEqual({ hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行。', sentence_clue_pinyin: 'wǒ qù yínháng.', sentence_clue_translation: 'I go to the bank.' });
    expect(cards[1]).toEqual({ hanzi: '书', pinyin: 'shū', english: 'book' });
    expect(newWordCards([{ hanzi: '银行', pinyin: '', gloss: 'bank' }], { hanzi: '银行' })[0].sentence_clue).toBeUndefined();
  });
  it('labels', () => {
    expect(COACH_NEW_WORDS_LABEL(3)).toBe('➕ Add new words (3)');
    expect(addNewWordsButton(0)).toBe('Tick the words to add');
    expect(addNewWordsButton(1)).toBe('➕ Add 1 word');
    expect(addNewWordsButton(4)).toBe('➕ Add 4 words');
  });
});
