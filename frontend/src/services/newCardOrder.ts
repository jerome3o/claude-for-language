/**
 * "Order new cards by" (Settings → New cards; shared/decks/new-card-order.ts), cached on
 * the device so the study queue follows it offline. The server copy is on the user row:
 * `/api/auth/me` and `/api/sync/changes` carry it as `new_card_order`,
 * `PUT /api/profile/new-card-order` changes it.
 */
import {
  newCardOrderInfo,
  parseNewCardOrder,
  type NewCardOrder,
  type NewCardOrderInfo,
  type NewCardOrderUpdate,
} from '@shared/decks';
import { updateNewCardOrder } from '../api/client';

const KEY = 'newCardOrder';
/** Fired on window when the cached order changed (Settings re-reads it). */
export const NEW_CARD_ORDER_CHANGED = 'new-card-order-changed';

export function readNewCardOrder(): NewCardOrder {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseNewCardOrder(raw);
  } catch { /* storage unavailable */ }
  return parseNewCardOrder(null);
}

export function readNewCardOrderInfo(): NewCardOrderInfo {
  return newCardOrderInfo(readNewCardOrder());
}

/** Store the server's order (a NewCardOrderInfo, or a user carrying `new_card_order`). Returns whether it changed. */
export function writeNewCardOrder(src: (Partial<NewCardOrder> & { new_card_order?: unknown }) | null | undefined): boolean {
  if (!src || typeof src !== 'object') return false;
  const raw = 'new_card_order' in src ? src.new_card_order : src;
  if (!raw || typeof raw !== 'object') return false;
  const next = parseNewCardOrder(raw);
  let changed = false;
  try {
    const nextRaw = JSON.stringify(next);
    changed = localStorage.getItem(KEY) !== nextRaw;
    localStorage.setItem(KEY, nextRaw);
  } catch { /* storage unavailable */ }
  if (changed && typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(NEW_CARD_ORDER_CHANGED, { detail: next })); } catch { /* no window events */ }
  }
  return changed;
}

/** PUT /api/profile/new-card-order (`{ reset: true }` = every default); caches the answer. */
export async function saveNewCardOrder(update: NewCardOrderUpdate | { reset: true }): Promise<NewCardOrderInfo> {
  const info = await updateNewCardOrder(update);
  writeNewCardOrder(info);
  return info;
}
