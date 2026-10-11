/**
 * AI word tags (services/word-tags-ai.ts, shared/cards/word-tags-ai.ts). Mounted under /api
 * after the auth middleware, before the /api/notes/:id routes.
 *
 *   GET  /notes/word-tags/backfill            → WordTagsProgress (the caller's notes)
 *   POST /notes/word-tags/backfill { limit? } → { queued, ...WordTagsProgress }
 *        Queues up to `limit` (default 200, ≤ 1000) of the caller's untagged notes now. The
 *        sync does this by itself (≤ 200 an hour); this is the on-demand path (MCP
 *        `backfill_word_tags`). 503 when no model is configured.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { modelAvailable } from '../services/card-check';
import { backfillWordTagsNow, wordTagsProgress } from '../services/word-tags-ai';
import { WORD_TAGS_BACKFILL_PER_HOUR } from '@shared/cards/word-tags-ai';

const wordTags = new Hono<{ Bindings: Env }>();

wordTags.get('/notes/word-tags/backfill', async (c) => {
  return c.json(await wordTagsProgress(c.env.DB, c.get('user').id));
});

wordTags.post('/notes/word-tags/backfill', async (c) => {
  const userId = c.get('user').id;
  if (!modelAvailable(c.env)) return c.json({ error: 'AI word tags are not available on this server (no API key).' }, 503);
  const body = await c.req.json<{ limit?: unknown }>().catch(() => ({} as { limit?: unknown }));
  const limit = body.limit === undefined || body.limit === null ? WORD_TAGS_BACKFILL_PER_HOUR : Number(body.limit);
  if (!Number.isFinite(limit) || limit < 1) return c.json({ error: 'limit must be a positive number' }, 400);
  return c.json(await backfillWordTagsNow(c.env, userId, limit, c.executionCtx));
});

export default wordTags;
