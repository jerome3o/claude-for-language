import { describe, it, expect } from 'vitest';
import { deckSizeLabel, exerciseMinutes, lessonSizeLabel, readerSizeLabel, revisionSizeLabel } from './size';

describe('homework size', () => {
  it('a lesson: every exercise, minutes by type', () => {
    expect(lessonSizeLabel(['note', 'choice', 'translate', 'conversation'])).toBe('4 exercises · ~4 min');
    expect(lessonSizeLabel(['choice'])).toBe('1 exercise · ~1 min');
    expect(lessonSizeLabel([])).toBe('');
  });
  it('unknown types count as 40 s; at least a minute', () => {
    expect(exerciseMinutes(['mystery'])).toBe(1);
    expect(exerciseMinutes(Array(9).fill('mystery'))).toBe(6);
    expect(exerciseMinutes([])).toBe(0);
  });
  it('a revision, a deck pass, a reader', () => {
    expect(revisionSizeLabel(5, ['note', 'choice', 'choice', 'translate', 'scramble', 'speak'])).toBe('5 questions · ~3 min');
    expect(revisionSizeLabel(1, ['choice'])).toBe('1 question · ~1 min');
    expect(deckSizeLabel(12)).toBe('12 words');
    expect(deckSizeLabel(1)).toBe('1 word');
    expect(deckSizeLabel(0)).toBe('');
    expect(readerSizeLabel(6)).toBe('6 pages');
  });
});
