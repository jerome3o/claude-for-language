import { describe, it, expect } from 'vitest';
import { findGhostDecks, parseServerTime } from './ghosts';

describe('parseServerTime', () => {
  it('reads SQLite UTC datetimes and ISO strings', () => {
    expect(parseServerTime('2026-09-21 06:10:11')).toBe(Date.parse('2026-09-21T06:10:11Z'));
    expect(parseServerTime('2026-09-21T06:10:11.000Z')).toBe(Date.parse('2026-09-21T06:10:11Z'));
    expect(parseServerTime(null)).toBeNaN();
    expect(parseServerTime('nonsense')).toBeNaN();
  });
});

describe('findGhostDecks', () => {
  const at = '2026-09-24T10:47:00.000Z';

  it('returns local decks missing from the live list that predate the snapshot', () => {
    const local = [
      { id: 'a', created_at: '2026-09-21 06:10:11' },
      { id: 'b', created_at: '2026-09-23 09:40:38' },
    ];
    expect(findGhostDecks(local, ['b'], at)).toEqual(['a']);
  });

  it('keeps decks created around or after the snapshot (made while the request was in flight)', () => {
    const local = [
      { id: 'just-before', created_at: '2026-09-24 10:46:30' },
      { id: 'after', created_at: '2026-09-24 10:50:00' },
    ];
    expect(findGhostDecks(local, [], at)).toEqual([]);
  });

  it('keeps decks of unknown age and does nothing without a snapshot time', () => {
    expect(findGhostDecks([{ id: 'x', created_at: null }], [], at)).toEqual([]);
    expect(findGhostDecks([{ id: 'x', created_at: '2026-01-01 00:00:00' }], [], undefined)).toEqual([]);
  });
});
