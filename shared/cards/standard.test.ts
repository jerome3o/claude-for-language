import { describe, it, expect } from 'vitest';
import { cardTextProblems, CARD_STANDARD, CARD_STANDARD_SHORT } from './standard';

describe('card standard', () => {
  it('accepts clean cards: a word, a sentence with Chinese punctuation, a title in 《》', () => {
    expect(cardTextProblems({ hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' })).toEqual([]);
    expect(cardTextProblems({ hanzi: '请问，洗手间在哪里？', pinyin: 'qǐngwèn, xǐshǒujiān zài nǎlǐ?', english: 'Where is the toilet?' })).toEqual([]);
    expect(cardTextProblems({ hanzi: '我在看《红楼梦》。', sentence_clue: '我昨天看了一本书。' })).toEqual([]);
    expect(cardTextProblems({ hanzi: 'AA制', english: 'go Dutch' })).toEqual([]);
  });

  it('refuses slashes, parentheses, brackets, ellipses and blanks on the card, and says where the content goes', () => {
    for (const hanzi of ['你好/您好', '(请)坐', '（请）坐', '我…了', '我...了', '___是我的', '不要[太]客气', '好 | 行']) {
      const problems = cardTextProblems({ hanzi });
      expect(problems.map(p => p.field)).toEqual(['hanzi']);
      expect(problems[0].message).toContain('fun_facts');
    }
  });

  it('refuses tone numbers, and symbols in the example sentence, but allows a Chinese comma', () => {
    expect(cardTextProblems({ pinyin: 'ni3 hao3' })[0]).toMatchObject({ field: 'pinyin' });
    expect(cardTextProblems({ pinyin: 'nǐ hǎo' })).toEqual([]);
    expect(cardTextProblems({ sentence_clue: '对不起，我来晚了。' })).toEqual([]);
    expect(cardTextProblems({ sentence_clue: '我想吃(苹果)。' })[0].message).toContain('brackets');
    expect(cardTextProblems({ sentence_clue: '' })).toEqual([]);
    expect(cardTextProblems({ sentence_clue: null })).toEqual([]);
  });

  it('only checks the fields given, so partial edits work', () => {
    expect(cardTextProblems({ english: 'a / b' })).toEqual([]);
    expect(cardTextProblems({})).toEqual([]);
  });

  it('the standard text carries the rules the checker enforces', () => {
    for (const rule of ['ONE clean form', 'tone marks', 'fun_facts', 'sentence_clue', 'placeholders']) {
      expect(CARD_STANDARD).toContain(rule);
    }
    expect(CARD_STANDARD_SHORT.length).toBeLessThan(600);
  });
});
