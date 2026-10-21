import { describe, expect, it } from 'vitest';
import {
  budgetForToday,
  pausedNewCardsLabel,
  pickReviewLoadCap,
  reviewLoadCapSummary,
  reviewLoadState,
  reviewLoadToday,
  tutorPausedLabel,
  upNextPausedLabel,
  type ReviewLoadCard,
} from './review-load';
import { selectStudyQueue, QUEUE_LEARNING, QUEUE_NEW, QUEUE_RELEARNING, QUEUE_REVIEW, type QueueCardInput, type QueueDeckInput } from './study-queue';

const H = 3_600_000;
const DAY_START = Date.UTC(2026, 9, 21, 0, 0, 0);
const CUTOFF = DAY_START + 24 * H - 1;

function card(id: string, queue: number, due_ms: number | null): ReviewLoadCard {
  return { id, queue, due_ms };
}

describe('reviewLoadToday', () => {
  it('counts cards past NEW due by the cutoff, never NEW ones or later ones', () => {
    const cards = [
      card('r1', QUEUE_REVIEW, DAY_START - 5 * H), // overdue
      card('r2', QUEUE_REVIEW, DAY_START + 20 * H), // later today
      card('r3', QUEUE_REVIEW, CUTOFF + 1), // tomorrow
      card('l1', QUEUE_LEARNING, DAY_START + 1 * H), // learning from yesterday
      card('n1', QUEUE_NEW, null),
      card('x', QUEUE_REVIEW, null), // no date = due now
    ];
    expect(reviewLoadToday(cards, new Set(), new Map(), DAY_START, CUTOFF)).toBe(4);
  });

  it('stays the same as he works through the day', () => {
    // Morning: 3 reviews due.
    const morning = [card('a', QUEUE_REVIEW, DAY_START - H), card('b', QUEUE_REVIEW, DAY_START + 2 * H), card('c', QUEUE_REVIEW, DAY_START + 3 * H)];
    const first = new Map([['a', DAY_START - 10 * 24 * H], ['b', DAY_START - 5 * 24 * H], ['c', DAY_START - 3 * 24 * H]]);
    expect(reviewLoadToday(morning, new Set(), first, DAY_START, CUTOFF)).toBe(3);
    // a → Good (next week), b → Again (relearning, due in 10 min), c not yet.
    const midday = [
      card('a', QUEUE_REVIEW, DAY_START + 7 * 24 * H),
      card('b', QUEUE_RELEARNING, DAY_START + 4 * H),
      card('c', QUEUE_REVIEW, DAY_START + 3 * H),
    ];
    expect(reviewLoadToday(midday, new Set(['a', 'b']), first, DAY_START, CUTOFF)).toBe(3);
    // Evening: all done, scheduled days ahead — still 3.
    const evening = midday.map(c => ({ ...c, queue: QUEUE_REVIEW, due_ms: DAY_START + 5 * 24 * H }));
    expect(reviewLoadToday(evening, new Set(['a', 'b', 'c']), first, DAY_START, CUTOFF)).toBe(3);
  });

  it("never counts a card introduced today (a new card's learning steps)", () => {
    const cards = [card('new-today', QUEUE_LEARNING, DAY_START + 5 * H), card('graduated-today', QUEUE_REVIEW, DAY_START + 2 * 24 * H)];
    const first = new Map([['new-today', DAY_START + H], ['graduated-today', DAY_START + 2 * H]]);
    expect(reviewLoadToday(cards, new Set(['new-today', 'graduated-today']), first, DAY_START, CUTOFF)).toBe(0);
  });

  it('a card reviewed today with no known first review counts (history not on this device)', () => {
    expect(reviewLoadToday([card('a', QUEUE_REVIEW, DAY_START + 9 * 24 * H)], new Set(['a']), new Map(), DAY_START, CUTOFF)).toBe(1);
  });

  it("an early review (a ⚡ bump's) counts from then on", () => {
    const cards = [card('early', QUEUE_REVIEW, DAY_START + 30 * 24 * H)];
    const first = new Map([['early', DAY_START - 40 * 24 * H]]);
    expect(reviewLoadToday(cards, new Set(), first, DAY_START, CUTOFF)).toBe(0);
    expect(reviewLoadToday(cards, new Set(['early']), first, DAY_START, CUTOFF)).toBe(1);
  });
});

describe('the threshold', () => {
  it('pauses only when the load is OVER the limit', () => {
    expect(reviewLoadState(100, 100).paused).toBe(false);
    expect(reviewLoadState(101, 100).paused).toBe(true);
    expect(reviewLoadState(90, 100)).toEqual({ load: 90, threshold: 100, paused: false });
    expect(reviewLoadState(5000, null).paused).toBe(false);
    expect(reviewLoadState(5000, undefined)).toEqual({ load: 5000, threshold: null, paused: false });
  });

  it("today's budget is 0 + 0 while paused", () => {
    const budget = { new_cards_per_day: 3, secondary_cards_per_day: 6 };
    expect(budgetForToday(budget, reviewLoadState(124, 100))).toEqual({ new_cards_per_day: 0, secondary_cards_per_day: 0 });
    expect(budgetForToday(budget, reviewLoadState(90, 100))).toBe(budget);
    expect(budgetForToday(budget, null)).toBe(budget);
  });

  it('copy', () => {
    expect(pausedNewCardsLabel(reviewLoadState(124, 100))).toBe('New cards paused — 124 reviews due today (limit 100)');
    expect(pausedNewCardsLabel(reviewLoadState(11, 10))).toBe('New cards paused — 11 reviews due today (limit 10)');
    expect(pausedNewCardsLabel(reviewLoadState(90, 100))).toBeNull();
    expect(tutorPausedLabel(reviewLoadState(124, 100))).toBe('⏸ New cards paused today · 124 reviews due');
    expect(tutorPausedLabel(reviewLoadState(50, 100))).toBeNull();
    expect(reviewLoadCapSummary(100)).toBe('Pauses new cards on days with more than 100 reviews due');
    expect(reviewLoadCapSummary(null)).toBeNull();
    expect(upNextPausedLabel(reviewLoadState(124, 100))).toBe('Up next waits — new cards are paused today (124 reviews due, limit 100).');
    expect(upNextPausedLabel(reviewLoadState(100, 100))).toBeNull();
  });

  it('validation', () => {
    expect(pickReviewLoadCap(undefined)).toEqual({});
    expect(pickReviewLoadCap(null)).toEqual({ value: null });
    expect(pickReviewLoadCap(100)).toEqual({ value: 100 });
    expect(pickReviewLoadCap(9).problem).toMatch(/between 10 and 1000/);
  });
});

describe('the paused budget in the study queue', () => {
  const decks: QueueDeckInput[] = [{ id: 'd', priority: 0, created_at: '2026-10-01', cap_primary: 20, cap_secondary: 20 }];
  const c = (id: string, note: string, queue: number, due: number | null = null, type = 'hanzi_to_meaning'): QueueCardInput => ({ id, note_id: note, deck_id: 'd', card_type: type, queue, due_ms: due });
  const cards: QueueCardInput[] = [
    c('rev', 'n-rev', QUEUE_REVIEW, DAY_START + H),
    c('learn-today', 'n-today', QUEUE_LEARNING, DAY_START + 2 * H), // introduced today, still in its learning steps
    c('new1', 'n1', QUEUE_NEW), c('new2', 'n2', QUEUE_NEW), c('new3', 'n3', QUEUE_NEW),
    c('bumped-new', 'n-bump', QUEUE_NEW),
    c('up-new', 'n-up', QUEUE_NEW),
    c('sib', 'n-rev', QUEUE_NEW, null, 'meaning_to_hanzi'),
  ];
  const paused = budgetForToday({ new_cards_per_day: 3, secondary_cards_per_day: 6 }, reviewLoadState(124, 100));
  const bumps = { bumps: [{ note_id: 'n-bump', created_ms: DAY_START + H }], lastReviewMs: new Map<string, number>(), firstReviewMs: new Map<string, number>() };
  const introduced = new Map([['d', { primary: 1, secondary: 0 }]]);

  it('reviews, learning steps and ⚡ bumps stay; new cards and Up next wait', () => {
    const q = selectStudyQueue(decks, cards, paused, 0, introduced, CUTOFF, null, null, null, bumps, ['n-up']);
    const ids = q.due.map(x => x.id);
    expect(ids).toContain('rev');
    expect(ids).toContain('learn-today');
    expect(ids).toContain('bumped-new');
    expect(ids).not.toContain('new1');
    expect(ids).not.toContain('sib');
    expect(ids).not.toContain('up-new');
    expect(q.upNext).toEqual([]);
    expect(q.upNextNoteIds).toEqual(['n-up']); // still on the list, waiting
    expect(q.hasMoreNew).toBe(true); // "Study 10 more" is offered
  });

  it('Study more (+10) still adds new cards — Up next first', () => {
    const q = selectStudyQueue(decks, cards, paused, 10, introduced, CUTOFF, null, null, null, bumps, ['n-up']);
    const ids = q.due.map(x => x.id);
    expect(q.upNext.map(x => x.id)).toEqual(['up-new']);
    expect(ids).toEqual(expect.arrayContaining(['new1', 'new2', 'new3']));
  });
});
