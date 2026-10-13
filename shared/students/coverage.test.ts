import { describe, it, expect } from 'vitest';
import { coverageHeadline, coveragePrompt, EMPTY_COVERAGE } from './coverage';

describe('coverage', () => {
  it('headline: words met (known well) · characters · lessons; empty parts left out', () => {
    expect(coverageHeadline({ words: { known: 140, learning: 172 }, characters: { known: 300, learning: 120 }, lesson_count: 9 })).toBe(
      '312 words met (140 known well) · 420 characters · 9 lessons',
    );
    expect(coverageHeadline({ words: { known: 0, learning: 1 }, characters: { known: 0, learning: 1 }, lesson_count: 1 })).toBe('1 word met · 1 character · 1 lesson');
    expect(coverageHeadline(EMPTY_COVERAGE)).toBe('');
  });

  it('prompt block lists the lessons and recent words', () => {
    const text = coveragePrompt(
      {
        ...EMPTY_COVERAGE,
        lesson_count: 2,
        words: { known: 3, learning: 2 },
        lessons: [
          { date: '2026-10-05', title: null, topics: ['Health & body vocabulary'], source: 'call', new_words: 20, corrections: 9 },
          { date: '2026-10-01', title: '把 sentences', topics: [], source: 'notes', new_words: 0, corrections: 0 },
        ],
        recent_words: [{ hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' }],
      },
      'Jerome',
    );
    expect(text).toContain('Jerome: 5 words met (3 known well) · 2 lessons.');
    expect(text).toContain('- 2026-10-05 (video lesson): Health & body vocabulary');
    expect(text).toContain('- 2026-10-01 (lesson notes): 把 sentences');
    expect(text).toContain('Recent words: 头疼 (headache)');
    expect(coveragePrompt(EMPTY_COVERAGE)).toContain('The student: nothing on record yet.');
  });
});
