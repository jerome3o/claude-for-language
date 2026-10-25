/**
 * The reader queue on the device ("Up next" on the Readers list; shared/reader/queue.ts,
 * docs/STUDY_SESSION.md "Graded readers"). A new order is written to IndexedDB at once —
 * the study session follows it offline — and kept as a pending order until the server has
 * it (PUT /api/readers/reorder): sent at once when online, else before the next reader sync,
 * which re-applies it over the server's rows while it is still pending.
 */
import { moveReaderInQueue, queuePriorities, type ReaderQueueMove } from '@shared/reader/queue';
import { unreadReaderQueue } from '@shared/study/daily-reader';
import { db, type LocalReader } from '../db/database';
import { reorderReaderQueue } from '../api/client';
import { isReaderRead, isStudyableReader } from './reader-study';

const PENDING_KEY = 'reader-queue-pending-v1';

function readPending(): string[] | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const ids = JSON.parse(raw);
    return Array.isArray(ids) && ids.every(x => typeof x === 'string') ? ids : null;
  } catch {
    return null;
  }
}

function writePending(ids: string[] | null): void {
  try {
    if (ids) localStorage.setItem(PENDING_KEY, JSON.stringify(ids));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage unavailable: the order still went to IndexedDB */ }
}

/** The unread, studyable readers in queue order (what "Up next" lists, the session's order). */
export function readerQueueOrder(readers: LocalReader[], exclude: ReadonlySet<string> = new Set()): LocalReader[] {
  return unreadReaderQueue(
    readers
      .filter(r => !exclude.has(r.id))
      .map(r => ({ id: r.id, created_at: r.created_at, queue_priority: r.queue_priority ?? null, studyable: isStudyableReader(r), read: isReaderRead(r), reader: r })),
  ).map(x => x.reader);
}

/** Write an order into IndexedDB: first = highest priority. */
export async function applyReaderOrderLocally(orderedIds: string[]): Promise<void> {
  const rows = queuePriorities(orderedIds);
  await db.transaction('rw', db.readers, async () => {
    for (const r of rows) await db.readers.update(r.id, { queue_priority: r.queue_priority });
  });
}

/** Save a new order (the visible queue, first = offered next): local at once, the server when it can. */
export async function saveReaderOrder(orderedIds: string[]): Promise<{ synced: boolean }> {
  await applyReaderOrderLocally(orderedIds);
  writePending(orderedIds);
  return { synced: await flushPendingReaderOrder() };
}

/** Move one reader within the given order and save it. Returns the new order (the same array when nothing changed). */
export async function moveReaderAndSave(orderedIds: string[], readerId: string, to: ReaderQueueMove): Promise<string[]> {
  const next = moveReaderInQueue(orderedIds, readerId, to);
  if (next !== orderedIds) await saveReaderOrder(next);
  return next;
}

/** Send a pending order to the server (true when nothing is pending afterwards). */
export async function flushPendingReaderOrder(): Promise<boolean> {
  const pending = readPending();
  if (!pending) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    await reorderReaderQueue(pending);
    // Only clear what was sent: a newer order saved meanwhile stays pending.
    if (JSON.stringify(readPending()) === JSON.stringify(pending)) writePending(null);
    return true;
  } catch (err) {
    console.warn('[ReaderQueue] reorder upload failed; kept for the next sync', err);
    return false;
  }
}

/** The order still waiting for the server, if any (re-applied after a reader sync). */
export function pendingReaderOrder(): string[] | null {
  return readPending();
}
