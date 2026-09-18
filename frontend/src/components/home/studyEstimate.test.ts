import { describe, it, expect } from 'vitest';
import { estimateStudyMinutes, formatStudyEstimate, describeDue, breakdownRows, totalDue } from './studyEstimate';

describe('study time estimate', () => {
  it('assumes about 20 seconds per card and rounds up', () => {
    expect(estimateStudyMinutes(24)).toBe(8);
    expect(estimateStudyMinutes(25)).toBe(9);
    expect(estimateStudyMinutes(3)).toBe(1);
    expect(estimateStudyMinutes(1)).toBe(1);
    expect(estimateStudyMinutes(0)).toBe(0);
  });

  it('formats a friendly estimate', () => {
    expect(formatStudyEstimate(24)).toBe('about 8 min');
    expect(formatStudyEstimate(3)).toBe('about 1 min');
    expect(formatStudyEstimate(2)).toBe('under a minute');
    expect(formatStudyEstimate(0)).toBe('');
  });

  it('describes the due count for the button subtitle', () => {
    expect(describeDue(24)).toBe('24 cards due · about 8 min');
    expect(describeDue(1)).toBe('1 card due · under a minute');
    expect(describeDue(0)).toBe('Nothing due right now');
  });

  it('sums every queue, tolerating counts cached before secondaryNew existed', () => {
    expect(totalDue({ new: 3, secondaryNew: 67, learning: 14, review: 7 })).toBe(91);
    expect(totalDue({ new: 3, learning: 14, review: 7 })).toBe(24);
  });

  it('breaks the total down in session order with singular/plural labels', () => {
    const rows = breakdownRows({ new: 1, secondaryNew: 0, learning: 2, review: 1 });
    expect(rows.map(r => r.key)).toEqual(['new', 'secondaryNew', 'learning', 'review']);
    expect(rows[0].label).toBe('new word');
    expect(rows[2].label).toBe('cards still learning');
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(4);
  });
});
