import { describe, it, expect } from 'vitest';
import { mergeEnrichment } from '../enrich-words';

describe('mergeEnrichment', () => {
  const inputs = [
    { hanzi: '苹果', pinyin: 'píng guǒ', english: 'apple' },
    { hanzi: '香蕉', pinyin: 'xiāng jiāo', english: 'banana', fun_facts: 'Teacher wrote this.' },
    { hanzi: '葡萄', pinyin: 'pú táo', english: 'grape', sentence_clue: '我爱吃葡萄。' },
  ];

  it('fills blanks, keeps the teacher text and matches by hanzi in any order', () => {
    const out = mergeEnrichment(inputs, [
      { hanzi: '葡萄', fun_facts: '葡 pú + 萄 táo', sentence_clue: '葡萄很甜。', sentence_clue_pinyin: 'pútáo hěn tián', sentence_clue_translation: 'Grapes are sweet.' },
      { hanzi: '苹果', fun_facts: '苹 píng + 果 guǒ fruit', sentence_clue: '我每天吃一个苹果。', sentence_clue_pinyin: 'wǒ měitiān chī yí gè píngguǒ', sentence_clue_translation: 'I eat an apple every day.' },
      { hanzi: '香蕉', fun_facts: 'Claude wrote this.', sentence_clue: '香蕉是黄色的。', sentence_clue_pinyin: 'xiāngjiāo shì huángsè de', sentence_clue_translation: 'Bananas are yellow.' },
    ]);
    expect(out[0]).toEqual({ hanzi: '苹果', fun_facts: '苹 píng + 果 guǒ fruit', sentence_clue: '我每天吃一个苹果。', sentence_clue_pinyin: 'wǒ měitiān chī yí gè píngguǒ', sentence_clue_translation: 'I eat an apple every day.' });
    expect(out[1].fun_facts).toBe('Teacher wrote this.');
    expect(out[1].sentence_clue).toBe('香蕉是黄色的。');
    expect(out[2].sentence_clue).toBe('我爱吃葡萄。'); // the teacher's sentence stays
    expect(out[2].sentence_clue_pinyin).toBe(''); // and Claude's pinyin for a different sentence is not attached to it
    expect(out[2].fun_facts).toBe('葡 pú + 萄 táo');
  });

  it('drops a sentence that breaks a hard rule or does not contain the word', () => {
    const out = mergeEnrichment([{ hanzi: '苹果' }, { hanzi: '香蕉' }, { hanzi: '葡萄' }], [
      { hanzi: '苹果', fun_facts: 'x', sentence_clue: '我吃苹果/香蕉。', sentence_clue_pinyin: 'p', sentence_clue_translation: 't' },
      { hanzi: '香蕉', fun_facts: 'y', sentence_clue: '我吃水果。', sentence_clue_pinyin: 'p', sentence_clue_translation: 't' },
      { hanzi: '葡萄', fun_facts: 'z', sentence_clue: '我吃葡萄…', sentence_clue_pinyin: 'p', sentence_clue_translation: 't' },
    ]);
    expect(out.map((o) => o.sentence_clue)).toEqual(['', '', '']);
    expect(out.map((o) => o.fun_facts)).toEqual(['x', 'y', 'z']);
  });

  it('leaves a word blank when Claude did not return it', () => {
    const out = mergeEnrichment([{ hanzi: '苹果' }], []);
    expect(out[0]).toEqual({ hanzi: '苹果', fun_facts: '', sentence_clue: '', sentence_clue_pinyin: '', sentence_clue_translation: '' });
  });
});
