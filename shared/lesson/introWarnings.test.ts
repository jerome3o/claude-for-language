import { describe, it, expect } from 'vitest';
import { conversationIntroWarnings } from './introWarnings';
import { SAMPLE_LESSONS } from './samples';
import type { CustomLessonSpec } from './types';

const convo = {
  type: 'conversation' as const,
  situation: 'Hotel',
  speakers: [{ name: '前台', voice: 'female' as const }, { name: '客人', voice: 'male' as const }],
  lines: [
    { speaker: 0, hanzi: '您好！请问有预订吗？' },
    { speaker: 1, hanzi: '有，我住三个晚上。' },
  ],
  questions: [{ question: 'How many nights?', answer: 'Three' }],
};

function lesson(intro: string[], after: string[] = []): CustomLessonSpec {
  return {
    title: 't',
    sections: [
      { exercises: [{ type: 'note', body: 'Scene', sentences: intro.map((hanzi) => ({ hanzi })) }] },
      { exercises: [convo] },
      ...(after.length ? [{ exercises: [{ type: 'note' as const, sentences: after.map((hanzi) => ({ hanzi })) }] }] : []),
    ],
  };
}

describe('spoiler intros', () => {
  it('warns when the intro quotes the dialogue', () => {
    const w = conversationIntroWarnings(lesson(['请问有预订吗？', '我住三个晚上。']));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('请问有预订吗');
    expect(w[0]).toContain('我住三个晚上');
  });
  it('is fine with proper nouns, hard nouns and phrases AFTER the conversation', () => {
    expect(conversationIntroWarnings(lesson(['护照', '王府井'], ['请问有预订吗？']))).toEqual([]);
  });
  it('the shipped conversation sample is spoiler-free', () => {
    for (const s of SAMPLE_LESSONS) expect(conversationIntroWarnings(s.spec)).toEqual([]);
  });
});
