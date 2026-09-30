import { describe, it, expect } from 'vitest';
import { cleanGloss, findGlossSegment, formatGloss, glossCacheKey, glossChipLabel, isHanChar, GLOSS_MAX_SEGMENT } from './gloss';

/** Caret at the end of `text` (in characters). */
const atEnd = (text: string, composing = false) => {
  const n = Array.from(text).length;
  return findGlossSegment(text, n, n, composing);
};

describe('findGlossSegment — when to suggest', () => {
  it('glosses the Chinese run ending at the caret', () => {
    expect(atEnd('你好')).toEqual({ ok: true, segment: '你好', start: 0, end: 2 });
    expect(atEnd('我想喝咖啡')).toEqual({ ok: true, segment: '我想喝咖啡', start: 0, end: 5 });
  });

  it('never suggests while an IME composition is open', () => {
    expect(atEnd('你好', true)).toEqual({ ok: false, reason: 'composing' });
  });

  it('needs a plain caret, not a selection', () => {
    expect(findGlossSegment('你好', 0, 2)).toEqual({ ok: false, reason: 'selection' });
  });

  it('only when the text just before the caret is Chinese', () => {
    expect(atEnd('hello')).toEqual({ ok: false, reason: 'no_chinese' });
    expect(atEnd('你好 ')).toEqual({ ok: false, reason: 'no_chinese' });
    expect(atEnd('')).toEqual({ ok: false, reason: 'no_chinese' });
    expect(atEnd('。')).toEqual({ ok: false, reason: 'no_chinese' });
    expect(atEnd('你好 - nǐ hǎo - hello')).toEqual({ ok: false, reason: 'no_chinese' });
  });

  it('keeps Chinese punctuation inside and at the end, drops it at the start', () => {
    expect(atEnd('你好，我叫小明。')).toMatchObject({ ok: true, segment: '你好，我叫小明。' });
    expect(atEnd('“你好”')).toMatchObject({ ok: true, segment: '你好”', start: 1 });
    expect(atEnd('真的吗？')).toMatchObject({ ok: true, segment: '真的吗？' });
  });

  it('on a mixed line takes only the trailing Chinese run', () => {
    expect(atEnd('Today we learned 苹果')).toEqual({ ok: true, segment: '苹果', start: 17, end: 19 });
    expect(atEnd('I like 苹果 and 香蕉')).toMatchObject({ ok: true, segment: '香蕉' });
    expect(atEnd('abc苹果')).toMatchObject({ ok: true, segment: '苹果', start: 3 });
    expect(atEnd('你好 - nǐ hǎo - hello 谢谢')).toMatchObject({ ok: true, segment: '谢谢' });
  });

  it('works on the current line only', () => {
    expect(atEnd('你好\n谢谢')).toEqual({ ok: true, segment: '谢谢', start: 3, end: 5 });
    expect(atEnd('你好\n')).toEqual({ ok: false, reason: 'no_chinese' });
    // Caret at the end of line 1, line 2 below.
    expect(findGlossSegment('你好\nhello', 2, 2)).toEqual({ ok: true, segment: '你好', start: 0, end: 2 });
  });

  it('not when the line already has a gloss after the run', () => {
    expect(findGlossSegment('你好 - nǐ hǎo - hello', 2, 2)).toEqual({ ok: false, reason: 'already_glossed' });
    expect(findGlossSegment('你好 -', 2, 2)).toEqual({ ok: false, reason: 'already_glossed' });
    expect(findGlossSegment('你好 — nǐ hǎo', 2, 2)).toEqual({ ok: false, reason: 'already_glossed' });
    // …even when other lines follow.
    expect(findGlossSegment('你好 - nǐ hǎo - hello\n再见', 2, 2)).toEqual({ ok: false, reason: 'already_glossed' });
  });

  it('not in the middle of a line (the ghost would cover the rest)', () => {
    expect(findGlossSegment('你好吗', 2, 2)).toEqual({ ok: false, reason: 'not_at_line_end' });
    expect(findGlossSegment('你好 world', 2, 2)).toEqual({ ok: false, reason: 'not_at_line_end' });
    // Trailing spaces don't count as text.
    expect(findGlossSegment('你好  ', 2, 2)).toMatchObject({ ok: true, segment: '你好' });
  });

  it('cuts a long run to the last 40 characters, at a clause break when there is one', () => {
    const long = '我'.repeat(50);
    const r = atEnd(long);
    expect(r).toMatchObject({ ok: true, start: 10, end: 50 });
    if (r.ok) expect(Array.from(r.segment).length).toBe(GLOSS_MAX_SEGMENT);
    const clauses = `${'我'.repeat(30)}，${'你'.repeat(20)}`; // 51 chars; the window starts at 11, the comma at 30
    expect(atEnd(clauses)).toMatchObject({ ok: true, segment: '你'.repeat(20), start: 31 });
  });

  it('counts characters as code points (supplementary ideographs)', () => {
    expect(atEnd('a𠀀好')).toEqual({ ok: true, segment: '𠀀好', start: 1, end: 3 });
    expect(isHanChar('𠀀')).toBe(true);
    expect(isHanChar('a')).toBe(false);
    expect(isHanChar('〇')).toBe(true);
  });

  it('a caret on a line below other Chinese lines glosses only its own line', () => {
    expect(atEnd('你好\n谢谢\n再见')).toEqual({ ok: true, segment: '再见', start: 6, end: 8 });
    expect(atEnd('你好。\n我们')).toMatchObject({ ok: true, segment: '我们' });
    // An empty or English line below Chinese ones: nothing to gloss, never reaching up.
    expect(atEnd('你好\n谢谢\n')).toEqual({ ok: false, reason: 'no_chinese' });
    expect(atEnd('你好\nok')).toEqual({ ok: false, reason: 'no_chinese' });
    // Windows line endings.
    expect(atEnd('你好\r\n谢谢')).toMatchObject({ ok: true, segment: '谢谢' });
    // A long line never pulls text from the line above even when shorter than the cap.
    const r = atEnd(`${'我'.repeat(30)}\n${'你'.repeat(5)}`);
    expect(r).toMatchObject({ ok: true, segment: '你'.repeat(5) });
    if (r.ok) expect(r.segment).not.toContain('\n');
  });

  it('clamps a caret past the end', () => {
    expect(findGlossSegment('你好', 9, 9)).toMatchObject({ ok: true, end: 2 });
  });
});

describe('formatGloss', () => {
  it('appends " - pinyin - english"', () => {
    expect(formatGloss({ pinyin: 'nǐ hǎo', english: 'hello' })).toBe(' - nǐ hǎo - hello');
    expect('你好' + formatGloss({ pinyin: 'nǐ hǎo', english: 'hello' })).toBe('你好 - nǐ hǎo - hello');
    expect(glossChipLabel({ pinyin: 'nǐ hǎo', english: 'hello' })).toBe('⇥ nǐ hǎo - hello');
  });
  it('cache key is the trimmed NFC text', () => {
    expect(glossCacheKey(' 你好 ')).toBe('你好');
  });
});

describe('cleanGloss — Claude reply → board text', () => {
  it('accepts a good reply', () => {
    expect(cleanGloss({ pinyin: 'wǒ xiǎng hē kāfēi', english: 'I want to drink coffee' })).toEqual({ pinyin: 'wǒ xiǎng hē kāfēi', english: 'I want to drink coffee' });
  });
  it('converts tone numbers and flattens whitespace', () => {
    expect(cleanGloss({ pinyin: ' ni3  hao3\n', english: ' hello \n there. ' })).toEqual({ pinyin: 'nǐ hǎo', english: 'hello there' });
  });
  it('removes separators and quotes that would break the line', () => {
    expect(cleanGloss({ pinyin: 'nǐ hǎo', english: '"hello - hi"' })).toEqual({ pinyin: 'nǐ hǎo', english: 'hello, hi' });
  });
  it('a reply with line breaks becomes one line (never a multi-line completion)', () => {
    const g = cleanGloss({ pinyin: 'nǐ\nhǎo\r\n', english: 'hello\r\nhi there\u2028friend\n\n' });
    expect(g).toEqual({ pinyin: 'nǐ hǎo', english: 'hello hi there friend' });
    expect(formatGloss(g!)).toBe(' - nǐ hǎo - hello hi there friend');
    expect(formatGloss(g!)).not.toMatch(/[\r\n]/);
    // formatGloss itself flattens too (defence in depth for a reply that skipped cleanGloss).
    expect(formatGloss({ pinyin: 'nǐ\nhǎo', english: 'hello\r\n' })).toBe(' - nǐ hǎo - hello');
    expect(cleanGloss({ pinyin: '\n\n', english: 'hello' })).toBeNull();
  });
  it('strips stray leading / trailing dashes', () => {
    expect(cleanGloss({ pinyin: '- nǐ hǎo', english: '- hello -' })).toEqual({ pinyin: 'nǐ hǎo', english: 'hello' });
  });
  it('cuts the English to 8 words', () => {
    expect(cleanGloss({ pinyin: 'a', english: 'one two three four five six seven eight, nine ten' })?.english).toBe('one two three four five six seven eight');
  });
  it('rejects bad shapes', () => {
    expect(cleanGloss(null)).toBeNull();
    expect(cleanGloss({ pinyin: 'nǐ hǎo' })).toBeNull();
    expect(cleanGloss({ pinyin: '', english: 'hello' })).toBeNull();
    expect(cleanGloss({ pinyin: '你好', english: 'hello' })).toBeNull();
    expect(cleanGloss({ pinyin: 'nǐ hǎo', english: '  ' })).toBeNull();
    expect(cleanGloss({ pinyin: 'nǐ hǎo', english: '你好' })).toBeNull();
  });
});
