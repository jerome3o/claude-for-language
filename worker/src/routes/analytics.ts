/**
 * Usage analytics (docs/ANALYTICS.md).
 *
 *   POST /analytics/events          { events: [...] } from the web / Lab apps → { accepted, stored, rejected, opted_out, level }
 *   PUT  /profile/analytics         { share_usage: boolean } → { share_usage }
 *
 * Admin only (the usage_* / feature_adoption / … MCP tools call these as the signed-in admin);
 * `:user` / `user=` is an id or an email:
 *   GET /admin/usage/summary?user=&since=
 *   GET /admin/usage/adoption?user=&since=&stale_days=
 *   GET /admin/usage/timeline?user=&date= | from=&to=&limit=&screens=0|1
 *   GET /admin/usage/counts?event=&group_by=day|user|platform|event&since=&user=
 *   GET /admin/usage/errors?user=&since=&limit=
 *   GET /admin/usage/ai?since=&group_by=model|day|user|route|provider&user=
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { resolveUserRef } from '../services/admin/inspect';
import { analyticsLevel } from '../services/analytics/server-events';
import {
  aiUsage,
  eventCounts,
  featureAdoption,
  parseSince,
  recentErrors,
  storeUsageEvents,
  usageSummary,
  userTimeline,
  type AiGroup,
  type CountGroup,
} from '../services/analytics/usage';

const analytics = new Hono<{ Bindings: Env }>();

analytics.post('/analytics/events', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const level = analyticsLevel(c.env);
  const optedOut = Number((user as { analytics_opt_out?: number | null }).analytics_opt_out) === 1;
  const res = await storeUsageEvents(c.env.DB, user.id, body, { now: Date.now(), level, optedOut });
  if ('error' in res) return c.json({ error: res.error }, 400);
  return c.json({ ...res, level });
});

analytics.put('/profile/analytics', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ share_usage?: unknown }>().catch(() => ({} as { share_usage?: unknown }));
  if (typeof body.share_usage !== 'boolean') return c.json({ error: 'share_usage must be a boolean' }, 400);
  await c.env.DB.prepare('UPDATE users SET analytics_opt_out = ? WHERE id = ?').bind(body.share_usage ? 0 : 1, user.id).run();
  if (!body.share_usage) {
    // Opting out also forgets what was collected.
    await c.env.DB.prepare('DELETE FROM usage_events WHERE user_id = ?').bind(user.id).run();
  }
  console.log(JSON.stringify({ type: 'analytics_pref', user_id: user.id, share_usage: body.share_usage }));
  return c.json({ share_usage: body.share_usage });
});

// ─── admin ──────────────────────────────────────────────────────────────
analytics.use('/admin/usage/*', adminMiddleware);

type Ctx = { env: Env; req: { query(name: string): string | undefined } };

/** `user=` → id, or a 404 message; absent → null (everyone). */
async function optionalUser(c: Ctx): Promise<{ id: string | null; email?: string | null } | { notFound: string }> {
  const raw = c.req.query('user')?.trim();
  if (!raw) return { id: null };
  const ref = await resolveUserRef(c.env.DB, raw);
  return ref ? { id: ref.id, email: ref.email } : { notFound: `User not found: ${raw}` };
}

const intParam = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? Math.max(min, Math.min(max, Math.floor(n))) : def;
};

analytics.get('/admin/usage/summary', async (c) => {
  const u = await optionalUser(c);
  if ('notFound' in u) return c.json({ error: u.notFound }, 404);
  if (!u.id) return c.json({ error: 'user is required (an id or an email)' }, 400);
  const since = parseSince(c.req.query('since'), Date.now(), 30);
  return c.json({ user: { id: u.id, email: u.email }, ...(await usageSummary(c.env.DB, u.id, since)) });
});

analytics.get('/admin/usage/adoption', async (c) => {
  const u = await optionalUser(c);
  if ('notFound' in u) return c.json({ error: u.notFound }, 404);
  const now = Date.now();
  const since = parseSince(c.req.query('since'), now, 180);
  const staleDays = intParam(c.req.query('stale_days'), 30, 1, 365);
  return c.json({ user: u.id ? { id: u.id, email: u.email } : null, ...(await featureAdoption(c.env.DB, { userId: u.id, since, now, staleDays })) });
});

analytics.get('/admin/usage/timeline', async (c) => {
  const u = await optionalUser(c);
  if ('notFound' in u) return c.json({ error: u.notFound }, 404);
  if (!u.id) return c.json({ error: 'user is required (an id or an email)' }, 400);
  const now = Date.now();
  const date = c.req.query('date');
  let from: string;
  let to: string;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // A UTC day, widened by `tz_offset` minutes (the user's local day) when given.
    const offset = intParam(c.req.query('tz_offset'), 0, -840, 840);
    const start = Date.parse(`${date}T00:00:00Z`) - offset * 60_000;
    from = new Date(start).toISOString();
    to = new Date(start + 24 * 60 * 60 * 1000).toISOString();
  } else {
    from = parseSince(c.req.query('from'), now, 1);
    to = c.req.query('to') ? parseSince(c.req.query('to'), now, 0) : new Date(now + 60_000).toISOString();
  }
  const limit = intParam(c.req.query('limit'), 500, 1, 2000);
  const includeScreens = c.req.query('screens') !== '0';
  return c.json({ user: { id: u.id, email: u.email }, ...(await userTimeline(c.env.DB, u.id, { from, to, limit, includeScreens })) });
});

analytics.get('/admin/usage/counts', async (c) => {
  const event = c.req.query('event')?.trim();
  if (!event || event.length > 80) return c.json({ error: 'event is required: a name (chat.send) or a prefix (chat. or chat.*)' }, 400);
  const u = await optionalUser(c);
  if ('notFound' in u) return c.json({ error: u.notFound }, 404);
  const groupBy = (['day', 'user', 'platform', 'event'] as const).find((g) => g === c.req.query('group_by')) ?? 'day';
  const since = parseSince(c.req.query('since'), Date.now(), 30);
  return c.json(await eventCounts(c.env.DB, { event, groupBy: groupBy as CountGroup, since, userId: u.id }));
});

analytics.get('/admin/usage/errors', async (c) => {
  const u = await optionalUser(c);
  if ('notFound' in u) return c.json({ error: u.notFound }, 404);
  const since = parseSince(c.req.query('since'), Date.now(), 14);
  const limit = intParam(c.req.query('limit'), 50, 1, 200);
  return c.json(await recentErrors(c.env.DB, { userId: u.id, since, limit }));
});

analytics.get('/admin/usage/ai', async (c) => {
  const u = await optionalUser(c);
  if ('notFound' in u) return c.json({ error: u.notFound }, 404);
  const groupBy = (['model', 'day', 'user', 'route', 'provider'] as const).find((g) => g === c.req.query('group_by')) ?? 'model';
  const since = parseSince(c.req.query('since'), Date.now(), 30);
  return c.json(await aiUsage(c.env.DB, { since, groupBy: groupBy as AiGroup, userId: u.id }));
});

export default analytics;
