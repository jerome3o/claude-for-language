/**
 * The ＋ Add tab's look-ups (docs/ADD_TAB.md). Mounted under /api after the auth middleware; both
 * in the cost guard's `ai` group (middleware/cost-guard.ts).
 *
 *   POST /ocr/words            raw JPEG / PNG / WebP body (or multipart `picture`), ≤ 4 MB
 *        → { lines: [{ text, box: [ymin, xmin, ymax, xmax] (0–1000) | null, main }], ms }
 *          the Chinese lines on the photo, most prominent first (shared/add/add.ts orderOcrLines);
 *          the photo is read once and never stored.
 *        400 no photo · 413 too big · 415 not a JPEG / PNG / WebP · 503 { retryable } busy / not set up
 *   POST /ai/english-words     { text }  (English or toneless pinyin, ≤ 120 characters)
 *        → { words: [{ hanzi, pinyin, english, note? }] }   up to 4, most common first
 *   POST /custom-lessons/generate   { prompt }  → 202 { request }  "🎯 Mini lesson": Claude writes it into
 *        his own Mini Lessons in the background (services/lesson-requests.ts; cost guard `jobs`)
 *   GET  /custom-lessons/requests/:id → { request: { id, prompt, status: generating|ready|failed, lesson_id, error } }
 *
 * E2E_TEST_MODE answers with the stand-ins in services/add-words.ts first.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { OCR_MAX_BYTES } from '@shared/add/add';
import { readPictureBytes } from '../services/profile';
import { sniffImage } from '../services/picture-hunt';
import {
  ENGLISH_INPUT_MAX,
  OcrError,
  englishToChineseWords,
  fakeEnglishWords,
  fakeOcrLines,
  readChineseFromPhoto,
} from '../services/add-words';
import { StructuredCallError } from '../services/structured-call';
import { LESSON_REQUEST_PROMPT_MAX, getLessonRequest, startLessonRequest } from '../services/lesson-requests';

const add = new Hono<{ Bindings: Env }>();

function userId(c: { get: (key: 'user') => { id: string } | undefined }): string | null {
  return c.get('user')?.id ?? null;
}

add.post('/ocr/words', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const tooBig = 'That photo is too big (4 MB at most)';
  const declared = Number(c.req.header('Content-Length') || 0);
  if (declared > OCR_MAX_BYTES + 64 * 1024) return c.json({ error: tooBig }, 413);
  let bytes: Uint8Array | null = null;
  try {
    bytes = await readPictureBytes(c.req.raw);
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length === 0) return c.json({ error: 'No photo was sent' }, 400);
  if (bytes.length > OCR_MAX_BYTES) return c.json({ error: tooBig }, 413);
  const sniffed = sniffImage(bytes);
  if (!sniffed) return c.json({ error: 'Send a JPEG, PNG or WebP photo' }, 415);

  const started = Date.now();
  if (c.env.E2E_TEST_MODE === 'true') {
    const lines = fakeOcrLines();
    return c.json({ lines, ms: Date.now() - started });
  }
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'Reading photos isn’t set up on this server.', retryable: false }, 503);
  try {
    const { lines } = await readChineseFromPhoto(c.env.GEMINI_API_KEY, bytes, sniffed.mime);
    const ms = Date.now() - started;
    return c.json({ lines, ms });
  } catch (error) {
    const retryable = !(error instanceof OcrError) || error.retryable;
    console.error('[ocr] reading a photo failed:', error instanceof Error ? error.message : error);
    return c.json({ error: retryable ? 'Couldn’t read the photo right now — try again.' : 'Couldn’t read that photo.', retryable }, retryable ? 503 : 502);
  }
});

add.post('/ai/english-words', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);
  if ([...text].length > ENGLISH_INPUT_MAX) return c.json({ error: `At most ${ENGLISH_INPUT_MAX} characters` }, 400);
  if (c.env.E2E_TEST_MODE === 'true') return c.json({ words: fakeEnglishWords(text) });
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'Looking up words needs Claude, which isn’t set up on this server.', retryable: false }, 503);
  try {
    const words = await englishToChineseWords(c.env.ANTHROPIC_API_KEY, text);
    return c.json({ words });
  } catch (error) {
    console.error('[add] english words failed:', error instanceof Error ? error.message : error);
    const retryable = !(error instanceof StructuredCallError) || error.retryable;
    return c.json({ error: retryable ? 'No answer right now — try again in a moment.' : 'No Chinese word found for that.', retryable }, retryable ? 503 : 502);
  }
});

add.post('/custom-lessons/generate', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const body = (await c.req.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return c.json({ error: 'prompt is required' }, 400);
  if ([...prompt].length > LESSON_REQUEST_PROMPT_MAX) return c.json({ error: `At most ${LESSON_REQUEST_PROMPT_MAX} characters` }, 400);
  if (c.env.E2E_TEST_MODE !== 'true' && !c.env.ANTHROPIC_API_KEY) return c.json({ error: 'Writing lessons needs Claude, which isn’t set up on this server.', retryable: false }, 503);
  const request = await startLessonRequest(c.env, uid, prompt, { waitUntil: (p) => c.executionCtx.waitUntil(p) });
  return c.json({ request }, 202);
});

add.get('/custom-lessons/requests/:id', async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: 'Unauthorized' }, 401);
  const request = await getLessonRequest(c.env.DB, uid, c.req.param('id'));
  if (!request) return c.json({ error: 'Not found' }, 404);
  return c.json({ request });
});

export default add;
