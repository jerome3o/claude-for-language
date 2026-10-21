import { describe, expect, it } from 'vitest';
import { pickStudyBudget, pickStudyBudgetUpdate } from './budget';
import { budgetFinishHint, budgetSetByLabel, budgetSummary, firstName, shortDay, studyBudgetInfo } from './tutor-budget';

describe('pickStudyBudgetUpdate', () => {
  it('keeps numbers, null = reset, missing = untouched', () => {
    expect(pickStudyBudgetUpdate({ new_cards_per_day: 5, secondary_cards_per_day: null })).toEqual({ update: { new_cards_per_day: 5, secondary_cards_per_day: null }, problems: [] });
    expect(pickStudyBudgetUpdate({})).toEqual({ update: {}, problems: [] });
    expect(pickStudyBudgetUpdate({ new_cards_per_day: 201 }).problems).toHaveLength(1);
    expect(pickStudyBudgetUpdate({ secondary_cards_per_day: '-1' }).problems).toHaveLength(1);
  });
  it('the review-load cap: 10–1000, null = off', () => {
    expect(pickStudyBudgetUpdate({ pause_new_when_reviews_over: 100 })).toEqual({ update: { pause_new_when_reviews_over: 100 }, problems: [] });
    expect(pickStudyBudgetUpdate({ pause_new_when_reviews_over: null })).toEqual({ update: { pause_new_when_reviews_over: null }, problems: [] });
    expect(pickStudyBudgetUpdate({ pause_new_when_reviews_over: '250' }).update).toEqual({ pause_new_when_reviews_over: 250 });
    expect(pickStudyBudgetUpdate({ pause_new_when_reviews_over: 10 }).problems).toEqual([]);
    expect(pickStudyBudgetUpdate({ pause_new_when_reviews_over: 1000 }).problems).toEqual([]);
    for (const bad of [9, 1001, 0, -5, 50.5, 'lots', '', true]) {
      expect(pickStudyBudgetUpdate({ pause_new_when_reviews_over: bad }).problems).toHaveLength(1);
    }
    // pickStudyBudget (the numbers only) ignores it.
    expect(pickStudyBudget({ pause_new_when_reviews_over: 100 })).toEqual({ budget: {}, problems: [] });
  });
  it('pickStudyBudget drops resets', () => {
    expect(pickStudyBudget({ new_cards_per_day: null, secondary_cards_per_day: 4 })).toEqual({ budget: { secondary_cards_per_day: 4 }, problems: [] });
  });
});

describe('studyBudgetInfo', () => {
  it('defaults when nothing is set', () => {
    expect(studyBudgetInfo(null, 'u')).toEqual({ new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true, set_by_id: null, set_by_name: null, set_by_tutor: false, set_at: null, pause_new_when_reviews_over: null });
  });
  it('knows who set it', () => {
    const row = { new_cards_per_day: 5, secondary_cards_per_day: null, study_budget_set_by: 't', study_budget_set_at: '2026-10-03T08:00:00Z', study_budget_set_by_name: 'Minghui Wang' };
    expect(studyBudgetInfo(row, 'u')).toMatchObject({ new_cards_per_day: 5, secondary_cards_per_day: 6, is_default: false, set_by_tutor: true, set_by_name: 'Minghui Wang' });
    expect(studyBudgetInfo(row, 't').set_by_tutor).toBe(false);
  });
  it('carries the review-load cap', () => {
    expect(studyBudgetInfo({ pause_new_when_reviews_over: 100 }, 'u')).toMatchObject({ is_default: true, pause_new_when_reviews_over: 100 });
  });
});

describe('copy', () => {
  it('summary', () => {
    expect(budgetSummary({ new_cards_per_day: 3, secondary_cards_per_day: 6 })).toBe('3 new words + 6 extra a day');
    expect(budgetSummary({ new_cards_per_day: 1, secondary_cards_per_day: 0 })).toBe('1 new word + 0 extra a day');
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
