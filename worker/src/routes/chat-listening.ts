/**
 * Listening mode in the chat (docs/CHAT.md "Listening mode"). Mounted under /api after auth.
 *
 *   GET /me/chat-listening                  → { default_on, conversations: [{ conversation_id, on, since, updated_at }] }
 *   PUT /conversations/:id/listening        { on, since? } → the row (member only; 403 / 404)
 *   PUT /profile/chat-listening             { on } → { default_on }  (Settings → Chat)
 *   GET /me/chat-clips[?per_conversation=]  → { clips: [{ message_id, conversation_id, text, voice_id, speed }] } the other
 *                                           person's newest Chinese messages per chat, in the voice I hear them (prefetch via
 *                                           POST /api/practice/tts — the one chat TTS path, shared/chats/voice.ts)
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { chatClipsFor } from '../services/chat/message-audio';
import { LISTENING_PREFETCH_COUNT } from '@shared/chats/listening';
import { getListeningState, ListeningError, parseListeningBody, setConversationListening, setListeningDefault } from '../services/chat/listening';

const listening = new Hono<{ Bindings: Env }>();

listening.get('/me/chat-listening', async (c) => {
  return c.json(await getListeningState(c.env.DB, c.get('user').id));
});

listening.put('/conversations/:id/listening', async (c) => {
  const parsed = parseListeningBody(await c.req.json().catch(() => null));
  if (typeof parsed === 'string') return c.json({ error: parsed }, 400);
  try {
    return c.json(await setConversationListening(c.env.DB, c.get('user').id, c.req.param('id'), parsed));
  } catch (err) {
    if (err instanceof ListeningError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

listening.put('/profile/chat-listening', async (c) => {
  const body = await c.req.json<{ on?: unknown }>().catch(() => null);
  if (!body || typeof body.on !== 'boolean') return c.json({ error: '`on` must be true or false' }, 400);
  return c.json({ default_on: await setListeningDefault(c.env.DB, c.get('user').id, body.on) });
});

listening.get('/me/chat-clips', async (c) => {
  const n = Math.min(50, Math.max(1, Number(c.req.query('per_conversation')) || LISTENING_PREFETCH_COUNT));
  return c.json({ clips: await chatClipsFor(c.env, c.get('user').id, n) });
});

export default listening;
