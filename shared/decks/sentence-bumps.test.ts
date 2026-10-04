import { describe, it, expect } from 'vitest';
import { addToTodayLabel, sentenceBumps, MAX_SENTENCE_BUMP_WORDS } from './sentence-bumps';

const note = (id: string, hanzi: string) => ({ id, hanzi });
const ids = (r: { words: Array<{ id: string }> }) => r.words.map(w => w.id);

describe('sentenceBumps', () => {
  it('the whole sentence is a note: exact, and only that note', () => {
    const notes = [note('w1', '外卖'), note('s1', '我们一起吃外卖吧'), note('w2', '吃')];
    const r = sentenceBumps('我们一起吃外卖吧！', notes);
    expect(r.exact?.id).toBe('s1');
    expect(r.words).toEqual([]);
  });

  it('exact ignores spaces and punctuation on both sides', () => {
    const r = sentenceBumps(' 你好， 世界。', [note('n', '你好世界')]);
    expect(r.exact?.id).toBe('n');
  });

  it('otherwise the words in it: longer first, then sentence order; single characters last', () => {
    const notes = [note('c', '吃'), note('k', '可爱'), note('q', '情侣'), note('w', '外卖'), note('y', '一对'), note('x', '咖啡')];
    const r = sentenceBumps('一对可爱的情侣在吃外卖。', notes);
    expect(r.exact).toBeNull();
    expect(ids(r)).toEqual(['y', 'k', 'q', 'w', 'c']);
  });

  it('a single character only inside a longer matched word is left out', () => {
    const notes = [note('c', '吃'), note('xc', '小吃'), note('h', '好')];
    expect(ids(sentenceBumps('这个小吃很好', notes))).toEqual(['xc', 'h']);
    // …but kept when it also stands on its own somewhere.
    expect(ids(sentenceBumps('我吃这个小吃', notes))).toEqual(['xc', 'c']);
  });

  it('longer multi-character words still keep the shorter ones inside them', () => {
    const notes = [note('a', '大学'), note('b', '大学生')];
    expect(ids(sentenceBumps('他是大学生', notes))).toEqual(['b', 'a']);
  });

  it('one row per spelling, the first note given wins', () => {
    const notes = [note('d1', '银行'), note('d2', '银行')];
    expect(ids(sentenceBumps('我去银行', notes))).toEqual(['d1']);
  });

  it('nothing matches → nothing; empty text → nothing', () => {
    expect(sentenceBumps('今天天气很好', [note('a', '咖啡')])).toEqual({ exact: null, words: [] });
    expect(sentenceBumps('。', [note('a', '。')])).toEqual({ exact: null, words: [] });
    expect(sentenceBumps('你好', [])).toEqual({ exact: null, words: [] });
  });

  it('caps the list', () => {
    const chars = '一二三四五六七八九十百千万亿甲乙丙丁戊己庚辛壬癸';
    const notes = [...chars].map((c, i) => note(`n${i}`, c));
    expect(sentenceBumps(chars, notes).words).toHaveLength(MAX_SENTENCE_BUMP_WORDS);
    expect(sentenceBumps(chars, notes, 3).words.map(w => w.hanzi)).toEqual(['一', '二', '三']);
  });
});

describe('addToTodayLabel', () => {
  it('names the count', () => {
    expect(addToTodayLabel(0)).toBe('⚡ Add to today');
    expect(addToTodayLabel(1)).toBe('⚡ Add 1 to today');
    expect(addToTodayLabel(3)).toBe('⚡ Add 3 to today');
  });
});
