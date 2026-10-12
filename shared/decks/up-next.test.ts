import { describe, it, expect } from 'vitest';
import {
  canAddToUpNext,
  insertIntoOrder,
  normalizeUpNextSource,
  reorderUpNext,
  takeUpNext,
  upNextAddedMessage,
  upNextIndex,
  upNextLabel,
  upNextSlots,
  upNextStatus,
  upNextStatusLabel,
} from './up-next';
import { countQueue, introducedToday, selectStudyQueue, type QueueCardInput, type QueueDeckInput } from './study-queue';
import type { QueueBumps } from './bumps';

const H = 3_600_000;
const NOW = Date.parse('2026-10-12T10:00:00.000Z');
const CUTOFF = Date.parse('2026-10-12T22:59:59.999Z');
const DAY_START = Date.parse('2026-10-11T23:00:00.000Z');

const card = (id: string, note: string, deck: string, queue = 0, type = 'hanzi_to_meaning', due: number | null = null): QueueCardInput => ({
  id, note_id: note, deck_id: deck, card_type: type, queue, due_ms: due,
});
/** A note's three cards, all NEW. */
const word = (note: string, deck: string) => [
  card(`${note}-h`, note, deck), card(`${note}-m`, note, deck, 0, 'meaning_to_hanzi'), card(`${note}-a`, note, deck, 0, 'audio_to_hanzi'),
];
const deck = (id: string, priority = 0, cap = 3, capS = 6): QueueDeckInput => ({
  id, priority, created_at: '2026-01-01', cap_primary: cap, cap_secondary: capS,
});
const budget = (p: number, s: number) => ({ new_cards_per_day: p, secondary_cards_per_day: s });
const newIds = (due: QueueCardInput[]) => due.filter(c => c.queue === 0).map(c => c.id);

describe('upNextStatus', () => {
  it('new / started / done / missing', () => {
    expect(upNextStatus([])).toBe('missing');
    expect(upNextStatus([{ queue: 0 }, { queue: 0 }])).toBe('new');
    expect(upNextStatus([{ queue: 2 }, { queue: 0 }])).toBe('started');
    expect(upNextStatus([{ queue: 2 }, { queue: 1 }])).toBe('done');
    expect(canAddToUpNext([{ queue: 2 }, { queue: 0 }])).toBe(true);
    expect(canAddToUpNext([{ queue: 2 }])).toBe(false);
    expect(canAddToUpNext([])).toBe(false);
  });
});

describe('upNextSlots', () => {
  it('one best card per unstarted note, every NEW card of a started note, list order', () => {
    const cards = [
      ...word('a', 'd'),
      card('b-h', 'b', 'd', 2, 'hanzi_to_meaning', NOW + 9 * H), card('b-a', 'b', 'd', 0, 'audio_to_hanzi'), card('b-m', 'b', 'd', 0, 'meaning_to_hanzi'),
      card('c-m', 'c', 'd', 0, 'meaning_to_hanzi'), card('c-a', 'c', 'd', 0, 'audio_to_hanzi'),
    ];
    const s = upNextSlots(cards, ['c', 'b', 'a', 'gone', 'a'], new Set(['b']));
    expect(s.primary.map(c => c.id)).toEqual(['c-m', 'a-h']);
    expect(s.secondary.map(c => c.id)).toEqual(['b-m', 'b-a']);
    expect([...s.noteIds]).toEqual(['c', 'b', 'a']);
  });

  it('skips opted-out unstarted words, done notes and the bump pocket', () => {
    const cards = [...word('a', 'd'), ...word('b', 'd'), card('c-h', 'c', 'd', 2)];
    const s = upNextSlots(cards, ['a', 'b', 'c'], new Set(['c']), new Set(['b-h', 'b-m', 'b-a']), new Map([['a', 0 as const]]));
    expect(s.primary).toEqual([]);
    expect(s.noteIds.size).toBe(0);
  });
});

describe('takeUpNext', () => {
  it('takes what the budget left allows, never negative', () => {
    expect(takeUpNext({ primary: 5, secondary: 2 }, { primary: 3, secondary: 6 })).toEqual({ primary: 3, secondary: 2 });
    expect(takeUpNext({ primary: 1, secondary: 2 }, { primary: 0, secondary: -1 })).toEqual({ primary: 0, secondary: 0 });
  });
});

describe('selectStudyQueue with Up next', () => {
  it('Up next takes the budget first, in list order, from any deck, before the deck queue', () => {
    const cards = [...word('top1', 'top'), ...word('top2', 'top'), ...word('low1', 'low'), ...word('low2', 'low')];
    const decks = [deck('top', 9), deck('low', 0)];
    const plain = selectStudyQueue(decks, cards, budget(2, 0), 0, new Map(), CUTOFF);
    expect(newIds(plain.due)).toEqual(['top1-h', 'top2-h']);
    const q = selectStudyQueue(decks, cards, budget(2, 0), 0, new Map(), CUTOFF, null, null, null, null, ['low2']);
    expect(newIds(q.due)).toEqual(['low2-h', 'top1-h']);
    expect(q.upNext.map(c => c.id)).toEqual(['low2-h']);
    expect(q.upNextNoteIds).toEqual(['low2']);
    expect(countQueue(q.due, q.reviewedNoteIds)).toEqual({ new: 2, secondaryNew: 0, learning: 0, review: 0 });
    expect(q.hasMoreNew).toBe(true);
  });

  it('ignores deck caps (a one-off 0 + 0 copy too) and holds back the note’s other cards', () => {
    const cards = [...word('x', 'oneoff'), ...word('y', 'oneoff'), ...word('z', 'main')];
    const decks = [deck('oneoff', 5, 0, 0), deck('main', 0, 3, 6)];
    const q = selectStudyQueue(decks, cards, budget(3, 6), 0, new Map(), CUTOFF, null, null, null, null, ['y', 'x']);
    // y and x from the 0 + 0 deck, then z from main; the 2nd / 3rd cards of y and x wait.
    expect(newIds(q.due)).toEqual(['y-h', 'x-h', 'z-h']);
  });

  it('counts its picks against the deck cap, so the day stays consistent after the reviews', () => {
    const cards = [...word('u1', 'd'), ...word('u2', 'd'), ...word('r1', 'd'), ...word('r2', 'd'), ...word('r3', 'd')];
    const decks = [deck('d', 0, 3, 0)];
    const before = selectStudyQueue(decks, cards, budget(10, 0), 0, new Map(), CUTOFF, null, null, null, null, ['u1', 'u2']);
    // Cap 3: 2 from Up next + 1 more of the deck's words (not 3).
    expect(newIds(before.due)).toEqual(['u1-h', 'u2-h', 'r1-h']);
    // After reviewing both Up next cards the same day, the deck still gives r1 only.
    const reviewedCards = cards.map(c => (c.id === 'u1-h' || c.id === 'u2-h' ? { ...c, queue: 1, due_ms: NOW + 600_000 } : c));
    const intro = introducedToday(reviewedCards, new Map([['u1-h', NOW - H], ['u2-h', NOW - H]]), DAY_START);
    const after = selectStudyQueue(decks, reviewedCards, budget(10, 0), 0, intro, CUTOFF, null, null, null, null, ['u1', 'u2']);
    expect(newIds(after.due)).toEqual(['r1-h']);
  });

  it('a started note’s NEW cards go first in the purple budget only', () => {
    const cards = [
      card('s-h', 's', 'd', 2, 'hanzi_to_meaning', NOW + 30 * H), card('s-m', 's', 'd', 0, 'meaning_to_hanzi'), card('s-a', 's', 'd', 0, 'audio_to_hanzi'),
      card('o-h', 'o', 'd', 2, 'hanzi_to_meaning', NOW + 30 * H), card('o-m', 'o', 'd', 0, 'meaning_to_hanzi'),
      ...word('w', 'd'),
    ];
    const q = selectStudyQueue([deck('d')], cards, budget(1, 1), 0, new Map(), CUTOFF, null, null, null, null, ['s']);
    expect(newIds(q.due)).toEqual(['s-m', 'w-h']);
    // No purple budget: nothing of s today, and no spill from the blue budget into it.
    const none = selectStudyQueue([deck('d')], cards, budget(1, 0), 0, new Map(), CUTOFF, null, null, null, null, ['s']);
    expect(newIds(none.due)).toEqual(['w-h']);
    expect(none.hasMoreNew).toBe(true);
  });

  it('a spent budget leaves the list waiting; "Study more" (bonus) takes the next ones first', () => {
    const cards = [...word('a', 'd'), ...word('b', 'd'), ...word('c', 'd')];
    const q = selectStudyQueue([deck('d', 0, 20)], cards, budget(1, 0), 0, new Map(), CUTOFF, null, null, null, null, ['c', 'b']);
    expect(newIds(q.due)).toEqual(['c-h']);
    const more = selectStudyQueue([deck('d', 0, 20)], cards, budget(1, 0), 2, new Map(), CUTOFF, null, null, null, null, ['c', 'b']);
    expect(newIds(more.due)).toEqual(['c-h', 'b-h', 'a-h']);
  });

  it('respects the long-term opt-out and leaves bumped notes to the pocket', () => {
    const cards = [...word('a', 'd'), ...word('b', 'd'), ...word('c', 'd')];
    const bumps: QueueBumps = { bumps: [{ note_id: 'b', created_ms: NOW - H }], lastReviewMs: new Map(), firstReviewMs: new Map() };
    const q = selectStudyQueue([deck('d')], cards, budget(1, 0), 0, new Map(), CUTOFF, null, null, new Map([['a', 0 as const]]), bumps, ['a', 'b', 'c']);
    expect(q.bumped.map(c => c.id)).toEqual(['b-h', 'b-m', 'b-a']);
    expect(q.upNext.map(c => c.id)).toEqual(['c-h']);
    expect(q.upNextNoteIds).toEqual(['c']);
  });

  it('a one-deck session sees the Up next notes of that deck only, sharing the global budget', () => {
    const cards = [...word('a', 'd1'), ...word('b', 'd2')];
    const decks = [deck('d1'), deck('d2')];
    const intro = new Map([['d2', { primary: 1, secondary: 0 }]]);
    const q = selectStudyQueue(decks, cards, budget(2, 0), 0, intro, CUTOFF, 'd1', null, null, null, ['b', 'a']);
    expect(newIds(q.due)).toEqual(['a-h']);
    const spent = selectStudyQueue(decks, cards, budget(1, 0), 0, intro, CUTOFF, 'd1', null, null, null, ['b', 'a']);
    expect(newIds(spent.due)).toEqual([]);
  });

  it('goes before "Order new cards by"', () => {
    const cards = [...word('n1', 'd'), ...word('n2', 'd')];
    const hanzi = new Map([['n1', '熊猫'], ['n2', '你好']]);
    const q = selectStudyQueue([deck('d')], cards, budget(1, 0), 0, new Map(), CUTOFF, null, { hanzi }, null, null, ['n2']);
    expect(newIds(q.due)).toEqual(['n2-h']);
  });
});

describe('list helpers', () => {
  it('insertIntoOrder places / moves to a final index', () => {
    expect(insertIntoOrder(['a', 'b', 'c'], ['x'], 0)).toEqual(['x', 'a', 'b', 'c']);
    expect(insertIntoOrder(['a', 'b', 'c'], ['x', 'y'], 1)).toEqual(['a', 'x', 'y', 'b', 'c']);
    expect(insertIntoOrder(['a', 'b', 'c'], ['x'])).toEqual(['a', 'b', 'c', 'x']);
    expect(insertIntoOrder(['a', 'b', 'c'], ['a'], 2)).toEqual(['b', 'c', 'a']);
    expect(insertIntoOrder(['a', 'b', 'c'], ['c', 'c'], 0)).toEqual(['c', 'a', 'b']);
    expect(insertIntoOrder(['a'], ['x'], 99)).toEqual(['a', 'x']);
    expect(insertIntoOrder(['a'], ['x'], -3)).toEqual(['x', 'a']);
  });

  it('reorderUpNext: the requested ids first, the rest after, unknown ids ignored', () => {
    expect(reorderUpNext(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'd']);
    expect(reorderUpNext(['a', 'b'], ['zz', 'b', 'b'])).toEqual(['b', 'a']);
  });

  it('upNextIndex', () => {
    expect(upNextIndex('top', 4)).toBe(0);
    expect(upNextIndex('bottom', 4)).toBe(4);
    expect(upNextIndex(2, 4)).toBe(2);
    expect(upNextIndex(9, 4)).toBe(4);
    expect(upNextIndex('1', 4)).toBe(1);
    expect(upNextIndex(undefined, 4)).toBe(4);
  });

  it('labels and sources', () => {
    expect(upNextLabel(0)).toBe('');
    expect(upNextLabel(4)).toBe('↑ 4 up next');
    expect(upNextAddedMessage(['银行'])).toBe('↑ 银行 is up next');
    expect(upNextAddedMessage(['银行', '学生', '老师'])).toBe('↑ 银行, 学生 and 1 more are up next');
    expect(upNextAddedMessage([], 0, 1)).toBe('Already studied — use ⚡ Study it today instead');
    expect(upNextAddedMessage([], 2)).toBe('Already up next');
    expect(upNextStatusLabel('started', 2)).toBe('Started · 2 new cards left');
    expect(normalizeUpNextSource('mcp')).toBe('mcp');
    expect(normalizeUpNextSource('nope')).toBe('other');
  });
});
