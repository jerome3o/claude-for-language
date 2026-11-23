/**
 * Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening", services/audio-lesson-feedback.ts).
 * Mounted under /api after the auth middleware; the caller's own lessons only. No model call (no cost guard).
 *
 *   POST /audio-lessons/:id/feedback  { events: AudioLessonFeedbackEvent[] } (≤ 100)
 *        → { accepted, stored, rejected }  idempotent by client id; 404 when the lesson isn't mine
 *   GET  /me/audio-lesson-feedback?lesson_id=&since=&limit=
 *        → { lessons: [{ lesson, events, summary }], cursor, more }  (the lesson with the newest press first)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { addAudioLessonFeedback, listAudioLessonFeedback, MAX_FEEDBACK_EVENTS_PER_REQUEST } from '../services/audio-lesson-feedback';
import { trackServer } from '../services/analytics/server-events';

const routes = new Hono<{ Bindings: Env }>();

routes.post('/audio-lessons/:id/feedback', async (c) => {
  const uid = c.get('user')?.id;
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const lessonId = c.req.param('id');
  const body = await c.req.json<{ events?: unknown }>().catch(() => null);
  const events = Array.isArray(body?.events) ? body!.events : null;
  if (!events || events.length === 0) return c.json({ error: 'Send events' }, 400);
  if (events.length > MAX_FEEDBACK_EVENTS_PER_REQUEST) return c.json({ error: `At most ${MAX_FEEDBACK_EVENTS_PER_REQUEST} events at a time` }, 400);
  const owned = await c.env.DB.prepare('SELECT id FROM audio_lessons WHERE id = ? AND user_id = ?').bind(lessonId, uid).first<{ id: string }>();
  if (!owned) return c.json({ error: 'Audio lesson not found' }, 404);
  const result = await addAudioLessonFeedback(c.env.DB, uid, lessonId, events);
  if (result.stored > 0) void trackServer('server.audio_lesson_feedback', { count: result.stored }, { env: c.env, userId: uid });
  return c.json(result);
});

routes.get('/me/audio-lesson-feedback', async (c) => {
  const uid = c.get('user')?.id;
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const limitRaw = Number(c.req.query('limit'));
  return c.json(await listAudioLessonFeedback(c.env.DB, uid, {
    lessonId: c.req.query('lesson_id') || null,
    since: c.req.query('since') || null,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
  }));
});

export default routes;
