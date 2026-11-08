import { describe, expect, it } from 'vitest';
import {
  claudeVerdictMoment, lessonFeel, LESSON_FEEL_MOMENTS, markedChars, sayAgainFix, sayAgainTarget, SAY_AGAIN_SKIPPED,
} from './feedback';
import { SAMPLE_LESSONS } from './samples';
import { EXERCISE_TYPE_LIST } from './registry';
import type { LessonExercise } from './types';

describe('lessonFeel', () => {
  it('celebrates right answers with the success feel and a small burst', () => {
    expect(lessonFeel('checked_right')).toEqual({ feel: 'success', confetti: true });
    expect(lessonFeel('matched_answer')).toEqual({ feel: 'success', confetti: true });
    expect(lessonFeel('say_again_right')).toEqual({ feel: 'round_right', confetti: true });
  });
  it('celebrates once per answer: Claude agreeing after the device matched adds nothing', () => {
    expect(lessonFeel('claude_right', false)).toEqual({ feel: 'success', confetti: true });
    expect(lessonFeel('claude_right', true)).toEqual({ feel: null, confetti: false });
  });
  it('keeps wrong moments silent', () => {
    for (const m of ['checked_wrong', 'claude_not_right', 'say_again_miss'] as const) {
      expect(lessonFeel(m)).toEqual({ feel: null, confetti: false });
    }
    expect(LESSON_FEEL_MOMENTS).toHaveLength(7);
  });
  it('maps Claude verdicts', () => {
    expect(claudeVerdictMoment('correct')).toBe('claude_right');
    expect(claudeVerdictMoment('acceptable')).toBe('claude_right');
    expect(claudeVerdictMoment('almost')).toBe('claude_not_right');
    expect(claudeVerdictMoment('wrong')).toBe('claude_not_right');
    expect(claudeVerdictMoment(null)).toBeNull();
  });
});

describe('sayAgainTarget', () => {
  const all: LessonExercise[] = SAMPLE_LESSONS.flatMap(l => l.spec.sections.flatMap(s => s.exercises));

  it('covers every type: a target, or a reason why not', () => {
    for (const info of EXERCISE_TYPE_LIST) {
      const samples = all.filter(e => e.type === info.type);
      expect(samples.length, info.type).toBeGreaterThan(0);
      const has = samples.some(e => sayAgainTarget(e) !== null);
      expect(has || !!SAY_AGAIN_SKIPPED[info.type], info.type).toBe(true);
      if (SAY_AGAIN_SKIPPED[info.type]) expect(samples.every(e => sayAgainTarget(e) === null), info.type).toBe(true);
    }
  });

  it('says the answer, or an open-ended exercise\'s example', () => {
    expect(sayAgainTarget({ type: 'scramble', english: 'x', tiles: ['我', '很好'], correct_order: ['我', '很好'] })).toEqual({ hanzi: '我很好', kind: 'answer' });
    expect(sayAgainTarget({ type: 'translate', english: 'x', reference_hanzi: '你好。', reference_pinyin: 'nǐ hǎo' })).toEqual({ hanzi: '你好。', pinyin: 'nǐ hǎo', kind: 'answer' });
    expect(sayAgainTarget({ type: 'speak', prompt: 'x', example: { hanzi: '我要咖啡' } })).toEqual({ hanzi: '我要咖啡', kind: 'example' });
    expect(sayAgainTarget({ type: 'speak', prompt: 'x' })).toBeNull();
    expect(sayAgainTarget({ type: 'choice', question: 'q', options: [{ hanzi: 'yes' }, { hanzi: '是' }], correct: 0 })).toBeNull();
  });
});

describe('markedChars', () => {
  it('marks the sentence as written, punctuation kept and never marked', () => {
    const model = markedChars('请把书放桌子上', '请把书放在桌子上。', 'model');
    expect(model.map(m => m.ch).join('')).toBe('请把书放在桌子上。');
    expect(model.filter(m => !m.hit).map(m => m.ch)).toEqual(['在']);
    const answer = markedChars('我很好，你呢？', '我也很好。', 'answer');
    expect(answer.map(m => m.ch).join('')).toBe('我很好，你呢？');
    expect(answer.filter(m => !m.hit).map(m => m.ch)).toEqual(['你', '呢']);
  });
});

describe('sayAgainFix', () => {
  it('offers Claude\'s fix only when it differs from what was said and what is already offered', () => {
    expect(sayAgainFix('你怎么换工作了？', '你怎么变工作了？', '你怎么换工作了')).toBeNull();
    expect(sayAgainFix('你怎么换工作了？', '你怎么变工作了？', null)).toBe('你怎么换工作了？');
    expect(sayAgainFix('你怎么换工作了？', '你怎么换工作了', null)).toBeNull();
    expect(sayAgainFix('', 'a', null)).toBeNull();
    expect(sayAgainFix('ok', 'a', null)).toBeNull();
  });
});
