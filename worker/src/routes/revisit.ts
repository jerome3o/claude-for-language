/**
 * "Revisit later" for mini lessons and graded readers (shared/study/revisit.ts,
 * services/revisit.ts). Mounted under /api after the auth middleware.
 *
 *   GET  /me/revisit                         → { settings, events }
 *   PUT  /profile/revisit-settings { hard_days?, good_days?, easy_days?, growth?, cap_days? }
 *        (null = that default; { reset: true } = all defaults) → RevisitSettingsInfo  (400 + problems)
 *   POST /me/revisit-events { events: [{ id, item_kind: lesson|reader, item_id, action: retire|restore, created_at }] }
 *        → { accepted, orphans, invalid }   (idempotent by id)
 *
 * `/api/auth/me` and `/api/sync/changes` carry the settings as `revisit_settings`;
 * `/api/sync/changes` also carries every event as `revisit_events` (a short list, sent whole).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { pickRevisitSettingsUpdate, DEFAULT_REVISIT_SETTINGS } from '@shared/study/revisit';
import {
  addRevisitEvents,
  getRevisitSettings,
  getRevisitSettingsInfo,
  listRevisitEvents,
  setRevisitSettings,
  MAX_REVISIT_EVENTS_PER_REQUEST,
  type RevisitEventInput,
} from '../services/revisit';

const revisit = new Hono<{ Bindings: Env }>();

revisit.get('/me/revisit', async (c) => {
  const userId = c.get('user').id;
  const [settings, events] = await Promise.all([getRevisitSettingsInfo(c.env.DB, userId), listRevisitEvents(c.env.DB, userId)]);
  return c.json({ settings, events });
});

revisit.put('/profile/revisit-settings', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Send the settings', problems: ['Send the settings'] }, 400);
  const input = body.reset === true
    ? Object.fromEntries(Object.keys(DEFAULT_REVISIT_SETTINGS).map(k => [k, null]))
    : body;
  const { update, problems } = pickRevisitSettingsUpdate(input, await getRevisitSettings(c.env.DB, userId));
  if (problems.length) return c.json({ error: problems.join('; '), problems }, 400);
  return c.json(await setRevisitSettings(c.env.DB, userId, update));
});

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
