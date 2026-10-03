import { describe, it, expect } from 'vitest';
import { admitsNewCards, deckInDailyReview, isLongTerm, longTermCaps, longTermSummary, prefForToggle, toLongTermPref } from './long-term';

describe('long-term review choice', () => {
  it('a deck is out of daily review only when both caps are 0', () => {
    expect(deckInDailyReview(0, 0)).toBe(false);
    expect(deckInDailyReview(0, 6)).toBe(true);
    expect(deckInDailyReview(3, 0)).toBe(true);
  });

  it('the switch follows the deck until the learner chooses; a started word is always in', () => {
    expect(isLongTerm(null, true)).toBe(true);
    expect(isLongTerm(null, false)).toBe(false);
    expect(isLongTerm(0, true)).toBe(false);
    expect(isLongTerm(1, false)).toBe(true);
    expect(isLongTerm(0, true, true)).toBe(true);
  });

  it('flipping back to the deck default stores null', () => {
    expect(prefForToggle(false, true)).toBe(0);
    expect(prefForToggle(true, true)).toBe(null);
    expect(prefForToggle(true, false)).toBe(1);
    expect(prefForToggle(false, false)).toBe(null);
  });

  it('admits NEW cards: opt-in always, opt-out only before the word is started', () => {
    expect(admitsNewCards(1, false, false)).toBe(true);
    expect(admitsNewCards(0, true, false)).toBe(false);
    expect(admitsNewCards(0, true, true)).toBe(true);
    expect(admitsNewCards(0, false, true)).toBe(false);
    expect(admitsNewCards(null, false, true)).toBe(false);
    expect(admitsNewCards(undefined, true, false)).toBe(true);
  });

  it('a 0 + 0 deck gives its opted-in words the new-deck caps', () => {
    expect(longTermCaps(0, 0)).toEqual({ capPrimary: 3, capSecondary: 6 });
    expect(longTermCaps(5, 0)).toEqual({ capPrimary: 5, capSecondary: 0 });
  });

  it('summarises a pass and normalises stored values', () => {
    expect(longTermSummary([{ pref: null, reviewed: false }, { pref: 0, reviewed: false }, { pref: 0, reviewed: true }], true)).toEqual({ added: 2, leftOut: 1 });
    expect(longTermSummary([{ pref: null, reviewed: false }, { pref: 1, reviewed: false }], false)).toEqual({ added: 1, leftOut: 1 });
    expect([1, true, '1', 0, false, '0', null, undefined, 2].map(toLongTermPref)).toEqual([1, 1, 1, 0, 0, 0, null, null, null]);
  });
});
