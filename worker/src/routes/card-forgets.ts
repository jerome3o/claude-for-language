/**
 * "Forget this card" (services/card-forgets.ts, shared/scheduler forget events). Mounted under /api
 * after the auth middleware. The signed-in user's OWN cards only.
 *
 *   GET  /me/card-forgets → { forgets: [{ id, card_id, forgotten_at, source }] }  (live, oldest first)
 *   POST /me/card-forgets { items?: [{ id, card_id, forgotten_at?, source? }], card_ids?, note_ids?, card_types?, source? }
 *        → { forgets, added, already, not_found }  (idempotent by client id; note_ids forget every card of
 *          those words, or only `card_types`; the cards' cached state is recomputed; 400 nothing given,
 *          404 when nothing matched)
 *   POST /me/card-forgets/undo { ids } → { undone, forgets }  (Undo; idempotent; states recomputed)
 *
 * `/api/sync/changes` carries the live list as `card_forgets`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { cardsOfNotes } from '../services/card-holds';
import { addForgets, listForgets, MAX_FORGETS_PER_REQUEST, undoForgets, type ForgetInputItem } from '../services/card-forgets';
import { trackServer } from '../services/analytics/server-events';

const cardForgets = new Hono<{ Bindings: Env }>();

const strings = (v: unknown): string[] =>
  (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []).filter((s): s is string => typeof s === 'string' && !!s.trim());

cardForgets.get('/me/card-forgets', async (c) => {
  return c.json({ forgets: await listForgets(c.env.DB, c.get('user').id) });
});

cardForgets.post('/me/card-forgets', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req
    .json<{ items?: ForgetInputItem[]; card_ids?: unknown; note_ids?: unknown; card_types?: unknown; source?: unknown }>()
    .catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Send items, card_ids or note_ids' }, 400);
  const items: ForgetInputItem[] = Array.isArray(body.items) ? body.items.filter(i => i && typeof i.card_id === 'string') : [];
  const source = typeof body.source === 'string' ? body.source : 'other';
  const types = strings(body.card_types);
  const fromNotes = await cardsOfNotes(c.env.DB, userId, strings(body.note_ids), types.length ? types : null);
  for (const cardId of new Set([...strings(body.card_ids), ...fromNotes])) items.push({ card_id: cardId, source });
  if (items.length === 0) return c.json({ error: 'Send items, card_ids or note_ids' }, 400);
  if (items.length > MAX_FORGETS_PER_REQUEST) return c.json({ error: `At most ${MAX_FORGETS_PER_REQUEST} cards at a time` }, 400);
  const result = await addForgets(c.env.DB, userId, items);
  if (result.added.length === 0 && result.already.length === 0) {
    return c.json({ error: 'None of those cards are in your decks', ...result }, 404);
  }
  if (result.added.length && items[0]?.source === 'mcp') {
    void trackServer('card.forget', { source: 'mcp', count: result.added.length }, { env: c.env, userId });
  }
  return c.json(result);
});

cardForgets.post('/me/card-forgets/undo', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null);
  const ids = strings(body?.ids);
  if (ids.length === 0) return c.json({ error: 'Send ids' }, 400);
  if (ids.length > MAX_FORGETS_PER_REQUEST) return c.json({ error: `At most ${MAX_FORGETS_PER_REQUEST} at a time` }, 400);
  return c.json(await undoForgets(c.env.DB, userId, ids));
});

export default cardForgets;
