import { describe, expect, it } from 'vitest';
import {
  bumpedAfterSession,
  countSessionCards,
  deckCountsAfterSession,
  NO_STUDY_COUNTS,
  sessionCountsNewer,
  totalAfterSession,
  type SessionCounts,
} from './homeCounts';

const c = (n: number, s: number, l: number, r: number) => ({ new: n, secondaryNew: s, learning: l, review: r });

function session(over: Partial<SessionCounts> = {}): SessionCounts {
  return { day: '2026-11-16', at: 1_000, deckId: null, remaining: NO_STUDY_COUNTS, byDeck: {}, bumpedNotes: 0, ...over };
}

describe('sessionCountsNewer', () => {
  it('a finished session beats the counts Home worked out before it', () => {
    expect(sessionCountsNewer(session({ at: 2_000 }), { at: 1_000, day: '2026-11-16' }, '2026-11-16')).toBe(true);
  });
  it('a recount that started after the session wins (and a tie goes to the recount)', () => {
    expect(sessionCountsNewer(session({ at: 2_000 }), { at: 3_000, day: '2026-11-16' }, '2026-11-16')).toBe(false);
    expect(sessionCountsNewer(session({ at: 2_000 }), { at: 2_000, day: '2026-11-16' }, '2026-11-16')).toBe(false);
  });
  it('no counts yet → the session', () => {
    expect(sessionCountsNewer(session(), null, '2026-11-16')).toBe(true);
  });
  it("yesterday's session never counts; yesterday's recount loses to today's session", () => {
    expect(sessionCountsNewer(session({ day: '2026-11-15' }), null, '2026-11-16')).toBe(false);
    expect(sessionCountsNewer(session({ at: 5 }), { at: 9_999, day: '2026-11-15' }, '2026-11-16')).toBe(true);
    expect(sessionCountsNewer(null, null, '2026-11-16')).toBe(false);
  });
});

describe('after an all-decks session', () => {
  it('"All done": every number is 0', () => {
    const s = session();
    expect(totalAfterSession(c(3, 6, 12, 40), { a: c(3, 6, 2, 30), b: c(0, 0, 10, 10) }, s)).toEqual(NO_STUDY_COUNTS);
    expect(deckCountsAfterSession(c(3, 6, 2, 30), s, 'a')).toEqual(NO_STUDY_COUNTS);
    expect(deckCountsAfterSession(c(0, 0, 10, 10), s, 'b')).toEqual(NO_STUDY_COUNTS);
    expect(bumpedAfterSession(2, s)).toBe(0);
  });
  it('left halfway: the session total, rows from what it holds per deck', () => {
    const s = session({ remaining: c(1, 2, 4, 5), byDeck: { a: c(1, 2, 1, 5), b: c(0, 0, 3, 0) }, bumpedNotes: 1 });
    expect(totalAfterSession(c(3, 6, 12, 40), {}, s)).toEqual(c(1, 2, 4, 5));
    // New cards: never more than the row said, nor than the session has left.
    expect(deckCountsAfterSession(c(3, 6, 2, 30), s, 'a')).toEqual(c(1, 2, 1, 5));
    expect(deckCountsAfterSession(c(0, 0, 10, 10), s, 'b')).toEqual(c(0, 0, 3, 0));
    // A deck with nothing left in the session.
    expect(deckCountsAfterSession(c(0, 1, 0, 4), s, 'c')).toEqual(c(0, 1, 0, 0));
    expect(bumpedAfterSession(4, s)).toBe(1);
  });
});

describe('after a one-deck session', () => {
  const s = session({ deckId: 'a', remaining: c(0, 0, 1, 0), byDeck: { a: c(0, 0, 1, 0) }, bumpedNotes: 0 });
  it('replaces only that deck in the total', () => {
    expect(totalAfterSession(c(3, 6, 12, 40), { a: c(3, 6, 2, 30) }, s)).toEqual(c(0, 0, 11, 10));
  });
  it('other decks keep their rows; the ⚡ line stays Home\'s', () => {
    expect(deckCountsAfterSession(c(0, 0, 10, 10), s, 'b')).toEqual(c(0, 0, 10, 10));
    expect(deckCountsAfterSession(null, s, 'b')).toEqual(NO_STUDY_COUNTS);
    expect(bumpedAfterSession(3, s)).toBe(3);
  });
  it('no total yet → the session numbers', () => {
    expect(totalAfterSession(null, {}, s)).toEqual(c(0, 0, 1, 0));
  });
});

describe('countSessionCards', () => {
  it('counts by queue, NEW of a started note as secondary', () => {
    const got = countSessionCards([
      { deck_id: 'a', note_id: 'n1', queue: 0 },
      { deck_id: 'a', note_id: 'n2', queue: 0 },
      { deck_id: 'b', note_id: 'n3', queue: 1 },
      { deck_id: 'b', note_id: 'n4', queue: 3 },
      { deck_id: 'b', note_id: 'n5', queue: 2 },
    ], new Set(['n2']));
    expect(got.total).toEqual(c(1, 1, 2, 1));
    expect(got.byDeck).toEqual({ a: c(1, 1, 0, 0), b: c(0, 0, 2, 1) });
  });
});
