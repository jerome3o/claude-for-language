import { describe, it, expect } from 'vitest';
import { moveInOrder, isQueueMove } from './queue';

describe('moveInOrder', () => {
  const q = ['a', 'b', 'c', 'd'];

  it('moves to the top and bottom', () => {
    expect(moveInOrder(q, 'c', 'top')).toEqual(['c', 'a', 'b', 'd']);
    expect(moveInOrder(q, 'b', 'bottom')).toEqual(['a', 'c', 'd', 'b']);
  });

  it('nudges one step', () => {
    expect(moveInOrder(q, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveInOrder(q, 'b', 'down')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns the same array when nothing changes', () => {
    expect(moveInOrder(q, 'a', 'top')).toBe(q);
    expect(moveInOrder(q, 'a', 'up')).toBe(q);
    expect(moveInOrder(q, 'd', 'bottom')).toBe(q);
    expect(moveInOrder(q, 'd', 'down')).toBe(q);
    expect(moveInOrder(q, 'zzz', 'top')).toBe(q);
  });

  it('validates a move name', () => {
    expect(isQueueMove('up')).toBe(true);
    expect(isQueueMove('sideways')).toBe(false);
    expect(isQueueMove(3)).toBe(false);
  });
});
