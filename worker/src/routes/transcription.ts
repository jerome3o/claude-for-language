/**
 * Live pronunciation transcription (mounted under /api in index.ts; the upload path,
 * POST /api/transcribe, stays in index.ts).
 *
 *   POST /transcribe/live        → a LiveTranscriptionSession: a temporary Soniox key
 *                                  for the signed-in user, or { provider: 'upload' }
 *   GET  /admin/transcription    → admin: which providers are configured (booleans only)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { LiveTranscriptionError, mintLiveSession, transcriptionCapabilities } from '../services/live-transcription';

const transcription = new Hono<{ Bindings: Env }>();

transcription.post('/transcribe/live', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const session = await mintLiveSession(c.env, user.id);
    c.header('Cache-Control', 'no-store');
    return c.json(session);
  } catch (err) {
    const status = err instanceof LiveTranscriptionError ? err.status : 500;
    if (!(err instanceof LiveTranscriptionError)) console.error('[transcribe/live]', err);
    return c.json({ error: 'Live transcription is unavailable right now' }, status as 500);
  }
});

transcription.get('/admin/transcription', adminMiddleware, (c) => c.json(transcriptionCapabilities(c.env)));

export default transcription;
