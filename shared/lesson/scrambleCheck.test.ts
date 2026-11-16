import { describe, it, expect } from 'vitest';
import {
  scrambleCheckInput, scrambleLocalVerdict, scrambleOrderText, scrambleOutcome, scrambleSentence, scrambleSpokenSentence,
  SCRAMBLE_ALSO_LABEL, SCRAMBLE_ALSO_RIGHT_BANNER, SCRAMBLE_CHECKING_BANNER, SCRAMBLE_EXPECTED_LABEL, SCRAMBLE_NOT_QUITE_BANNER, SCRAMBLE_RIGHT_ORDER_LABEL,
} from './scrambleCheck';
import { answerCheckApplies, answerCheckCacheText, exactAnswerCheck, SCRAMBLE_CHECK_VERSION, type AnswerCheck } from './answerCheck';

const cake = {
  english: 'As soon as the child saw the cake, he cheered up.',
  tiles: ['高兴起来了', '孩子', '就', '蛋糕', '一看见'],
  correct_order: ['孩子', '一看见', '蛋糕', '就', '高兴起来了'],
};
const jerome = ['一看见', '蛋糕', '孩子', '就', '高兴起来了'];
const check = (verdict: AnswerCheck['verdict'], headline = 'h'): AnswerCheck => ({ verdict, headline, corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it' });

describe('scrambleLocalVerdict', () => {
  it('the correct order and an accepted alternative are right on the device; spaces never matter', () => {
    expect(scrambleLocalVerdict(cake.correct_order, cake.tiles, cake.correct_order)).toBe('right');
    expect(scrambleLocalVerdict(jerome, cake.tiles, cake.correct_order, [jerome])).toBe('right');
    expect(scrambleLocalVerdict(['孩子 ', '一看见', '蛋糕', '就', '高兴起来了'], cake.tiles, cake.correct_order)).toBe('right');
  });
  it('every tile in another order → unexpected (Claude); not every tile placed → incomplete', () => {
    expect(scrambleLocalVerdict(jerome, cake.tiles, cake.correct_order)).toBe('unexpected');
    expect(scrambleLocalVerdict(jerome, cake.tiles, cake.correct_order, null)).toBe('unexpected');
    expect(scrambleLocalVerdict(jerome.slice(1), cake.tiles, cake.correct_order)).toBe('incomplete');
  });
});

describe('scrambleCheckInput', () => {
  it('the English, the two orders as spaced tiles, typed, the focus', () => {
    expect(scrambleCheckInput(cake, jerome, ' 一…就 ')).toEqual({
      prompt_en: cake.english,
      model_answer: '孩子 一看见 蛋糕 就 高兴起来了',
      answer: '一看见 蛋糕 孩子 就 高兴起来了',
      exercise_type: 'scramble',
      input: 'typed',
      focus: '一…就',
    });
    expect(scrambleCheckInput(cake, jerome)!.focus).toBeUndefined();
  });
  it('nothing to check without English or Chinese', () => {
    expect(scrambleCheckInput({ ...cake, english: ' ' }, jerome)).toBeNull();
    expect(scrambleCheckInput({ english: 'a b', correct_order: ['a', 'b'] }, ['b', 'a'])).toBeNull();
  });
  it('a tile\'s own spaces fold; the joined sentence drops them', () => {
    expect(scrambleOrderText([' 我 们 ', '好']) ).toBe('我们 好');
    expect(scrambleSentence(['我 们', ' 好'])).toBe('我们好');
  });
  it('applies, caches by the orders only (focus / spaces aside), and the expected order itself is checked locally', () => {
    const input = scrambleCheckInput(cake, jerome, '一…就')!;
    expect(answerCheckApplies('scramble', input.answer)).toBe(true);
    const text = answerCheckCacheText(input);
    expect(text).toBe(`o${SCRAMBLE_CHECK_VERSION}|scramble|as soon as the child saw the cake, he cheered up.|孩子一看见蛋糕就高兴起来了|一看见蛋糕孩子就高兴起来了`);
    expect(answerCheckCacheText({ ...input, focus: undefined, answer: '一看见蛋糕 孩子就 高兴起来了' })).toBe(text);
    expect(exactAnswerCheck(input)).toBeNull();
    expect(exactAnswerCheck({ ...input, answer: '孩子一看见 蛋糕就高兴起来了' })!.verdict).toBe('correct');
  });
});

describe('scrambleOutcome', () => {
  it('right on the device: ✓ Correct, felt at once; an accepted alternative labels the expected order "Also:"', () => {
    const o = scrambleOutcome('right', null);
    expect(o).toMatchObject({ kind: 'right', banner: '✓ Correct', tone: 'good', correct: true, expectedLabel: null, checking: false, moment: 'checked_right' });
    expect(scrambleOutcome('right', null, false).expectedLabel).toBe(SCRAMBLE_ALSO_LABEL);
  });
  it('while Claude checks: a neutral "Checking…" banner in place, the expected order shown, not scored right yet', () => {
    const o = scrambleOutcome('unexpected', { status: 'checking' });
    expect(o).toMatchObject({ kind: 'checking', banner: SCRAMBLE_CHECKING_BANNER, tone: 'neutral', correct: false, expectedLabel: SCRAMBLE_EXPECTED_LABEL, checking: true, moment: null, note: null });
  });
  it('correct / acceptable → ✓ Also right, scored right, "Also:", Claude\'s line, felt', () => {
    for (const v of ['correct', 'acceptable'] as const) {
      const o = scrambleOutcome('unexpected', { status: 'done', check: check(v, 'With 一…就 the subject can come later.') });
      expect(o).toMatchObject({ kind: 'also_right', banner: SCRAMBLE_ALSO_RIGHT_BANNER, tone: 'good', correct: true, expectedLabel: SCRAMBLE_ALSO_LABEL, note: 'With 一…就 the subject can come later.', moment: 'claude_right' });
    }
  });
  it('almost / wrong → ✗ Not quite with Claude\'s reason', () => {
    for (const v of ['almost', 'wrong'] as const) {
      const o = scrambleOutcome('unexpected', { status: 'done', check: check(v, '就 must come before the verb.') });
      expect(o).toMatchObject({ kind: 'not_quite', banner: SCRAMBLE_NOT_QUITE_BANNER, tone: 'bad', correct: false, expectedLabel: SCRAMBLE_RIGHT_ORDER_LABEL, note: '就 must come before the verb.', moment: null });
    }
  });
  it('offline / failed / no check → today\'s strict ✗ Not quite, no reason', () => {
    for (const c of [{ status: 'unavailable' } as const, null]) {
      expect(scrambleOutcome('unexpected', c)).toMatchObject({ kind: 'not_quite', correct: false, note: null, checking: false });
    }
  });
  it('plays his own order when right, the expected one when not, nothing while checking', () => {
    expect(scrambleSpokenSentence({ kind: 'also_right' }, jerome, cake.correct_order)).toBe('一看见蛋糕孩子就高兴起来了');
    expect(scrambleSpokenSentence({ kind: 'not_quite' }, jerome, cake.correct_order)).toBe('孩子一看见蛋糕就高兴起来了');
    expect(scrambleSpokenSentence({ kind: 'checking' }, jerome, cake.correct_order)).toBeNull();
  });
});
