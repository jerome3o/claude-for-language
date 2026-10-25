/**
 * "Skip handwriting exercises" (services/skip-handwriting.ts). Mounted under /api after auth.
 *
 *   PUT /profile/skip-handwriting { skip_handwriting: boolean } → { skip_handwriting }
 *
 * `/api/auth/me` and `/api/sync/changes` carry the switch as `skip_handwriting`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { setSkipHandwriting } from '../services/skip-handwriting';

const skipHandwriting = new Hono<{ Bindings: Env }>();

skipHandwriting.put('/profile/skip-handwriting', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ skip_handwriting?: unknown }>().catch(() => ({} as { skip_handwriting?: unknown }));
  if (typeof body.skip_handwriting !== 'boolean') return c.json({ error: 'skip_handwriting must be true or false' }, 400);
  return c.json({ skip_handwriting: await setSkipHandwriting(c.env.DB, userId, body.skip_handwriting) });
});

export default skipHandwriting;
