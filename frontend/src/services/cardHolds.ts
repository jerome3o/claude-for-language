/**
 * Suspend & snooze on the device (shared/decks/holds.ts; docs/STUDY_SESSION.md "Suspend & snooze").
 *
 * Offline-first, like "⚡ Study it today":
 *   - a hold / release is written to IndexedDB (`cardHolds`) at once with `pending`, so the
 *     queue, Home and every list see it immediately, offline too;
 *   - it goes up straight away when online (POST /api/me/card-holds with client ids,
 *     POST /api/me/card-holds/clear — both idempotent), else in the next sync;
 *   - every sync replaces the server's rows whole (`card_holds` on /api/sync/changes),
 *     keeping this device's pending rows on top.
 * Which holds are on TODAY is decided with the device's local date (a snooze ends on a date).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { activeHoldFor, holdMessage, releaseMessage, snoozeUntil, type HoldKind, type HoldScope, type SnoozeLength } from '@shared/decks';
import { db, localDateKey, type LocalCardHold } from '../db/database';
import { addHoldsApi, clearHoldsApi, listHoldsApi, type ApiCardHold } from '../api/cardHolds';
import { track } from './analytics';

export { localDateKey } from '../db/database';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** Where a hold was made (analytics `source`). */
export type HoldSource = 'study' | 'card_hub' | 'held_list' | 'deck' | 'leech' | 'other';

/** Rows that count (not waiting to be cleared). */
async function liveRows(): Promise<LocalCardHold[]> {
  return (await db.cardHolds.toArray()).filter((h) => h.pending !== 'clear');
}

/** card id → the hold that keeps it out of study today, live. */
export function useCardHolds(): Map<string, LocalCardHold> {
  const rows = useLiveQuery(() => liveRows(), []) ?? [];
  return activeHoldMap(rows, localDateKey());
}

/** card id → its active hold today (suspend wins; else the snooze ending last). */
export function activeHoldMap(rows: LocalCardHold[], today: string): Map<string, LocalCardHold> {
  const byCard = new Map<string, LocalCardHold[]>();
  for (const r of rows) {
    const list = byCard.get(r.card_id);
    if (list) list.push(r);
    else byCard.set(r.card_id, [r]);
  }
  const out = new Map<string, LocalCardHold>();
  for (const [id, list] of byCard) {
    const h = activeHoldFor(list, today);
    if (h) out.set(id, h);
  }
  return out;
}

export interface HoldOutcome {
  count: number;
  message: string;
}

/**
 * Suspend or snooze cards now (local at once, uploaded when online). `scope` is analytics only —
 * the caller already expanded "all card types of this word" into `cardIds`.
 */
export async function holdCards(
  cardIds: string[],
  kind: HoldKind,
  opts: { length?: SnoozeLength; scope: HoldScope; source: HoldSource }
): Promise<HoldOutcome> {
  const ids = [...new Set(cardIds.filter(Boolean))];
  const now = new Date().toISOString();
  const until = kind === 'snooze' ? snoozeUntil(localDateKey(), opts.length ?? 'tomorrow') : null;
  await db.transaction('rw', db.cardHolds, async () => {
    for (const cardId of ids) {
      // The newest hold on a card is the one that counts (the server clears the older ones too).
      // A pending clear stays (it goes up with its earlier time and can't touch this hold).
      const old = await db.cardHolds.where('card_id').equals(cardId).toArray();
      for (const r of old) if (r.pending !== 'clear') await db.cardHolds.delete(r.id);
      await db.cardHolds.put({ id: crypto.randomUUID(), card_id: cardId, kind, until, created_at: now, pending: 'add' });
    }
  });
  if (kind === 'suspend') track('card.suspend', { scope: opts.scope, count: ids.length, source: opts.source });
  else track('card.snooze', { scope: opts.scope, length: opts.length ?? 'tomorrow', count: ids.length, source: opts.source });
  if (ids.length && online()) void flushPendingHolds().catch(() => undefined);
  return { count: ids.length, message: holdMessage(kind, ids.length, opts.length) };
}

/** Undo of a release: the same holds again (new client ids, same kind and end date). */
export async function restoreHolds(holds: Array<Pick<LocalCardHold, 'card_id' | 'kind' | 'until'>>): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction('rw', db.cardHolds, async () => {
    for (const h of holds) {
      const old = await db.cardHolds.where('card_id').equals(h.card_id).toArray();
      for (const r of old) if (r.pending !== 'clear') await db.cardHolds.delete(r.id);
      await db.cardHolds.put({ id: crypto.randomUUID(), card_id: h.card_id, kind: h.kind, until: h.until, created_at: now, pending: 'add' });
    }
  });
  if (holds.length && online()) void flushPendingHolds().catch(() => undefined);
}

/** Unsuspend / Wake now (local at once). */
export async function releaseCards(cardIds: string[], source: HoldSource): Promise<HoldOutcome> {
  const ids = [...new Set(cardIds.filter(Boolean))];
  const now = new Date().toISOString();
  const today = localDateKey();
  let suspended = 0;
  let snoozed = 0;
  await db.transaction('rw', db.cardHolds, async () => {
    for (const cardId of ids) {
      const rows = await db.cardHolds.where('card_id').equals(cardId).toArray();
      const active = activeHoldFor(rows.filter((r) => r.pending !== 'clear'), today);
      if (active?.kind === 'suspend') suspended++;
      else if (active) snoozed++;
      for (const r of rows) {
        // A pending add not on its way yet is just dropped; one being sent becomes a clear.
        if (r.pending === 'add' && !flushing) await db.cardHolds.delete(r.id);
        else await db.cardHolds.update(r.id, { pending: 'clear', cleared_at: now });
      }
    }
  });
  if (suspended) track('card.unsuspend', { count: suspended, source });
  if (snoozed) track('card.wake', { count: snoozed, source });
  if (ids.length && online()) void flushPendingHolds().catch(() => undefined);
  return { count: ids.length, message: releaseMessage(ids.length) };
}

let flushing: Promise<void> | null = null;
let flushAgain = false;

/** Send every pending add / clear; then take the server's list. Single-flight. */
export function flushPendingHolds(): Promise<void> {
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
  const pending = (await db.cardHolds.toArray()).filter((h) => h.pending);
  if (pending.length === 0) return;
  let latest: ApiCardHold[] | null = null;
  const adds = pending.filter((h) => h.pending === 'add');
  for (let i = 0; i < adds.length; i += 200) {
    const chunk = adds.slice(i, i + 200);
    const r = await addHoldsApi(chunk.map((h) => ({ id: h.id, card_id: h.card_id, kind: h.kind, until: h.until, created_at: h.created_at, source: 'app' })));
    latest = r.holds ?? latest;
    await db.transaction('rw', db.cardHolds, async () => {
      for (const h of chunk) {
        const now = await db.cardHolds.get(h.id);
        if (now?.pending === 'add') await db.cardHolds.update(h.id, { pending: null });
      }
    });
  }
  const clears = pending.filter((h) => h.pending === 'clear');
  // One call per clear time (a clear covers the holds made at or before it).
  const byTime = new Map<string, LocalCardHold[]>();
  for (const h of clears) {
    const at = h.cleared_at ?? new Date().toISOString();
    const list = byTime.get(at);
    if (list) list.push(h);
    else byTime.set(at, [h]);
  }
  for (const [at, rows] of byTime) {
    const r = await clearHoldsApi([...new Set(rows.map((h) => h.card_id))], at);
    latest = r.holds ?? latest;
    for (const h of rows) {
      const now = await db.cardHolds.get(h.id);
      if (now?.pending === 'clear') await db.cardHolds.delete(h.id);
    }
  }
  if (latest) await replaceLocalHolds(latest);
}

/** The server's active list replaces the synced rows; this device's pending rows win for their cards. */
export async function replaceLocalHolds(server: ApiCardHold[]): Promise<void> {
  await db.transaction('rw', db.cardHolds, async () => {
    const local = await db.cardHolds.toArray();
    const pendingCards = new Set(local.filter((h) => h.pending).map((h) => h.card_id));
    const stale = local.filter((h) => !h.pending).map((h) => h.id);
    if (stale.length) await db.cardHolds.bulkDelete(stale);
    const rows: LocalCardHold[] = server
      .filter((h) => !pendingCards.has(h.card_id))
      .map((h) => ({ id: h.id, card_id: h.card_id, kind: h.kind === 'snooze' ? 'snooze' : 'suspend', until: h.until ?? null, created_at: h.created_at, pending: null }));
    if (rows.length) await db.cardHolds.bulkPut(rows);
  });
}

/** Sync: upload what's pending (never throws). The list itself comes with /sync/changes. */
export async function uploadPendingHolds(): Promise<void> {
  try {
    await flushPendingHolds();
  } catch (err) {
    console.error('[Holds] upload failed:', err);
  }
}

/** Full sync: pending up, then the whole list down (never throws). */
export async function syncHolds(): Promise<void> {
  await uploadPendingHolds();
  try {
    const { holds } = await listHoldsApi();
    if (Array.isArray(holds)) await replaceLocalHolds(holds);
  } catch (err) {
    console.error('[Holds] sync failed:', err);
  }
}

/** One row of the "Suspended & snoozed cards" list (built from the device's own cards). */
export interface HeldCardRow {
  card_id: string;
  note_id: string;
  card_type: string;
  hold: LocalCardHold;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

/** Every card held today with its word and deck, from IndexedDB (works offline). */
export async function loadHeldCardRows(): Promise<HeldCardRow[]> {
  const map = activeHoldMap(await liveRows(), localDateKey());
  if (map.size === 0) return [];
  const cards = (await db.cards.bulkGet([...map.keys()])).filter((c): c is NonNullable<typeof c> => !!c);
  const notes = new Map((await db.notes.bulkGet([...new Set(cards.map((c) => c.note_id))])).filter(Boolean).map((n) => [n!.id, n!]));
  const decks = new Map((await db.decks.toArray()).map((d) => [d.id, d]));
  const out: HeldCardRow[] = [];
  for (const c of cards) {
    const n = notes.get(c.note_id);
    const d = n ? decks.get(n.deck_id) : undefined;
    if (!n || !d) continue;
    out.push({ card_id: c.id, note_id: c.note_id, card_type: c.card_type, hold: map.get(c.id)!, hanzi: n.hanzi, pinyin: n.pinyin, english: n.english, deck_id: d.id, deck_name: d.name });
  }
  return out;
}

/** The held list, live. */
export function useHeldCardRows(): HeldCardRow[] | undefined {
  return useLiveQuery(() => loadHeldCardRows(), []);
}
