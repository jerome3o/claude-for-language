import { describe, it, expect } from 'vitest';
import { spokenAnswerDiff, typedAnswerDiff } from './answerDiff';

const marks = (s: string, t: string) => typedAnswerDiff(s, t).typed.map(c => `${c.char || '?'}:${c.mark}`);

describe('typedAnswerDiff', () => {
  it('marks a wrong character as wrong and the rest correct', () => {
    expect(marks('打蒜', '打算')).toEqual(['打:correct', '蒜:wrong']);
    expect(typedAnswerDiff('打蒜', '打算').expected).toEqual([
      { char: '打', matched: true },
      { char: '算', matched: false },
    ]);
  });

  it('marks positions the answer did not reach as missing', () => {
    expect(marks('你好', '你好吗')).toEqual(['你:correct', '好:correct', '?:missing']);
    expect(typedAnswerDiff('你好', '你好吗').expected.map(e => e.matched)).toEqual([true, true, false]);
  });

  it('marks extra characters past the end as wrong', () => {
    expect(marks('谢谢你', '谢谢')).toEqual(['谢:correct', '谢:correct', '你:wrong']);
    expect(typedAnswerDiff('谢谢你', '谢谢').expected).toHaveLength(2);
  });

  it('compares by code point, not UTF-16 unit', () => {
    expect(marks('𠀀好', '𠀀好')).toEqual(['𠀀:correct', '好:correct']);
  });

  it('marks everything missing for an empty answer', () => {
    expect(marks('', '好')).toEqual(['?:missing']);
  });
});

describe('spokenAnswerDiff', () => {
  const spoken = (s: string, t: string) => spokenAnswerDiff(s, t).typed.map(c => `${c.char}:${c.mark}`);

  it('lines a spoken answer up with the expected one — no offset makes everything red', () => {
    // Positionally every character of 他长的很高 would be red against 长得; lined up, 长 is right.
    expect(spoken('他长的很高', '长得')).toEqual(['他:wrong', '长:correct', '的:wrong', '很:wrong', '高:wrong']);
    expect(spokenAnswerDiff('他长的很高', '长得').expected).toEqual([
      { char: '长', matched: true },
      { char: '得', matched: false },
    ]);
  });

  it('no missing cells; nothing in common is all wrong', () => {
    expect(spoken('猫', '狗')).toEqual(['猫:wrong']);
    expect(spokenAnswerDiff('', '好').typed).toEqual([]);
    expect(spokenAnswerDiff('', '好').expected).toEqual([{ char: '好', matched: false }]);
  });
});
