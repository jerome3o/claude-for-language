import { describe, it, expect } from 'vitest';
import { pickNextUpCard, sessionBumpPlan } from './bump-next';

const c = (id: string, card_type: string) => ({ id, card_type });
const h = c('h', 'hanzi_to_meaning');
const m = c('m', 'meaning_to_hanzi');
const a = c('a', 'audio_to_hanzi');

describe('sessionBumpPlan — where a bump made during a session goes', () => {
  it('an unstarted word: its one bumped card comes next', () => {
    expect(sessionBumpPlan([a], false, false, true)).toEqual({ next: a, mixed: [] });
    expect(sessionBumpPlan([h], false, false, false)).toEqual({ next: h, mixed: [] });
  });

  it('a whole-note bump of an unstarted word: the lead card next (by ear: listening), the rest into the mix', () => {
    expect(sessionBumpPlan([h, m, a], false, false, true)).toEqual({ next: a, mixed: [h, m] });
    expect(sessionBumpPlan([h, m, a], false, false, false)).toEqual({ next: h, mixed: [m, a] });
    expect(sessionBumpPlan([m, a], false, false, false)).toEqual({ next: m, mixed: [a] });
  });

  it('a started word, or the note on screen / just rated (sibling spacing): mixed as before', () => {
    expect(sessionBumpPlan([a], true, false, true)).toEqual({ next: null, mixed: [a] });
    expect(sessionBumpPlan([m], false, true, true)).toEqual({ next: null, mixed: [m] });
    expect(sessionBumpPlan([], false, false, true)).toEqual({ next: null, mixed: [] });
  });
});

describe('pickNextUpCard', () => {
  const queue = [{ id: 'x' }, { id: 'b' }, { id: 'a' }];
  it('the first still in the queue, in the order bumped', () => {
    expect(pickNextUpCard(queue, ['a', 'b'])?.id).toBe('a');
    expect(pickNextUpCard(queue, ['gone', 'b'])?.id).toBe('b');
    expect(pickNextUpCard(queue, [])).toBeNull();
    expect(pickNextUpCard(queue, null)).toBeNull();
  });
});
