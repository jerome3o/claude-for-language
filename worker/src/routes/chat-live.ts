/**
 * Tutor–student chat delivery (docs/CHAT.md §2). Mounted under /api after the
 * auth middleware; the live WebSocket (`mountLiveSocket`) is registered before
 * it and authenticated by a one-minute `live` ticket instead.
 *
 *   GET    /conversations/:id/messages[?since=]   messages + read_state { me, other }
 *   POST   /conversations/:id/messages            { content, reply_to_message_id?, client_id? } → 201 (200 for a repeated client_id)
 *   POST   /conversations/:id/read                { up_to? } → { conversation_id, last_read_at, unread }
 *   GET    /me/chat-inbox[?since=]                unread messages to me + conversations with unread
 *   GET    /me/chats                              the Chats tab: every conversation, last message, unread, newest first
 *   POST   /push/devices                          { token, platform?, app?, device_label? } → { id }
 *   DELETE /push/devices                          { token }
 *   POST   /live/ticket                           → { ticket, ws_path }
 *   GET    /api/live/ws?ticket=                   WebSocket into the caller's ChatHub (before auth)
 */

import { Hono } from 'hono';
import type { Env, MessageWithSender, SendMessageRequest } from '../types';
import * as db from '../db/queries';
import { getConversationById, getMessages, normalizeClientId, sendMessage } from '../services/conversations';
import {
  countUnread,
  getChatInbox,
  getChatList,
  getConversationParticipants,
  getReadState,
  markConversationRead,
  normalizeTimestamp,
  otherParticipant,
} from '../services/chat/reads';
import { notifyChatRead, notifyNewChatMessage } from '../services/chat/notify';
import { deleteDeviceToken, DeviceTokenError, saveDeviceToken } from '../services/push/devices';
import { createPurposeTicket, verifyPurposeTicket } from '../services/chat/ticket';
import { enrichMessageInBackground } from '../services/chat/messages';
import { pregenerateMessageClip } from '../services/chat/message-audio';

const chat = new Hono<{ Bindings: Env }>();

/** `c.executionCtx` throws outside a real request (tests): then work is awaited inline. */
export async function background(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }, work: Promise<unknown>): Promise<void> {
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  if (ctx) ctx.waitUntil(work);
  else await work;
}

// ---------- Messages ----------

chat.get('/conversations/:id/messages', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const since = c.req.query('since');
  try {
    const result = await getMessages(c.env.DB, convId, userId, since);
    const participants = await getConversationParticipants(c.env.DB, convId);
    const other = participants ? otherParticipant(participants, userId) : null;
    const read_state = await getReadState(c.env.DB, convId, userId, other);
    return c.json({ ...result, read_state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get messages';
    return c.json({ error: message }, 400);
  }
});

chat.post('/conversations/:id/messages', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const body = await c.req.json<SendMessageRequest>().catch(() => ({} as SendMessageRequest));
  const { content, reply_to_message_id } = body;

  if (typeof content !== 'string' || content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
  }
  const clientId = normalizeClientId(body.client_id);
  if (body.client_id !== undefined && body.client_id !== null && !clientId) {
    return c.json({ error: 'client_id must be 1–100 characters of letters, digits, _ . : -' }, 400);
  }

  try {
    const sent = await sendMessage(c.env.DB, convId, userId, content, reply_to_message_id, { clientId });
    const { duplicate, ...message } = sent;
    // A repeat of a send that already went through: same message, nobody notified again.
    if (duplicate) return c.json(message, 200);

    const env = c.env;
    await background(c, deliverSentMessage(env, convId, userId, message));
    // Chinese messages: translation + word chips (non-blocking); `message_updated` when they land.
    await background(c, enrichMessageInBackground(env, message.id, content));
    // Its read-aloud clip, ready before anyone taps (listening mode, Read aloud).
    await background(c, pregenerateMessageClip(env, message));

    return c.json(message, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send message';
    return c.json({ error: message }, 400);
  }
});

/**
 * After a message (text, photo or voice) is stored: the sender has read
 * everything before it, the recipient is notified (live, FCM, Web Push, the
 * bell, e-mail, ntfy). Never throws.
 */
export async function deliverSentMessage(env: Env, convId: string, userId: string, message: MessageWithSender): Promise<void> {
  try {
    // Writing a message means I've read everything before it.
    const unreadBefore = await countUnread(env.DB, convId, userId);
    const read = await markConversationRead(env.DB, convId, userId, message.created_at);
    const participants = await getConversationParticipants(env.DB, convId);
    if (!participants) return;
    const work: Promise<unknown>[] = [notifyNewChatMessage(env, message, { id: convId, relationship_id: participants.relationship_id })];
    if (unreadBefore > 0 && read.moved && read.last_read_at) {
      await db.markNotificationsReadByConversation(env.DB, userId, convId);
      work.push(notifyChatRead(env, userId, participants, read.last_read_at));
    }
    await Promise.all(work);
  } catch (err) {
    console.error('[Notifications] Failed to send message notification:', err);
  }
}

// ---------- Read markers ----------

chat.post('/conversations/:id/read', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const body = await c.req.json<{ up_to?: unknown }>().catch(() => ({} as { up_to?: unknown }));
  let upTo: string | null = null;
  if (body.up_to !== undefined && body.up_to !== null) {
    upTo = normalizeTimestamp(body.up_to);
    if (!upTo) return c.json({ error: 'up_to must be a message created_at' }, 400);
  }
  const conv = await getConversationById(c.env.DB, convId, userId);
  if (!conv) return c.json({ error: 'Conversation not found' }, 404);

  const read = await markConversationRead(c.env.DB, convId, userId, upTo);
  // The bell: chat notifications for this conversation are read once it is.
  if (read.unread === 0) await db.markNotificationsReadByConversation(c.env.DB, userId, convId);
  if (read.moved && read.last_read_at) {
    const participants = await getConversationParticipants(c.env.DB, convId);
    if (participants) await background(c, notifyChatRead(c.env, userId, participants, read.last_read_at));
  }
  return c.json({ conversation_id: read.conversation_id, last_read_at: read.last_read_at, unread: read.unread });
});

chat.get('/me/chat-inbox', async (c) => {
  const raw = c.req.query('since');
  let since: string | null = null;
  if (raw) {
    since = normalizeTimestamp(raw);
    if (!since) return c.json({ error: 'since must be an ISO timestamp' }, 400);
  }
  return c.json(await getChatInbox(c.env.DB, c.get('user').id, since));
});

chat.get('/me/chats', async (c) => {
  return c.json(await getChatList(c.env.DB, c.get('user').id));
});

// ---------- Native push tokens ----------

chat.post('/push/devices', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const saved = await saveDeviceToken(c.env, c.get('user').id, body);
    return c.json({ id: saved.id }, 201);
  } catch (error) {
    if (error instanceof DeviceTokenError) return c.json({ error: error.message }, 400);
    console.error('[push] device token save failed:', error);
    return c.json({ error: 'Failed to save the device' }, 500);
  }
});

chat.delete('/push/devices', async (c) => {
  const body = await c.req.json<{ token?: unknown }>().catch(() => ({} as { token?: unknown }));
  if (typeof body.token !== 'string' || !body.token) return c.json({ error: 'token is required' }, 400);
  return c.json({ ok: true, removed: await deleteDeviceToken(c.env, c.get('user').id, body.token) });
});

// ---------- Live socket ----------

chat.post('/live/ticket', async (c) => {
  if (!c.env.CHAT_HUB) return c.json({ error: 'Live chat is not set up on this server' }, 503);
  const ticket = await createPurposeTicket(c.env, 'live', c.get('user').id);
  return c.json({ ticket, ws_path: '/api/live/ws' });
});

export default chat;

/** The live WebSocket — registered BEFORE the auth middleware (it uses a `live` ticket). */
export function mountLiveSocket(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/live/ws', async (c) => {
    if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'Expected a WebSocket' }, 426);
    if (!c.env.CHAT_HUB) return c.json({ error: 'Live chat is not set up on this server' }, 503);
    const claims = await verifyPurposeTicket(c.env, c.req.query('ticket'), 'live');
    if (!claims) return c.json({ error: 'Unauthorized' }, 401);
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(claims.userId).first<{ id: string }>();
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const headers = new Headers(c.req.raw.headers);
    headers.set('X-User-Id', user.id);
    const stub = c.env.CHAT_HUB.get(c.env.CHAT_HUB.idFromName(user.id));
    return stub.fetch(new Request(c.req.raw.url, { headers }));
  });
}
