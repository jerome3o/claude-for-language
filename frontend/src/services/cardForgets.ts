/**
 * "Forget this card" on the device (shared/scheduler forget events, shared/cards/leech.ts;
 * docs/STUDY_SESSION.md "Forget").
 *
 * Offline-first, like Suspend & snooze:
 *   - a forget is written to IndexedDB (`cardForgets`) at once with `pending: 'add'` and the card is
 *     replayed from its events + forgets right away (it is NEW from now on), offline too;
 *   - it goes up straight away when online (POST /api/me/card-forgets, idempotent by client id),
 *     else in the next sync;
 *   - Undo (right after, from the toast) drops a not-yet-sent forget, or marks a sent one
 *     `pending: 'undo'` (POST …/undo) — the card is replayed again either way;
 *   - every sync replaces the server's rows whole (`card_forgets` on /api/sync/changes), keeping
 *     this device's pending rows, and replays every card whose forgets changed.
 * The review history is never touched: a forget counts for scheduling only.
 */
import { forgetMessage, undoForgetMessage, type ForgetScope } from '@shared/cards/leech';
import { db, type LocalCardForget } from '../db/database';
import { addForgetsApi, listForgetsApi, undoForgetsApi, type ApiCardForget } from '../api/cardForgets';
import { recomputeCardFromEvents } from './review-events';
import { track } from './analytics';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** Where a forget was made (analytics `source`). */
export type ForgetSource = 'study' | 'card_hub' | 'leech' | 'other';

export interface ForgetOutcome {
  /** The new forgets' ids — what Undo takes back. */
  ids: string[];
  cardIds: string[];
  message: string;
}

/** Replay these cards (their events + live forgets) and write their rows. */
async function replay(cardIds: Iterable<string>): Promise<void> {
  // A card with no events and no forget left was never reviewed: NEW already, nothing to write.
  for (const id of new Set(cardIds)) await recomputeCardFromEvents(id);
}

/** Forget cards now: they go back to NEW (local at once, uploaded when online). */
export async function forgetCards(cardIds: string[], opts: { scope: ForgetScope; source: ForgetSource }): Promise<ForgetOutcome> {
  const ids = [...new Set(cardIds.filter(Boolean))];
  const now = new Date().toISOString();
  const rows: LocalCardForget[] = ids.map((cardId) => ({ id: crypto.randomUUID(), card_id: cardId, forgotten_at: now, pending: 'add' }));
  await db.cardForgets.bulkPut(rows);
  await replay(ids);
  track('card.forget', { scope: opts.scope, count: ids.length, source: opts.source, undone: false });
  if (rows.length && online()) void flushPendingForgets().catch(() => undefined);
  return { ids: rows.map((r) => r.id), cardIds: ids, message: forgetMessage(ids.length) };
}

/** Undo (the toast's button): these forgets stop counting; the cards are back as they were. */
export async function undoForget(forgetIds: string[], source: ForgetSource = 'study'): Promise<string> {
  const cards: string[] = [];
  await db.transaction('rw', db.cardForgets, async () => {
    for (const id of forgetIds) {
      const row = await db.cardForgets.get(id);
      if (!row) continue;
      cards.push(row.card_id);
      if (row.pending === 'add' && !flushing) await db.cardForgets.delete(id);
      else await db.cardForgets.update(id, { pending: 'undo' });
    }
  });
  await replay(cards);
  track('card.forget', { count: cards.length, source, undone: true });
  if (online()) void flushPendingForgets().catch(() => undefined);
  return undoForgetMessage(cards.length);
}

let flushing: Promise<void> | null = null;
let flushAgain = false;

/** Send every pending add / undo; then take the server's list. Single-flight. */
export function flushPendingForgets(): Promise<void> {
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

async function doFlush(): Promise<void> {
  const pending = (await db.cardForgets.toArray()).filter((f) => f.pending);
  if (pending.length === 0) return;
  let latest: ApiCardForget[] | null = null;
  // Adds first (an undo of a forget being sent needs the forget on the server to undo).
  const adds = pending.filter((f) => f.pending === 'add');
  for (let i = 0; i < adds.length; i += 200) {
    const chunk = adds.slice(i, i + 200);
    const r = await addForgetsApi(chunk.map((f) => ({ id: f.id, card_id: f.card_id, forgotten_at: f.forgotten_at, source: 'app' })));
    latest = r.forgets ?? latest;
    for (const f of chunk) {
      const now = await db.cardForgets.get(f.id);
      if (now?.pending === 'add') await db.cardForgets.update(f.id, { pending: null });
    }
  }
  const undos = (await db.cardForgets.toArray()).filter((f) => f.pending === 'undo');
  for (let i = 0; i < undos.length; i += 200) {
    const chunk = undos.slice(i, i + 200);
    // An undo of a forget the server never had is fine: it simply undoes nothing.
    const r = await undoForgetsApi(chunk.map((f) => f.id));
    latest = r.forgets ?? latest;
    await db.cardForgets.bulkDelete(chunk.map((f) => f.id));
  }
  if (latest) await replaceLocalForgets(latest);
}

/**
 * The server's live list replaces the synced rows; this device's pending rows stay. Every card
 * whose forgets changed is replayed (a forget made on another device resets it here too).
 */
export async function replaceLocalForgets(server: ApiCardForget[]): Promise<number> {
  const changed = new Set<string>();
  await db.transaction('rw', db.cardForgets, async () => {
    const local = await db.cardForgets.toArray();
    const pendingIds = new Set(local.filter((f) => f.pending).map((f) => f.id));
    const serverIds = new Set(server.map((f) => f.id));
    const stale = local.filter((f) => !f.pending && !serverIds.has(f.id));
    for (const f of stale) changed.add(f.card_id);
    if (stale.length) await db.cardForgets.bulkDelete(stale.map((f) => f.id));
    const known = new Map(local.map((f) => [f.id, f]));
    const rows: LocalCardForget[] = [];
    for (const f of server) {
      if (pendingIds.has(f.id)) continue;
      const had = known.get(f.id);
      if (!had || had.forgotten_at !== f.forgotten_at || had.card_id !== f.card_id) changed.add(f.card_id);
      rows.push({ id: f.id, card_id: f.card_id, forgotten_at: f.forgotten_at, pending: null });
    }
    if (rows.length) await db.cardForgets.bulkPut(rows);
  });
  if (changed.size) await replay(changed);
  return changed.size;
}

/** Sync: upload what's pending (never throws). The list itself comes with /sync/changes. */
export async function uploadPendingForgets(): Promise<void> {
  try {
    await flushPendingForgets();
  } catch (err) {
    console.error('[Forgets] upload failed:', err);
  }
}

/** Full sync: the server's list (never throws). */
export async function syncForgets(): Promise<void> {
  try {
    await uploadPendingForgets();
    const { forgets } = await listForgetsApi();
    await replaceLocalForgets(forgets ?? []);
  } catch (err) {
    console.error('[Forgets] sync failed:', err);
  }
}

/** Live forgets of one note's cards (the history modal / card hub), oldest first. */
export async function forgetsOfCards(cardIds: string[]): Promise<LocalCardForget[]> {
  if (cardIds.length === 0) return [];
  const rows = await db.cardForgets.where('card_id').anyOf(cardIds).toArray();
  return rows.filter((f) => f.pending !== 'undo').sort((a, b) => (a.forgotten_at < b.forgotten_at ? -1 : 1));
}
