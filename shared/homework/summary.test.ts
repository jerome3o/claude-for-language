import { describe, expect, it } from 'vitest';
import { isLongTermDeck, summarizeOneOffHomework, type OneOffSummaryInput } from './summary';

const TODAY = '2026-10-05';

function a(over: Partial<OneOffSummaryInput> = {}): OneOffSummaryInput {
  return { mode: 'one_off', status: 'active', due_date: '2026-10-07', completed_at: null, ...over };
}

describe('summarizeOneOffHomework — the top-line homework figure', () => {
  it('nothing one-off ever set → "No homework set", no percent (never 0%)', () => {
    expect(summarizeOneOffHomework([], TODAY)).toMatchObject({ state: 'none', percent: null, label: 'No homework set', total: 0 });
    // Long-term (fsrs-only) decks are not homework progress.
    expect(summarizeOneOffHomework([a({ mode: 'fsrs', due_date: null })], TODAY)).toMatchObject({ state: 'none', percent: null });
  });

  it('every one-off item done this week → "✓ All done this week"', () => {
    const s = summarizeOneOffHomework(
      [a({ status: 'done', completed_at: '2026-10-03T09:00:00Z' }), a({ mode: 'both', status: 'done', completed_at: '2026-10-04T20:00:00Z' }), a({ mode: 'fsrs' })],
      TODAY
    );
    expect(s).toMatchObject({ state: 'all_done', percent: 100, total: 2, done: 2, open: 0, label: '✓ All done this week', pill: 'Homework ✓ all done this week' });
  });

  it('nothing open and nothing done lately → "✓ All done" (no "this week")', () => {
    const s = summarizeOneOffHomework([a({ status: 'done', completed_at: '2026-09-01T09:00:00Z', due_date: '2026-09-01' })], TODAY);
    expect(s).toMatchObject({ state: 'all_done', percent: 100, total: 0, label: '✓ All done' });
  });

  it('"2 of 3 done": open items + this week\'s done ones; older done ones drop out of the count', () => {
    const s = summarizeOneOffHomework(
      [
        a({ status: 'done', completed_at: '2026-10-05T08:00:00Z' }),
        a({ mode: 'both', status: 'done', completed_at: '2026-09-29T08:00:00Z' }),
        a({ status: 'done', completed_at: '2026-09-28T08:00:00Z' }), // 8 days ago: not this week
        a({ due_date: '2026-10-08' }),
      ],
      TODAY
    );
    expect(s).toMatchObject({ state: 'open', total: 3, done: 2, open: 1, overdue: 0, percent: 67, label: '2 of 3 done', pill: 'Homework 2 of 3 done' });
  });

  it('the one-off pass of a "both" assignment counts; cancelled and fsrs-only never do', () => {
    const s = summarizeOneOffHomework([a({ mode: 'both' }), a({ status: 'cancelled' }), a({ mode: 'fsrs', due_date: null })], TODAY);
    expect(s).toMatchObject({ total: 1, open: 1, done: 0, label: '0 of 1 done' });
  });

  it('overdue and due today', () => {
    const s = summarizeOneOffHomework([a({ due_date: '2026-10-04' }), a({ due_date: TODAY }), a({ due_date: null }), a({ status: 'done', completed_at: '2026-10-05T07:00:00Z' })], TODAY);
    expect(s).toMatchObject({ state: 'overdue', overdue: 1, due_today: 1, open: 3, done: 1, total: 4, label: '1 overdue · 1 of 4 done', pill: 'Homework 1 overdue' });
  });

  it('a done item without a completion time counts this week by its due date', () => {
    expect(summarizeOneOffHomework([a({ status: 'done', completed_at: null, due_date: '2026-10-02' })], TODAY)).toMatchObject({ done: 1, label: '✓ All done this week' });
  });
});

describe('isLongTermDeck', () => {
  it('is long-term unless every assignment on the copy is one-off only', () => {
    expect(isLongTermDeck([])).toBe(true);
    expect(isLongTermDeck(['fsrs'])).toBe(true);
    expect(isLongTermDeck(['both'])).toBe(true);
    expect(isLongTermDeck(['one_off', 'fsrs'])).toBe(true);
    expect(isLongTermDeck(['one_off'])).toBe(false);
    expect(isLongTermDeck(['one_off', 'one_off'])).toBe(false);
  });
});
