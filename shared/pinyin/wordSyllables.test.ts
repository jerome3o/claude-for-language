import { describe, expect, it } from 'vitest';
import { polyphonic, pinyin } from 'pinyin-pro';
import { alignWordSyllables, checkWordPinyin, deviceSyllables, hanChars, joinWordSyllables, readingFits, type DevicePinyin } from './wordSyllables';
import { applyYiBuToneChanges } from './toneChange';
import { resolveWord, wordChars } from '../explorer/word';

/** The device's readings + auto-pinyin as the web app has them (pinyin-pro, then the 一 / 不 rule). */
const device: DevicePinyin = {
  readings: (ch) => (polyphonic(ch)[0] ?? '').split(' ').filter(Boolean),
  auto: (text) => applyYiBuToneChanges(text, pinyin(text, { toneType: 'symbol', type: 'string' })),
};

describe('alignWordSyllables', () => {
  const chars = hanChars('吴侬软语');

  it('cuts joined pinyin into one syllable per character (no greedy wún | óng)', () => {
    expect(alignWordSyllables(chars, 'wúnóngkuǎnyǔ')?.syllables).toEqual(['wú', 'nóng', 'kuǎn', 'yǔ']);
    expect(alignWordSyllables(chars, 'wú nóng ruǎn yǔ')?.syllables).toEqual(['wú', 'nóng', 'ruǎn', 'yǔ']);
  });

  it('marks the syllables a character can never have', () => {
    const fits = (i: number, s: string) => readingFits(chars, i, s, device.readings!(chars[i]));
    const a = alignWordSyllables(chars, 'wúnóngkuǎnyǔ', fits)!;
    expect(a.syllables).toEqual(['wú', 'nóng', 'kuǎn', 'yǔ']);
    expect(a.misfits).toEqual([2]);
    expect(a.spans[2]).toEqual([6, 10]);
  });

  it('takes erhua, apostrophes, neutral tones and refuses what it cannot line up', () => {
    expect(alignWordSyllables(hanChars('一会儿'), 'yíhuìr')?.syllables).toEqual(['yí', 'huì', 'r']);
    expect(alignWordSyllables(hanChars('西安'), "Xī'ān")?.syllables).toEqual(['Xī', 'ān']);
    expect(alignWordSyllables(hanChars('妈妈'), 'māma')?.syllables).toEqual(['mā', 'ma']);
    expect(alignWordSyllables(hanChars('学生'), 'xue2sheng5')).toBeNull();
    expect(alignWordSyllables(hanChars('银行'), 'bank')).toBeNull();
    expect(alignWordSyllables(hanChars('吴侬软语'), 'wúnóng')).toBeNull();
  });
});

describe('readingFits', () => {
  it('knows readings, neutral tones, 一 / 不 and reduplication', () => {
    const r = (ch: string) => device.readings!(ch);
    expect(readingFits(['软'], 0, 'kuǎn', r('软'))).toBe(false);
    expect(readingFits(['软'], 0, 'ruǎn', r('软'))).toBe(true);
    expect(readingFits(['觉', '得'], 1, 'de', r('得'))).toBe(true);
    expect(readingFits(['一', '个'], 0, 'yí', [])).toBe(true);
    expect(readingFits(['好', '好'], 1, 'hāo', r('好'))).toBe(true);
    expect(readingFits(['𠀀'], 0, 'qiū', ['𠀀'])).toBe(true);
  });
});

describe('checkWordPinyin', () => {
  it('fixes the impossible syllable only (吴侬软语 kuǎn → ruǎn)', () => {
    expect(checkWordPinyin('吴侬软语', 'wúnóngkuǎnyǔ', device)).toEqual({
      pinyin: 'wúnóngruǎnyǔ',
      syllables: ['wú', 'nóng', 'ruǎn', 'yǔ'],
      how: 'corrected',
    });
    expect(checkWordPinyin('吴侬软语', 'wú nóng kuǎn yǔ', device).pinyin).toBe('wú nóng ruǎn yǔ');
  });

  it('keeps right pinyin as written', () => {
    expect(checkWordPinyin('银行', 'yínháng', device)).toEqual({ pinyin: 'yínháng', syllables: ['yín', 'háng'], how: 'as_given' });
    expect(checkWordPinyin('大人', 'dàrén', device).syllables).toEqual(['dà', 'rén']);
  });

  it("falls back to the device's reading when the pinyin can't be lined up", () => {
    expect(checkWordPinyin('吴侬软语', 'wúnóng', device)).toEqual({ pinyin: 'wúnóngruǎnyǔ', syllables: ['wú', 'nóng', 'ruǎn', 'yǔ'], how: 'device' });
    expect(checkWordPinyin('学生', 'xue2sheng5', device)).toMatchObject({ syllables: ['xué', 'shēng'], how: 'device' });
    expect(checkWordPinyin('西安', '', device)).toMatchObject({ pinyin: "xī'ān", how: 'device' });
    // Mostly wrong: another word's pinyin, not a slip.
    expect(checkWordPinyin('银行', 'péngyou', device)).toMatchObject({ pinyin: 'yínháng', how: 'device' });
  });

  it('never corrects a trusted source, and without device readings keeps what it has', () => {
    expect(checkWordPinyin('吴侬软语', 'wúnóngkuǎnyǔ', device, true)).toMatchObject({ pinyin: 'wúnóngkuǎnyǔ', how: 'as_given' });
    expect(checkWordPinyin('吴侬软语', 'wúnóngkuǎnyǔ')).toEqual({ pinyin: 'wúnóngkuǎnyǔ', syllables: ['wú', 'nóng', 'kuǎn', 'yǔ'], how: 'as_given' });
    expect(checkWordPinyin('吴侬软语', 'wúnóng')).toEqual({ pinyin: 'wúnóng', syllables: null, how: 'as_given' });
  });

  it('device syllables and joined words', () => {
    expect(deviceSyllables(hanChars('一个'), device.auto)).toEqual(['yí', 'gè']);
    expect(deviceSyllables(['𠀀'], device.auto)).toBeNull();
    expect(joinWordSyllables(['Xī', 'ān'])).toBe("Xī'ān");
  });
});

describe('the explorer Word view (Jerome: 吴侬软语 in a reader)', () => {
  it('wordChars splits by character even without the device', () => {
    expect(wordChars('吴侬软语', 'wúnóngkuǎnyǔ').map((c) => c.syllable)).toEqual(['wú', 'nóng', 'kuǎn', 'yǔ']);
  });

  it('resolveWord: the reader chip pinyin is validated, chips get wú nóng ruǎn yǔ', () => {
    const w = resolveWord('吴侬软语', { hint: { pinyin: 'wúnóngkuǎnyǔ', gloss: 'soft Wu dialect' }, device });
    expect(w).toMatchObject({ pinyin: 'wúnóngruǎnyǔ', syllables: ['wú', 'nóng', 'ruǎn', 'yǔ'], source: 'context', english: 'soft Wu dialect' });
    expect(wordChars('吴侬软语', w.pinyin, w.syllables).map((c) => [c.char, c.syllable, c.tone])).toEqual([
      ['吴', 'wú', 2],
      ['侬', 'nóng', 2],
      ['软', 'ruǎn', 3],
      ['语', 'yǔ', 3],
    ]);
  });

  it("resolveWord: an unalignable hint and no hint at all take the device's reading; the dictionary is untouched", () => {
    expect(resolveWord('吴侬软语', { hint: { pinyin: 'wún óng', gloss: 'x' }, device })).toMatchObject({ pinyin: 'wúnóngruǎnyǔ', syllables: ['wú', 'nóng', 'ruǎn', 'yǔ'] });
    expect(resolveWord('吴侬软语', { device })).toMatchObject({ pinyin: 'wúnóngruǎnyǔ', source: 'none' });
    const record = { hanzi: '银行', pinyin: 'yínháng', syllables: ['yín', 'háng'], english: 'bank', senses: ['bank'], rank: 1 };
    expect(resolveWord('银行', { record, device })).toMatchObject({ pinyin: 'yínháng', source: 'dictionary' });
  });
});
