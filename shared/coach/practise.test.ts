import { describe, expect, it } from 'vitest';
import { practiseBlockNote, practiseMicEnabled, practiseOutcome, practiseSentence } from './practise';

describe('practiseSentence', () => {
  it('a take of the sentence matches (trailing 。 tidied, punctuation ignored)', () => {
    const p = practiseSentence('他在沙发上占了很多地方', '他在沙发上占了很多地方。');
    expect(p.result.state).toBe('match');
    expect(p.result.accepted).toBe(true);
    expect(practiseOutcome(p, null)).toBe('match');
  });

  it('the same sentence said with a homophone counts by sound', () => {
    const p = practiseSentence('他在沙发上站了很多地方。', '他在沙发上占了很多地方。');
    expect(p.verdict).toBe('sound');
    expect(p.result.chars.filter((c) => c.mark === 'differs').map((c) => c.char).join('')).toBe('站');
  });

  it('a different word does not match and marks the characters that differ', () => {
    const p = practiseSentence('他在沙发上放了很多东西', '他在沙发上占了很多地方。');
    expect(p.result.state).toBe('wrong');
    expect(p.result.chars.filter((c) => c.mark === 'wrong').map((c) => c.char).join('')).toBe('放东西');
  });

  it('the recogniser ending a word with 。 is tidied away', () => {
    expect(practiseSentence('你好。', '你好').said).toBe('你好');
  });

  it('no result → failed / empty', () => {
    expect(practiseOutcome(null, 'empty')).toBe('empty');
    expect(practiseOutcome(null, 'failed')).toBe('failed');
    expect(practiseOutcome(null, 'offline')).toBe('failed');
  });

  it('says why 🎤 cannot record, and keeps it tappable for a retry', () => {
    expect(practiseBlockNote(null)).toBeNull();
    expect(practiseBlockNote('offline')).toBe('Practising needs a connection.');
    expect(practiseMicEnabled('offline')).toBe(false);
    expect(practiseMicEnabled('denied')).toBe(true);
    expect(practiseMicEnabled(null)).toBe(true);
  });
});
