/** Fisher-Yates shuffled index list [0..count). */
export function shuffledIndexes(count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const join = (tiles: string[]) => tiles.join('').replace(/\s/g, '');

/**
 * Display order for a scramble's tile pool. Exercises repeat under FSRS, and
 * authored tile order is often the answer itself — so shuffle at display
 * time. If the shuffle lands on a correct order (which would hand the
 * learner the answer), repair it deterministically by scanning pairwise
 * swaps — random re-rolls have a real failure rate on tiny pools (a
 * two-tile scramble is 50% per roll).
 */
export function scramblePoolOrder(
  tiles: string[],
  correctOrder: string[],
  altOrders?: string[][],
): number[] {
  const answers = new Set([join(correctOrder), ...(altOrders ?? []).map(join)]);
  const isAnswer = (o: number[]) => answers.has(join(o.map(i => tiles[i])));

  const order = shuffledIndexes(tiles.length);
  if (!isAnswer(order)) return order;

  for (let i = 0; i < order.length - 1; i++) {
    for (let j = i + 1; j < order.length; j++) {
      [order[i], order[j]] = [order[j], order[i]];
      if (!isAnswer(order)) return order;
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  // Pathological pool (e.g. identical tiles, or every permutation is an
  // accepted answer) — any order gives the answer away
  return order;
}
