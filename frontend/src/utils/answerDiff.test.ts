import { describe, it, expect } from 'vitest';
import { typedAnswerDiff } from './answerDiff';

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
