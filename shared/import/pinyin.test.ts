import { describe, it, expect } from 'vitest';
import { toneNumbersToMarks, normalizePinyin, pinyinSyllableCount, segmentPinyin, hasToneInfo, stripTones } from './pinyin';

describe('pinyin helpers', () => {
  it('converts tone numbers to marks with the right vowel', () => {
    expect(toneNumbersToMarks('ni3 hao3')).toBe('nǐ hǎo');
    expect(toneNumbersToMarks('ni3hao3')).toBe('nǐhǎo');
    expect(toneNumbersToMarks('lv4')).toBe('lǜ');
    expect(toneNumbersToMarks('xie4xie5')).toBe('xièxie');
    expect(toneNumbersToMarks('dou1')).toBe('dōu');
    expect(toneNumbersToMarks('liu2')).toBe('liú');
    expect(toneNumbersToMarks('gui4')).toBe('guì');
    expect(toneNumbersToMarks('xue2 sheng1')).toBe('xué shēng');
    expect(toneNumbersToMarks('Bei3jing1')).toBe('Běijīng');
  });

  it('leaves tone-marked or non-pinyin text alone', () => {
    expect(toneNumbersToMarks('nǐ hǎo')).toBe('nǐ hǎo');
    expect(toneNumbersToMarks('hello')).toBe('hello');
    expect(normalizePinyin('  píng   guǒ ')).toBe('píng guǒ');
  });

  it('segments syllable runs', () => {
    expect(segmentPinyin('píngguǒ')).toEqual(['ping', 'guo']);
    expect(segmentPinyin("xi'an")).toEqual(['xi', 'an']);
    expect(segmentPinyin('zhuangyuan')).toEqual(['zhuang', 'yuan']);
    expect(segmentPinyin('hello')).toBeNull();
    expect(segmentPinyin('apple')).toBeNull();
  });

  it('counts syllables and rejects English', () => {
    expect(pinyinSyllableCount('nǐ hǎo')).toBe(2);
    expect(pinyinSyllableCount('píngguǒ')).toBe(2);
    expect(pinyinSyllableCount('wǒ měitiān chī yí gè píngguǒ.')).toBe(8);
    expect(pinyinSyllableCount('to eat')).toBeNull();
    expect(pinyinSyllableCount('banana')).toBe(3); // ba-na-na is syllable-shaped: callers use tone info / hanzi length
    // "ma" and "an" are syllables — the caller decides by tone info / length
    expect(pinyinSyllableCount('ma')).toBe(1);
  });

  it('detects tone info', () => {
    expect(hasToneInfo('nǐ hǎo')).toBe(true);
    expect(hasToneInfo('ni3 hao3')).toBe(true);
    expect(hasToneInfo('ni hao')).toBe(false);
    expect(stripTones('nǐ hǎo ma5')).toBe('ni hao ma');
  });
});
