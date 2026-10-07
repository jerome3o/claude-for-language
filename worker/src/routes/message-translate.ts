/**
 * Translate a chat message (the message menu's Translate, the word-by-word view).
 *
 *   POST /messages/:id/translate           → { translation }  — fast: one short Haiku reply,
 *                                            cached on the message for both people
 *   POST /messages/:id/translate-segmented → { translation, segmentation } — the word-by-word
 *                                            breakdown too (older Lab builds use it for Translate)
 *
 * Either participant of an active relationship. Failures are 503 `{ error, retryable: true }`
 * (try again) or 502 `{ error, retryable: false }` (declined) with a readable reason —
 * never a raw parser error. See services/translation.ts for why the two are separate calls.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { StructuredCallError } from '../services/structured-call';

type Ctx = { Bindings: Env };
const app = new Hono<Ctx>();

interface MessageRow {
  id: string;
  conversation_id: string;
  content: string;
  translation: string | null;
  segmentation: string | null;
}

class TranslateAccessError extends Error {
  constructor(message: string, public readonly status: 404 | 403) {
    super(message);
  }
}

async function loadTranslatableMessage(db: D1Database, messageId: string, userId: string): Promise<MessageRow> {
  const message = await db
    .prepare('SELECT id, conversation_id, content, translation, segmentation FROM messages WHERE id = ?')
    .bind(messageId)
    .first<MessageRow>();
  if (!message) throw new TranslateAccessError('Message not found', 404);
  const conv = await db
    .prepare('SELECT relationship_id FROM conversations WHERE id = ?')
    .bind(message.conversation_id)
    .first<{ relationship_id: string }>();
  if (!conv) throw new TranslateAccessError('Conversation not found', 404);
  const rel = await db
    .prepare('SELECT id FROM tutor_relationships WHERE id = ? AND status = ? AND (requester_id = ? OR recipient_id = ?)')
    .bind(conv.relationship_id, 'active', userId, userId)
    .first();
  if (!rel) throw new TranslateAccessError('Access denied', 403);
  return message;
}

function parseStoredSegmentation(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { chunks?: unknown };
    return parsed && Array.isArray(parsed.chunks) && parsed.chunks.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function failure(error: unknown): { body: { error: string; retryable: boolean }; status: 502 | 503 } {
  if (error instanceof StructuredCallError && !error.retryable) {
    return { body: { error: 'Claude could not translate this message.', retryable: false }, status: 502 };
  }
  return { body: { error: 'Translation is busy right now — try again in a moment.', retryable: true }, status: 503 };
}

app.post('/messages/:id/translate', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');
  try {
    const message = await loadTranslatableMessage(c.env.DB, msgId, userId);
    if (message.translation) return c.json({ translation: message.translation });
    if (!message.content.trim()) return c.json({ error: 'Nothing to translate' }, 400);
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured', retryable: false }, 503);
    const { translateChineseText } = await import('../services/translation');
    const translation = await translateChineseText(c.env.ANTHROPIC_API_KEY, message.content);
    // Only while the text is still the one translated (an edit clears it and re-translates).
    await c.env.DB
      .prepare('UPDATE messages SET translation = ? WHERE id = ? AND content = ? AND translation IS NULL')
      .bind(translation, msgId, message.content)
      .run();
    return c.json({ translation });
  } catch (error) {
    if (error instanceof TranslateAccessError) return c.json({ error: error.message }, error.status);
    console.error('[translate] message translation failed:', error instanceof Error ? error.message : error);
    const f = failure(error);
    return c.json(f.body, f.status);
  }
});

app.post('/messages/:id/translate-segmented', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');
  try {
    const message = await loadTranslatableMessage(c.env.DB, msgId, userId);
    const stored = parseStoredSegmentation(message.segmentation);
    if (message.translation && stored) return c.json({ translation: message.translation, segmentation: stored });
    if (!message.content.trim()) return c.json({ error: 'Nothing to translate' }, 400);
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured', retryable: false }, 503);
    const { translateAndSegment } = await import('../services/translation');
    const result = await translateAndSegment(c.env.ANTHROPIC_API_KEY, message.content, { knownTranslation: message.translation });
    await c.env.DB
      .prepare('UPDATE messages SET translation = COALESCE(translation, ?), segmentation = ? WHERE id = ? AND content = ?')
      .bind(result.translation, result.segmented ? JSON.stringify(result.segmentation) : message.segmentation, msgId, message.content)
      .run();
    return c.json({ translation: result.translation, segmentation: result.segmentation });
  } catch (error) {
    if (error instanceof TranslateAccessError) return c.json({ error: error.message }, error.status);
    console.error('[translate] word-by-word translation failed:', error instanceof Error ? error.message : error);
    const f = failure(error);
    return c.json(f.body, f.status);
  }
});

export default app;
