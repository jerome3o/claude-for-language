import { describe, it, expect } from 'vitest';
import {
  scrambleDrop, scrambleDropSlot, scrambleInsertAt, scrambleMoveTo, scrambleMovedAnnouncement, scrambleNudge, scrambleOthers,
  scramblePreview, scrambleRemoveAt, scrambleRows, scrambleTileLabel, scrambleZone, type ScrambleRect,
} from './scrambleOrder';

/** Lay tiles out like a wrapping flex row: `widths` into lines of `lineWidth`, 8 apart, 48 high, 8 between lines. */
function flow(widths: number[], lineWidth = 300, left = 10, top = 100): ScrambleRect[] {
  const out: ScrambleRect[] = [];
  let x = left;
  let y = top;
  for (const w of widths) {
    if (x > left && x + w > left + lineWidth) {
      x = left;
      y += 56;
    }
    out.push({ left: x, top: y, width: w, height: 48 });
    x += w + 8;
  }
  return out;
}

describe('scrambleRows', () => {
  it('groups a wrapped row into its lines', () => {
    const rects = flow([100, 100, 100, 60, 150, 80]);
    expect(scrambleRows(rects)).toEqual([[0, 2], [2, 4], [4, 6]]);
    expect(scrambleRows([])).toEqual([]);
    expect(scrambleRows(flow([50]))).toEqual([[0, 1]]);
  });
});

describe('scrambleDropSlot', () => {
  const rects = flow([100, 100, 100, 60, 150, 80]);
  // line 1: [10..110] [118..218]  y 100..148
  // line 2: [10..110] [118..178]  y 156..204
  // line 3: [10..160] [168..248]  y 212..260
  it('an empty answer is slot 0', () => {
    expect(scrambleDropSlot([], 50, 50)).toBe(0);
  });
  it('before the first tile whose centre is right of x, on the line that holds y', () => {
    expect(scrambleDropSlot(rects, 20, 120)).toBe(0);
    expect(scrambleDropSlot(rects, 80, 120)).toBe(1);
    expect(scrambleDropSlot(rects, 250, 120)).toBe(2);
    expect(scrambleDropSlot(rects, 20, 180)).toBe(2);
    expect(scrambleDropSlot(rects, 160, 180)).toBe(4);
    expect(scrambleDropSlot(rects, 140, 180)).toBe(3);
    expect(scrambleDropSlot(rects, 300, 240)).toBe(6);
  });
  it('above the first line / below the last → that line; in the gap between lines → the nearer one', () => {
    expect(scrambleDropSlot(rects, 20, 10)).toBe(0);
    expect(scrambleDropSlot(rects, 300, 500)).toBe(6);
    expect(scrambleDropSlot(rects, 20, 150)).toBe(0);
    expect(scrambleDropSlot(rects, 20, 154)).toBe(2);
  });
  it('is stable while the gap follows the finger (the moving tile slides away from the pointer)', () => {
    const others = flow([80, 80, 80], 1000);
    expect(scrambleDropSlot(others, 95, 120)).toBe(1);
    // Re-laid out with the gap at slot 1: B and C shift right.
    const withGap = flow([80, 60, 80, 80], 1000);
    expect(scrambleDropSlot([withGap[0], withGap[2], withGap[3]], 95, 120)).toBe(1);
  });
});

describe('scrambleZone', () => {
  const answer = { left: 0, top: 100, width: 400, height: 72 };
  const pool = { left: 0, top: 200, width: 400, height: 120 };
  it('answer (with slack) wins, then pool, else none', () => {
    expect(scrambleZone(answer, pool, 10, 120)).toBe('answer');
    expect(scrambleZone(answer, pool, 10, 190)).toBe('answer');
    expect(scrambleZone(answer, pool, 10, 250)).toBe('pool');
    expect(scrambleZone(answer, pool, 10, 600)).toBe('none');
    expect(scrambleZone(answer, pool, 900, 120)).toBe('none');
    expect(scrambleZone(null, null, 10, 120)).toBe('none');
    expect(scrambleZone(answer, pool, 10, 190, 0)).toBe('none');
    expect(scrambleZone(answer, pool, 10, 205, 0)).toBe('pool');
  });
});

describe('order edits', () => {
  it('insert / remove / move / nudge', () => {
    expect(scrambleInsertAt([3, 1], 0, 1)).toEqual([3, 0, 1]);
    expect(scrambleInsertAt([3, 1], 0, 9)).toEqual([3, 1, 0]);
    expect(scrambleInsertAt([3, 1], 0, -2)).toEqual([0, 3, 1]);
    expect(scrambleRemoveAt([3, 1, 0], 1)).toEqual([3, 0]);
    const o = [3, 1, 0];
    expect(scrambleRemoveAt(o, 5)).toBe(o);
    expect(scrambleMoveTo([5, 4, 3, 2], 0, 2)).toEqual([4, 3, 5, 2]);
    expect(scrambleMoveTo([5, 4, 3, 2], 3, 0)).toEqual([2, 5, 4, 3]);
    expect(scrambleMoveTo(o, 1, 1)).toBe(o);
    expect(scrambleNudge([5, 4, 3], 1, -1)).toEqual([4, 5, 3]);
    expect(scrambleNudge([5, 4, 3], 1, 1)).toEqual([5, 3, 4]);
    expect(scrambleNudge(o, 0, -1)).toBe(o);
    expect(scrambleNudge(o, 2, 1)).toBe(o);
  });
});

describe('a drag', () => {
  const order = [4, 0, 2, 5];
  it('the others leave the dragged tile out', () => {
    expect(scrambleOthers(order, { from: 'answer', index: 1 })).toEqual([4, 2, 5]);
    expect(scrambleOthers(order, { from: 'pool', tile: 3 })).toEqual(order);
  });
  it('preview: the gap at the slot over the answer, gone over the pool, home elsewhere', () => {
    expect(scramblePreview(order, { from: 'answer', index: 1 }, 'answer', 3)).toEqual([4, 2, 5, 0]);
    expect(scramblePreview(order, { from: 'answer', index: 1 }, 'pool', 3)).toEqual([4, 2, 5]);
    expect(scramblePreview(order, { from: 'answer', index: 1 }, 'none', 3)).toEqual(order);
    expect(scramblePreview(order, { from: 'pool', tile: 3 }, 'answer', 0)).toEqual([3, 4, 0, 2, 5]);
    expect(scramblePreview(order, { from: 'pool', tile: 3 }, 'pool', 0)).toEqual(order);
  });
  it('drop: moved within the answer, inserted from the pool, removed to the pool, nothing elsewhere', () => {
    expect(scrambleDrop(order, { from: 'answer', index: 0 }, 'answer', 2)).toEqual({ order: [0, 2, 4, 5], change: 'moved' });
    expect(scrambleDrop(order, { from: 'answer', index: 1 }, 'answer', 1)).toEqual({ order, change: 'none' });
    expect(scrambleDrop(order, { from: 'pool', tile: 3 }, 'answer', 2)).toEqual({ order: [4, 0, 3, 2, 5], change: 'inserted' });
    expect(scrambleDrop(order, { from: 'pool', tile: 3 }, 'answer', 99)).toEqual({ order: [4, 0, 2, 5, 3], change: 'inserted' });
    expect(scrambleDrop(order, { from: 'answer', index: 2 }, 'pool', 0)).toEqual({ order: [4, 0, 5], change: 'removed' });
    expect(scrambleDrop(order, { from: 'answer', index: 2 }, 'none', 0)).toEqual({ order, change: 'none' });
    expect(scrambleDrop(order, { from: 'pool', tile: 3 }, 'pool', 0)).toEqual({ order, change: 'none' });
    expect(scrambleDrop(order, { from: 'pool', tile: 3 }, 'none', 0)).toEqual({ order, change: 'none' });
    expect(scrambleDrop(order, { from: 'answer', index: 9 }, 'answer', 0)).toEqual({ order, change: 'none' });
  });
  it('a pool drag of a tile already placed only moves it (never a duplicate)', () => {
    expect(scrambleDrop(order, { from: 'pool', tile: 2 }, 'answer', 0)).toEqual({ order: [2, 4, 0, 5], change: 'moved' });
  });
});

describe('words', () => {
  it('the tile label and the move announcement', () => {
    expect(scrambleTileLabel(' 他 ', 1, 6)).toBe('他, 2 of 6');
    expect(scrambleMovedAnnouncement('他', 0, 6)).toBe('他 moved to 1 of 6');
  });
});
