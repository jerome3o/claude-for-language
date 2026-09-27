import { describe, it, expect } from 'vitest';
import {
  countQueue,
  introducedToday,
  selectStudyQueue,
  type QueueCardInput,
  type QueueDeckInput,
} from './study-queue';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-09-27T18:37:00.000Z');
const CUTOFF = Date.parse('2026-09-27T22:59:59.999Z');
const DAY_START = Date.parse('2026-09-26T23:00:00.000Z');

const card = (id: string, note: string, deck: string, queue: number, due: number | null = null, type = 'hanzi_to_meaning'): QueueCardInput => ({
  id, note_id: note, deck_id: deck, card_type: type, queue, due_ms: due,
});
const deck = (id: string, priority: number, cap = 3, capS = 6): QueueDeckInput => ({
  id, priority, created_at: '2026-01-01', cap_primary: cap, cap_secondary: capS,
});

describe('introducedToday', () => {
  it('counts first reviews since the day start; a sibling reviewed earlier makes it secondary', () => {
    const cards = [
      card('a-h', 'a', 'd1', 1), card('a-m', 'a', 'd1', 1),
      card('b-h', 'b', 'd1', 2), card('b-m', 'b', 'd1', 1),
      card('c-h', 'c', 'd2', 2),
    ];
    const first = new Map([
      ['a-h', DAY_START + H], ['a-m', DAY_START + 2 * H], // both today: primary then secondary
      ['b-h', DAY_START - DAY], ['b-m', DAY_START + H], // sibling started yesterday: secondary
      ['c-h', DAY_START - 1], // yesterday: not today
    ]);
    const got = introducedToday(cards, first, DAY_START);
    expect(Object.fromEntries(got)).toEqual({ d1: { primary: 1, secondary: 2 } });
  });

  it('a review exactly at the day start counts; ties between siblings are both primary', () => {
    const cards = [card('x', 'n', 'd', 1), card('y', 'n', 'd', 1)];
    const got = introducedToday(cards, new Map([['x', DAY_START], ['y', DAY_START]]), DAY_START);
    expect(got.get('d')).toEqual({ primary: 2, secondary: 0 });
  });
});

describe('selectStudyQueue', () => {
  const budget = { new_cards_per_day: 5, secondary_cards_per_day: 10 };

  it('holds learning / review cards due by the cutoff and nothing due later (Home counts the same)', () => {
    const cards = [
      card('r-due', 'n1', 'd1', 2, NOW - 3 * DAY),
      card('r-tonight', 'n2', 'd1', 2, NOW + 2 * H),
      card('r-tomorrow', 'n3', 'd1', 2, CUTOFF + 1),
      card('l-now', 'n4', 'd1', 1, NOW - 60_000),
      card('l-tomorrow', 'n5', 'd1', 3, NOW + DAY),
      card('l-null', 'n6', 'd1', 1, null),
    ];
    const q = selectStudyQueue([deck('d1', 1, 0, 0)], cards, budget, 0, new Map(), CUTOFF);
    expect(q.due.map(c => c.id).sort()).toEqual(['l-now', 'l-null', 'r-due', 'r-tonight']);
    expect(countQueue(q.due, q.reviewedNoteIds)).toEqual({ new: 0, secondaryNew: 0, learning: 2, review: 2 });
  });

  it('spends the budget top-down, best tier first, and remembers what other decks used today', () => {
    const cards = [
      card('a1-m', 'a1', 'top', 0, null, 'meaning_to_hanzi'), card('a1-h', 'a1', 'top', 0),
      card('a2-h', 'a2', 'top', 0),
      card('b1-h', 'b1', 'low', 0),
      card('s-h', 's', 'low', 2, NOW + DAY), card('s-m', 's', 'low', 0, null, 'meaning_to_hanzi'),
    ];
    const decks = [deck('low', 1), deck('top', 5, 2)];
    const introduced = new Map([['other', { primary: 2, secondary: 0 }]]);
    const all = selectStudyQueue(decks, cards, budget, 0, introduced, CUTOFF);
    // 5 − 2 used elsewhere = 3 words: top gives 2 (its cap), low 1; then the secondary s-m.
    expect(all.due.map(c => c.id)).toEqual(['a1-h', 'a2-h', 'b1-h', 's-m']);
    expect(Object.fromEntries(all.allocation)).toEqual({ top: { primary: 2, secondary: 0 }, low: { primary: 1, secondary: 1 } });
    expect(all.hasMoreNew).toBe(true); // a1-m is left over

    const one = selectStudyQueue(decks, cards, budget, 0, introduced, CUTOFF, 'low');
    expect(one.due.map(c => c.id)).toEqual(['b1-h', 's-m']);
    expect(one.pools.map(p => p.deckId)).toEqual(['low']);
  });

  it('introduced-today and the bonus change what is left', () => {
    const cards = [card('n1', 'n1', 'd', 0), card('n2', 'n2', 'd', 0), card('n3', 'n3', 'd', 0)];
    const spent = new Map([['d', { primary: 2, secondary: 0 }]]);
    const tight = { new_cards_per_day: 3, secondary_cards_per_day: 0 };
    expect(selectStudyQueue([deck('d', 1, 10)], cards, tight, 0, spent, CUTOFF).due).toHaveLength(1);
    expect(selectStudyQueue([deck('d', 1, 10)], cards, tight, 10, spent, CUTOFF).due).toHaveLength(3);
  });

  it('ignores cards of decks it does not know', () => {
    const q = selectStudyQueue([deck('d', 1)], [card('x', 'n', 'gone', 2, NOW - DAY)], budget, 0, new Map(), CUTOFF);
    expect(q.due).toEqual([]);
  });
});
