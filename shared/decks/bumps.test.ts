import { describe, it, expect } from 'vitest';
import { bumpPocket, bumpedCardsForNote, bumpedLabel, bumpedMessage, normalizeBumpSource, type QueueBumps } from './bumps';
import { selectStudyQueue, countQueue, type QueueCardInput, type QueueDeckInput } from './study-queue';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-10-04T10:00:00.000Z');
const CUTOFF = Date.parse('2026-10-04T22:59:59.999Z');
const BUMP = NOW - H;

const card = (id: string, note: string, queue: number, due: number | null = null, type = 'hanzi_to_meaning', deck = 'd1'): QueueCardInput => ({
  id, note_id: note, deck_id: deck, card_type: type, queue, due_ms: due,
});
const deck = (id: string, priority = 0, cap = 3, capS = 6): QueueDeckInput => ({
  id, priority, created_at: '2026-01-01', cap_primary: cap, cap_secondary: capS,
});
const bumps = (notes: Array<[string, number]>, last: Array<[string, number]> = [], first: Array<[string, number]> = []): QueueBumps => ({
  bumps: notes.map(([note_id, created_ms]) => ({ note_id, created_ms })),
  lastReviewMs: new Map(last),
  firstReviewMs: new Map(first),
});

describe('bumpedCardsForNote', () => {
  it('a brand-new note: all its NEW cards, card-type order', () => {
    const cards = [card('a', 'n', 0, null, 'audio_to_hanzi'), card('h', 'n', 0), card('m', 'n', 0, null, 'meaning_to_hanzi')];
    expect(bumpedCardsForNote(cards, { note_id: 'n', created_ms: BUMP }, new Map(), new Map(), CUTOFF).map(c => c.id)).toEqual(['h', 'm', 'a']);
  });

  it('a note in review, nothing due: ONE early review, hanzi_to_meaning first', () => {
    const cards = [card('m', 'n', 2, NOW + 5 * DAY, 'meaning_to_hanzi'), card('h', 'n', 2, NOW + 9 * DAY), card('a', 'n', 2, NOW + 2 * DAY, 'audio_to_hanzi')];
    expect(bumpedCardsForNote(cards, { note_id: 'n', created_ms: BUMP }, new Map(), new Map(), CUTOFF).map(c => c.id)).toEqual(['h']);
  });

  it('a card already due is moved to the front instead of an early review', () => {
    const cards = [card('h', 'n', 2, NOW + 9 * DAY), card('m', 'n', 2, NOW - DAY, 'meaning_to_hanzi')];
    expect(bumpedCardsForNote(cards, { note_id: 'n', created_ms: BUMP }, new Map(), new Map(), CUTOFF).map(c => c.id)).toEqual(['m']);
  });

  it('NEW cards plus the early review of a started note', () => {
    const cards = [card('h', 'n', 2, NOW + 9 * DAY), card('m', 'n', 0, null, 'meaning_to_hanzi'), card('a', 'n', 0, null, 'audio_to_hanzi')];
    expect(bumpedCardsForNote(cards, { note_id: 'n', created_ms: BUMP }, new Map(), new Map(), CUTOFF).map(c => c.id)).toEqual(['h', 'm', 'a']);
  });

  it('done after review: reviewing the early card ends the bump (no next early card)', () => {
    const cards = [card('h', 'n', 2, NOW + 3 * DAY), card('m', 'n', 2, NOW + 5 * DAY, 'meaning_to_hanzi')];
    const got = bumpedCardsForNote(cards, { note_id: 'n', created_ms: BUMP }, new Map([['h', NOW]]), new Map([['h', NOW - 30 * DAY]]), CUTOFF);
    expect(got).toEqual([]);
  });

  it('a NEW card reviewed since the bump leaves the early slot open for the started card', () => {
    // h was NEW at bump time (first review after the bump): the early review of m stays.
    const cards = [card('h', 'n', 1, NOW + 10 * 60_000), card('m', 'n', 2, NOW + 4 * DAY, 'meaning_to_hanzi')];
    const got = bumpedCardsForNote(cards, { note_id: 'n', created_ms: BUMP }, new Map([['h', NOW]]), new Map([['h', NOW]]), CUTOFF);
    expect(got.map(c => c.id)).toEqual(['m']);
  });

  it('reviews before the bump do not count (carry-over: yesterday’s bump is still open)', () => {
    const cards = [card('h', 'n', 0)];
    const bump = { note_id: 'n', created_ms: NOW - DAY };
    expect(bumpedCardsForNote(cards, bump, new Map([['h', NOW - 2 * DAY]]), new Map(), CUTOFF).map(c => c.id)).toEqual(['h']);
  });
});

describe('bumpPocket', () => {
  it('oldest bump first; done and active notes; unknown notes ignored', () => {
    const cards = [card('x1', 'x', 0), card('y1', 'y', 2, NOW + DAY * 4), card('z1', 'z', 0)];
    const p = bumpPocket(cards, bumps([['z', BUMP], ['x', BUMP - H], ['y', BUMP], ['ghost', BUMP]], [['z1', NOW]]), CUTOFF);
    expect(p.cards.map(c => c.id)).toEqual(['x1', 'y1']);
    expect(p.activeNoteIds).toEqual(['x', 'y']);
    expect(p.doneNoteIds).toEqual(['z']);
  });
});

describe('selectStudyQueue with bumps', () => {
  const budget = { new_cards_per_day: 1, secondary_cards_per_day: 0 };

  it('bumped NEW cards come first and over the budget, without taking from it', () => {
    const cards = [
      card('a-h', 'a', 0), card('b-h', 'b', 0), card('c-h', 'c', 0),
      card('r', 'r', 2, NOW - DAY),
    ];
    const q = selectStudyQueue([deck('d1')], cards, budget, 0, new Map([['d1', { primary: 1, secondary: 0 }]]), CUTOFF, null, null, null,
      bumps([['c', BUMP]]));
    // Budget spent (1 introduced today): only the bumped c-h is new.
    expect(q.due.map(c => c.id)).toEqual(['c-h', 'r']);
    expect(q.bumped.map(c => c.id)).toEqual(['c-h']);
    expect(q.bumpedNoteIds).toEqual(['c']);
    expect(countQueue(q.due, q.reviewedNoteIds)).toEqual({ new: 1, secondaryNew: 0, learning: 0, review: 1 });
  });

  it('the budget still introduces its own words beside a bump', () => {
    const cards = [card('a-h', 'a', 0), card('c-h', 'c', 0)];
    const q = selectStudyQueue([deck('d1')], cards, budget, 0, new Map(), CUTOFF, null, null, null, bumps([['c', BUMP]]));
    expect(q.due.map(c => c.id)).toEqual(['c-h', 'a-h']);
    expect(q.hasMoreNew).toBe(false);
  });

  it('a not-due review card joins today as an early review; a due one moves to the front once', () => {
    const cards = [card('due', 'n1', 2, NOW - DAY), card('later', 'n2', 2, NOW + 6 * DAY), card('soon', 'n3', 2, NOW - H)];
    const q = selectStudyQueue([deck('d1')], cards, budget, 0, new Map(), CUTOFF, null, null, null, bumps([['n2', BUMP], ['n3', BUMP + 1]]));
    expect(q.due.map(c => c.id)).toEqual(['later', 'soon', 'due']);
  });

  it('a one-deck session only carries that deck’s bumps', () => {
    const cards = [card('a', 'a', 0, null, 'hanzi_to_meaning', 'd1'), card('b', 'b', 0, null, 'hanzi_to_meaning', 'd2')];
    const q = selectStudyQueue([deck('d1'), deck('d2')], cards, { new_cards_per_day: 0, secondary_cards_per_day: 0 }, 0, new Map(), CUTOFF, 'd2', null, null,
      bumps([['a', BUMP], ['b', BUMP]]));
    expect(q.due.map(c => c.id)).toEqual(['b']);
  });

  it('without bumps nothing changes', () => {
    const cards = [card('a-h', 'a', 0), card('b-h', 'b', 0)];
    const a = selectStudyQueue([deck('d1')], cards, budget, 0, new Map(), CUTOFF);
    const b = selectStudyQueue([deck('d1')], cards, budget, 0, new Map(), CUTOFF, null, null, null, bumps([]));
    expect(b.due).toEqual(a.due);
    expect(a.bumped).toEqual([]);
  });
});

describe('copy', () => {
  it('labels and messages', () => {
    expect(bumpedLabel(0)).toBe('');
    expect(bumpedLabel(2)).toBe('⚡ 2 bumped for today');
    expect(bumpedMessage(['银行'])).toBe('⚡ 银行 will come first in today’s study');
    expect(bumpedMessage(['a', 'b', 'c', 'd'])).toBe('⚡ a, b and 2 more will come first in today’s study');
    expect(bumpedMessage([], 1)).toBe('Already in today’s pocket ⚡');
    expect(normalizeBumpSource('coach')).toBe('coach');
    expect(normalizeBumpSource('nope')).toBe('other');
  });
});
