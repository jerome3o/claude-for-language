/**
 * "Forget this card" (migration 0136 `card_forgets`, shared/scheduler forget events; docs/STUDY_SESSION.md
 * "Forget"). A forget puts a card back to NEW: its schedule restarts and every earlier review stops
 * counting for it. The reviews themselves are kept (history, insights, review counts) — the forget
 * is merged into the card's events only when its state is replayed (`withForgetEvents`).
 *
 * Idempotent by client id. Undo marks the forget `undone_at` (it then counts nowhere). Every change
 * recomputes the cached state of the cards it touches, from their events + live forgets.
 */
import {
  computeCardState,
  DEFAULT_DECK_SETTINGS,
  withForgetEvents,
  type CardForget,
  type Rating,
  type ReviewEvent,
} from '../../../shared/scheduler';
import { ownedCards } from './card-holds';

export const MAX_FORGETS_PER_REQUEST = 200;

export interface CardForgetRow extends CardForget {
  source: string | null;
}

export interface ForgetInputItem {
  /** Client id (offline outbox); a retry with the same id is a no-op. */
  id?: string;
  card_id: string;
  forgotten_at?: string;
  source?: string;
}

export interface ForgetResult {
  forgets: CardForgetRow[];
  /** Cards newly forgotten. */
  added: string[];
  /** Forgets already stored (same client id). */
  already: string[];
  /** Card ids that are not the user's. */
  not_found: string[];
}

function chunks<T>(xs: T[], n = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** A client time as ISO, never in the future (a fast clock would make later reviews "before" it). */
function forgetTime(s: unknown): string {
  const now = Date.now();
  if (typeof s !== 'string') return new Date(now).toISOString();
  const ms = Date.parse(s);
  return new Date(Number.isFinite(ms) ? Math.min(ms, now) : now).toISOString();
}

/** Every live (not undone) forget of the user, oldest first. */
export async function listForgets(db: D1Database, userId: string): Promise<CardForgetRow[]> {
  const res = await db
    .prepare('SELECT id, card_id, forgotten_at, source FROM card_forgets WHERE user_id = ? AND undone_at IS NULL ORDER BY forgotten_at ASC, id ASC')
    .bind(userId)
    .all<CardForgetRow>();
  return res.results ?? [];
}

/** Live forgets of these cards (all of the user's when `cardIds` is omitted), by card. */
export async function forgetsByCard(db: D1Database, userId: string, cardIds?: string[]): Promise<Map<string, CardForget[]>> {
  const out = new Map<string, CardForget[]>();
  const add = (rows: CardForget[]) => {
    for (const r of rows) {
      const list = out.get(r.card_id);
      if (list) list.push(r);
      else out.set(r.card_id, [r]);
    }
  };
  if (!cardIds) {
    add(await listForgets(db, userId));
    return out;
  }
  for (const chunk of chunks([...new Set(cardIds)])) {
    const res = await db
      .prepare(`SELECT id, card_id, forgotten_at FROM card_forgets WHERE user_id = ? AND undone_at IS NULL AND card_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(userId, ...chunk)
      .all<CardForget>();
    add(res.results ?? []);
  }
  return out;
}

/** `events` per card with that card's forgets merged in (sorted). Cards with only forgets are added (they are NEW). */
export function mergeForgets(eventsByCard: Map<string, ReviewEvent[]>, forgets: Map<string, CardForget[]>): Map<string, ReviewEvent[]> {
  const out = new Map<string, ReviewEvent[]>();
  for (const [cardId, events] of eventsByCard) out.set(cardId, withForgetEvents(events, forgets.get(cardId) ?? []));
  for (const [cardId, list] of forgets) if (!out.has(cardId)) out.set(cardId, withForgetEvents([], list));
  return out;
}

/** Recompute the cached state of these cards from their review events + live forgets. */
export async function recomputeCards(db: D1Database, userId: string, cardIds: string[]): Promise<number> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return 0;
  const events = new Map<string, ReviewEvent[]>(ids.map(id => [id, []]));
  for (const chunk of chunks(ids, 50)) {
    const rows = await db
      .prepare(`SELECT id, card_id, rating, reviewed_at FROM review_events WHERE user_id = ? AND card_id IN (${chunk.map(() => '?').join(',')}) ORDER BY reviewed_at ASC`)
      .bind(userId, ...chunk)
      .all<{ id: string; card_id: string; rating: number; reviewed_at: string }>();
    for (const e of rows.results ?? []) events.get(e.card_id)?.push({ id: e.id, card_id: e.card_id, rating: e.rating as Rating, reviewed_at: e.reviewed_at });
  }
  const merged = mergeForgets(events, await forgetsByCard(db, userId, ids));
  const update = db.prepare(`
    UPDATE cards SET queue = ?, stability = ?, difficulty = ?, lapses = ?, ease_factor = ?, interval = ?,
      repetitions = ?, next_review_at = ?, due_timestamp = ?, updated_at = datetime('now')
    WHERE id = ?`);
  const statements: D1PreparedStatement[] = [];
  for (const [cardId, list] of merged) {
    const s = computeCardState(list, DEFAULT_DECK_SETTINGS);
    statements.push(update.bind(s.queue, s.stability, s.difficulty, s.lapses, s.ease_factor, s.interval, s.repetitions, s.next_review_at, s.due_timestamp, cardId));
  }
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  return statements.length;
}

/** Forget cards (each must be the user's), then recompute them. */
export async function addForgets(db: D1Database, userId: string, items: ForgetInputItem[]): Promise<ForgetResult> {
  const result: ForgetResult = { forgets: [], added: [], already: [], not_found: [] };
  const owned = await ownedCards(db, userId, items.map(i => i.card_id));
  const ids = items.map(i => i.id).filter((x): x is string => typeof x === 'string' && !!x);
  const existing = new Set<string>();
  for (const chunk of chunks(ids)) {
    const res = await db.prepare(`SELECT id FROM card_forgets WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<{ id: string }>();
    for (const r of res.results ?? []) existing.add(r.id);
  }
  const statements: D1PreparedStatement[] = [];
  const touched: string[] = [];
  for (const item of items) {
    if (!owned.has(item.card_id)) {
      result.not_found.push(item.card_id);
      continue;
    }
    if (item.id && existing.has(item.id)) {
      result.already.push(item.card_id);
      continue;
    }
    const id = item.id || crypto.randomUUID();
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO card_forgets (id, user_id, card_id, forgotten_at, source) VALUES (?, ?, ?, ?, ?)')
        .bind(id, userId, item.card_id, forgetTime(item.forgotten_at), typeof item.source === 'string' ? item.source.slice(0, 40) : null)
    );
    existing.add(id);
    result.added.push(item.card_id);
    touched.push(item.card_id);
  }
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  await recomputeCards(db, userId, touched);
  result.forgets = await listForgets(db, userId);
  return result;
}

/** Undo forgets by id (the user's own; idempotent), then recompute their cards. */
export async function undoForgets(db: D1Database, userId: string, forgetIds: string[]): Promise<{ undone: number; forgets: CardForgetRow[] }> {
  const cards: string[] = [];
  let undone = 0;
  for (const chunk of chunks([...new Set(forgetIds)])) {
    const rows = await db
      .prepare(`SELECT id, card_id FROM card_forgets WHERE user_id = ? AND undone_at IS NULL AND id IN (${chunk.map(() => '?').join(',')})`)
      .bind(userId, ...chunk)
      .all<{ id: string; card_id: string }>();
    const found = rows.results ?? [];
    if (found.length === 0) continue;
    await db
      .prepare(`UPDATE card_forgets SET undone_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND id IN (${found.map(() => '?').join(',')})`)
      .bind(userId, ...found.map(r => r.id))
      .run();
    undone += found.length;
    cards.push(...found.map(r => r.card_id));
  }
  await recomputeCards(db, userId, cards);
  return { undone, forgets: await listForgets(db, userId) };
}
