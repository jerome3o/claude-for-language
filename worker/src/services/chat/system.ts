/**
 * System messages (docs/CHAT.md "System messages", shared/chats/system.ts): the
 * lines the platform posts into a chat on someone's behalf. The person stays the
 * sender; `system_kind` + `system_data` say what happened, and `content` holds
 * the readable fallback (the recipient's view, third person) for older apps,
 * e-mails and notifications.
 */
import { systemFallbackContent, type SystemKind } from '@shared/chats/system';
import { sendMessage, type SentMessage } from '../conversations';

async function userName(db: D1Database, userId: string): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string | null }>();
    return row?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Post a system message as `senderId` (who the platform speaks for) through the
 * normal send path. `url` = the absolute join link older apps need in the text.
 */
export async function postSystemMessage(
  db: D1Database,
  conversationId: string,
  senderId: string,
  kind: SystemKind,
  data: Record<string, unknown>,
  opts: { url?: string | null; senderName?: string | null; clientId?: string | null } = {},
): Promise<SentMessage> {
  const name = opts.senderName || (await userName(db, senderId));
  const content = systemFallbackContent(kind, data, name, { url: opts.url ?? null });
  return sendMessage(db, conversationId, senderId, content, undefined, {
    clientId: opts.clientId ?? null,
    system: { kind, data },
  });
}

/**
 * A call ended: its "started a video call" line turns into "Video call ended" /
 * "Missed video call from …". `joinedUserIds` (the room's list) says whether the
 * other person ever came in; without it only `ended` is set. Bumps `updated_at`
 * so `?since=` polling and the next open pick it up. Returns the changed message ids.
 */
export async function markCallMessageEnded(db: D1Database, callId: string, joinedUserIds?: readonly string[] | null): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT id, sender_id, system_data FROM messages
        WHERE system_kind = 'call_started' AND json_extract(system_data, '$.call_id') = ?`,
    )
    .bind(callId)
    .all<{ id: string; sender_id: string; system_data: string | null }>();
  const now = new Date().toISOString();
  const changed: string[] = [];
  for (const row of rows.results ?? []) {
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(row.system_data ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      /* keep {} */
    }
    const next: Record<string, unknown> = { ...data, call_id: callId, ended: true };
    if (joinedUserIds) next.missed = !joinedUserIds.some((id) => id !== row.sender_id);
    if (data.ended === true && (joinedUserIds ? data.missed === next.missed : true)) continue;
    await db.prepare('UPDATE messages SET system_data = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(next), now, row.id).run();
    changed.push(row.id);
  }
  return changed;
}
