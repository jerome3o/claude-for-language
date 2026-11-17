import { describe, expect, it } from 'vitest';
import { answerDiff, answerDiffLine } from './answer-diff';
import { answerMore, answerWhy, deviceWhy } from './answer-why';

describe('answerWhy — one sentence why', () => {
  const said = '这是一个真实的故事。';
  const model = '这是真实的故事。';

  it('Claude’s headline, first sentence only (Jerome’s “true story”)', () => {
    const check = { headline: 'Correct — 一个 is optional here. Both are natural.', tips: [] };
    expect(answerWhy({ diff: answerDiff(said, model), check })).toBe('Correct — 一个 is optional here.');
  });

  it('a stock headline says nothing: the first useful tip instead, else none', () => {
    expect(answerWhy({ check: { headline: 'Nearly — compare with the corrected version.', tips: [{ text: '得 needs a complement after the verb; 好 alone isn’t enough.' }] } }))
      .toBe('得 needs a complement after the verb; 好 alone isn’t enough.');
    expect(answerWhy({ check: { headline: 'Exactly right — nice!', tips: [] } })).toBeNull();
  });

  it('never repeats the line above', () => {
    const diff = answerDiff('他们昨天在家看电影', '我明天去北京');
    const check = { headline: 'A different sentence. Use 去 for going.', tips: [] };
    const line = answerDiffLine({ diff, headline: check.headline });
    expect(line).toBe('A different sentence.');
    expect(answerWhy({ diff, check, line })).toBeNull();
  });

  it('the device’s own reason for a homophone; an exact match needs none', () => {
    expect(deviceWhy(answerDiff('由', '油'))).toBe('Same sounds — written differently: 由 vs 油');
    expect(answerWhy({ diff: answerDiff('我们都去', '我们都去') })).toBeNull();
  });

  it('caps the sentence', () => {
    const why = answerWhy({ check: { headline: 'x '.repeat(100) } })!;
    expect([...why].length).toBeLessThanOrEqual(110);
    expect(why.endsWith('…')).toBe(true);
  });
});

describe('answerMore — Explain more in place', () => {
  it('the tips, the fix and the alternative, never the why again', () => {
    const check = { headline: 'Use 她, not 他.', tips: [{ text: 'Use 她, not 他.' }, { text: 'The story is about a woman.' }], corrected: '她很高', alternative: '她个子很高' };
    expect(answerMore(check, 'Use 她, not 他.', '他很高')).toEqual({ tips: ['The story is about a woman.'], corrected: '她很高', alternative: '她个子很高' });
  });

  it('nothing on hand → null (the surface may ask Claude instead)', () => {
    expect(answerMore({ headline: 'Correct — 一个 is optional here.', tips: [] }, 'Correct — 一个 is optional here.')).toBeNull();
    expect(answerMore(null, null)).toBeNull();
  });
});
