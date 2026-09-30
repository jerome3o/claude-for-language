/**
 * Live pronunciation transcription (mounted under /api in index.ts; the upload path,
 * POST /api/transcribe, stays in index.ts).
 *
 *   POST /transcribe             → the upload path: one take (multipart `file`) → { text,
 *                                  language, provider }. Whisper, then Soniox async, then
 *                                  Gemini (services/take-transcription.ts). The device sends
 *                                  `live_error` (why its live stream gave nothing) and
 *                                  `client`, logged so a broken live path is visible.
 *   POST /transcribe/live        → a LiveTranscriptionSession: a temporary Soniox key
 *                                  for the signed-in user, or { provider: 'upload' }
 *   GET  /admin/transcription    → admin: which providers are configured (booleans only)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { LiveTranscriptionError, mintLiveSession, transcriptionCapabilities } from '../services/live-transcription';
import { cleanClientNote, takeProviders, TakeTranscriptionError, transcribeTake } from '../services/take-transcription';

const transcription = new Hono<{ Bindings: Env }>();

/** Most a pronunciation take can be: minutes of 16 kHz WAV, far more than one word. */
const MAX_TAKE_BYTES = 12 * 1024 * 1024;

transcription.post('/transcribe', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const formData = await c.req.formData();
  const file = formData.get('file') as unknown;
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return c.json({ error: 'file is required' }, 400);
  }
  const blob = file as Blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: 'The recording is empty' }, 400);
  if (bytes.byteLength > MAX_TAKE_BYTES) return c.json({ error: 'The recording is too long' }, 413);
  const mime = (blob.type || 'audio/webm').split(';')[0].trim();

  // Why the device's live stream gave nothing — the only place that reason reaches the server.
  const liveError = cleanClientNote(formData.get('live_error'));
  const client = cleanClientNote(formData.get('client'), 20) ?? 'unknown';
  if (liveError) console.warn(`[transcribe] live stream failed on ${client}: ${liveError}`);

  try {
    const result = await transcribeTake(takeProviders(c.env), bytes, mime);
    return c.json({ text: result.text, language: result.language, provider: result.provider });
  } catch (err) {
    const failed = err instanceof TakeTranscriptionError ? err.failed : [];
    console.error(`[transcribe] every provider failed (${client}, ${mime}, ${bytes.byteLength} B): ${err instanceof Error ? err.message : String(err)}`);
    return c.json({
      error: "Couldn't transcribe the recording",
      providers: failed.map((f) => f.provider),
    }, 502);
  }
});

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
