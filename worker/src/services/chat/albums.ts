/**
 * Photo albums (docs/CHAT.md "Photo albums"). Photos picked together are one
 * message each (forward / delete / reactions / read receipts keep working per
 * photo) and carry the same client-chosen `album_id` + their `album_index`, so
 * the apps draw them as ONE bubble (`layoutBubbles`, shared/chats/bubbles.ts).
 *
 * Notifications: ONE per album, not one per photo. The first photo of an album
 * to arrive claims it (`album_notified_at`, one atomic UPDATE, so two uploads
 * racing never both notify) and the push / e-mail / bell say "📷 3 photos" —
 * the count the sender declared (`album_count`). The other photos only go out
 * live (the ChatHub `message` event stays per message, so open chats fill in).
 */

import { normalizeClientId } from '../conversations';
import { ALBUM_MAX_PHOTOS } from '@shared/chats/bubbles';

export interface AlbumParams {
  id: string;
  index: number;
  /** How many photos the sender picked (2–10); the notification says "📷 <count> photos". */
  count: number;
}

export class AlbumParamError extends Error {
  readonly status = 400 as const;
}

/**
 * `album_id` / `album_index` / `album_count` from a query string or body. Null when
 * there is no album id (an ordinary message); throws AlbumParamError when they
 * are malformed. The id has the client_id shape (1–100 of [A-Za-z0-9_.:-]).
 */
export function parseAlbumParams(raw: { album_id?: unknown; album_index?: unknown; album_count?: unknown }): AlbumParams | null {
  if (raw.album_id === undefined || raw.album_id === null || raw.album_id === '') return null;
  const id = normalizeClientId(raw.album_id);
  if (!id) throw new AlbumParamError('album_id must be 1–100 characters of letters, digits, _ . : -');
  const index = toInt(raw.album_index);
  const count = toInt(raw.album_count);
  if (count === null || count < 2 || count > ALBUM_MAX_PHOTOS) throw new AlbumParamError(`album_count must be 2–${ALBUM_MAX_PHOTOS}`);
  if (index === null || index < 0 || index >= count) throw new AlbumParamError('album_index must be 0 … album_count − 1');
  return { id, index, count };
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\d{1,3}$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Claim the album's one notification for this message. True for exactly one
 * photo of an album (the first to get here); every later call is false.
 */
export async function claimAlbumNotification(
  db: D1Database,
  message: { id: string; conversation_id: string; sender_id: string },
  albumId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE messages SET album_notified_at = ?
        WHERE id = ? AND album_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM messages o
             WHERE o.conversation_id = ? AND o.sender_id = ? AND o.album_id = ? AND o.album_notified_at IS NOT NULL
          )`,
    )
    .bind(now, message.id, albumId, message.conversation_id, message.sender_id, albumId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Photos of an album stored so far (not deleted), and the caption it shows (the last photo with one). */
export async function albumSummary(
  db: D1Database,
  conversationId: string,
  senderId: string,
  albumId: string,
): Promise<{ count: number; caption: string }> {
  const rows = await db
    .prepare(
      `SELECT content FROM messages
        WHERE conversation_id = ? AND sender_id = ? AND album_id = ? AND deleted_at IS NULL
        ORDER BY COALESCE(album_index, 0), created_at`,
    )
    .bind(conversationId, senderId, albumId)
    .all<{ content: string | null }>();
  const list = rows.results ?? [];
  let caption = '';
  for (const r of list) if (r.content && r.content.trim()) caption = r.content;
  return { count: list.length, caption };
}
