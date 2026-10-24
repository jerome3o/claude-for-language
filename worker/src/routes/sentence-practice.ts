/**
 * Practice per example sentence (services/sentence-practice.ts, shared/study/sentenceHistory.ts;
 * docs/STUDY_SESSION.md "Sentence practice history"). Mounted under /api after the auth middleware.
 *
 *   GET  /me/sentence-practice?since=&note_id= → { events, cursor, more }  (received after `since`, oldest first, ≤ 1000)
 *   POST /me/sentence-practice { events: [{ id, note_id, sentence_key, kind: attempt|hide|unhide, mode?, result?, reason?, at }] }
 *        → { accepted, stored, rejected }  (idempotent by client id; the user's own notes only; ≤ 200)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { addSentenceEvents, listSentenceEvents, MAX_SENTENCE_EVENTS_PER_REQUEST } from '../services/sentence-practice';
import { trackServer } from '../services/analytics/server-events';

const sentencePractice = new Hono<{ Bindings: Env }>();

sentencePractice.get('/me/sentence-practice', async (c) => {
  const since = c.req.query('since') || null;
  const noteId = c.req.query('note_id') || null;
  return c.json(await listSentenceEvents(c.env.DB, c.get('user').id, since, noteId));
});

sentencePractice.post('/me/sentence-practice', async (c) => {
  const body = await c.req.json<{ events?: unknown }>().catch(() => null);
  const events = Array.isArray(body?.events) ? body!.events : null;
  if (!events || events.length === 0) return c.json({ error: 'Send events' }, 400);
  if (events.length > MAX_SENTENCE_EVENTS_PER_REQUEST) return c.json({ error: `At most ${MAX_SENTENCE_EVENTS_PER_REQUEST} events at a time` }, 400);
  const result = await addSentenceEvents(c.env.DB, c.get('user').id, events);
  if (result.stored > 0) void trackServer('server.sentence_practice_events', { count: result.stored }, { env: c.env, userId: c.get('user').id }).catch(() => {});
  return c.json(result);
});

export default sentencePractice;
