import { describe, expect, it } from 'vitest';
import {
  answerDiff, answerDiffLabel, answerDiffLine, answerDiffSummary, firstSentence,
  ANSWER_DIFF_FAR, ANSWER_DIFF_ORDER, ANSWER_DIFF_RIGHT, ANSWER_DIFF_WORDED,
} from './answer-diff';

const shown = (said: string, expected: string) =>
  answerDiff(said, expected).parts.map((p) => (p.kind === 'ok' || p.kind === 'plain' ? p.text : `[${p.kind}:${p.text}]`)).join('');
const summary = (said: string, expected: string) => answerDiffSummary(answerDiff(said, expected));

describe('answerDiff', () => {
  it('lines his answer up with the expected one, character by character', () => {
    expect(shown('我去成读', '我去成都')).toBe('我去成[tone:读]');
    expect(shown('我明天去北京了', '我明天去北京。')).toBe('我明天去北京[extra:了]。');
    // What he added goes before the answer's own end punctuation (never "开始？营业").
    expect(shown('银行几点开始营业', '银行几点开门？')).toBe('银行几点开[wrong:始][extra:营业]？');
    expect(shown('我明天去北', '我明天去北京。')).toBe('我明天去北[missing:京]。');
    expect(shown('他的书', '我的书呢')).toBe('[wrong:他]的书[missing:呢]');
  });

  it('reads digits as hanzi (3 = 三) and keeps punctuation out of the score', () => {
    expect(answerDiff('我有3本书', '我有三本书').right).toBe(true);
    expect(answerDiff('我有三本书', '我有3本书').right).toBe(true);
    expect(answerDiff('我明天去北京！', '我明天去北京。').right).toBe(true);
  });

  it('counts a homophone as right', () => {
    const d = answerDiff('由', '油');
    expect(d.right).toBe(true);
    expect(d.sound).toBe(1);
  });

  it('spots a reordering of the same characters', () => {
    expect(answerDiff('明天我去北京', '我明天去北京').reordered).toBe(true);
    expect(answerDiff('我明天去北京', '我明天去北京').reordered).toBe(false);
  });

  it('says when nothing was said', () => {
    expect(answerDiff('', '你好').empty).toBe(true);
    expect(answerDiff('', '你好').right).toBe(false);
  });
});

describe('answerDiffSummary — one short sentence', () => {
  it.each([
    ['我明天去北京', '我明天去北京。', ANSWER_DIFF_RIGHT],
    ['由', '油', 'Sounded right — written 由'],
    ['我去成读', '我去成都', 'Tone off on 都'],
    ['朗', '狼', 'Tone off on 狼'],
    ['我明天去北京了', '我明天去北京。', 'Extra 了 at the end'],
    ['我很喜欢你', '我喜欢你', 'Extra 很'],
    ['我明天去北', '我明天去北京。', 'Missing 京 at the end'],
    ['我越学中文，越觉得英语很繁琐', '我越学中文，越觉得英文很繁琐。', '语 instead of 文'],
    ['明天我去北京', '我明天去北京', ANSWER_DIFF_ORDER],
    ['他的书', '我的书呢', '1 wrong character, 1 missing'],
    ['你好吗', '我很好', '1 wrong character, 1 missing, 1 extra'],
    ['我早上喝咖啡，因为工作不困。', '我早上喝咖啡是为了上班不困。', '3 wrong characters, 1 missing'],
    ['他们昨天在家看电影', '我明天去北京', ANSWER_DIFF_FAR],
  ])('%s for %s → %s', (said, expected, line) => {
    expect(summary(said, expected)).toBe(line);
  });

  it('names two tone slips, counts more', () => {
    expect(summary('妈骂', '马麻')).toBe('Tones off on 马 and 麻');
    expect(summary('妈骂妈', '马麻马')).toBe('3 tones off');
  });
});

describe('answerDiffLine', () => {
  it('an accepted answer in other words is "Right — worded differently"', () => {
    expect(answerDiffLine({ diff: answerDiff('我早上喝咖啡，因为工作不困。', '我早上喝咖啡是为了上班不困。'), accepted: true })).toBe(ANSWER_DIFF_WORDED);
    expect(answerDiffLine({ diff: answerDiff('由', '油'), accepted: true })).toBe('Sounded right — written 由');
  });

  it("uses Claude's first sentence only when the answer is too different for a count", () => {
    const far = answerDiff('他们昨天在家看电影', '我明天去北京');
    expect(answerDiffLine({ diff: far, headline: 'A different sentence. Use 去 for going.' })).toBe('A different sentence.');
    const near = answerDiff('我去成读', '我去成都');
    expect(answerDiffLine({ diff: near, headline: 'A different sentence.' })).toBe('Tone off on 都');
  });
});

describe('firstSentence', () => {
  it('keeps the first sentence, never the explanation', () => {
    expect(firstSentence('Almost. The 即使…也 is right — make it a command.')).toBe('Almost.');
    expect(firstSentence('x'.repeat(120))).toHaveLength(90);
  });
});

describe('answerDiffLabel', () => {
  it('reads the whole diff as one sentence', () => {
    const d = answerDiff('他的书', '我的书呢');
    expect(answerDiffLabel(d, '1 wrong character, 1 missing')).toBe(
      'Your answer: 他的书. 1 wrong character, 1 missing. 他 — wrong, the answer has 我; missing 呢.',
    );
  });
});
