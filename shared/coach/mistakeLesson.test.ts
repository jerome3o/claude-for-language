import { describe, expect, it } from 'vitest';
import {
  coachMistakeLessonOffered,
  mistakeLessonCardLine,
  mistakeLessonExerciseCount,
  parseMistakeLessonContent,
  sentenceCore,
} from './mistakeLesson';

const check = (originalInput: string, hanzi: string, isCorrect = false) => ({ originalInput, isCorrect, corrected: { hanzi } });

describe('coach mistake lessons', () => {
  it('is offered only when the correction differs from what was written', () => {
    expect(coachMistakeLessonOffered(check('我昨天去了商店买东西了', '我昨天去商店买东西了'))).toBe(true);
    expect(coachMistakeLessonOffered(check('我去商店', '我去商店', false))).toBe(false);
    expect(coachMistakeLessonOffered(check('我去商店', '我去了商店', true))).toBe(false);
    // Punctuation and spaces don't count as a mistake.
    expect(coachMistakeLessonOffered(check('我 去商店', '我去商店。'))).toBe(false);
    expect(coachMistakeLessonOffered(check('你好!', '你好！'))).toBe(false);
    // English asked "how do I say": no Chinese of his to fix.
    expect(coachMistakeLessonOffered(check("I'm late", '我迟到了'))).toBe(false);
    expect(coachMistakeLessonOffered(null)).toBe(false);
    expect(coachMistakeLessonOffered(check('', '我'))).toBe(false);
  });

  it('strips spaces, punctuation and symbols', () => {
    expect(sentenceCore(' 我，去了。 “商店”！ ')).toBe('我去了商店');
  });

  it('labels and parses the stored lesson', () => {
    expect(mistakeLessonCardLine(1)).toBe('🎯 Mini lesson · 1 exercise');
    expect(mistakeLessonCardLine(10)).toBe('🎯 Mini lesson · 10 exercises');
    const spec = { title: 'T', sections: [{ exercises: [{ type: 'note' }, { type: 'choice' }] }, { exercises: [{ type: 'translate' }] }] };
    expect(mistakeLessonExerciseCount(spec as never)).toBe(3);
    expect(parseMistakeLessonContent(JSON.stringify({ spec }))).toEqual({ spec, lesson_id: null, saved_at: null, completed: false });
    expect(parseMistakeLessonContent(JSON.stringify({ spec, lesson_id: 'l1', completed: true }))?.lesson_id).toBe('l1');
    expect(parseMistakeLessonContent('')).toBeNull();
    expect(parseMistakeLessonContent('{"spec":{}}')).toBeNull();
    expect(parseMistakeLessonContent('not json')).toBeNull();
  });
});
