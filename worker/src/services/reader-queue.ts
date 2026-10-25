/**
 * The graded-reader queue on the server ("Up next"; rules in shared/reader/queue.ts,
 * docs/STUDY_SESSION.md "Graded readers"). The queue = the account's unread, ready
 * stories with at least one page, in `compareReaderQueue` order; the study session
 * offers its first one. `graded_readers.queue_priority` (migration 0140) is NULL until
 * a move / reorder writes one on every reader of the queue.
 */
import {
  bottomQueuePriority,
  mergeReaderOrder,
  moveReaderInQueue,
  queuePriorities,
  sortReadersForQueue,
  type ReaderQueueMove,
  type ReaderQueuePlacement,
} from '@shared/reader/queue';

export interface ReaderQueueEntry {
  id: string;
  created_at: string;
  queue_priority: number | null;
  title_chinese: string;
  title_english: string;
  difficulty_level: string;
  topic: string | null;
  folder_id: string | null;
  page_count: number;
}

export interface ReaderQueueState {
  /** The unread, ready stories in queue order (first = offered next). */
  queue: ReaderQueueEntry[];
}

/** The account's reader queue, in order. */
export async function getReaderQueue(db: D1Database, userId: string): Promise<ReaderQueueState> {
  const rows = await db.prepare(`
    SELECT r.id, r.created_at, r.queue_priority, r.title_chinese, r.title_english, r.difficulty_level,
           r.topic, r.folder_id,
           (SELECT COUNT(*) FROM reader_pages p WHERE p.reader_id = r.id) AS page_count
    FROM graded_readers r
    WHERE r.user_id = ? AND r.status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM reader_review_events e WHERE e.reader_id = r.id AND e.user_id = r.user_id)
  `).bind(userId).all<ReaderQueueEntry>();
  const studyable = rows.results.filter(r => Number(r.page_count) > 0);
  return { queue: sortReadersForQueue(studyable) };
}

/** `queue_position` (1-based) for each reader in the queue; others are absent. */
export async function readerQueuePositions(db: D1Database, userId: string): Promise<Map<string, number>> {
  const { queue } = await getReaderQueue(db, userId);
  return new Map(queue.map((r, i) => [r.id, i + 1]));
}

/** Readers decorated with `queue_position` (null = not in the queue: read, not ready, or no pages). */
export function withQueuePositions<T extends { id: string }>(readers: T[], positions: Map<string, number>): Array<T & { queue_position: number | null }> {
  return readers.map(r => ({ ...r, queue_position: positions.get(r.id) ?? null }));
}

/** Write the queue in this order (first = highest priority). */
async function writeOrder(db: D1Database, userId: string, orderedIds: string[]): Promise<void> {
  const rows = queuePriorities(orderedIds);
  if (rows.length === 0) return;
  const stmt = db.prepare('UPDATE graded_readers SET queue_priority = ? WHERE id = ? AND user_id = ?');
  await db.batch(rows.map(r => stmt.bind(r.queue_priority, r.id, userId)));
}

export class ReaderQueueError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

export interface ReaderQueueResult {
  queue: ReaderQueueEntry[];
  changed: boolean;
}

function withPriorities(queue: ReaderQueueEntry[], order: string[]): ReaderQueueEntry[] {
  const byId = new Map(queue.map(r => [r.id, r]));
  const pr = new Map(queuePriorities(order).map(p => [p.id, p.queue_priority]));
  return order.map(id => ({ ...byId.get(id)!, queue_priority: pr.get(id) ?? null }));
}

/**
 * Move one reader within the queue (`to` = top / up / down / bottom or a 1-based place).
 * 404 when the reader isn't the caller's, 409 when it isn't in the queue (read, not ready).
 */
export async function moveReaderInAccountQueue(
  db: D1Database,
  userId: string,
  readerId: string,
  to: ReaderQueueMove,
): Promise<ReaderQueueResult & { queue_position: number }> {
  const owned = await db.prepare('SELECT id FROM graded_readers WHERE id = ? AND user_id = ?').bind(readerId, userId).first<{ id: string }>();
  if (!owned) throw new ReaderQueueError('Reader not found', 404);
  const { queue } = await getReaderQueue(db, userId);
  const current = queue.map(r => r.id);
  if (!current.includes(readerId)) {
    throw new ReaderQueueError('This story is not in the queue (it was read, or it is not ready yet)', 409);
  }
  const next = moveReaderInQueue(current, readerId, to);
  const allPlaced = queue.every(r => r.queue_priority !== null);
  const changed = next !== current;
  // Write when the order changed, or when it was still implicit (so the order is now explicit).
  if (changed || !allPlaced) await writeOrder(db, userId, next);
  const written = withPriorities(queue, next);
  return { queue: written, changed, queue_position: next.indexOf(readerId) + 1 };
}

/** Set the order: `readerIds` first (in that order; ids not in the queue ignored), the rest after as they were. */
export async function reorderAccountReaderQueue(db: D1Database, userId: string, readerIds: string[]): Promise<ReaderQueueResult & { ignored: string[] }> {
  const { queue } = await getReaderQueue(db, userId);
  const current = queue.map(r => r.id);
  const known = new Set(current);
  const ignored = [...new Set(readerIds.filter(id => !known.has(id)))];
  const next = mergeReaderOrder(current, readerIds);
  const changed = next.some((id, i) => id !== current[i]);
  await writeOrder(db, userId, next);
  return { queue: withPriorities(queue, next), changed, ignored };
}

/**
 * Place a NEW story: 'top' (the default) leaves it unplaced — unplaced stories come
 * first, newest first, so it is on top; 'bottom' gives it a priority below every other.
 */
export async function placeNewReader(db: D1Database, userId: string, readerId: string, placement: ReaderQueuePlacement | undefined): Promise<number | null> {
  if (placement !== 'bottom') return null;
  const rows = await db.prepare('SELECT queue_priority FROM graded_readers WHERE user_id = ? AND id != ? AND queue_priority IS NOT NULL')
    .bind(userId, readerId).all<{ queue_priority: number }>();
  const priority = bottomQueuePriority(rows.results.map(r => r.queue_priority));
  await db.prepare('UPDATE graded_readers SET queue_priority = ? WHERE id = ? AND user_id = ?').bind(priority, readerId, userId).run();
  return priority;
}
