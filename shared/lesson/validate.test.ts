import { describe, it, expect } from 'vitest';
import { validateLessonSpec } from './validate';
import { countScoreable, lessonTtsTexts, CustomLessonSpec } from './types';

const validSpec: CustomLessonSpec = {
  title: 'Ordering at a café',
  icon: '☕',
  sections: [
    {
      title: 'Warm up',
      exercises: [
        {
          type: 'note',
          body: 'Today we practice ordering drinks.',
          sentences: [{ hanzi: '我要一杯咖啡。', pinyin: 'wǒ yào yì bēi kā fēi.', english: 'I want a cup of coffee.' }],
        },
        {
          type: 'match',
          pairs: [
            { hanzi: '咖啡', english: 'coffee' },
            { hanzi: '茶', english: 'tea' },
            { hanzi: '牛奶', english: 'milk' },
          ],
        },
      ],
    },
    {
      exercises: [
        {
          type: 'scramble',
          english: 'I want a cup of coffee.',
          tiles: ['我', '要', '一杯', '咖啡'],
          correct_order: ['我', '要', '一杯', '咖啡'],
        },
        {
          type: 'choice',
          question: 'The waiter asks what you want. You say:',
          options: [
            { hanzi: '我要一杯茶。' },
            { hanzi: '我是茶。' },
          ],
          correct: 0,
          explanation: '要 expresses wanting; 是 would say you ARE tea.',
        },
        { type: 'translate', english: 'Two coffees, please.', reference_hanzi: '请给我两杯咖啡。', reference_pinyin: 'qǐng gěi wǒ liǎng bēi kā fēi.' },
        {
          type: 'describe_image',
          image_prompt: 'A cozy café counter with a barista handing over two coffees',
          reference_hanzi: '服务员给客人两杯咖啡。',
        },
        { type: 'speak', prompt: 'Order your own drink out loud.', example: { hanzi: '我要一杯热茶。' } },
      ],
    },
  ],
};

describe('validateLessonSpec', () => {
  it('accepts a full valid spec', () => {
    expect(validateLessonSpec(validSpec)).toEqual([]);
  });

  it('rejects non-objects and missing basics', () => {
    expect(validateLessonSpec(null).length).toBeGreaterThan(0);
    expect(validateLessonSpec({ title: '', sections: [] }).length).toBeGreaterThan(0);
    expect(validateLessonSpec({ title: 'x' })).toContain('lesson needs at least one section');
  });

  it('rejects scramble tiles that cannot form the answer', () => {
    const errors = validateLessonSpec({
      title: 'x',
      sections: [{
        exercises: [{
          type: 'scramble',
          english: 'hi',
          tiles: ['我', '好'],
          correct_order: ['我', '要'],
        }],
      }],
    });
    expect(errors.some(e => e.includes('same multiset'))).toBe(true);
  });

  it('rejects out-of-range choice answers and ambiguous match pairs', () => {
    const errors = validateLessonSpec({
      title: 'x',
      sections: [{
        exercises: [
          { type: 'choice', question: 'q', options: [{ hanzi: 'a' }, { hanzi: 'b' }], correct: 2 },
          { type: 'match', pairs: [{ hanzi: '茶', english: 'tea' }, { hanzi: '茶', english: 'green tea' }] },
        ],
      }],
    });
    expect(errors.some(e => e.includes('option index'))).toBe(true);
    expect(errors.some(e => e.includes('ambiguous'))).toBe(true);
  });

  it('rejects unknown exercise types with a helpful message', () => {
    const errors = validateLessonSpec({
      title: 'x',
      sections: [{ exercises: [{ type: 'karaoke' }] }],
    });
    expect(errors.some(e => e.includes('unknown exercise type "karaoke"'))).toBe(true);
  });
});

describe('spec helpers', () => {
  it('counts only scoreable exercises', () => {
    // note is not scoreable; match, scramble, choice, translate, describe_image, speak are
    expect(countScoreable(validSpec)).toBe(6);
  });

  it('collects every hanzi that needs TTS', () => {
    const texts = lessonTtsTexts(validSpec);
    expect(texts).toContain('我要一杯咖啡。');       // note sentence
    expect(texts).toContain('我要一杯咖啡');          // scramble joined
    expect(texts).toContain('咖啡');                  // match pair
    expect(texts).toContain('请给我两杯咖啡。');      // translate reference
    expect(texts).toContain('服务员给客人两杯咖啡。'); // describe_image reference
    expect(texts).toContain('我要一杯热茶。');        // speak example
  });
});
