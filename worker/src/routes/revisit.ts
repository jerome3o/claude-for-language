/**
 * The legacy "Done for good" / "Bring back" marks on mini lessons (services/revisit.ts). Mounted
 * under /api after the auth middleware.
 *
 *   GET  /me/revisit                  → { settings, events }
 *   PUT  /profile/revisit-settings    → the fixed legacy settings (a no-op)
 *   POST /me/revisit-events { events: [{ id, item_kind: lesson|reader, item_id, action: retire|restore, created_at }] }
 *        → { accepted, orphans, invalid }   (idempotent by id)
 *
 * The "revisit later" gaps / "New lessons a day" settings are gone (Oct 2026). Older app builds
 * still GET them and may PUT them from their Settings: both answer 200 with the old defaults
 * (LEGACY_REVISIT_SETTINGS) so those builds keep working, and nothing is stored.
 * `/api/sync/changes` carries every event as `revisit_events` (a short list, sent whole).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import {
  addRevisitEvents,
  listRevisitEvents,
  LEGACY_REVISIT_SETTINGS,
  MAX_REVISIT_EVENTS_PER_REQUEST,
  type RevisitEventInput,
} from '../services/revisit';

const revisit = new Hono<{ Bindings: Env }>();

revisit.get('/me/revisit', async (c) => {
  const events = await listRevisitEvents(c.env.DB, c.get('user').id);
  return c.json({ settings: LEGACY_REVISIT_SETTINGS, events });
});

// Older builds' Settings → "Lessons & readers": accepted and ignored (nothing reads the gaps any more).
revisit.put('/profile/revisit-settings', (c) => c.json(LEGACY_REVISIT_SETTINGS));

revisit.post('/me/revisit-events', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ events?: RevisitEventInput[] }>().catch(() => null);
  if (!body || !Array.isArray(body.events)) return c.json({ error: 'events array is required' }, 400);
  if (body.events.length > MAX_REVISIT_EVENTS_PER_REQUEST) {
    return c.json({ error: `At most ${MAX_REVISIT_EVENTS_PER_REQUEST} events at a time` }, 400);
  }
  return c.json(await addRevisitEvents(c.env.DB, userId, body.events));
});

export default revisit;
