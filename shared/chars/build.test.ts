import { describe, it, expect } from 'vitest';
import { buildCharDict, cedictWordPinyin, cleanGloss, parseCedict, parseMakeMeAHanzi, parseWordfreq } from './build';
import { decodeMsgpack } from './msgpack';
import { charShard, charShardFile, CHAR_DICT_SHARDS } from './types';
import { TINY_CEDICT, TINY_HANZI, TINY_WORDFREQ } from './__fixtures__/tiny';

function build(maxRank?: number) {
  return buildCharDict({
    cedict: parseCedict(TINY_CEDICT),
    hanzi: parseMakeMeAHanzi(TINY_HANZI),
    freq: parseWordfreq(TINY_WORDFREQ),
  }, { maxRank, wordsPerChar: 20 });
}

describe('character dictionary build', () => {
  it('parses CC-CEDICT lines and skips comments', () => {
    const entries = parseCedict(TINY_CEDICT);
    expect(entries[0]).toEqual({ trad: '行', simp: '行', pinyin: 'hang2', glosses: ['(bound form) row; line', '(bound form) line of business; trade; profession'] });
    expect(entries.some((e) => e.simp.startsWith('#'))).toBe(false);
  });

  it('turns CC-CEDICT pinyin into one word with tone marks and the 一 / 不 changes', () => {
    expect(cedictWordPinyin('银行', 'yin2 hang2')).toBe('yínháng');
    expect(cedictWordPinyin('西安', 'Xi1 an1')).toBe("xī'ān");
    expect(cedictWordPinyin('一样', 'yi1 yang4')).toBe('yíyàng');
    expect(cedictWordPinyin('一点儿', 'yi1 dian3 r5')).toBe('yìdiǎnr');
    expect(cedictWordPinyin('绿', 'lu:4')).toBe('lǜ');
    expect(cedictWordPinyin('了', 'le5')).toBe('le');
  });

  it('keeps the first one or two real senses and drops cross-references', () => {
    expect(cleanGloss(['bank', 'CL:家[jia1],個|个[ge4]'])).toBe('bank');
    expect(cleanGloss(['(bound form) to walk; to go', 'capable', 'third'])).toBe('to walk; to go; capable');
    expect(cleanGloss(['used in 道行[dao4 heng2]'])).toBe('used in 道行');
    expect(cleanGloss(['(of a process etc) to proceed', '(completed action marker)'])).toBe('to proceed; (completed action marker)');
  });

  it('decodes wordfreq msgpack', () => {
    // [ {"format":"cB"}, ["一"], [] ]
    const bytes = new Uint8Array([0x93, 0x81, 0xa6, ...new TextEncoder().encode('format'), 0xa2, 0x63, 0x42, 0x91, 0xa3, ...new TextEncoder().encode('一'), 0x90]);
    expect(decodeMsgpack(bytes)).toEqual([{ format: 'cB' }, ['一'], []]);
    const freq = parseWordfreq(TINY_WORDFREQ);
    expect(freq.get('一')).toBe(1);
    expect(freq.get('进行')! > freq.get('银行')!).toBe(true);
  });

  it('builds a card-independent record per character', () => {
    const dict = build();
    const xing = dict.find((r) => r.char === '行')!;
    // Readings ordered by the words that use them: 银行 + 行业 (háng) outweigh 进行 (xíng);
    // "used in 道行" (héng) is only a cross-reference, so it is left out.
    expect(xing.readings.map((r) => r.pinyin)).toEqual(['háng', 'xíng']);
    expect(xing.readings[1].english).toBe('to walk; to go; to travel; capable; competent');
    expect(xing.meaning).toBe('to go, to walk, to move; professional');
    expect(xing.components).toEqual([
      { char: '彳', meaning: 'to step with the left foot' },
      { char: '亍', meaning: 'to take small steps' },
    ]);
    expect(xing.strokes).toBe(6);
    expect(xing.etymology).toContain('small steps');
    // Most frequent first; proper nouns (西安) never.
    expect(xing.words.map((w) => w.hanzi)).toEqual(['进行', '银行', '行业']);
    expect(xing.words[1]).toEqual({ hanzi: '银行', pinyin: 'yínháng', english: 'bank' });

    const yin = dict.find((r) => r.char === '银')!;
    expect(yin.readings).toEqual([{ pinyin: 'yín', english: 'silver' }]);
    expect(yin.etymology).toBe('钅 (money) gives the meaning, 艮 gives the sound');
    expect(yin.radical_meaning).toBe('gold, metal');

    const yi = dict.find((r) => r.char === '一')!;
    // Rank = Σ word frequency × occurrences: 行 (行, 进行, 银行, 行业) outranks 一.
    expect(xing.rank).toBe(1);
    expect(yi.rank).toBe(2);
    expect(yi.words.map((w) => `${w.hanzi} ${w.pinyin}`)).toEqual(['一样 yíyàng', '一点儿 yìdiǎnr']);
  });

  it('includes ranked characters Make Me a Hanzi lacks, and nothing empty', () => {
    const dict = build();
    expect(dict.some((r) => r.char === '样')).toBe(true);
    expect(dict.some((r) => r.char === '业')).toBe(true);
    expect(dict.every((r) => r.readings.length > 0 || r.words.length > 0)).toBe(true);
    // Sorted, one record per character.
    const chars = dict.map((r) => r.char);
    expect(chars).toEqual([...chars].sort());
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('shards by code point', () => {
    expect(charShard('行')).toBe('行'.codePointAt(0)! % CHAR_DICT_SHARDS);
    expect(charShardFile(7)).toBe('007.dat');
  });
});
