import { describe, expect, it } from 'vitest';
import {
  checkSpokenAnswer,
  checkTypedAnswer,
  isAcceptedVerdict,
  normalizeSpokenPinyin,
  spokenPinyinKey,
  spokenVerdictNote,
  tonelessPinyin,
} from './answer';

describe('checkTypedAnswer (the AnswerDiff decision)', () => {
  it('exact, punctuation-only, equivalent, alternative, wrong', () => {
    expect(checkTypedAnswer('你好', '你好')).toBe('exact');
    expect(checkTypedAnswer(' 你好 ', '你好')).toBe('exact');
    expect(checkTypedAnswer('你好', '你好。')).toBe('punctuation_only');
    expect(checkTypedAnswer('7个', '七个')).toBe('equivalent');
    expect(checkTypedAnswer('两个', '二个')).toBe('equivalent');
    expect(checkTypedAnswer('您好', '你好', ['您好'])).toBe('alternative');
    expect(checkTypedAnswer('你号', '你好')).toBe('wrong');
  });

  it('never gives the spoken verdicts', () => {
    expect(checkTypedAnswer('油', '由')).toBe('wrong');
  });
});

describe('checkSpokenAnswer', () => {
  it('a homophone counts by sound', () => {
    expect(checkSpokenAnswer('油', '由')).toBe('sound');
    expect(checkSpokenAnswer('游', '由')).toBe('sound');
    expect(checkSpokenAnswer('她是我的朋友', '他是我的朋友')).toBe('sound');
    expect(checkSpokenAnswer('银航', '银行')).toBe('sound');
  });

  it('exact hanzi stay exact; punctuation the recogniser adds is ignored', () => {
    expect(checkSpokenAnswer('由', '由')).toBe('exact');
    expect(checkSpokenAnswer('你好。', '你好')).toBe('punctuation_only');
    expect(checkSpokenAnswer('我有七个', '我有7个')).toBe('equivalent');
    expect(checkSpokenAnswer('您好', '你好', ['您好'])).toBe('alternative');
  });

  it('other tones are close (still wrong), other syllables wrong', () => {
    expect(checkSpokenAnswer('有', '由')).toBe('close');
    expect(checkSpokenAnswer('买', '卖')).toBe('close');
    expect(checkSpokenAnswer('猫', '狗')).toBe('wrong');
    expect(isAcceptedVerdict('close')).toBe(false);
    expect(isAcceptedVerdict('sound')).toBe(true);
  });

  it('the note pinyin is a target too (a polyphone the automatic pinyin reads otherwise)', () => {
    // 长 alone reads cháng; the card says zhǎng ("to grow").
    expect(checkSpokenAnswer('涨', '长')).toBe('wrong');
    expect(checkSpokenAnswer('涨', '长', [], 'zhǎng')).toBe('sound');
  });

  it('the 一 / 不 tone changes are applied on both sides', () => {
    expect(spokenPinyinKey('一个')).toBe('yígè');
    expect(spokenPinyinKey('不是')).toBe('búshì');
    expect(checkSpokenAnswer('衣个', '一个')).toBe('close');
  });

  it('nothing Chinese heard is wrong, never by sound', () => {
    expect(checkSpokenAnswer('', '由')).toBe('wrong');
    expect(checkSpokenAnswer('you', '由')).toBe('wrong');
    expect(checkSpokenAnswer('ma', '吗')).toBe('wrong');
  });
});

describe('pinyin helpers', () => {
  it('normalises and strips tones', () => {
    expect(normalizeSpokenPinyin("Xī'ān, nǚ ér")).toBe('xīānnǚér');
    expect(tonelessPinyin('xīānnǚér')).toBe('xiannüer');
  });

  it('the note line', () => {
    expect(spokenVerdictNote('sound', '由')).toBe('Sounded right ✓ — written 由');
    expect(spokenVerdictNote('close', '由')).toBe('Close — the tones are off');
    expect(spokenVerdictNote('exact', '由')).toBeNull();
  });
});
