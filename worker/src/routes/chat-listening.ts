/**
 * Listening mode in the chat (docs/CHAT.md "Listening mode"). Mounted under /api after auth.
 *
 *   GET /me/chat-listening                  → { default_on, conversations: [{ conversation_id, on, since, updated_at }] }
 *   PUT /conversations/:id/listening        { on, since? } → the row (member only; 403 / 404)
 *   PUT /profile/chat-listening             { on } → { default_on }  (Settings → Chat)
 *   GET /messages/:id/audio                 the message read aloud (audio/mpeg; made once, then served from R2)
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { ChatMessageError, loadMessageForMember } from '../services/chat/messages';
import { ensureMessageClip } from '../services/chat/message-audio';
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

listening.get('/messages/:id/audio', async (c) => {
  let msg;
  try {
    msg = await loadMessageForMember(c.env.DB, c.req.param('id'), c.get('user').id);
  } catch (err) {
    if (err instanceof ChatMessageError) return c.json({ error: err.message }, err.status as 403 | 404);
    throw err;
  }
  if (msg.deleted_at) return c.json({ error: 'Message deleted' }, 410);
  if (!msg.content.trim() || msg.attachment?.kind === 'voice') return c.json({ error: 'Nothing to read aloud' }, 400);
  try {
    const key = await ensureMessageClip(c.env, { ...msg, attachment: null });
    const object = key ? await c.env.AUDIO_BUCKET.get(key) : null;
    if (!object) return c.json({ error: "Couldn't make the audio" }, 502);
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'audio/mpeg',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Clip-Key': key!,
      },
    });
  } catch (err) {
    console.error('[chat] message audio failed:', err);
    return c.json({ error: "Couldn't make the audio" }, 502);
  }
});

export default listening;
