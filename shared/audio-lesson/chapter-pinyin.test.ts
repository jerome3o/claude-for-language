import { describe, expect, it } from 'vitest';
import { chapterTitleParts, chapterTitleWithPinyin, splitChapterTitle } from './chapter-pinyin';
import type { LessonWord } from './types';

const words: LessonWord[] = [
  { hanzi: '打扰了', pinyin: 'dǎrǎo le', english: 'sorry to bother you' },
  { hanzi: '心意', pinyin: 'xīnyì', english: 'a small token of thanks' },
  { hanzi: '自驾游', pinyin: 'zìjiàyóu', english: 'road trip' },
];

describe('chapter titles with pinyin', () => {
  it('takes a taught word’s pinyin from the lesson’s words (dialogue)', () => {
    expect(chapterTitleWithPinyin('打扰了 — sorry to bother you', words)).toBe('打扰了 dǎrǎo le — sorry to bother you');
    expect(chapterTitleWithPinyin('心意 — a small token of thanks', words)).toBe('心意 xīnyì — a small token of thanks');
    expect(chapterTitleParts('打扰了 — sorry to bother you', words)).toEqual({ label: '打扰了 — sorry to bother you', pinyin: 'dǎrǎo le' });
  });

  it('never doubles a title that already has its pinyin (sleep)', () => {
    expect(chapterTitleWithPinyin('自驾游 zìjiàyóu', words)).toBe('自驾游 zìjiàyóu');
    expect(chapterTitleParts('自驾游 zìjiàyóu', words)).toEqual({ label: '自驾游', pinyin: 'zìjiàyóu' });
    // Without the words data too (a tone mark is enough).
    expect(chapterTitleParts('导航 dǎoháng')).toEqual({ label: '导航', pinyin: 'dǎoháng' });
    // A neutral-only pinyin is recognised when it is the word's.
    expect(chapterTitleParts('了 le', [{ hanzi: '了', pinyin: 'le', english: 'done' }])).toEqual({ label: '了', pinyin: 'le' });
  });

  it('falls back to automatic pinyin with the 一 / 不 tone changes', () => {
    expect(chapterTitleWithPinyin('开始')).toBe('开始 kāi shǐ');
    expect(splitChapterTitle('一个人 — alone').pinyin).toBe('yí gè rén');
    expect(splitChapterTitle('不是').pinyin).toBe('bú shì');
    // A word that isn't in the lesson's words.
    expect(chapterTitleWithPinyin('谢谢 — thanks', words)).toBe('谢谢 xiè xiè — thanks');
  });

  it('cuts the pinyin short where the title is cut short (story)', () => {
    expect(chapterTitleWithPinyin('小明每天早上七点起床…')).toBe('小明每天早上七点起床… xiǎo míng měi tiān zǎo shàng qī diǎn qǐ chuáng…');
    expect(chapterTitleParts('小明每天早上七点起床…')).toEqual({ label: '小明每天早上七点起床…', pinyin: 'xiǎo míng měi tiān zǎo shàng qī diǎn qǐ chuáng…' });
  });

  it('leaves titles without Chinese alone', () => {
    for (const t of ['Introduction', 'First listen', 'Third listen, a little slower', 'Final listen', '']) {
      expect(chapterTitleWithPinyin(t, words)).toBe(t);
      expect(chapterTitleParts(t, words)).toEqual({ label: t, pinyin: null });
    }
  });
});
