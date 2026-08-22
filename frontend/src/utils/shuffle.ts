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
 * time, re-rolling if the pool happens to land on a correct order (which
 * would hand the learner the answer).
 */
export function scramblePoolOrder(
  tiles: string[],
  correctOrder: string[],
  altOrders?: string[][],
): number[] {
  const answers = new Set([join(correctOrder), ...(altOrders ?? []).map(join)]);
  let order = shuffledIndexes(tiles.length);
  for (let attempt = 0; attempt < 10; attempt++) {
    const presented = join(order.map(i => tiles[i]));
    if (!answers.has(presented)) return order;
    order = shuffledIndexes(tiles.length);
  }
  // Pathological pool (e.g. identical tiles) — any order gives the answer away
  return order;
}
