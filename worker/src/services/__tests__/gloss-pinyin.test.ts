import { describe, expect, it, vi } from 'vitest';
import { alignPinyin, checkGlossPinyin, pinyinProLine, syllableFits } from '../calls/gloss-pinyin';

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
