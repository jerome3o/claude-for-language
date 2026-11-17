import { describe, expect, it } from 'vitest';
import { checkSpokenAnswer } from './answer';
import { spokenResult, spokenResultLabel, spokenResultState } from './spoken-result';

const marks = (transcript: string, correct: string, notePinyin = '') =>
  spokenResult(transcript, correct, checkSpokenAnswer(transcript, correct, [], notePinyin)).chars.map((c) => `${c.char}:${c.mark}`).join(' ');

describe('spokenResult', () => {
  it('maps every verdict onto the row’s five states', () => {
    expect(spokenResultState('exact')).toBe('match');
    expect(spokenResultState('punctuation_only')).toBe('match');
    expect(spokenResultState('equivalent')).toBe('match');
    expect(spokenResultState('alternative')).toBe('match');
    expect(spokenResultState('sound')).toBe('sound');
    expect(spokenResultState('contains')).toBe('contains');
    expect(spokenResultState('close')).toBe('close');
    expect(spokenResultState('wrong')).toBe('wrong');
  });

  it('a match: every character right, ✓ Match, no ✎', () => {
    const r = spokenResult('曾经', '曾经', 'exact');
    expect(r).toMatchObject({ state: 'match', accepted: true, chip: 'Match', icon: 'check', coach: false });
    expect(r.chars.map((c) => c.mark)).toEqual(['right', 'right']);
  });

  it('sounded right: the characters written differently are `differs` (yellow), the chip still ✓', () => {
    const r = spokenResult('油', '由', checkSpokenAnswer('油', '由'));
    // The chip is the answer diff's one sentence: it names the characters written differently.
    expect(r).toMatchObject({ state: 'sound', accepted: true, chip: 'Sounded right — written 油', icon: 'check', coach: true });
    expect(marks('油', '由')).toBe('油:differs');
    expect(marks('银航', '银行')).toBe('银:right 航:differs');
  });

  it('close (Jerome’s 狼 said 朗): the slipped tone marked, the chip one short sentence, not accepted', () => {
    const r = spokenResult('朗', '狼', checkSpokenAnswer('朗', '狼'));
    expect(r).toMatchObject({ state: 'close', accepted: false, chip: 'Tone off on 狼', icon: 'approx', coach: true });
    expect(marks('朗', '狼')).toBe('朗:tone');
  });

  it('didn’t match: the slim diff — wrong, extra, missing, tone off; the chip says what differs', () => {
    const r = spokenResult('猫。', '狗', 'wrong');
    expect(r).toMatchObject({ state: 'wrong', accepted: false, chip: '猫 instead of 狗', icon: 'close' });
    expect(r.chars.map((c) => `${c.char}:${c.mark}`).join(' ')).toBe('猫:wrong');
    expect(spokenResult('我很好', '你好', 'wrong').chars.map((c) => c.mark)).toEqual(['wrong', 'extra', 'right']);
    // Lined up, not positional: no offset makes everything red (长 is right in 他长的很高 for 长得).
    expect(spokenResult('他长的很高', '长得', 'wrong').chars.map((c) => `${c.char}:${c.mark}`))
      .toEqual(['他:extra', '长:right', '的:tone', '很:extra', '高:extra']);
    // A character he left out is shown in its slot (muted, dashed).
    expect(spokenResult('我明天去北', '我明天去北京', 'wrong').chars.map((c) => `${c.char}:${c.mark}`).slice(-1)).toEqual(['京:missing']);
    expect(spokenResult('我明天去北', '我明天去北京', 'wrong').chip).toBe('Missing 京 at the end');
  });

  it('contains: the answer’s characters right, the words around it plain', () => {
    expect(marks('他长得很好。', '长得', 'zhǎngde')).toBe('他:plain 长:right 得:right 很:plain 好:plain 。:plain');
    const r = spokenResult('他长得很好。', '长得', 'contains');
    expect(r).toMatchObject({ state: 'contains', accepted: true, icon: 'approx', coach: true });
  });

  it('reads the whole row as one sentence', () => {
    const close = spokenResult('朗', '狼', 'close');
    expect(spokenResultLabel(close, '狼', 'lǎng')).toBe('You said 朗 (lǎng). Close. Tone off on 狼. Tone off: 朗.');
    expect(spokenResultLabel(spokenResult('我明天去北', '我明天去北京', 'wrong'), '我明天去北京'))
      .toBe('You said 我明天去北. Didn’t match. Missing 京 at the end. Missing: 京.');
    expect(spokenResultLabel(spokenResult('油', '由', 'sound'), ' 由 ', 'yóu'))
      .toBe('You said 油 (yóu). Sounded right — written differently (油); the card writes 由.');
    expect(spokenResultLabel(spokenResult('曾经', '曾经', 'exact'), '曾经')).toBe('You said 曾经. Match.');
    expect(spokenResultLabel(spokenResult('他长得很好', '长得', 'contains'), '长得')).toBe('You said 他长得很好. Contains the answer, 长得.');
    expect(spokenResultLabel(spokenResult('', '狗', 'wrong'), '狗')).toBe('You said …. Didn’t match.');
  });
});
