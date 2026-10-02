/**
 * Rich chat messages (docs/CHAT.md PR 2). Mounted under /api after the auth
 * middleware.
 *
 *   POST   /conversations/:id/media?kind=image|voice&client_id=&caption=&reply_to_message_id=&duration_ms=
 *          raw body → 201 MessageWithSender (200 for a repeated client_id)
 *   GET    /chat-media/:messageId          the bytes (participants only), private immutable cache
 *   PATCH  /messages/:id                   { content } — sender only: text, or a photo's caption
 *   DELETE /messages/:id                   sender only: soft delete + the R2 object removed
 *   POST   /messages/:id/pin               { pinned } — either participant
 *   POST   /messages/:id/reactions         { emoji } — toggle; bumps updated_at
 *
 * Every change → `message_updated` on both people's ChatHubs.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { findMessageByClientId, normalizeClientId, sendMessage, toggleReaction } from '../services/conversations';
import { generateId } from '../services/cards';
import { getConversationParticipants } from '../services/chat/reads';
import {
  CAPTION_MAX,
  ChatMediaError,
  chatMediaKey,
  inspectUpload,
  maxBytesFor,
  parseDurationMs,
  parseMediaKind,
} from '../services/chat/media';
import {
  broadcastMessageUpdated,
  ChatMessageError,
  deleteMessage,
  editMessage,
  loadMessageForMember,
  pinMessage,
  touchMessage,
  enrichMessageInBackground,
  transcribeVoiceMessage,
} from '../services/chat/messages';
import { background, deliverSentMessage } from './chat-live';
import { stripJpegMetadata } from './picture-hunts';

const chatMessages = new Hono<{ Bindings: Env }>();

function fail(c: { json: (body: unknown, status: number) => Response }, err: unknown, fallback: string): Response {
  if (err instanceof ChatMessageError || err instanceof ChatMediaError) return c.json({ error: err.message }, err.status);
  console.error(`[chat] ${fallback}:`, err);
  return c.json({ error: fallback }, 500);
}

// ---------- Photo / voice upload ----------

chatMessages.post('/conversations/:id/media', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const kind = parseMediaKind(c.req.query('kind'));
  if (!kind) return c.json({ error: 'kind must be image or voice' }, 400);

  const rawClientId = c.req.query('client_id');
  const clientId = normalizeClientId(rawClientId);
  if (rawClientId !== undefined && rawClientId !== '' && !clientId) {
    return c.json({ error: 'client_id must be 1–100 characters of letters, digits, _ . : -' }, 400);
  }
  const caption = c.req.query('caption') ?? '';
  if (caption.length > CAPTION_MAX) return c.json({ error: `A caption can be at most ${CAPTION_MAX} characters` }, 400);
  const replyTo = c.req.query('reply_to_message_id') || undefined;
  const rawDuration = c.req.query('duration_ms');
  const durationMs = kind === 'voice' ? parseDurationMs(rawDuration) : null;
  if (kind === 'voice' && !durationMs) return c.json({ error: 'duration_ms is required for a voice message (1 ms to 5 minutes)' }, 400);

  const participants = await getConversationParticipants(c.env.DB, convId);
  if (!participants) return c.json({ error: 'Conversation not found' }, 404);
  if (!participants.user_ids.includes(userId) || participants.status !== 'active') return c.json({ error: 'Access denied' }, 403);

  // A repeat of an upload that already went through: the same message, nothing stored or sent again.
  if (clientId) {
    const existing = await findMessageByClientId(c.env.DB, userId, clientId);
    if (existing) return c.json({ ...existing, client_id: clientId }, 200);
  }

  const declaredLength = Number(c.req.header('Content-Length') || 0);
  if (declaredLength > maxBytesFor(kind)) {
    return c.json({ error: kind === 'image' ? 'Photos can be at most 8 MB' : 'Voice messages can be at most 10 MB' }, 413);
  }

  let bytes: Uint8Array = new Uint8Array(await c.req.arrayBuffer());
  let inspected;
  try {
    inspected = inspectUpload(kind, bytes, { durationMs, contentType: c.req.header('Content-Type') });
  } catch (err) {
    return fail(c, err, 'Upload failed');
  }
  const attachment = inspected.attachment;
  if (attachment.kind === 'image' && attachment.mime === 'image/jpeg') {
    // EXIF / GPS never leave the sender's phone through us.
    bytes = stripJpegMetadata(bytes);
    attachment.bytes = bytes.length;
  }

  const id = generateId();
  const key = chatMediaKey(convId, id, inspected.ext);
  try {
    await c.env.AUDIO_BUCKET.put(key, bytes, { httpMetadata: { contentType: attachment.mime } });
  } catch (err) {
    console.error('[chat] media upload to R2 failed:', err);
    return c.json({ error: 'Could not store the file, try again' }, 503);
  }

  let sent;
  try {
    sent = await sendMessage(c.env.DB, convId, userId, caption, replyTo, { clientId, id, attachment: { ...attachment, key } });
  } catch (err) {
    await c.env.AUDIO_BUCKET.delete(key).catch(() => undefined);
    const message = err instanceof Error ? err.message : 'Failed to send message';
    return c.json({ error: message }, 400);
  }
  const { duplicate, ...message } = sent;
  if (duplicate) {
    // Another upload with this client_id won the race: drop our copy of the file.
    await c.env.AUDIO_BUCKET.delete(key).catch(() => undefined);
    return c.json(message, 200);
  }

  const env = c.env;
  await background(c, deliverSentMessage(env, convId, userId, message));
  if (attachment.kind === 'voice') {
    const audio = bytes;
    // Transcript → translation + the transcript's word chips.
    await background(c, transcribeVoiceMessage(env, id, audio, attachment.mime));
  } else if (caption) {
    // A photo's Chinese caption gets a translation and word chips like a text message.
    await background(c, enrichMessageInBackground(env, id, caption));
  }
  return c.json(message, 201);
});

// ---------- Serving media ----------

chatMessages.get('/chat-media/:messageId', async (c) => {
  const userId = c.get('user').id;
  try {
    const msg = await loadMessageForMember(c.env.DB, c.req.param('messageId'), userId);
    if (msg.deleted_at || !msg.attachment) return c.json({ error: 'Not found' }, 404);
    const object = await c.env.AUDIO_BUCKET.get(msg.attachment.key);
    if (!object) return c.json({ error: 'Not found' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', msg.attachment.mime || object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'private, max-age=31536000, immutable');
    if (typeof object.size === 'number') headers.set('Content-Length', String(object.size));
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    return new Response(object.body, { headers });
  } catch (err) {
    return fail(c, err, 'Failed to load the file');
  }
});

// ---------- Edit / delete / pin / reactions ----------

chatMessages.patch('/messages/:id', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ content?: unknown }>().catch(() => ({} as { content?: unknown }));
  try {
    const message = await editMessage(c.env.DB, c.req.param('id'), userId, body.content);
    const env = c.env;
    await background(c, (async () => {
      await broadcastMessageUpdated(env, message.id);
      // Re-translated and re-split into words (the old ones were cleared with the edit).
      await enrichMessageInBackground(env, message.id, message.content);
    })());
    return c.json(message);
  } catch (err) {
    return fail(c, err, 'Failed to edit the message');
  }
});

chatMessages.delete('/messages/:id', async (c) => {
  const userId = c.get('user').id;
  try {
    const { message, mediaKey, changed } = await deleteMessage(c.env.DB, c.req.param('id'), userId);
    if (mediaKey) {
      try {
        await c.env.AUDIO_BUCKET.delete(mediaKey);
      } catch (err) {
        console.error('[chat] deleting chat media failed:', mediaKey, err);
      }
    }
    if (changed) await background(c, broadcastMessageUpdated(c.env, message.id));
    return c.json(message);
  } catch (err) {
    return fail(c, err, 'Failed to delete the message');
  }
});

chatMessages.post('/messages/:id/pin', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ pinned?: unknown }>().catch(() => ({} as { pinned?: unknown }));
  try {
    const { message, changed } = await pinMessage(c.env.DB, c.req.param('id'), userId, body.pinned);
    if (changed) await background(c, broadcastMessageUpdated(c.env, message.id));
    return c.json(message);
  } catch (err) {
    return fail(c, err, 'Failed to pin the message');
  }
});

// Toggle a reaction on a message
chatMessages.post('/messages/:id/reactions', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');
  const body = await c.req.json<{ emoji?: unknown }>().catch(() => ({} as { emoji?: unknown }));
  const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
  if (!emoji || emoji.length > 32) return c.json({ error: 'Emoji is required' }, 400);
  try {
    const msg = await loadMessageForMember(c.env.DB, msgId, userId);
    if (msg.deleted_at) return c.json({ error: 'This message was deleted' }, 409);
    const result = await toggleReaction(c.env.DB, msgId, userId, emoji);
    await touchMessage(c.env.DB, msgId);
    await background(c, broadcastMessageUpdated(c.env, msgId));
    return c.json(result);
  } catch (err) {
    return fail(c, err, 'Failed to toggle reaction');
  }
});

export default chatMessages;
