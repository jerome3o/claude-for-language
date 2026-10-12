/**
 * "Up next" on the device (shared/decks/up-next.ts; docs/STUDY_SESSION.md "Up next").
 *
 * The account's ordered list of chosen notes, introduced first within the daily budget.
 * Offline-first, like the ⚡ pocket (services/studyBumps.ts):
 *   - every change (add / reorder / remove) is applied to IndexedDB (`upNext`) at once, so
 *     the queue, Home and the page follow immediately, offline too, and queued in
 *     `upNextOps` (in order; each idempotent — adds carry client ids, a reorder sends the
 *     whole order, a remove is by note);
 *   - the ops go up straight away when online, else in the next sync; a 4xx drops the op
 *     (the server's list then wins), a network error keeps it for later;
 *   - the server's list (`up_next` on /api/sync/changes, or the answer to the last op)
 *     replaces the rows whenever no change is waiting.
 * Which notes are done / how many new cards are left is derived from the local cards.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { canAddToUpNext, insertIntoOrder, normalizeUpNextSource, upNextAddedMessage, upNextIndex, type UpNextSource } from '@shared/decks';
import { db, type LocalUpNext, type LocalUpNextOp } from '../db/database';
import { addUpNextApi, listUpNextApi, removeUpNextApi, reorderUpNextApi, UpNextApiError, type ApiUpNext } from '../api/upNext';
import { track } from './analytics';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** The list in order (live). */
export function useUpNextRows(): LocalUpNext[] | undefined {
  return useLiveQuery(() => db.upNext.orderBy('position').toArray(), []);
}

/** note id → its NEW / all card counts on this device. */
export async function localCardCounts(noteIds: string[]): Promise<Map<string, { fresh: number; total: number }>> {
  const out = new Map<string, { fresh: number; total: number }>();
  if (noteIds.length === 0) return out;
  const cards = await db.cards.where('note_id').anyOf(noteIds).toArray();
  for (const c of cards) {
    const v = out.get(c.note_id) ?? { fresh: 0, total: 0 };
    v.total++;
    if (c.queue === 0) v.fresh++;
    out.set(c.note_id, v);
  }
  return out;
}

async function writeOrder(order: string[], extra: Map<string, LocalUpNext> = new Map()): Promise<void> {
  const rows = new Map((await db.upNext.toArray()).map((r) => [r.note_id, r]));
  for (const [id, r] of extra) rows.set(id, r);
  const next: LocalUpNext[] = [];
  order.forEach((noteId, position) => {
    const r = rows.get(noteId);
    if (r) next.push({ ...r, position });
  });
  await db.upNext.clear();
  if (next.length) await db.upNext.bulkPut(next);
}

export interface UpNextOutcome {
  added: string[];
  already: string[];
  /** Notes with every card already studied (offer ⚡ Study it today). */
  noNewCards: string[];
  message: string;
}

/**
 * Put notes on the list at `position` ('top' | 'bottom' | 0-based index; default bottom).
 * A note already on the list moves there when a position is given.
 */
export async function addToUpNext(
  noteIds: string[],
  opts: { position?: 'top' | 'bottom' | number; source: UpNextSource }
): Promise<UpNextOutcome> {
  const ids = [...new Set(noteIds.filter(Boolean))];
  const source = normalizeUpNextSource(opts.source);
  const explicit = opts.position !== undefined && opts.position !== 'bottom';
  const counts = await localCardCounts(ids);
  const notes = await db.notes.bulkGet(ids);
  const hanzi = new Map(ids.map((id, i) => [id, notes[i]?.hanzi ?? '']));
  const current = (await db.upNext.orderBy('position').toArray()).map((r) => r.note_id);
  const onList = new Set(current);
  const added: string[] = [];
  const already: string[] = [];
  const noNew: string[] = [];
  const place: string[] = [];
  const fresh = new Map<string, LocalUpNext>();
  const items: Array<{ id: string; note_id: string; created_at: string }> = [];
  const now = new Date().toISOString();
  for (const id of ids) {
    if (onList.has(id)) {
      already.push(id);
      if (explicit) place.push(id);
      continue;
    }
    const c = counts.get(id);
    if (!canAddToUpNext(c ? Array.from({ length: c.total }, (_, i) => ({ queue: i < c.fresh ? 0 : 1 })) : [])) {
      noNew.push(id);
      continue;
    }
    const row: LocalUpNext = { note_id: id, id: crypto.randomUUID(), position: 0, created_at: now, source, added_by_name: null };
    fresh.set(id, row);
    items.push({ id: row.id, note_id: id, created_at: now });
    added.push(id);
    place.push(id);
  }
  if (place.length) {
    const index = explicit ? upNextIndex(opts.position, current.length) : null;
    await db.transaction('rw', db.upNext, db.upNextOps, async () => {
      await writeOrder(insertIntoOrder(current, place, index), fresh);
      if (items.length) {
        await db.upNextOps.add({ kind: 'add', body: { items, position: explicit ? upNextIndex(opts.position, current.length) : 'bottom', source }, created_at: now });
      }
      if (explicit && already.length) {
        const order = (await db.upNext.orderBy('position').toArray()).map((r) => r.note_id);
        await db.upNextOps.add({ kind: 'order', body: { note_ids: order }, created_at: now });
      }
    });
    if (online()) void flushUpNext().catch(() => undefined);
  }
  if (added.length) track('study.up_next_added', { source, count: added.length, already: already.length });
  const names = (list: string[]) => list.map((id) => hanzi.get(id) ?? '').filter(Boolean);
  return {
    added,
    already,
    noNewCards: noNew,
    message: explicit && already.length && !added.length ? 'Moved' : upNextAddedMessage(names(added), already.length, noNew.length),
  };
}

/** A new order (drag / ↑ top); the whole order goes up. */
export async function reorderUpNext(order: string[], how: 'drag' | 'top' | 'bottom'): Promise<void> {
  await db.transaction('rw', db.upNext, db.upNextOps, async () => {
    await writeOrder(order);
    await db.upNextOps.add({ kind: 'order', body: { note_ids: order }, created_at: new Date().toISOString() });
  });
  track('study.up_next_moved', { how });
  if (online()) void flushUpNext().catch(() => undefined);
}

/** Take a note off the list (the note is kept). Returns what Undo needs. */
export async function removeFromUpNext(noteId: string, source: UpNextSource = 'up_next_page'): Promise<{ index: number } | null> {
  const current = (await db.upNext.orderBy('position').toArray()).map((r) => r.note_id);
  const index = current.indexOf(noteId);
  if (index < 0) return null;
  await db.transaction('rw', db.upNext, db.upNextOps, async () => {
    await writeOrder(current.filter((id) => id !== noteId));
    await db.upNextOps.add({ kind: 'remove', body: { note_id: noteId }, created_at: new Date().toISOString() });
  });
  track('study.up_next_removed', { source: normalizeUpNextSource(source) });
  if (online()) void flushUpNext().catch(() => undefined);
  return { index };
}

let flushing: Promise<void> | null = null;
let flushAgain = false;

/** Send every waiting change in order, then take the server's list. Single-flight. */
export function flushUpNext(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    do {
      flushAgain = false;
      await doFlush();
    } while (flushAgain);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function sendOp(op: LocalUpNextOp): Promise<ApiUpNext[]> {
  const b = op.body as Record<string, unknown>;
  if (op.kind === 'add') {
    return (await addUpNextApi({ items: b.items as never, position: b.position as never, source: b.source as string })).up_next;
  }
  if (op.kind === 'order') return (await reorderUpNextApi(b.note_ids as string[])).up_next;
  return (await removeUpNextApi(b.note_id as string)).up_next;
}

async function doFlush(): Promise<void> {
  const ops = await db.upNextOps.orderBy('seq').toArray();
  if (ops.length === 0) return;
  let latest: ApiUpNext[] | null = null;
  for (const op of ops) {
    try {
      latest = await sendOp(op);
    } catch (err) {
      // Refused for good (4xx): drop it, the server's list wins. Otherwise try again later.
      if (!(err instanceof UpNextApiError && err.status >= 400 && err.status < 500)) throw err;
    }
    await db.upNextOps.delete(op.seq!);
  }
  if (latest) await replaceLocalUpNext(latest);
}

/** The server's list replaces the rows — only when no change made here is still waiting. */
export async function replaceLocalUpNext(server: ApiUpNext[]): Promise<void> {
  await db.transaction('rw', db.upNext, db.upNextOps, async () => {
    if ((await db.upNextOps.count()) > 0) return;
    await db.upNext.clear();
    const rows: LocalUpNext[] = [...server]
      .sort((a, b) => a.position - b.position)
      .map((e, i) => ({ note_id: e.note_id, id: e.id, position: i, created_at: e.created_at, source: e.source, added_by_name: e.added_by_name ?? null }));
    if (rows.length) await db.upNext.bulkPut(rows);
  });
}

/** Sync: upload what's waiting (never throws). The list itself comes with /sync/changes. */
export async function uploadPendingUpNext(): Promise<void> {
  try {
    await flushUpNext();
  } catch (err) {
    console.error('[UpNext] upload failed:', err);
  }
}

/** Full sync: waiting changes up, then the whole list down (never throws). */
export async function syncUpNext(): Promise<void> {
  await uploadPendingUpNext();
  try {
    const { up_next } = await listUpNextApi();
    if (Array.isArray(up_next)) await replaceLocalUpNext(up_next);
  } catch (err) {
    console.error('[UpNext] sync failed:', err);
  }
}
