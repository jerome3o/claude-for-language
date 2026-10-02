/**
 * Learning tools in the chat (docs/CHAT.md PR 3). Mounted under /api after
 * the auth middleware.
 *
 *   POST   /messages/:id/words                    → { words, source, cached } — the message's word chips,
 *          made now when missing / stale (participants only; idempotent). `words` null = no Chinese in it.
 *   POST   /conversations/:id/flashcards/propose  { message_ids?, since?, focus?: 'correction' }
 *          → { cards: [FlashcardItem + { already_have, source_message_id }] } (nothing saved)
 *   PUT    /messages/:id/correction               { text, note? } — the relationship's tutor, on the other
 *          person's text message → MessageWithSender; the student gets a push
 *   DELETE /messages/:id/correction               same people → MessageWithSender
 *
 * Every stored change → `message_updated` on both people's ChatHubs.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { StructuredCallError } from '../services/structured-call';
import { broadcastMessageUpdated, ChatMessageError } from '../services/chat/messages';
import { clearCorrection, ensureMessageWords, setCorrection } from '../services/chat/learning';
import { parseProposeRequest, proposeChatFlashcards } from '../services/chat/flashcards';
import { notifyChatCorrection } from '../services/chat/notify';
import { background } from './chat-live';

const chatLearning = new Hono<{ Bindings: Env }>();

function fail(c: { json: (body: unknown, status: number) => Response }, err: unknown, fallback: string): Response {
  if (err instanceof ChatMessageError) return c.json({ error: err.message }, err.status);
  if (err instanceof StructuredCallError) {
    console.error(`[chat] ${fallback}:`, err.message);
    return c.json(
      { error: err.retryable ? 'Claude is busy right now — try again' : 'Claude could not make cards from these messages', retryable: err.retryable },
      err.retryable ? 503 : 502,
    );
  }
  console.error(`[chat] ${fallback}:`, err);
  return c.json({ error: fallback }, 500);
}

chatLearning.post('/messages/:id/words', async (c) => {
  const userId = c.get('user').id;
  const messageId = c.req.param('id');
  try {
    const result = await ensureMessageWords(c.env, messageId, userId);
    if (result.changed) await background(c, broadcastMessageUpdated(c.env, messageId));
    return c.json({ words: result.words, source: result.source, cached: result.cached });
  } catch (err) {
    return fail(c, err, 'Failed to split the message into words');
  }
});

chatLearning.post('/conversations/:id/flashcards/propose', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  try {
    const req = parseProposeRequest(body);
    return c.json(await proposeChatFlashcards(c.env, c.req.param('id'), userId, req));
  } catch (err) {
    return fail(c, err, 'Failed to propose flashcards');
  }
});

chatLearning.put('/messages/:id/correction', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  try {
    const result = await setCorrection(c.env.DB, c.req.param('id'), userId, body);
    if (result.changed) {
      const env = c.env;
      await background(c, Promise.all([
        broadcastMessageUpdated(env, result.message.id),
        notifyChatCorrection(env, { message: result.message, studentId: result.studentId, relationshipId: result.relationshipId, tutorId: userId }),
      ]));
    }
    return c.json(result.message);
  } catch (err) {
    return fail(c, err, 'Failed to save the correction');
  }
});

chatLearning.delete('/messages/:id/correction', async (c) => {
  const userId = c.get('user').id;
  try {
    const result = await clearCorrection(c.env.DB, c.req.param('id'), userId);
    if (result.changed) await background(c, broadcastMessageUpdated(c.env, result.message.id));
    return c.json(result.message);
  } catch (err) {
    return fail(c, err, 'Failed to remove the correction');
  }
});

export default chatLearning;
