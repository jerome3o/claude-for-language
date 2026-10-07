import { describe, expect, it } from 'vitest';
import {
  breadcrumbTrail,
  charSegments,
  explorableSegments,
  explorerReducer,
  EXPLORER_MAX_DEPTH,
  itemForText,
  relatedWords,
  resolveWord,
  wordChars,
  wordFrequencyLabel,
  type ExplorerItem,
} from './index';

const c = (char: string): ExplorerItem => ({ kind: 'char', char });
const w = (hanzi: string): ExplorerItem => ({ kind: 'word', hanzi });

describe('explorer stack', () => {
  it('opens, pushes, pops and closes', () => {
    let s = explorerReducer([], { type: 'open', item: w('银行') });
    s = explorerReducer(s, { type: 'push', item: c('银') });
    s = explorerReducer(s, { type: 'push', item: w('银子') });
    expect(s.map((i) => (i.kind === 'char' ? i.char : i.hanzi))).toEqual(['银行', '银', '银子']);
    expect(explorerReducer(s, { type: 'pop' })).toHaveLength(2);
    expect(explorerReducer(s, { type: 'popTo', index: 0 })).toEqual([w('银行')]);
    expect(explorerReducer(s, { type: 'popTo', index: 9 })).toEqual(s);
    expect(explorerReducer(s, { type: 'close' })).toEqual([]);
    expect(explorerReducer([c('银')], { type: 'pop' })).toEqual([]);
  });

  it('pushing the top again is a no-op; an item further down goes back to it', () => {
    const s = [w('银行'), c('银'), w('银子')];
    expect(explorerReducer(s, { type: 'push', item: w('银子') })).toEqual(s);
    expect(explorerReducer(s, { type: 'push', item: { kind: 'word', hanzi: '银行', gloss: 'bank' } })).toEqual([w('银行')]);
  });

  it('open replaces the stack; depth is capped', () => {
    expect(explorerReducer([w('银行'), c('银')], { type: 'open', item: c('好') })).toEqual([c('好')]);
    let s: ExplorerItem[] = [];
    for (let i = 0; i < EXPLORER_MAX_DEPTH + 5; i++) s = explorerReducer(s, { type: 'push', item: c(String.fromCodePoint(0x4e00 + i)) });
    expect(s).toHaveLength(EXPLORER_MAX_DEPTH);
    expect(s[0]).toEqual(c(String.fromCodePoint(0x4e00 + 5)));
  });

  it('breadcrumb: all while they fit, else first … last two', () => {
    expect(breadcrumbTrail([w('银行'), c('银')])).toEqual([
      { kind: 'item', label: '银行', index: 0, current: false },
      { kind: 'item', label: '银', index: 1, current: true },
    ]);
    const long = [w('银行'), c('银'), w('银子'), c('子'), w('孩子')];
    expect(breadcrumbTrail(long).map((x) => (x.kind === 'gap' ? '…' : x.label))).toEqual(['银行', '…', '子', '孩子']);
    expect(breadcrumbTrail([])).toEqual([]);
  });

  it('itemForText: one character → char, several → word with the hint, none → null', () => {
    expect(itemForText('银')).toEqual(c('银'));
    expect(itemForText('银行，', { gloss: 'bank', pinyin: '' })).toEqual({ kind: 'word', hanzi: '银行', gloss: 'bank' });
    expect(itemForText('，!')).toBeNull();
  });
});

describe('word facts', () => {
  it('wordChars lines syllables up with characters', () => {
    expect(wordChars('银行', 'yínháng')).toEqual([
      { char: '银', syllable: 'yín', tone: 2 },
      { char: '行', syllable: 'háng', tone: 2 },
    ]);
    expect(wordChars('一个', 'yíge', ['yí', 'ge']).map((x) => x.tone)).toEqual([2, 5]);
    expect(wordChars('银行', 'bank')).toEqual([
      { char: '银', syllable: null, tone: null },
      { char: '行', syllable: null, tone: null },
    ]);
  });

  it('frequency label', () => {
    expect(wordFrequencyLabel(570)).toEqual({ text: '#570 most common word', tier: 'top' });
    expect(wordFrequencyLabel(2915)).toEqual({ text: '#2,915 most common word', tier: 'common' });
    expect(wordFrequencyLabel(15658).tier).toBe('uncommon');
    expect(wordFrequencyLabel(51006)).toEqual({ text: 'Rare word', tier: 'rare' });
    expect(wordFrequencyLabel(null)).toEqual({ text: 'Rare word', tier: 'rare' });
  });

  it('resolveWord: dictionary, then character lists, then my card, then the context', () => {
    const record = { hanzi: '银行', pinyin: 'yínháng', syllables: ['yín', 'háng'], english: 'bank', senses: ['bank'], rank: 570 };
    expect(resolveWord('银行', { record, rank: 600 })).toMatchObject({ english: 'bank', source: 'dictionary', rank: 600 });
    expect(resolveWord('银行', { charWords: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank (cw)' }] })).toMatchObject({ english: 'bank (cw)', source: 'char_dict' });
    expect(resolveWord('银行', { notes: [{ hanzi: '银行 ', pinyin: 'yínháng', english: 'a bank' }] })).toMatchObject({ english: 'a bank', source: 'your_card' });
    expect(resolveWord('银行', { hint: { gloss: 'the bank' } })).toMatchObject({ english: 'the bank', source: 'context' });
    expect(resolveWord('银行', {})).toMatchObject({ english: '', source: 'none', rank: null });
  });
});

describe('related words', () => {
  const yin = { char: '银', words: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank' }, { hanzi: '银子', pinyin: 'yínzi', english: 'silver' }, { hanzi: '收银', pinyin: 'shōuyín', english: 'cashier' }] };
  const hang = { char: '行', words: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank' }, { hanzi: '自行车', pinyin: 'zìxíngchē', english: 'bicycle' }, { hanzi: '行人', pinyin: 'xíngrén', english: 'pedestrian' }] };
  const ranks: Record<string, number> = { 自行车: 3000, 银子: 15000, 行人: 5000 };

  it('other words sharing a character, most common first, unranked after by list position', () => {
    const out = relatedWords('银行', [yin, hang], (h) => ranks[h]);
    expect(out.map((r) => r.word.hanzi)).toEqual(['自行车', '行人', '银子', '收银']);
    expect(out[0].shared).toEqual(['行']);
  });

  it('ignores records of other characters and respects the limit', () => {
    expect(relatedWords('银子', [hang], () => 1)).toEqual([]);
    expect(relatedWords('银行', [yin, hang], () => null, 2).map((r) => r.word.hanzi)).toEqual(['自行车', '银子']);
  });
});

describe('explorable segments', () => {
  it('by character without words', () => {
    expect(charSegments('我是Tom。')).toEqual([
      { text: '我', item: c('我') },
      { text: '是', item: c('是') },
      { text: 'Tom。', item: null },
    ]);
  });

  it('by word when the segments match, with the hint and the sentence', () => {
    const text = '我去银行。';
    const segs = [{ text: '我', pinyin: 'wǒ', gloss: 'I' }, { text: '去', pinyin: 'qù', gloss: 'go' }, { text: '银行', pinyin: 'yínháng', gloss: 'bank' }, { text: '。' }];
    const out = explorableSegments(text, segs, () => text);
    expect(out[0]).toEqual({ text: '我', item: c('我') });
    expect(out[2]).toEqual({ text: '银行', item: { kind: 'word', hanzi: '银行', pinyin: 'yínháng', gloss: 'bank', sentence: text } });
    expect(out[3]).toEqual({ text: '。', item: null });
  });

  it('falls back to characters when the segments do not match the text', () => {
    expect(explorableSegments('银行', [{ text: '银' }])).toEqual(charSegments('银行'));
  });
});
