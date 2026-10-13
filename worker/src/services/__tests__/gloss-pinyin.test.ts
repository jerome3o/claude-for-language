import { describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCharRecords, getWordRecords } from '../char-dict';
import { alignPinyin, checkGlossPinyin, dictionaryLine, pinyinProLine, syllableFits, type GlossReadingSources } from '../calls/gloss-pinyin';

// The worker's real dictionaries (worker/char-dict, committed), read from disk the way the CHAR_DICT binding serves them.
const dictDir = path.resolve(__dirname, '../../../char-dict');
const fsLoader = async (file: string) => {
  const p = path.join(dictDir, file);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
};
const real: GlossReadingSources = {
  charReadings: async (chars) => {
    const { records } = await getCharRecords(fsLoader, chars, 'test-fs');
    return Object.fromEntries(Object.entries(records).map(([c, r]) => [c, r.readings.map((x) => x.pinyin)]));
  },
  wordPinyin: async (words) => {
    const { records } = await getWordRecords(fsLoader, words, 'test-fs');
    return Object.fromEntries(Object.entries(records).map(([w, r]) => [w, r.pinyin]));
  },
};

describe("board gloss pinyin on Minghui's board (11 Oct 2026, the model's answers before the dictionary check)", () => {
  it('fixes them with the real dictionaries', async () => {
    for (const [hz, py, to] of [
      // A reading the character has, but not in this word: the dictionary and pinyin-pro agree against it.
      ['直觉', 'zhíjiào', 'zhíjué'],
      ['睡觉', 'shuìjué', 'shuìjiào'],
      // 一 / 不 tone changes.
      ['建一条路', 'jiàn yī tiáo lù', 'jiàn yì tiáo lù'],
      ['我一有时间就听播客', 'wǒ yī yǒu shíjiān jiù tīng bōkè', 'wǒ yì yǒu shíjiān jiù tīng bōkè'],
      ['我不太了解西班牙。', 'wǒ bùtài liǎojiě Xībānyá', 'wǒ bútài liǎojiě Xībānyá'],
      ['一般般', 'yībānbān', 'yìbānbān'],
      // Impossible syllables.
      ['人工智能是人性的放大器。', 'rénggōng zhìnéng shì rénxìng de fàngdà qì', 'réngōng zhìnéng shì rénxìng de fàngdà qì'],
      ['脑容量', 'nǎo rónliàng', 'nǎo róngliàng'],
      // A syllable left out (and a Latin alpha): the line is rebuilt from the dictionaries, words joined, 儿 folded.
      ['你玩儿得怎么样？', 'nǐ wáner de zěnyɑ̀ng?', 'nǐ wánr de zěnmeyàng?'],
    ]) {
      expect((await checkGlossPinyin(hz, py, real)).pinyin, hz).toBe(to);
    }
  });

  it('leaves right readings alone, also where the word dictionary picks another one', async () => {
    for (const [hz, py] of [
      ['大夫', 'dàifu'], ['觉得', 'juéde'], ['地方', 'dìfang'], ['长大', 'zhǎngdà'], ['了解', 'liǎojiě'], ['便宜', 'piányi'],
      ['头发', 'tóufa'], ['暖和', 'nuǎnhuo'], ['睡着', 'shuìzháo'], ['教室', 'jiàoshì'], ['一会儿', 'yíhuìr'], ['地道', 'dìdao'],
      ['种子', 'zhǒngzi'], ['种地', 'zhòngdì'], ['重新', 'chóngxīn'], ['差不多', 'chàbuduō'], ['出差', 'chūchāi'], ['好学', 'hàoxué'],
      ['还是', 'háishi'], ['首都', 'shǒudū'], ['行业', 'hángyè'], ['得到', 'dédào'], ['还钱', 'huán qián'], ['我得走了', 'wǒ děi zǒu le'],
      ['朝代', 'cháodài'], ['调整', 'tiáozhěng'], ['调查', 'diàochá'], ['第一节课前半小时', 'dì yī jié kè qián bàn xiǎoshí'],
    ]) {
      expect(await checkGlossPinyin(hz, py, real), hz).toEqual({ pinyin: py, fixes: [] });
    }
  });

  it('dictionaryLine: dictionary words joined, a lone particle neutral, 女儿 keeps its ér', async () => {
    expect(await dictionaryLine('你玩儿得怎么样？', real)).toBe('nǐ wánr de zěnmeyàng?');
    expect(await dictionaryLine('我女儿跑得很快', real)).toBe("wǒ nǚ'ér pǎo de hěn kuài");
    expect(await dictionaryLine('你好', {})).toBe('');
  });
});

const han = (s: string) => Array.from(s).filter((c) => /\p{Script=Han}/u.test(c));

describe('board gloss pinyin check', () => {
  it('keeps pinyin whose every syllable is a reading of its character', async () => {
    for (const [hz, py] of [
      ['我想喝咖啡', 'wǒ xiǎng hē kāfēi'],
      ['银行在哪儿', 'yínháng zài nǎr'],
      ['他长大了', 'tā zhǎngdà le'],
      ['我还没还书', 'wǒ hái méi huán shū'],
      ['东西', 'dōngxi'],
      ['你好，我叫小明。', 'nǐ hǎo, wǒ jiào Xiǎo Míng'],
      ['我得走了', 'wǒ děi zǒu le'],
      ['一点儿', 'yìdiǎnr'],
      ['西安', "Xī'ān"],
      // dà|rén, not dàr|én: a word is cut the way that fits its characters.
      ['大人', 'dàrén'],
    ]) {
      const r = await checkGlossPinyin(hz, py);
      expect(r, hz).toEqual({ pinyin: py, fixes: [] });
    }
  });

  it("replaces a word whose syllable the character never has, with the dictionary's word reading", async () => {
    const wordPinyin = vi.fn(async (words: string[]): Promise<Record<string, string>> => (words.includes('银行') ? { 银行: 'yínháng' } : {}));
    const r = await checkGlossPinyin('我去银行', 'wǒ qù yínxìng', { wordPinyin });
    expect(r.pinyin).toBe('wǒ qù yínháng');
    expect(r.fixes).toEqual([{ hanzi: '银行', from: 'yínxìng', to: 'yínháng' }]);
    expect(wordPinyin).toHaveBeenCalledWith(['银行']);
  });

  it("falls back to pinyin-pro's reading in this sentence when the dictionary has no such word", async () => {
    // 绿 is lǜ (or lù), never lú; 们 is men, never mēn.
    expect((await checkGlossPinyin('绿色', 'lúsè')).pinyin).toBe('lǜsè');
    expect((await checkGlossPinyin('我们', 'wǒ mēn')).pinyin).toBe('wǒ men');
    // Capitals kept.
    expect((await checkGlossPinyin('长城', 'Chǎngchéng')).pinyin).toBe('Chángchéng');
  });

  it('asks the character dictionary before calling a syllable wrong', async () => {
    // Suppose pinyin-pro lacked a reading CC-CEDICT has: the model's syllable stands.
    const charReadings = vi.fn(async () => ({ 们: ['mēn'] }));
    const r = await checkGlossPinyin('我们', 'wǒ mēn', { charReadings });
    expect(r).toEqual({ pinyin: 'wǒ mēn', fixes: [] });
    expect(charReadings).toHaveBeenCalledWith(['们']);
    // A dictionary that fails changes nothing about the answer's safety.
    const broken = { charReadings: async () => Promise.reject(new Error('x')), wordPinyin: async () => Promise.reject(new Error('y')) };
    expect((await checkGlossPinyin('绿色', 'lúsè', broken)).pinyin).toBe('lǜsè');
  });

  it('rebuilds the whole line when a syllable is left out or added', async () => {
    const r = await checkGlossPinyin('他长大了', 'tā zhǎng le');
    expect(r.pinyin).toBe('tā zhǎngdà le');
    expect(r.fixes).toHaveLength(1);
    expect((await checkGlossPinyin('你好', 'nǐ hǎo ma')).pinyin).toBe('nǐ hǎo');
  });

  it('applies the 一 / 不 rule to whatever comes out', async () => {
    expect((await checkGlossPinyin('一个人', 'yī gè rén')).pinyin).toBe('yí gè rén');
    expect((await checkGlossPinyin('不是', 'bù shì')).pinyin).toBe('bú shì');
    // Tone-changed 一 / 不 are never "wrong readings".
    expect(await checkGlossPinyin('一起', 'yìqǐ')).toEqual({ pinyin: 'yìqǐ', fixes: [] });
  });

  it('leaves text it cannot line up alone (digits / Latin in the Chinese)', async () => {
    expect(await checkGlossPinyin('3个', 'sān gè')).toEqual({ pinyin: 'sān gè', fixes: [] });
  });

  it('syllableFits: neutral tone fits any tone of the same syllable; marked tones must match', () => {
    expect(syllableFits('西', 'xi', ['xī'])).toBe(true);
    expect(syllableFits('西', 'xí', ['xī'])).toBe(false);
    expect(syllableFits('一', 'yí', ['yī'])).toBe(true);
    expect(syllableFits('不', 'bú', ['bù'])).toBe(true);
    expect(syllableFits('行', 'háng', ['xíng', 'háng'])).toBe(true);
  });

  it('alignPinyin folds 儿 into the syllable before it only when it has no syllable of its own', () => {
    expect(alignPinyin(han('哪儿'), 'nǎr')?.[0]).toMatchObject({ hanFrom: 0, hanTo: 2, erhua: [1] });
    expect(alignPinyin(han('女儿'), 'nǚ ér')?.map((w) => w.erhua)).toEqual([[], []]);
    expect(alignPinyin(han('你好'), 'nǐ')).toBeNull();
  });

  it('pinyinProLine writes words joined and plain punctuation', () => {
    expect(pinyinProLine('他长大了')).toBe('tā zhǎngdà le');
    expect(pinyinProLine('你呢？')).toBe('nǐ ne?');
  });
});
