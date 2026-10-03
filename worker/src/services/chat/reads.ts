/**
 * Chat read markers and the inbox (docs/CHAT.md §1–§2).
 *
 * `conversation_reads.last_read_at` is the `created_at` of the newest message a
 * person has read in a conversation (ISO strings, compared as strings). It only
 * ever moves forward. Unread = messages from the OTHER person after it.
 */

import { CLAUDE_AI_USER_ID } from '../../types';
import { messagePreviewText, parseStoredAttachment, type ChatMediaKind } from './media';
import { chatMessagePreview, sortChatList, type ChatListResponse, type ChatListRow } from '@shared/chats/inbox';

export interface ChatParticipants {
  conversation_id: string;
  relationship_id: string;
  title: string | null;
  is_ai: boolean;
  /** Both people of the conversation's relationship. */
  user_ids: [string, string];
  status: string;
}

/** Who is in a conversation (from its relationship), or null when it doesn't exist. */
export async function getConversationParticipants(db: D1Database, conversationId: string): Promise<ChatParticipants | null> {
  const row = await db
    .prepare(
      `SELECT c.id, c.relationship_id, c.title, c.is_ai_conversation, r.requester_id, r.recipient_id, r.status
         FROM conversations c JOIN tutor_relationships r ON r.id = c.relationship_id
        WHERE c.id = ?`,
    )
    .bind(conversationId)
    .first<{ id: string; relationship_id: string; title: string | null; is_ai_conversation: number | null; requester_id: string; recipient_id: string; status: string }>();
  if (!row) return null;
  return {
    conversation_id: row.id,
    relationship_id: row.relationship_id,
    title: row.title,
    is_ai: !!row.is_ai_conversation || row.requester_id === CLAUDE_AI_USER_ID || row.recipient_id === CLAUDE_AI_USER_ID,
    user_ids: [row.requester_id, row.recipient_id],
    status: row.status,
  };
}

export function otherParticipant(p: ChatParticipants, userId: string): string {
  return p.user_ids[0] === userId ? p.user_ids[1] : p.user_ids[0];
}

/** A plausible message timestamp from a client (`up_to`, `since`), else null. */
export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v.length > 40 || !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return null;
  return v;
}

export async function getLastReadAt(db: D1Database, conversationId: string, userId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT last_read_at FROM conversation_reads WHERE conversation_id = ? AND user_id = ?')
    .bind(conversationId, userId)
    .first<{ last_read_at: string }>();
  return row?.last_read_at ?? null;
}

export async function countUnread(db: D1Database, conversationId: string, userId: string, lastReadAt?: string | null): Promise<number> {
  const marker = lastReadAt === undefined ? await getLastReadAt(db, conversationId, userId) : lastReadAt;
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND deleted_at IS NULL AND created_at > ?')
    .bind(conversationId, userId, marker ?? '')
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** `{ me, other }` read markers for GET …/messages. */
export async function getReadState(
  db: D1Database,
  conversationId: string,
  userId: string,
  otherUserId: string | null,
): Promise<{ me: string | null; other: string | null }> {
  const rows = await db
    .prepare('SELECT user_id, last_read_at FROM conversation_reads WHERE conversation_id = ?')
    .bind(conversationId)
    .all<{ user_id: string; last_read_at: string }>();
  const by = new Map((rows.results ?? []).map((r) => [r.user_id, r.last_read_at]));
  return { me: by.get(userId) ?? null, other: otherUserId ? by.get(otherUserId) ?? null : null };
}

export interface MarkReadResult {
  conversation_id: string;
  last_read_at: string | null;
  unread: number;
  /** The marker moved forward with this call. */
  moved: boolean;
}

/**
 * Move my marker forward to `upTo` (default: the newest message), never past
 * the newest message and never back. The caller checks access.
 */
export async function markConversationRead(
  db: D1Database,
  conversationId: string,
  userId: string,
  upTo?: string | null,
): Promise<MarkReadResult> {
  const newestRow = await db
    .prepare('SELECT MAX(created_at) AS newest FROM messages WHERE conversation_id = ?')
    .bind(conversationId)
    .first<{ newest: string | null }>();
  const newest = newestRow?.newest ?? null;
  const before = await getLastReadAt(db, conversationId, userId);
  let target: string | null = newest;
  if (upTo && newest) target = upTo < newest ? upTo : newest;
  if (!target || (before && target <= before)) {
    return { conversation_id: conversationId, last_read_at: before, unread: await countUnread(db, conversationId, userId, before), moved: false };
  }
  await db
    .prepare(
      `INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES (?, ?, ?)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET
         updated_at = CASE WHEN excluded.last_read_at > conversation_reads.last_read_at THEN datetime('now') ELSE conversation_reads.updated_at END,
         last_read_at = CASE WHEN excluded.last_read_at > conversation_reads.last_read_at THEN excluded.last_read_at ELSE conversation_reads.last_read_at END`,
    )
    .bind(conversationId, userId, target)
    .run();
  const after = (await getLastReadAt(db, conversationId, userId)) ?? target;
  return { conversation_id: conversationId, last_read_at: after, unread: await countUnread(db, conversationId, userId, after), moved: after !== before };
}

export interface InboxSender {
  id: string;
  name: string | null;
  picture_url: string | null;
}

export interface ChatInboxMessage {
  id: string;
  conversation_id: string;
  relationship_id: string;
  content: string;
  created_at: string;
  sender: InboxSender;
  /** 'image' | 'voice' for a photo / voice message, else null. */
  attachment_kind: ChatMediaKind | null;
  /** What a notification shows: the text, or "📷 Photo" / "🎤 Voice message" (+ caption). */
  preview: string;
}

export interface ChatInboxConversation {
  conversation_id: string;
  relationship_id: string;
  title: string | null;
  other_user: InboxSender;
  unread: number;
  last_read_at: string | null;
  last_message_at: string | null;
}

export interface ChatInbox {
  server_time: string;
  messages: ChatInboxMessage[];
  conversations: ChatInboxConversation[];
}

export const INBOX_MESSAGE_LIMIT = 50;
export const INBOX_DEFAULT_DAYS = 7;

/** Conversations of my active relationships, minus AI role-play chats (shared FROM / WHERE). */
const MY_CHATS = `
  FROM conversations c
  JOIN tutor_relationships r ON r.id = c.relationship_id
  LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = ?1
  WHERE (r.requester_id = ?1 OR r.recipient_id = ?1)
    AND r.status = 'active'
    AND COALESCE(c.is_ai_conversation, 0) = 0
    AND r.requester_id != '${CLAUDE_AI_USER_ID}' AND r.recipient_id != '${CLAUDE_AI_USER_ID}'`;

/**
 * What I haven't read: messages to me after `since` (default: the last 7 days)
 * and after my marker, oldest first, at most 50; and every conversation with
 * unread messages.
 */
export async function getChatInbox(db: D1Database, userId: string, since?: string | null, now = new Date()): Promise<ChatInbox> {
  const from = since ?? new Date(now.getTime() - INBOX_DEFAULT_DAYS * 86_400_000).toISOString();
  const messages = await db
    .prepare(
      `SELECT m.id, m.conversation_id, c.relationship_id, m.content, m.created_at, m.attachment,
              u.id AS sender_id, u.name AS sender_name, u.picture_url AS sender_picture
       ${MY_CHATS.replace('WHERE', 'JOIN messages m ON m.conversation_id = c.id JOIN users u ON u.id = m.sender_id WHERE')}
         AND m.sender_id != ?1
         AND m.deleted_at IS NULL
         AND m.created_at > ?2
         AND m.created_at > COALESCE(cr.last_read_at, '')
       ORDER BY m.created_at ASC
       LIMIT ${INBOX_MESSAGE_LIMIT}`,
    )
    .bind(userId, from)
    .all<{ id: string; conversation_id: string; relationship_id: string; content: string; created_at: string; attachment: string | null; sender_id: string; sender_name: string | null; sender_picture: string | null }>();

  const convs = await db
    .prepare(
      `SELECT * FROM (
         SELECT c.id AS conversation_id, c.relationship_id, c.title, cr.last_read_at,
                CASE WHEN r.requester_id = ?1 THEN r.recipient_id ELSE r.requester_id END AS other_id,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ?1 AND m.deleted_at IS NULL
                    AND m.created_at > COALESCE(cr.last_read_at, '')) AS unread,
                COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.last_message_at) AS last_message_at
         ${MY_CHATS}
       ) WHERE unread > 0
       ORDER BY last_message_at DESC`,
    )
    .bind(userId)
    .all<{ conversation_id: string; relationship_id: string; title: string | null; last_read_at: string | null; other_id: string; unread: number; last_message_at: string | null }>();

  const convRows = convs.results ?? [];
  const otherIds = [...new Set(convRows.map((r) => r.other_id))];
  const users = new Map<string, InboxSender>();
  if (otherIds.length > 0) {
    const rows = await db
      .prepare(`SELECT id, name, picture_url FROM users WHERE id IN (${otherIds.map(() => '?').join(',')})`)
      .bind(...otherIds)
      .all<InboxSender>();
    for (const u of rows.results ?? []) users.set(u.id, { id: u.id, name: u.name, picture_url: u.picture_url });
  }

  return {
    server_time: now.toISOString(),
    messages: (messages.results ?? []).map((m) => {
      const attachment = parseStoredAttachment(m.attachment);
      return {
        id: m.id,
        conversation_id: m.conversation_id,
        relationship_id: m.relationship_id,
        content: m.content,
        created_at: m.created_at,
        sender: { id: m.sender_id, name: m.sender_name, picture_url: m.sender_picture },
        attachment_kind: attachment?.kind ?? null,
        preview: messagePreviewText({ content: m.content, attachment, deleted_at: null }),
      };
    }),
    conversations: convRows.map((r) => ({
      conversation_id: r.conversation_id,
      relationship_id: r.relationship_id,
      title: r.title,
      other_user: users.get(r.other_id) ?? { id: r.other_id, name: null, picture_url: null },
      unread: Number(r.unread),
      last_read_at: r.last_read_at ?? null,
      last_message_at: r.last_message_at ?? null,
    })),
  };
}

/**
 * The Chats inbox (`GET /api/me/chats`): every conversation of my active
 * relationships — Claude role-play chats flagged `is_ai` — with its last
 * message, my unread count and the other person, newest activity first. ONE
 * query (the last message by a correlated subquery per conversation, the
 * unread count by another; both on the messages(conversation_id, created_at)
 * index).
 */
export async function getChatList(db: D1Database, userId: string, now = new Date()): Promise<ChatListResponse> {
  const rows = await db
    .prepare(
      `SELECT c.id AS conversation_id, c.relationship_id, c.title, c.created_at AS conv_created_at, c.last_message_at,
              COALESCE(c.is_ai_conversation, 0) AS is_ai_conversation,
              r.requester_id, r.recipient_id, r.requester_role,
              u.id AS other_id, u.name AS other_name, u.picture_url AS other_picture,
              m.id AS last_id, m.sender_id AS last_sender_id, m.content AS last_content, m.created_at AS last_created_at,
              m.deleted_at AS last_deleted_at, m.attachment AS last_attachment,
              (SELECT COUNT(*) FROM messages um
                WHERE um.conversation_id = c.id AND um.sender_id != ?1 AND um.deleted_at IS NULL
                  AND um.created_at > COALESCE(cr.last_read_at, '')) AS unread
         FROM conversations c
         JOIN tutor_relationships r ON r.id = c.relationship_id
         JOIN users u ON u.id = CASE WHEN r.requester_id = ?1 THEN r.recipient_id ELSE r.requester_id END
         LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = ?1
         LEFT JOIN messages m ON m.id = (
           SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
         )
        WHERE (r.requester_id = ?1 OR r.recipient_id = ?1)
          AND r.status = 'active'
        ORDER BY COALESCE(m.created_at, c.last_message_at, c.created_at) DESC`,
    )
    .bind(userId)
    .all<{
      conversation_id: string; relationship_id: string; title: string | null; conv_created_at: string | null; last_message_at: string | null;
      is_ai_conversation: number; requester_id: string; recipient_id: string; requester_role: 'tutor' | 'student';
      other_id: string; other_name: string | null; other_picture: string | null;
      last_id: string | null; last_sender_id: string | null; last_content: string | null; last_created_at: string | null;
      last_deleted_at: string | null; last_attachment: string | null; unread: number;
    }>();

  const conversations: ChatListRow[] = (rows.results ?? []).map((r) => {
    const iAmRequester = r.requester_id === userId;
    const otherRole: 'tutor' | 'student' = iAmRequester ? (r.requester_role === 'tutor' ? 'student' : 'tutor') : r.requester_role;
    const attachment = parseStoredAttachment(r.last_attachment);
    const lastMessage = r.last_id && r.last_sender_id && r.last_created_at
      ? {
          id: r.last_id,
          sender_id: r.last_sender_id,
          preview: chatMessagePreview({ content: r.last_content ?? '', attachment_kind: attachment?.kind ?? null, deleted: !!r.last_deleted_at }),
          created_at: r.last_created_at,
        }
      : null;
    return {
      conversation_id: r.conversation_id,
      relationship_id: r.relationship_id,
      title: r.title,
      is_ai: !!r.is_ai_conversation || r.requester_id === CLAUDE_AI_USER_ID || r.recipient_id === CLAUDE_AI_USER_ID,
      other_user: { id: r.other_id, name: r.other_name, picture_url: r.other_picture },
      other_role: otherRole,
      last_message: lastMessage,
      unread: Number(r.unread ?? 0),
      last_activity_at: lastMessage?.created_at ?? r.last_message_at ?? r.conv_created_at ?? now.toISOString(),
    };
  });
  return { server_time: now.toISOString(), conversations: sortChatList(conversations) };
}
