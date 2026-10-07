/**
 * "Order new cards by" (shared/decks/new-card-order.ts): the account's switches, stored as
 * JSON on users.new_card_order (NULL = defaults). The devices do the ordering; the server
 * only keeps the choice and hands it out on /api/auth/me and /api/sync/changes.
 */
import {
  applyNewCardOrderUpdate,
  newCardOrderInfo,
  parseNewCardOrder,
  type NewCardOrder,
  type NewCardOrderInfo,
  type NewCardOrderUpdate,
} from '@shared/decks';

export async function getNewCardOrder(db: D1Database, userId: string): Promise<NewCardOrder> {
  const row = await db.prepare('SELECT new_card_order FROM users WHERE id = ?').bind(userId).first<{ new_card_order: string | null }>();
  return parseNewCardOrder(row?.new_card_order ?? null);
}

export async function getNewCardOrderInfo(db: D1Database, userId: string): Promise<NewCardOrderInfo> {
  return newCardOrderInfo(await getNewCardOrder(db, userId));
}

/** Apply a change; a set equal to the defaults is stored as NULL. */
export async function setNewCardOrder(db: D1Database, userId: string, update: NewCardOrderUpdate): Promise<NewCardOrderInfo> {
  const next = applyNewCardOrderUpdate(await getNewCardOrder(db, userId), update);
  const info = newCardOrderInfo(next);
  await db
    .prepare('UPDATE users SET new_card_order = ? WHERE id = ?')
    .bind(info.is_default ? null : JSON.stringify(next), userId)
    .run();
  return info;
}
