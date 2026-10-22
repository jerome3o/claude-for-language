/**
 * Suspend & snooze (services/card-holds.ts, shared/decks/holds.ts). Mounted under /api after
 * the auth middleware. The signed-in user's OWN cards only — there is no tutor version.
 *
 *   GET  /me/card-holds          → { holds: CardHoldRow[] }  (active: not cleared; snoozes whose
 *                                   date passed more than two days ago are left out)
 *   POST /me/card-holds { items?: [{ id, card_id, kind: suspend|snooze, until?, created_at?, source? }],
 *                         card_ids?, note_ids?, hanzi?, card_types?, kind?, until?, source? }
 *        → { holds, added, already, not_found, invalid }  (idempotent by client id; note_ids / hanzi
 *          hold every card of those words, or only `card_types`; 400 nothing given / bad kind,
 *          404 when nothing matched)
 *   POST /me/card-holds/clear { card_ids?, note_ids?, hanzi?, kind?, cleared_at? }
 *        → { cleared, holds }  (Unsuspend / Wake now; idempotent)
 *   PUT  /profile/bury-siblings { bury_siblings: boolean | null } → { bury_siblings }
 *
 * `/api/sync/changes` carries the active list as `card_holds` and the switch as `bury_siblings`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import {
  addHolds,
  cardsOfNotes,
  clearHolds,
  listActiveHolds,
  MAX_HOLDS_PER_REQUEST,
  notesByHanzi,
  setBurySiblings,
  type HoldInputItem,
} from '../services/card-holds';
import { trackServer } from '../services/analytics/server-events';

const cardHolds = new Hono<{ Bindings: Env }>();

interface HoldBody {
  items?: HoldInputItem[];
  card_ids?: unknown;
  note_ids?: unknown;
  hanzi?: unknown;
  card_types?: unknown;
  kind?: unknown;
  until?: unknown;
  source?: unknown;
  cleared_at?: unknown;
}

const strings = (v: unknown): string[] =>
  (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []).filter((s): s is string => typeof s === 'string' && !!s.trim());

/** card ids named directly + every card of the named notes / hanzi (optionally some card types). */
async function resolveCards(db: D1Database, userId: string, body: HoldBody): Promise<{ cardIds: string[]; notFound: string[] }> {
  const cardIds = strings(body.card_ids);
  const noteIds = strings(body.note_ids);
  const byHanzi = await notesByHanzi(db, userId, strings(body.hanzi));
  const types = strings(body.card_types);
  const fromNotes = await cardsOfNotes(db, userId, [...noteIds, ...byHanzi.noteIds], types.length ? types : null);
  return { cardIds: [...new Set([...cardIds, ...fromNotes])], notFound: byHanzi.notFound };
}

cardHolds.get('/me/card-holds', async (c) => {
  const userId = c.get('user').id;
  return c.json({ holds: await listActiveHolds(c.env.DB, userId) });
});

cardHolds.post('/me/card-holds', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<HoldBody>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Send items, card_ids, note_ids or hanzi' }, 400);
  const items: HoldInputItem[] = Array.isArray(body.items) ? body.items.filter(i => i && typeof i.card_id === 'string') : [];
  const resolved = await resolveCards(c.env.DB, userId, body);
  if (resolved.cardIds.length) {
    const kind = body.kind;
    if (kind !== 'suspend' && kind !== 'snooze') return c.json({ error: "kind must be 'suspend' or 'snooze'" }, 400);
    for (const cardId of resolved.cardIds) {
      items.push({ card_id: cardId, kind, until: typeof body.until === 'string' ? body.until : null, source: typeof body.source === 'string' ? body.source : 'other' });
    }
  }
  if (items.length === 0 && resolved.notFound.length === 0) return c.json({ error: 'Send items, card_ids, note_ids or hanzi' }, 400);
  if (items.length > MAX_HOLDS_PER_REQUEST) return c.json({ error: `At most ${MAX_HOLDS_PER_REQUEST} cards at a time` }, 400);
  const result = await addHolds(c.env.DB, userId, items);
  result.not_found.push(...resolved.notFound);
  if (result.added.length === 0 && result.already.length === 0) {
    const status = result.invalid.length ? 400 : 404;
    return c.json({ error: result.invalid[0]?.error ?? 'None of those cards are in your decks', ...result }, status);
  }
  // The apps track their own taps; agents (MCP) are tracked here.
  const source = items[0]?.source;
  if (result.added.length && source === 'mcp') {
    const kind = items[0].kind === 'snooze' ? 'card.snooze' : 'card.suspend';
    void trackServer(kind, { source: 'mcp', count: result.added.length }, { env: c.env, userId });
  }
  return c.json(result);
});

cardHolds.post('/me/card-holds/clear', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<HoldBody>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Send card_ids, note_ids or hanzi' }, 400);
  const { cardIds } = await resolveCards(c.env.DB, userId, body);
  if (cardIds.length === 0) return c.json({ error: 'Send card_ids, note_ids or hanzi' }, 400);
  if (cardIds.length > MAX_HOLDS_PER_REQUEST * 5) return c.json({ error: 'Too many cards at a time' }, 400);
  const kind = body.kind === 'suspend' || body.kind === 'snooze' ? body.kind : null;
  const cleared = await clearHolds(c.env.DB, userId, cardIds, typeof body.cleared_at === 'string' ? body.cleared_at : null, kind);
  if (cleared && body.source === 'mcp') {
    void trackServer(kind === 'snooze' ? 'card.wake' : 'card.unsuspend', { source: 'mcp', count: cleared }, { env: c.env, userId });
  }
  return c.json({ cleared, holds: await listActiveHolds(c.env.DB, userId) });
});

cardHolds.put('/profile/bury-siblings', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ bury_siblings?: unknown }>().catch(() => ({} as { bury_siblings?: unknown }));
  const v = body.bury_siblings;
  if (v !== null && typeof v !== 'boolean') return c.json({ error: 'bury_siblings must be true, false or null' }, 400);
  return c.json({ bury_siblings: await setBurySiblings(c.env.DB, userId, v) });
});

export default cardHolds;
