import { describe, it, expect } from 'vitest';
import { allocateNewCards, daysToIntroduce, pickStudyBudget, sortDecksForQueue, DeckNewPool } from './budget';

function pool(deckId: string, priority: number, over: Partial<DeckNewPool> = {}): DeckNewPool {
  return {
    deckId, priority, createdAt: '2026-09-01',
    totalNew: 10, totalSecondaryNew: 10, capPrimary: 3, capSecondary: 6, studiedPrimary: 0, studiedSecondary: 0,
    ...over,
  };
}

describe('allocateNewCards', () => {
  it('fills the global budget from the top of the queue and stops', () => {
    const out = allocateNewCards([pool('core', 10), pool('legacy', 0), pool('phone', 5)], { new_cards_per_day: 3, secondary_cards_per_day: 6 });
    expect(out.get('core')).toEqual({ primary: 3, secondary: 6 });
    expect(out.get('phone')).toEqual({ primary: 0, secondary: 0 });
    expect(out.get('legacy')).toEqual({ primary: 0, secondary: 0 });
  });

  it('a deck cap holds it back and the rest flows to the next deck in the queue', () => {
    const out = allocateNewCards([pool('core', 10, { capPrimary: 1, capSecondary: 2 }), pool('phone', 5)], { new_cards_per_day: 3, secondary_cards_per_day: 6 });
    expect(out.get('core')).toEqual({ primary: 1, secondary: 2 });
    expect(out.get('phone')).toEqual({ primary: 2, secondary: 4 });
  });

  it('what was studied today, in any deck, comes off the global budget', () => {
    const out = allocateNewCards([pool('core', 10, { studiedPrimary: 2, studiedSecondary: 1 }), pool('phone', 5)], { new_cards_per_day: 3, secondary_cards_per_day: 6 });
    expect(out.get('core')).toEqual({ primary: 1, secondary: 5 });
    expect(out.get('phone')).toEqual({ primary: 0, secondary: 0 });
  });

  it('the bonus adds to the primary budget; spare primary budget admits secondary cards', () => {
    const out = allocateNewCards([pool('core', 10, { totalNew: 1 })], { new_cards_per_day: 3, secondary_cards_per_day: 2 }, 2);
    // 1 unseen word, then 2 secondary from their own budget, then 2 more from the spare primary (deck cap 3 - 1 = 2)
    expect(out.get('core')).toEqual({ primary: 1, secondary: 4 });
  });

  it('ties in priority go to the newer deck', () => {
    const out = allocateNewCards([pool('old', 0, { createdAt: '2026-01-01' }), pool('new', 0, { createdAt: '2026-09-23' })], { new_cards_per_day: 3, secondary_cards_per_day: 0 });
    expect(out.get('new')!.primary).toBe(3);
    expect(out.get('old')!.primary).toBe(0);
    expect(sortDecksForQueue([{ priority: 0, createdAt: 'a' }, { priority: 2, createdAt: 'b' }])[0].priority).toBe(2);
  });

  it('a zero budget introduces nothing', () => {
    const out = allocateNewCards([pool('core', 10)], { new_cards_per_day: 0, secondary_cards_per_day: 0 });
    expect(out.get('core')).toEqual({ primary: 0, secondary: 0 });
  });
});

describe('daysToIntroduce / pickStudyBudget', () => {
  it('rounds up and never divides by zero', () => {
    expect(daysToIntroduce(34, { new_cards_per_day: 6 })).toBe(6);
    expect(daysToIntroduce(0, { new_cards_per_day: 6 })).toBe(0);
    expect(daysToIntroduce(5, { new_cards_per_day: 0 })).toBe(5);
  });
  it('validates whole numbers in range', () => {
    expect(pickStudyBudget({ new_cards_per_day: '4', secondary_cards_per_day: 6 })).toEqual({ budget: { new_cards_per_day: 4, secondary_cards_per_day: 6 }, problems: [] });
    expect(pickStudyBudget({ new_cards_per_day: -1, secondary_cards_per_day: 2.5 }).problems).toHaveLength(2);
    expect(pickStudyBudget(undefined)).toEqual({ budget: {}, problems: [] });
  });
});
