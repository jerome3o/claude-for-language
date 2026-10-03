import { describe, expect, it } from 'vitest';
import { pickStudyBudget, pickStudyBudgetUpdate } from './budget';
import { budgetChangeMessage, budgetFinishHint, budgetSetByLabel, budgetSummary, firstName, shortDay, studyBudgetInfo } from './tutor-budget';

describe('pickStudyBudgetUpdate', () => {
  it('keeps numbers, null = reset, missing = untouched', () => {
    expect(pickStudyBudgetUpdate({ new_cards_per_day: 5, secondary_cards_per_day: null })).toEqual({ update: { new_cards_per_day: 5, secondary_cards_per_day: null }, problems: [] });
    expect(pickStudyBudgetUpdate({})).toEqual({ update: {}, problems: [] });
    expect(pickStudyBudgetUpdate({ new_cards_per_day: 201 }).problems).toHaveLength(1);
    expect(pickStudyBudgetUpdate({ secondary_cards_per_day: '-1' }).problems).toHaveLength(1);
  });
  it('pickStudyBudget drops resets', () => {
    expect(pickStudyBudget({ new_cards_per_day: null, secondary_cards_per_day: 4 })).toEqual({ budget: { secondary_cards_per_day: 4 }, problems: [] });
  });
});

describe('studyBudgetInfo', () => {
  it('defaults when nothing is set', () => {
    expect(studyBudgetInfo(null, 'u')).toEqual({ new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true, set_by_id: null, set_by_name: null, set_by_tutor: false, set_at: null });
  });
  it('knows who set it', () => {
    const row = { new_cards_per_day: 5, secondary_cards_per_day: null, study_budget_set_by: 't', study_budget_set_at: '2026-10-03T08:00:00Z', study_budget_set_by_name: 'Minghui Wang' };
    expect(studyBudgetInfo(row, 'u')).toMatchObject({ new_cards_per_day: 5, secondary_cards_per_day: 6, is_default: false, set_by_tutor: true, set_by_name: 'Minghui Wang' });
    expect(studyBudgetInfo(row, 't').set_by_tutor).toBe(false);
  });
});

describe('copy', () => {
  it('summary', () => {
    expect(budgetSummary({ new_cards_per_day: 3, secondary_cards_per_day: 6 })).toBe('3 new words + 6 extra a day');
    expect(budgetSummary({ new_cards_per_day: 1, secondary_cards_per_day: 0 })).toBe('1 new word + 0 extra a day');
  });
  it('chat message', () => {
    expect(budgetChangeMessage({ new_cards_per_day: 5, secondary_cards_per_day: 10 }, false)).toBe("I've set your new cards to 5 a day (+10 extra) 📚");
    expect(budgetChangeMessage({ new_cards_per_day: 3, secondary_cards_per_day: 6 }, true)).toBe("I've set your new cards back to the usual 3 a day (+6 extra) 📚");
    expect(budgetChangeMessage({ new_cards_per_day: 2, secondary_cards_per_day: 0 }, false)).toBe("I've set your new cards to 2 a day (no extra cards) 📚");
  });
  it('set by', () => {
    const info = { set_by_tutor: true, set_by_name: 'Minghui Wang', set_at: '2026-10-02T23:30:00Z' };
    expect(budgetSetByLabel(info, 0)).toBe('Set by Minghui · 2 Oct');
    expect(budgetSetByLabel(info, -60)).toBe('Set by Minghui · 3 Oct');
    expect(budgetSetByLabel({ ...info, set_by_tutor: false }, 0)).toBeNull();
    expect(budgetSetByLabel({ ...info, set_at: null, set_by_name: null }, 0)).toBe('Set by your tutor');
    expect(shortDay('nope', 0)).toBeNull();
    expect(firstName('  明慧 ')).toBe('明慧');
  });
  it('finish hint', () => {
    expect(budgetFinishHint(5, 'Lesson vocab – 2 Oct', 42)).toBe('At 5 a day, Lesson vocab – 2 Oct finishes in ~9 days');
    expect(budgetFinishHint(5, 'X', 3)).toBe('At 5 a day, X finishes in ~1 day');
    expect(budgetFinishHint(0, 'X', 3)).toBe('At 0 a day, no new words from X are introduced');
    expect(budgetFinishHint(5, 'X', 0)).toBeNull();
    expect(budgetFinishHint(5, null, 4)).toBeNull();
  });
});
