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
import { createUnsubscribeToken, listUnsubscribeHeaders, unsubscribeUrl } from '../email-unsubscribe';
import { notifyNewChatMessage as ntfyNewChatMessage } from '../notifications';
import { pushToUsers } from '../push';
import { pushToDevices } from '../push/devices';
import { broadcastToUsers, broadcastToUser } from './hub';
import { messagePreviewText } from './media';
import { getConversationParticipants, otherParticipant, type ChatParticipants } from './reads';
import { notificationPreviewFor } from './listening';
import { albumSummary, claimAlbumNotification, type AlbumParams } from './albums';

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
export function chatMessageFcmData(
  message: MessageWithSender,
  relationshipId: string,
  preview: string = previewOf(message),
  album: { id: string; count: number } | null = null,
): Record<string, string> {
  return {
    // A photo album's ONE notification (docs/CHAT.md "Photo albums"): the app keys its line by album.
    ...(album ? { album_id: album.id, album_count: String(album.count) } : {}),
    type: 'chat_message',
    conversation_id: message.conversation_id,
    relationship_id: relationshipId,
    message_id: message.id,
    sender_id: message.sender_id,
    sender_name: message.sender.name || 'Someone',
    sender_picture_url: message.sender.picture_url || '',
    // A photo / voice message: "📷 Photo" / "🎤 Voice message" (+ caption).
    // Listening mode: "🎧 New message" instead of the text (docs/CHAT.md "Listening mode").
    content: preview.slice(0, FCM_CONTENT_MAX),
    attachment_kind: message.attachment?.kind ?? '',
    created_at: message.created_at,
    url: chatUrl(relationshipId, message.conversation_id),
  };
}

function previewOf(message: MessageWithSender): string {
  return messagePreviewText(message);
}

export function chatMessageWebPush(message: MessageWithSender, relationshipId: string, text: string = previewOf(message)) {
  const preview = text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) + '…' : text;
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

/**
 * Everything that happens when `message` has been stored. Never throws.
 *
 * A photo of an album (`opts.album`, docs/CHAT.md "Photo albums"): the live
 * event goes out for every photo, everything else (FCM, Web Push, e-mail, the
 * bell, ntfy) ONCE per album — on the first photo to arrive, which claims it —
 * saying "📷 <album_count> photos".
 */
export async function notifyNewChatMessage(
  env: Env,
  message: MessageWithSender,
  conversation: { id: string; relationship_id: string },
  deps: ChatNotifyDeps = {},
  opts: { album?: AlbumParams | null } = {},
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
  const album = opts.album && message.album_id === opts.album.id ? opts.album : null;

  // 1. Live: the recipient's sockets and the sender's other devices — every photo of an album too.
  const live = step('live', () =>
    broadcastToUsers(env, recipientIsHuman ? [recipientId, senderId] : [senderId], {
      type: 'message',
      message,
      relationship_id: relationshipId,
      ...(album ? { album_count: album.count } : {}),
    }),
  );

  let raw = previewOf(message);
  let albumNote: { id: string; count: number } | null = null;
  if (album) {
    let claimed = false;
    try {
      claimed = await claimAlbumNotification(env.DB, message, album.id);
    } catch (err) {
      console.error('[chat-notify] album claim failed:', err);
    }
    // Another photo of this album already notified: live only.
    if (!claimed) {
      await live;
      return;
    }
    let caption = message.content;
    let stored = 1;
    try {
      const summary = await albumSummary(env.DB, message.conversation_id, senderId, album.id);
      stored = summary.count;
      if (!caption.trim()) caption = summary.caption;
    } catch (err) {
      console.error('[chat-notify] album summary failed:', err);
    }
    albumNote = { id: album.id, count: Math.max(album.count, stored) };
    raw = messagePreviewText({ ...message, content: caption }, albumNote.count);
  }
  // What the recipient may see before opening the chat: their listening mode hides Chinese text.
  let content = raw;
  if (recipientIsHuman) {
    try {
      content = await notificationPreviewFor(env.DB, recipientId, message, raw);
    } catch (err) {
      console.error('[chat-notify] listening lookup failed:', err);
    }
  }
  const truncated = content.length > PREVIEW_MAX ? content.slice(0, PREVIEW_MAX) + '...' : content;

  await Promise.all([
    live,
    // 2. FCM to the recipient's native apps (never the sender's).
    recipientIsHuman
      ? step('fcm', () => pushToDevices(env, [recipientId], chatMessageFcmData(message, relationshipId, content, albumNote), { collapseKey: message.conversation_id, ttlSeconds: 86400 }, deps.fetcher))
      : Promise.resolve(),
    // 3. Web Push to the recipient's browsers.
    recipientIsHuman
      ? step('web push', () =>
          (deps.webPush ?? pushToUsers)(env, [recipientId], chatMessageWebPush(message, relationshipId, content), {
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
        .prepare('SELECT email, name, email_chat_messages FROM users WHERE id = ?')
        .bind(recipientId)
        .first<{ email: string | null; name: string | null; email_chat_messages: number | null }>();
      if (!recipient?.email) return;
      // Turned off in Settings or with the e-mail's own link (docs/CHAT.md "E-mail opt-out").
      if (recipient.email_chat_messages === 0) return;
      const url = unsubscribeUrl(env.PUBLIC_API_URL, await createUnsubscribeToken(env, recipientId));
      const sent = await (deps.email ?? sendNewMessageNotification)(env.SENDGRID_API_KEY, {
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        senderName: message.sender.name,
        messagePreview: content,
        conversationId: message.conversation_id,
        relationshipId,
        unsubscribeUrl: url,
        headers: listUnsubscribeHeaders(url),
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

// ---------- Corrections (docs/CHAT.md PR 3) ----------

export function correctionLine(tutorName: string | null | undefined): string {
  return `✏️ ${tutorName || 'Your tutor'} corrected your message`;
}

/** The FCM data payload telling the student their message was corrected. */
export function chatCorrectionFcmData(
  message: Pick<MessageWithSender, 'id' | 'conversation_id'>,
  relationshipId: string,
  tutorName: string | null | undefined,
): Record<string, string> {
  return {
    type: 'chat_correction',
    conversation_id: message.conversation_id,
    relationship_id: relationshipId,
    message_id: message.id,
    sender_name: tutorName || 'Your tutor',
    content: correctionLine(tutorName),
    url: chatUrl(relationshipId, message.conversation_id),
  };
}

export function chatCorrectionWebPush(
  message: Pick<MessageWithSender, 'id' | 'conversation_id'>,
  relationshipId: string,
  tutorName: string | null | undefined,
) {
  return {
    type: 'chat_correction' as const,
    title: tutorName || 'Your tutor',
    body: correctionLine(tutorName),
    url: chatUrl(relationshipId, message.conversation_id),
    tag: `chat-${message.conversation_id}`,
    conversation_id: message.conversation_id,
    relationship_id: relationshipId,
    message_id: message.id,
  };
}

/**
 * The tutor corrected the student's message: FCM to the student's native apps
 * and Web Push to their browsers (no e-mail; the live `message_updated` goes
 * out separately). Never throws.
 */
export async function notifyChatCorrection(
  env: Env,
  input: { message: Pick<MessageWithSender, 'id' | 'conversation_id'>; studentId: string; relationshipId: string; tutorId: string },
  deps: Pick<ChatNotifyDeps, 'fetcher' | 'webPush'> = {},
): Promise<void> {
  const { message, studentId, relationshipId } = input;
  if (!studentId || studentId === CLAUDE_AI_USER_ID || studentId === input.tutorId) return;
  let tutorName: string | null = null;
  try {
    const row = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(input.tutorId).first<{ name: string | null }>();
    tutorName = row?.name ?? null;
  } catch (err) {
    console.error('[chat-notify] tutor name lookup failed:', err);
  }
  await Promise.all([
    step('fcm correction', () =>
      pushToDevices(env, [studentId], chatCorrectionFcmData(message, relationshipId, tutorName), { collapseKey: `correction-${message.id}`, ttlSeconds: 86400 }, deps.fetcher),
    ),
    step('web push correction', () =>
      (deps.webPush ?? pushToUsers)(env, [studentId], chatCorrectionWebPush(message, relationshipId, tutorName), { ttl: 86400, urgency: 'normal' }),
    ),
  ]);
}
