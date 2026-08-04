import { describe, it, expect } from 'vitest';
import { compareTranscription } from './useTranscription';

describe('compareTranscription', () => {
  const match = (transcribed: string, expectedHanzi: string) =>
    compareTranscription(transcribed, expectedHanzi, '').isMatch;

  it('matches identical hanzi', () => {
    expect(match('你好', '你好')).toBe(true);
  });

  it('rejects different hanzi (tone-aware)', () => {
    expect(match('妈', '马')).toBe(false);
    expect(match('四', '五')).toBe(false);
  });

  it('accepts Arabic digits in the transcription for hanzi numbers', () => {
    expect(match('5', '五')).toBe(true);
    expect(match('12', '十二')).toBe(true);
    expect(match('99', '九十九')).toBe(true);
  });

  it('accepts digits adjacent to hanzi', () => {
    expect(match('第2个', '第二个')).toBe(true);
    expect(match('3月', '三月')).toBe(true);
  });

  it('accepts hanzi when the note itself is written with digits', () => {
    expect(match('三月', '3月')).toBe(true);
    expect(match('五个', '5个')).toBe(true);
  });

  it('treats 两 and 二 as equivalent for numbers', () => {
    expect(match('200', '两百')).toBe(true);
    expect(match('二百', '两百')).toBe(true);
    expect(match('2000', '两千')).toBe(true);
  });

  it('handles numbers beyond 999', () => {
    expect(match('1000', '一千')).toBe(true);
    expect(match('1500', '一千五百')).toBe(true);
    expect(match('1005', '一千零五')).toBe(true);
    expect(match('10000', '一万')).toBe(true);
    expect(match('35000', '三万五千')).toBe(true);
  });

  it('handles thousands separators', () => {
    expect(match('1,000', '一千')).toBe(true);
    expect(match('10,000', '一万')).toBe(true);
  });

  it('handles decimals and percentages', () => {
    expect(match('1.5', '一点五')).toBe(true);
    expect(match('50%', '百分之五十')).toBe(true);
  });

  it('accepts English number words from the transcriber', () => {
    expect(match('two', '二')).toBe(true);
    expect(match('ten', '十')).toBe(true);
  });

  it('still rejects wrong numbers', () => {
    expect(match('20', '二')).toBe(false);
    expect(match('4', '五')).toBe(false);
    expect(match('300', '两百')).toBe(false);
  });

  it('ignores punctuation and whitespace', () => {
    expect(match('你好。', '你好')).toBe(true);
    expect(match(' 十二 ', '十二')).toBe(true);
  });
});
