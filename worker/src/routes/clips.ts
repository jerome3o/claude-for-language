/**
 * 🎬 Clips (experimental; services/clips/, shared/clips, docs/CLIPS.md). Mounted under /api after
 * the auth middleware; every route is scoped to the caller's own clips.
 *
 *   GET    /clips                      → { clips: ClipRecord[] } the feed: unseen first, then by fit (rankClipFeed)
 *   GET    /clips/:id                  → { clip }
 *   POST   /clips { spec, source? }    → 201 { clip, pinyin_fixes } — import a spec (400 + problems)
 *   POST   /clips/generate { topic?, words?, count? (1–3) } → 202 { clips } (generating; clip-queue)
 *   POST   /clips/:id/retry            → 202 { clip } a failed generation again
 *   DELETE /clips/:id                  → { deleted: true }
 *   POST   /clips/events { events }    → { accepted, stored, rejected } (idempotent by id)
 *   POST   /clips/:id/learn-more { action: lesson | reader | podcast | more }
 *          → lesson: 202 { lesson } (200 when it exists / is being written) · reader: 201 { reader }
 *            · podcast: 202 { audio_lesson } · more: 202 { clips }
 */
import { Hono, type Context, type Next } from 'hono';
import type { Env } from '../types';
import { deleteClip, getClip, listClipFeed, recordClipEvents, MAX_CLIP_EVENTS } from '../services/clips/store';
import { importClip, pickGenerateRequest, requestClipGeneration, retryClipGeneration } from '../services/clips/job';
import { requestClipLesson } from '../services/clips/lesson';
import { startClipPodcast, startClipReader, startMoreClips } from '../services/clips/follow-up';

const clips = new Hono<{ Bindings: Env }>();

const signedIn = async (c: Context<{ Bindings: Env }>, next: Next) => (c.get('user') ? next() : c.json({ error: 'Unauthorized' }, 401));
clips.use('/clips', signedIn);
clips.use('/clips/*', signedIn);

const wait = (c: Context<{ Bindings: Env }>) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

clips.get('/clips', async (c) => c.json({ clips: await listClipFeed(c.env.DB, c.get('user').id) }));

clips.post('/clips', async (c) => {
  const body = await c.req.json<{ spec?: unknown; source?: unknown }>().catch(() => null);
  if (!body || body.spec === undefined) return c.json({ error: 'spec is required', problems: ['spec is required'] }, 400);
  const source = body.source === 'agent' ? 'agent' : 'manual';
  const out = await importClip(c.env, c.get('user').id, body.spec, source, wait(c));
  if (!out.ok) return c.json({ error: out.problems![0], problems: out.problems }, 400);
  return c.json({ clip: out.clip, pinyin_fixes: out.pinyin_fixes ?? [] }, 201);
});

clips.post('/clips/generate', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const req = pickGenerateRequest(body);
  if (req.problems.length) return c.json({ error: req.problems[0], problems: req.problems }, 400);
  const via = body.via === 'mcp' ? 'mcp' : 'app';
  const out = await requestClipGeneration(c.env, c.get('user').id, req, { waitUntil: wait(c), via });
  if ('error' in out) return c.json({ error: out.error }, out.status);
  return c.json(out, 202);
});

clips.post('/clips/events', async (c) => {
  const body = await c.req.json<{ events?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.events)) return c.json({ error: 'events array is required' }, 400);
  if (body.events.length > MAX_CLIP_EVENTS) return c.json({ error: `At most ${MAX_CLIP_EVENTS} events at a time` }, 400);
  return c.json(await recordClipEvents(c.env.DB, c.get('user').id, body.events));
});

clips.get('/clips/:id', async (c) => {
  const clip = await getClip(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!clip) return c.json({ error: 'Not found' }, 404);
  return c.json({ clip });
});

clips.delete('/clips/:id', async (c) => {
  const ok = await deleteClip(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.json({ deleted: true });
});

clips.post('/clips/:id/retry', async (c) => {
  const out = await retryClipGeneration(c.env, c.get('user').id, c.req.param('id'), wait(c));
  if ('problem' in out) return c.json({ error: out.problem }, out.status);
  return c.json(out, 202);
});

clips.post('/clips/:id/learn-more', async (c) => {
  const body = await c.req.json<{ action?: unknown }>().catch(() => ({} as { action?: unknown }));
  const userId = c.get('user').id;
  const id = c.req.param('id');
  switch (body.action) {
    case 'lesson': {
      const out = await requestClipLesson(c.env, userId, id, wait(c));
      if ('error' in out) return c.json({ error: out.error }, out.status);
      return c.json({ lesson: out.lesson, started: out.started }, out.started ? 202 : 200);
    }
    case 'reader': {
      const out = await startClipReader(c.env, userId, id);
      if ('error' in out) return c.json({ error: out.error }, out.status);
      return c.json(out, 201);
    }
    case 'podcast': {
      const out = await startClipPodcast(c.env, c.executionCtx, userId, id);
      if ('error' in out) return c.json({ error: out.error }, out.status);
      return c.json(out, 202);
    }
    case 'more': {
      const out = await startMoreClips(c.env, c.executionCtx, userId, id);
      if ('error' in out) return c.json({ error: out.error }, out.status);
      return c.json(out, 202);
    }
    default:
      return c.json({ error: 'action must be lesson, reader, podcast or more' }, 400);
  }
});

export default clips;
