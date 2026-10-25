/**
 * The graded-reader queue — the order unread stories are offered in ("Up next"),
 * modelled on the deck queue (decks.study_priority, shared/decks/queue.ts).
 *
 * `graded_readers.queue_priority` (migration 0140) is NULL until the learner
 * reorders, so nothing changes for anyone who never does:
 * - readers WITHOUT a priority come first, newest first (ties by id) — today's
 *   rule, and where a newly created / generated story lands;
 * - then readers WITH a priority, higher first (ties newest first, then id).
 * A move or reorder writes a priority on EVERY reader of the queue (first =
 * highest, `queuePriorities`), so the order is exactly what the learner chose;
 * a story created afterwards (priority NULL) lands on top again, unless it asks
 * for the bottom (`bottomQueuePriority`).
 *
 * The queue itself = the unread stories that are ready (studyable). Read ones
 * are never offered again (shared/study/daily-reader.ts), whatever their priority.
 *
 * Pure; the Lab app's port (core/…/DailyReader.kt, ReaderQueue) is parity-tested.
 */
import { moveInOrder, moveToIndex, type QueueMove } from '../decks/queue';

export interface ReaderQueueRow {
  id: string;
  created_at: string;
  /** NULL / undefined = never placed by hand (today's rule: newest first, on top). */
  queue_priority?: number | null;
}

/** Where a new story goes in the queue (create paths' `queue_position` / `position`). */
export type ReaderQueuePlacement = 'top' | 'bottom';

export function isReaderQueuePlacement(value: unknown): value is ReaderQueuePlacement {
  return value === 'top' || value === 'bottom';
}

const hasPriority = (r: ReaderQueueRow): r is ReaderQueueRow & { queue_priority: number } =>
  typeof r.queue_priority === 'number' && Number.isFinite(r.queue_priority);

/** Comparator: negative when `a` comes before `b` in the queue. */
export function compareReaderQueue(a: ReaderQueueRow, b: ReaderQueueRow): number {
  const ap = hasPriority(a);
  const bp = hasPriority(b);
  if (ap !== bp) return ap ? 1 : -1; // never placed by hand → first
  if (ap && bp && a.queue_priority !== b.queue_priority) return b.queue_priority - a.queue_priority;
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1; // newest first
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** The rows in queue order (a new array). */
export function sortReadersForQueue<T extends ReaderQueueRow>(rows: readonly T[]): T[] {
  return [...rows].sort(compareReaderQueue);
}

/** The priority each id gets when the queue is written in this order: first = highest (n … 1). */
export function queuePriorities(orderedIds: readonly string[]): Array<{ id: string; queue_priority: number }> {
  const n = orderedIds.length;
  return orderedIds.map((id, i) => ({ id, queue_priority: n - i }));
}

/**
 * The priority that puts a NEW story at the bottom: below every placed reader
 * (and every unplaced one, which always come first). `priorities` = the
 * account's current values (NULLs ignored).
 */
export function bottomQueuePriority(priorities: ReadonlyArray<number | null | undefined>): number {
  let min = 0;
  for (const p of priorities) if (typeof p === 'number' && Number.isFinite(p) && p < min) min = p;
  return min - 1;
}

/**
 * The whole order after a "reorder" request: `requested` ids first in that
 * order (unknown / duplicate ids ignored), then the rest of `current` as it was.
 */
export function mergeReaderOrder(current: readonly string[], requested: readonly string[]): string[] {
  const known = new Set(current);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of requested) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of current) if (!seen.has(id)) out.push(id);
  return out;
}

/** 1-based place of each id in an ordered list. */
export function queuePositions(orderedIds: readonly string[]): Map<string, number> {
  return new Map(orderedIds.map((id, i) => [id, i + 1]));
}

/** A move in the reader queue: one of the deck queue's moves, or a 1-based place. */
export type ReaderQueueMove = QueueMove | number;

/**
 * The order after moving `id` (`to` = top / up / down / bottom, or a 1-based
 * place, clamped to the list). The same array when nothing changes.
 */
export function moveReaderInQueue(orderedIds: readonly string[], id: string, to: ReaderQueueMove): string[] {
  if (typeof to === 'number') {
    if (!Number.isFinite(to)) return orderedIds as string[];
    const index = Math.min(orderedIds.length - 1, Math.max(0, Math.floor(to) - 1));
    return moveToIndex(orderedIds, id, index);
  }
  return moveInOrder(orderedIds, id, to);
}
