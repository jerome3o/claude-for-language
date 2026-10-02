/**
 * Live chat events (docs/CHAT.md §4): every user has one ChatHub Durable
 * Object (idFromName(userId)) holding their open sockets. These helpers send an
 * event to all of a user's sockets; failures are logged, never thrown — the
 * socket is a doorbell, the REST API stays the source of truth.
 */

import type { Env } from '../../types';
import type { MessageWithSender } from '../../types';

export type ChatLiveEvent =
  | { type: 'hello'; user_id: string; server_time: string }
  | { type: 'message'; message: MessageWithSender; relationship_id: string }
  | { type: 'message_updated'; message: MessageWithSender; relationship_id: string }
  | { type: 'read'; conversation_id: string; user_id: string; last_read_at: string }
  | { type: 'typing'; conversation_id: string; user_id: string };

type HubEnv = Pick<Env, 'CHAT_HUB'>;

/** Send `event` to every socket `userId` has open. Returns how many got it (0 when the hub is not bound). */
export async function broadcastToUser(env: HubEnv, userId: string, event: ChatLiveEvent): Promise<number> {
  if (!env.CHAT_HUB || !userId) return 0;
  try {
    const stub = env.CHAT_HUB.get(env.CHAT_HUB.idFromName(userId));
    return await stub.broadcast(event);
  } catch (err) {
    console.error('[chat-hub] broadcast failed for', userId, err);
    return 0;
  }
}

export async function broadcastToUsers(env: HubEnv, userIds: string[], event: ChatLiveEvent): Promise<void> {
  await Promise.all([...new Set(userIds)].filter(Boolean).map((id) => broadcastToUser(env, id, event)));
}
