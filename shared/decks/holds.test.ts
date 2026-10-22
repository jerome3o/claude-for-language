import { describe, it, expect } from 'vitest';
import {
  activeHoldFor,
  addLocalDays,
  addLocalMonths,
  cardsInStudy,
  dateOfDayNumber,
  dayNumber,
  filterHoldRows,
  heldCardIds,
  holdMessage,
  holdStatusLabel,
  holdTag,
  holdTargets,
  isHoldActive,
  isLocalDate,
  siblingBuriedCardIds,
  snoozeUntil,
  type CardHold,
} from './holds';
import { countQueue, selectStudyQueue, type QueueCardInput, type QueueDeckInput } from './study-queue';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-09-27T18:37:00.000Z');
const CUTOFF = Date.parse('2026-09-27T22:59:59.999Z');

const card = (id: string, note: string, deck: string, queue: number, due: number | null = null, type = 'hanzi_to_meaning'): QueueCardInput => ({
  id, note_id: note, deck_id: deck, card_type: type, queue, due_ms: due,
});
const deck = (id: string, priority = 0, cap = 3, capS = 6): QueueDeckInput => ({
  id, priority, created_at: '2026-01-01', cap_primary: cap, cap_secondary: capS,
});
const hold = (card_id: string, kind: 'suspend' | 'snooze', until: string | null = null): CardHold => ({
  id: `h-${card_id}`, card_id, kind, until, created_at: '2026-09-27T10:00:00.000Z',
});

describe('local dates', () => {
  it('round-trips day numbers across leap years and centuries', () => {
    for (const d of ['1970-01-01', '2000-02-29', '2024-12-31', '2026-10-22', '2100-03-01']) {
      expect(dateOfDayNumber(dayNumber(d))).toBe(d);
    }
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('1969-12-31')).toBe(-1);
  });

  it('adds days and months (clamped to the month end)', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addLocalMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addLocalMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('validates dates', () => {
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('26-01-01')).toBe(false);
    expect(isLocalDate(null)).toBe(false);
  });

  it('snoozes until tomorrow / a week / a month (local dates)', () => {
    expect(snoozeUntil('2026-10-22', 'tomorrow')).toBe('2026-10-23');
    expect(snoozeUntil('2026-10-22', 'week')).toBe('2026-10-29');
    expect(snoozeUntil('2026-10-31', 'month')).toBe('2026-11-30');
  });
});

describe('holds', () => {
  it('a suspend is active until cleared; a snooze until its date', () => {
    expect(isHoldActive(hold('a', 'suspend'), '2030-01-01')).toBe(true);
    const s = hold('b', 'snooze', '2026-10-23');
    expect(isHoldActive(s, '2026-10-22')).toBe(true);
    expect(isHoldActive(s, '2026-10-23')).toBe(false);
    expect(isHoldActive(hold('c', 'snooze', 'garbage'), '2026-10-22')).toBe(false);
    expect([...heldCardIds([hold('a', 'suspend'), s, hold('c', 'snooze', '2026-10-01')], '2026-10-22')].sort()).toEqual(['a', 'b']);
  });

  it('the active hold of a card: suspend wins, else the latest snooze', () => {
    const a = hold('x', 'snooze', '2026-10-25');
    const b = hold('x', 'snooze', '2026-11-25');
    expect(activeHoldFor([a, b], '2026-10-22')).toBe(b);
    const s = hold('x', 'suspend');
    expect(activeHoldFor([a, s, b], '2026-10-22')).toBe(s);
    expect(activeHoldFor([hold('x', 'snooze', '2026-10-01')], '2026-10-22')).toBeNull();
  });

  it('labels and tags (icon + text)', () => {
    expect(holdStatusLabel(hold('x', 'suspend'), '2026-10-22')).toBe('Suspended');
    expect(holdStatusLabel(hold('x', 'snooze', '2026-10-23'), '2026-10-22')).toBe('Snoozed until tomorrow');
    expect(holdStatusLabel(hold('x', 'snooze', '2026-11-22'), '2026-10-22')).toBe('Snoozed until 22 Nov');
    expect(holdStatusLabel(hold('x', 'snooze', '2027-01-05'), '2026-12-30')).toBe('Snoozed until 5 Jan 2027');
    expect(holdTag(hold('x', 'suspend'), '2026-10-22')).toEqual({ icon: '⏸', text: 'Suspended' });
    expect(holdTag(hold('x', 'snooze', '2026-10-29'), '2026-10-22')).toEqual({ icon: '💤', text: 'Snoozed · 29 Oct' });
    expect(holdMessage('snooze', 3, 'week')).toBe('3 cards snoozed for a week.');
    expect(holdMessage('suspend', 1)).toMatch(/^Suspended/);
  });

  it('targets the card or every card of the word', () => {
    const cards = [card('a', 'n', 'd', 0), card('b', 'n', 'd', 2), card('c', 'm', 'd', 0)];
    expect(holdTargets(cards[0], cards, 'card').map(c => c.id)).toEqual(['a']);
    expect(holdTargets(cards[0], cards, 'word').map(c => c.id)).toEqual(['a', 'b']);
  });

  it('filters the management list by kind and search (pinyin with or without tones)', () => {
    const rows = [
      { card_id: '1', hold: hold('1', 'snooze', '2026-11-01'), hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
      { card_id: '2', hold: hold('2', 'suspend'), hanzi: '学生', pinyin: 'xuéshēng', english: 'student' },
      { card_id: '3', hold: hold('3', 'snooze', '2026-10-23'), hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple' },
    ];
    expect(filterHoldRows(rows, '', 'all').map(r => r.card_id)).toEqual(['2', '3', '1']);
    expect(filterHoldRows(rows, 'yinhang', 'all').map(r => r.card_id)).toEqual(['1']);
    expect(filterHoldRows(rows, '学', 'all').map(r => r.card_id)).toEqual(['2']);
    expect(filterHoldRows(rows, 'APPLE', 'snoozed').map(r => r.card_id)).toEqual(['3']);
    expect(filterHoldRows(rows, '', 'suspended').map(r => r.card_id)).toEqual(['2']);
  });
});

describe('sibling burying', () => {
  it('buries NEW and REVIEW siblings of a card reviewed today; never learning cards, never exempt notes', () => {
    const cards = [
      card('a-h', 'a', 'd', 1), card('a-m', 'a', 'd', 0), card('a-u', 'a', 'd', 2),
      card('b-h', 'b', 'd', 2), card('b-m', 'b', 'd', 3),
      card('c-h', 'c', 'd', 2), card('c-m', 'c', 'd', 0),
    ];
    const reviewed = new Set(['a-h', 'b-m', 'c-h']);
    expect([...siblingBuriedCardIds(cards, reviewed)].sort()).toEqual(['a-m', 'a-u', 'b-h', 'c-m']);
    expect([...siblingBuriedCardIds(cards, reviewed, ['a'])].sort()).toEqual(['b-h', 'c-m']);
    expect(siblingBuriedCardIds(cards, new Set()).size).toBe(0);
  });

  it('a card reviewed today is not buried by itself', () => {
    const cards = [card('x', 'n', 'd', 2), card('y', 'n', 'd', 2)];
    expect([...siblingBuriedCardIds(cards, new Set(['x']))]).toEqual(['y']);
  });
});

describe('selectStudyQueue with holds', () => {
  const budget = { new_cards_per_day: 2, secondary_cards_per_day: 0 };

  it('a held NEW card frees its budget slot for the next new card', () => {
    const cards = [card('n1', 'w1', 'd', 0), card('n2', 'w2', 'd', 0), card('n3', 'w3', 'd', 0)];
    const plain = selectStudyQueue([deck('d', 0, 5, 0)], cards, budget, 0, new Map(), CUTOFF);
    expect(plain.due.map(c => c.id)).toEqual(['n1', 'n2']);
    const held = selectStudyQueue([deck('d', 0, 5, 0)], cards, budget, 0, new Map(), CUTOFF, null, null, null, null, null, { held: new Set(['n1']) });
    expect(held.due.map(c => c.id)).toEqual(['n2', 'n3']);
  });

  it('held review / learning cards leave the due list and the counts, bumps and Up next', () => {
    const cards = [
      card('r1', 'a', 'd', 2, NOW - DAY), card('l1', 'b', 'd', 1, NOW - H),
      card('bump', 'c', 'd', 2, NOW + 3 * DAY), card('up', 'e', 'd', 0),
    ];
    const bumps = { bumps: [{ note_id: 'c', created_ms: NOW - H }], lastReviewMs: new Map<string, number>(), firstReviewMs: new Map<string, number>() };
    const all = selectStudyQueue([deck('d')], cards, budget, 0, new Map(), CUTOFF, null, null, null, bumps, ['e']);
    expect(all.due.map(c => c.id).sort()).toEqual(['bump', 'l1', 'r1', 'up']);
    const q = selectStudyQueue([deck('d')], cards, budget, 0, new Map(), CUTOFF, null, null, null, bumps, ['e'], { held: new Set(['r1', 'l1', 'bump', 'up']) });
    expect(q.due).toEqual([]);
    expect(q.bumped).toEqual([]);
    expect(q.upNext).toEqual([]);
    expect(countQueue(q.due, q.reviewedNoteIds)).toEqual({ new: 0, secondaryNew: 0, learning: 0, review: 0 });
  });

  it('a suspended reviewed card still makes its word started (siblings stay secondary)', () => {
    const cards = [card('h', 'w', 'd', 2, NOW + 5 * DAY), card('m', 'w', 'd', 0, null, 'meaning_to_hanzi')];
    const q = selectStudyQueue([deck('d')], cards, { new_cards_per_day: 3, secondary_cards_per_day: 3 }, 0, new Map(), CUTOFF, null, null, null, null, null, { held: new Set(['h']) });
    expect(q.reviewedNoteIds.has('w')).toBe(true);
    expect(countQueue(q.due, q.reviewedNoteIds)).toEqual({ new: 0, secondaryNew: 1, learning: 0, review: 0 });
  });

  it('sibling burying keeps learning cards and bumped words; buries the rest until tomorrow', () => {
    const cards = [
      card('a-h', 'a', 'd', 1, NOW - H), card('a-m', 'a', 'd', 0, null, 'meaning_to_hanzi'),
      card('b-h', 'b', 'd', 2, NOW + 2 * DAY), card('b-m', 'b', 'd', 2, NOW - DAY, 'meaning_to_hanzi'),
      card('c-h', 'c', 'd', 2, NOW + 2 * DAY), card('c-m', 'c', 'd', 2, NOW - DAY, 'meaning_to_hanzi'),
    ];
    const bumps = { bumps: [{ note_id: 'c', created_ms: NOW - 2 * H }], lastReviewMs: new Map([['c-h', NOW - H]]), firstReviewMs: new Map([['c-h', NOW - 30 * DAY]]) };
    const reviewedToday = new Set(['a-h', 'b-h', 'c-h']);
    const b = { new_cards_per_day: 3, secondary_cards_per_day: 3 };
    const q = selectStudyQueue([deck('d')], cards, b, 0, new Map(), CUTOFF, null, null, null, bumps, null, { reviewedToday });
    expect(q.due.map(c => c.id).sort()).toEqual(['a-h', 'c-m']);
    const off = selectStudyQueue([deck('d')], cards, b, 0, new Map(), CUTOFF, null, null, null, bumps, null, { reviewedToday: null });
    expect(off.due.map(c => c.id).sort()).toEqual(['a-h', 'a-m', 'b-m', 'c-m']);
  });

  it('cardsInStudy without holds returns the same list', () => {
    const cards = [card('a', 'n', 'd', 0)];
    expect(cardsInStudy(cards, null)).toBe(cards);
  });
});
