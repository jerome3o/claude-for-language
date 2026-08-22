import { describe, it, expect } from 'vitest';
import { shuffledIndexes, scramblePoolOrder } from './shuffle';

describe('shuffledIndexes', () => {
  it('returns a permutation of 0..count', () => {
    const order = shuffledIndexes(6);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('scramblePoolOrder', () => {
  it('never presents the tiles in a correct order', () => {
    const tiles = ['我', '把', '手机', '放在', '包里', '了'];
    // Authored tiles ARE the answer here (common in agent-authored lessons)
    for (let run = 0; run < 50; run++) {
      const order = scramblePoolOrder(tiles, tiles);
      const presented = order.map(i => tiles[i]).join('');
      expect(presented).not.toBe(tiles.join(''));
    }
  });

  it('avoids alt orders too, even on two-tile scrambles', () => {
    const tiles = ['你好', '吗'];
    // With 2 tiles, half of naive shuffles would land on the answer
    for (let run = 0; run < 50; run++) {
      const order = scramblePoolOrder(tiles, ['你好', '吗']);
      expect(order.map(i => tiles[i])).toEqual(['吗', '你好']);
    }
  });

  it('still returns a valid permutation for pathological pools', () => {
    // Identical tiles: every order is "the answer" — must not loop forever
    const tiles = ['好', '好'];
    const order = scramblePoolOrder(tiles, ['好', '好']);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1]);
  });
});
