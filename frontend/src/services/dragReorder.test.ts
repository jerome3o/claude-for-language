import { describe, it, expect } from 'vitest';
import { indexUnderPointer, moveToIndex } from './dragReorder';

const col = [
  { left: 0, top: 0, width: 100, height: 50 },
  { left: 0, top: 60, width: 100, height: 50 },
  { left: 0, top: 120, width: 100, height: 50 },
];

describe('indexUnderPointer', () => {
  it('returns the card containing the point', () => {
    expect(indexUnderPointer(col, 10, 10)).toBe(0);
    expect(indexUnderPointer(col, 50, 100)).toBe(1);
    expect(indexUnderPointer(col, 99, 169)).toBe(2);
  });

  it('falls back to the nearest card in a gap or outside the list', () => {
    expect(indexUnderPointer(col, 50, 55)).toBe(0); // gap, closer to the first centre
    expect(indexUnderPointer(col, 50, 58)).toBe(1);
    expect(indexUnderPointer(col, 50, 400)).toBe(2);
    expect(indexUnderPointer(col, 50, -100)).toBe(0);
  });

  it('works for a two-column grid', () => {
    const grid = [
      { left: 0, top: 0, width: 100, height: 50 },
      { left: 110, top: 0, width: 100, height: 50 },
      { left: 0, top: 60, width: 100, height: 50 },
    ];
    expect(indexUnderPointer(grid, 150, 20)).toBe(1);
    expect(indexUnderPointer(grid, 150, 80)).toBe(1); // nearest centre to the empty slot
  });

  it('is -1 for no cards', () => {
    expect(indexUnderPointer([], 0, 0)).toBe(-1);
  });
});

describe('moveToIndex', () => {
  const q = ['a', 'b', 'c', 'd'];
  it('moves an id to a slot', () => {
    expect(moveToIndex(q, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveToIndex(q, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('returns the same array when nothing changes', () => {
    expect(moveToIndex(q, 'b', 1)).toBe(q);
    expect(moveToIndex(q, 'zzz', 1)).toBe(q);
    expect(moveToIndex(q, 'a', 9)).toBe(q);
  });
});
