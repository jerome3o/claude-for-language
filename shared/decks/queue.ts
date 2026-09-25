/**
 * Moving one deck within a queue order — the one definition used by the
 * student's own Decks tab, the tutor's move on a homework packet and the
 * worker route behind both.
 */

export type QueueMove = 'top' | 'up' | 'down' | 'bottom';

export const QUEUE_MOVES: readonly QueueMove[] = ['top', 'up', 'down', 'bottom'];

export function isQueueMove(value: unknown): value is QueueMove {
  return typeof value === 'string' && (QUEUE_MOVES as readonly string[]).includes(value);
}

/**
 * Pure: the order after moving `id`. The first id is studied first. Returns
 * the input array itself when nothing changes (id missing, already at the
 * edge), so callers can skip a write.
 */
export function moveInOrder(orderedIds: readonly string[], id: string, to: QueueMove): string[] {
  const i = orderedIds.indexOf(id);
  if (i < 0) return orderedIds as string[];
  const target = to === 'top' ? 0 : to === 'bottom' ? orderedIds.length - 1 : to === 'up' ? i - 1 : i + 1;
  if (target === i || target < 0 || target >= orderedIds.length) return orderedIds as string[];
  const next = orderedIds.filter((x) => x !== id);
  next.splice(target, 0, id);
  return next;
}
