/**
 * Lesson illustrations by scene description (services/lesson-images.ts).
 * Mounted under /api after the auth middleware.
 *
 *   POST /lesson-images/ensure          { prompts: string[] (≤ 20), queue?: false } → { images: [{ prompt, status, image_url }] }
 *        status: ready (image_url = R2 key, served by GET /api/audio/<key>) | pending | failed | unavailable,
 *        or missing (not drawn, and queue: false — the editor form looks up without drawing every draft).
 *        Idempotent — a pending prompt is not queued again, so clients poll it while "the picture is on its way".
 *   POST /lesson-images/top-up          the caller's lessons missing a picture get it written in or queued, their
 *        library items and the catalogue samples are pre-drawn (the sync calls this, throttled)
 *   POST /admin/lesson-images/backfill  admin: the same for every account
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { ensureLessonImages, topUpLessonImages } from '../services/lesson-images';

const MAX_PROMPTS_PER_CALL = 20;

const lessonImages = new Hono<{ Bindings: Env }>();

lessonImages.post('/lesson-images/ensure', async (c) => {
  const body = await c.req.json<{ prompts?: unknown; queue?: unknown }>().catch(() => ({} as { prompts?: unknown; queue?: unknown }));
  const prompts = Array.isArray(body.prompts)
    ? body.prompts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];
  if (prompts.length === 0) return c.json({ error: 'prompts is required' }, 400);
  if (prompts.length > MAX_PROMPTS_PER_CALL) return c.json({ error: `At most ${MAX_PROMPTS_PER_CALL} prompts per call` }, 400);
  const images = await ensureLessonImages(c.env, prompts, { queue: body.queue !== false });
  return c.json({ images });
});

lessonImages.post('/lesson-images/top-up', async (c) => {
  const result = await topUpLessonImages(c.env, c.get('user').id);
  return c.json(result);
});

lessonImages.post('/admin/lesson-images/backfill', adminMiddleware, async (c) => {
  const result = await topUpLessonImages(c.env, null);
  return c.json(result);
});

export default lessonImages;
