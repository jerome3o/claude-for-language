/**
 * 成语 Idioms (beta; services/idioms.ts, shared/idioms, docs/IDIOMS.md). Mounted under /api
 * after the auth middleware. Entries are global: one per idiom, for every account.
 *
 *   GET  /idioms                 → { starter: IdiomSummary[], more: IdiomSummary[] }
 *   GET  /idioms/:hanzi          → { idiom: IdiomRecord } (status missing when never asked for)
 *   POST /idioms { hanzi, retry? } → get-or-generate: 200 { idiom } when ready / not_idiom,
 *                                  202 { idiom } while generating; 400 + error for text that
 *                                  can't be a 成语; 503 when AI is not configured
 *   POST /admin/idioms/backfill { limit? } → admin: queue starter idioms with no entry yet
 */
import { Hono } from 'hono';
import { idiomKeyProblem, normalizeIdiomHanzi } from '@shared/idioms';
import type { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { backfillStarterIdioms, countIdiomView, getIdiom, idiomsAvailable, listIdioms, requestIdiom } from '../services/idioms';
import { trackServer } from '../services/analytics/server-events';

const idioms = new Hono<{ Bindings: Env }>();

idioms.get('/idioms', async (c) => {
  const limit = Number(c.req.query('limit') ?? '') || undefined;
  return c.json(await listIdioms(c.env.DB, { limit }));
});

idioms.get('/idioms/:hanzi', async (c) => {
  const raw = decodeURIComponent(c.req.param('hanzi'));
  const problem = idiomKeyProblem(raw);
  if (problem) return c.json({ error: problem }, 400);
  const hanzi = normalizeIdiomHanzi(raw);
  const idiom = await getIdiom(c.env.DB, hanzi);
  if (idiom.status === 'ready') c.executionCtx.waitUntil(countIdiomView(c.env.DB, hanzi));
  return c.json({ idiom });
});

idioms.post('/idioms', async (c) => {
  const body = await c.req.json<{ hanzi?: unknown; retry?: unknown }>().catch(() => ({} as { hanzi?: unknown; retry?: unknown }));
  const raw = typeof body.hanzi === 'string' ? body.hanzi : '';
  const problem = idiomKeyProblem(raw);
  if (problem) return c.json({ error: problem }, 400);
  const hanzi = normalizeIdiomHanzi(raw);
  const { record, started } = await requestIdiom(c.env, hanzi, { retry: body.retry === true, waitUntil: (p) => c.executionCtx.waitUntil(p) });
  if (record.status === 'missing' || (record.status === 'failed' && !started && !idiomsAvailable(c.env))) {
    return c.json({ error: 'AI is not configured', idiom: record }, 503);
  }
  if (started) void trackServer('idioms.generate', { status: record.status, retry: body.retry === true }, { env: c.env, userId: c.get('user')?.id ?? null });
  return c.json({ idiom: record }, record.status === 'generating' ? 202 : 200);
});

idioms.post('/admin/idioms/backfill', adminMiddleware, async (c) => {
  const body = await c.req.json<{ limit?: unknown }>().catch(() => ({} as { limit?: unknown }));
  if (!idiomsAvailable(c.env)) return c.json({ error: 'AI is not configured' }, 503);
  const limit = typeof body.limit === 'number' ? body.limit : undefined;
  return c.json(await backfillStarterIdioms(c.env, { limit, waitUntil: (p) => c.executionCtx.waitUntil(p) }));
});

export default idioms;
