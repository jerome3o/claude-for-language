/**
 * Listening mode (docs/CHAT.md "Listening mode"): per person and conversation,
 * stored so every device of the account follows it and so notification
 * previews don't spoil a hidden message. The rules live in
 * shared/chats/listening.ts; revealed message ids stay on each device.
 */

import { effectiveListening, listeningCandidate, LISTENING_PREVIEW, type ListeningSetting } from '@shared/chats/listening';
import { getConversationParticipants } from './reads';

export interface ListeningRow extends ListeningSetting {
  conversation_id: string;
  updated_at: string;
}

export interface ListeningState {
  default_on: boolean;
  conversations: ListeningRow[];
}

export class ListeningError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) {
    super(message);
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** `{ on, since? }` from a request body, or a problem. `since` must be an ISO UTC time (or null). */
export function parseListeningBody(body: unknown): { on: boolean; since: string | null } | string {
  if (!body || typeof body !== 'object') return 'Body must be { on, since? }';
  const b = body as { on?: unknown; since?: unknown };
  if (typeof b.on !== 'boolean') return '`on` must be true or false';
  if (b.since === undefined || b.since === null) return { on: b.on, since: null };
  if (typeof b.since !== 'string' || !ISO.test(b.since)) return '`since` must be an ISO time like 2026-10-03T10:00:00.000Z';
  return { on: b.on, since: b.since };
}

export async function getListeningState(db: D1Database, userId: string): Promise<ListeningState> {
  const [user, rows] = await Promise.all([
    db.prepare('SELECT chat_listening_default FROM users WHERE id = ?').bind(userId).first<{ chat_listening_default: number | null }>(),
    db
      .prepare('SELECT conversation_id, listening, since, updated_at FROM chat_listening WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(userId)
      .all<{ conversation_id: string; listening: number; since: string | null; updated_at: string }>(),
  ]);
  return {
    default_on: !!user?.chat_listening_default,
    conversations: (rows.results ?? []).map((r) => ({ conversation_id: r.conversation_id, on: !!r.listening, since: r.since, updated_at: r.updated_at })),
  };
}

export async function setConversationListening(
  db: D1Database,
  userId: string,
  conversationId: string,
  value: { on: boolean; since: string | null },
  now = new Date(),
): Promise<ListeningRow> {
  const participants = await getConversationParticipants(db, conversationId);
  if (!participants) throw new ListeningError('Conversation not found', 404);
  if (!participants.user_ids.includes(userId)) throw new ListeningError('Not a member of this conversation', 403);
  const at = now.toISOString();
  await db
    .prepare(
      `INSERT INTO chat_listening (conversation_id, user_id, listening, since, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET listening = excluded.listening, since = excluded.since, updated_at = excluded.updated_at`,
    )
    .bind(conversationId, userId, value.on ? 1 : 0, value.since, at)
    .run();
  return { conversation_id: conversationId, on: value.on, since: value.since, updated_at: at };
}

export async function setListeningDefault(db: D1Database, userId: string, on: boolean): Promise<boolean> {
  await db.prepare('UPDATE users SET chat_listening_default = ? WHERE id = ?').bind(on ? 1 : 0, userId).run();
  return on;
}

/** The recipient's setting for one conversation (row, else their default). */
export async function listeningFor(db: D1Database, userId: string, conversationId: string): Promise<ListeningSetting> {
  const row = await db
    .prepare(
      `SELECT u.chat_listening_default AS def, l.listening, l.since
         FROM users u LEFT JOIN chat_listening l ON l.user_id = u.id AND l.conversation_id = ?
        WHERE u.id = ?`,
    )
    .bind(conversationId, userId)
    .first<{ def: number | null; listening: number | null; since: string | null }>();
  if (!row) return { on: false, since: null };
  return effectiveListening(row.listening === null ? null : { on: !!row.listening, since: row.since }, !!row.def);
}

/**
 * The notification line for a new message to `recipientId`: "🎧 New message"
 * when their listening mode would hide it (a new message is always after
 * `since`), else `preview`.
 */
export async function notificationPreviewFor(
  db: D1Database,
  recipientId: string,
  message: { id: string; conversation_id: string; sender_id: string; content: string; created_at: string; deleted_at?: string | null; attachment?: { kind: string } | null },
  preview: string,
): Promise<string> {
  const candidate = listeningCandidate(
    { id: message.id, sender_id: message.sender_id, content: message.content, created_at: message.created_at, deleted_at: message.deleted_at, attachment_kind: message.attachment?.kind ?? null },
    recipientId,
  );
  if (!candidate) return preview;
  const setting = await listeningFor(db, recipientId, message.conversation_id);
  return setting.on ? LISTENING_PREVIEW : preview;
}
