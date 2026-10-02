/**
 * Delivering a new chat message and a read (docs/CHAT.md §3).
 *
 * New message, in order of speed: the live socket (both people's ChatHubs —
 * the recipient's devices and the sender's other devices), FCM data messages
 * to the recipient's native apps, Web Push to the recipient's browsers, then
 * what was there before: the in-app notification row, the e-mail and the
 * admin's ntfy ping. Each channel runs on its own: one failing never stops
 * the others.
 *
 * Read: a `chat_read` FCM message to MY native devices (they drop the
 * notification) and a `read` live event to me and to the other person.
 */

import type { Env, MessageWithSender } from '../../types';
import { CLAUDE_AI_USER_ID } from '../../types';
import * as db from '../../db/queries';
import { sendNewMessageNotification } from '../email';
import { notifyNewChatMessage as ntfyNewChatMessage } from '../notifications';
import { pushToUsers } from '../push';
import { pushToDevices } from '../push/devices';
import { broadcastToUsers, broadcastToUser } from './hub';
import { getConversationParticipants, otherParticipant, type ChatParticipants } from './reads';

/** FCM data values are capped well below FCM's 4 KB payload limit. */
export const FCM_CONTENT_MAX = 1000;
const PREVIEW_MAX = 100;

export interface ChatNotifyDeps {
  /** Fetch used for FCM (tests). */
  fetcher?: typeof fetch;
  /** Web Push sender (tests). */
  webPush?: typeof pushToUsers;
  /** E-mail sender (tests). */
  email?: typeof sendNewMessageNotification;
  /** ntfy sender (tests). */
  ntfy?: typeof ntfyNewChatMessage;
}

export function chatUrl(relationshipId: string, conversationId: string): string {
  return `/connections/${relationshipId}/chat/${conversationId}`;
}

/** The FCM data payload for a new message (all values strings once sent). */
export function chatMessageFcmData(message: MessageWithSender, relationshipId: string): Record<string, string> {
  return {
    type: 'chat_message',
    conversation_id: message.conversation_id,
    relationship_id: relationshipId,
    message_id: message.id,
    sender_id: message.sender_id,
    sender_name: message.sender.name || 'Someone',
    sender_picture_url: message.sender.picture_url || '',
    content: message.content.length > FCM_CONTENT_MAX ? message.content.slice(0, FCM_CONTENT_MAX) : message.content,
    created_at: message.created_at,
    url: chatUrl(relationshipId, message.conversation_id),
  };
}

export function chatMessageWebPush(message: MessageWithSender, relationshipId: string) {
  const preview = message.content.length > PREVIEW_MAX ? message.content.slice(0, PREVIEW_MAX) + '…' : message.content;
  return {
    type: 'chat_message' as const,
    title: message.sender.name || 'New message',
    body: preview,
    url: chatUrl(relationshipId, message.conversation_id),
    tag: `chat-${message.conversation_id}`,
    conversation_id: message.conversation_id,
    relationship_id: relationshipId,
  };
}

async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[chat-notify] ${label} failed:`, err);
  }
}

/** Everything that happens when `message` has been stored. Never throws. */
export async function notifyNewChatMessage(
  env: Env,
  message: MessageWithSender,
  conversation: { id: string; relationship_id: string },
  deps: ChatNotifyDeps = {},
): Promise<void> {
  let participants: ChatParticipants | null = null;
  try {
    participants = await getConversationParticipants(env.DB, conversation.id);
  } catch (err) {
    console.error('[chat-notify] participants lookup failed:', err);
  }
  if (!participants) return;
  const senderId = message.sender_id;
  const recipientId = otherParticipant(participants, senderId);
  const relationshipId = participants.relationship_id;
  const recipientIsHuman = !!recipientId && recipientId !== CLAUDE_AI_USER_ID && recipientId !== senderId;
  const senderName = message.sender.name || 'Someone';
  const content = message.content;
  const truncated = content.length > PREVIEW_MAX ? content.slice(0, PREVIEW_MAX) + '...' : content;

  await Promise.all([
    // 1. Live: the recipient's sockets and the sender's other devices.
    step('live', () =>
      broadcastToUsers(env, recipientIsHuman ? [recipientId, senderId] : [senderId], { type: 'message', message, relationship_id: relationshipId }),
    ),
    // 2. FCM to the recipient's native apps (never the sender's).
    recipientIsHuman
      ? step('fcm', () => pushToDevices(env, [recipientId], chatMessageFcmData(message, relationshipId), { collapseKey: message.conversation_id, ttlSeconds: 86400 }, deps.fetcher))
      : Promise.resolve(),
    // 3. Web Push to the recipient's browsers.
    recipientIsHuman
      ? step('web push', () =>
          (deps.webPush ?? pushToUsers)(env, [recipientId], chatMessageWebPush(message, relationshipId), {
            ttl: 86400,
            urgency: 'high',
            topic: `chat${message.conversation_id.replace(/[^A-Za-z0-9]/g, '').slice(0, 28)}`,
          }),
        )
      : Promise.resolve(),
    // 4. As before: e-mail, the in-app notification row, ntfy.
    step('email', async () => {
      if (!env.SENDGRID_API_KEY || !recipientId) return;
      const recipient = await env.DB
        .prepare('SELECT email, name FROM users WHERE id = ?')
        .bind(recipientId)
        .first<{ email: string | null; name: string | null }>();
      if (!recipient?.email) return;
      const sent = await (deps.email ?? sendNewMessageNotification)(env.SENDGRID_API_KEY, {
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        senderName: message.sender.name,
        messagePreview: content,
        conversationId: message.conversation_id,
        relationshipId,
      });
      console.log('[Email] Message notification to', recipient.email, sent ? 'sent' : 'FAILED');
    }),
    step('in-app notification', async () => {
      if (!recipientId) return;
      const existing = await db.getRecentUnreadChatNotification(env.DB, recipientId, message.conversation_id);
      if (existing) {
        // Count existing messages from the title (e.g., "2 new messages from X")
        const countMatch = existing.title.match(/^(\d+) new messages from/);
        const currentCount = countMatch ? parseInt(countMatch[1], 10) : 1;
        await db.updateNotificationMessage(env.DB, existing.id, `${currentCount + 1} new messages from ${senderName}`, truncated);
      } else {
        await db.createNotification(env.DB, recipientId, 'new_chat_message', `New message from ${senderName}`, truncated, {
          conversation_id: message.conversation_id,
          relationship_id: relationshipId,
        });
      }
    }),
    step('ntfy', () => (deps.ntfy ?? ntfyNewChatMessage)(env.NTFY_TOPIC, senderName, truncated)),
  ]);
}

/** After my marker moved: tell my native devices and everyone's live sockets. Never throws. */
export async function notifyChatRead(
  env: Env,
  userId: string,
  participants: ChatParticipants,
  lastReadAt: string,
  deps: Pick<ChatNotifyDeps, 'fetcher'> = {},
): Promise<void> {
  const otherId = otherParticipant(participants, userId);
  await Promise.all([
    step('fcm read', () =>
      pushToDevices(
        env,
        [userId],
        { type: 'chat_read', conversation_id: participants.conversation_id, last_read_at: lastReadAt },
        { collapseKey: `read-${participants.conversation_id}`, ttlSeconds: 86400 },
        deps.fetcher,
      ),
    ),
    step('live read', async () => {
      const event = { type: 'read' as const, conversation_id: participants.conversation_id, user_id: userId, last_read_at: lastReadAt };
      await broadcastToUser(env, userId, event);
      if (otherId && otherId !== userId && otherId !== CLAUDE_AI_USER_ID) await broadcastToUser(env, otherId, event);
    }),
  ]);
}
