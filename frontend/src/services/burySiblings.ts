/**
 * "Don't show a word's other card types on the same day" (Anki's sibling burying;
 * shared/decks/holds.ts), cached on the device so the study queue follows it offline.
 * The server copy is `users.bury_siblings`: `/api/auth/me` and `/api/sync/changes` carry it,
 * `PUT /api/profile/bury-siblings` changes it. Off by default.
 */
import { setBurySiblingsApi } from '../api/cardHolds';

const KEY = 'burySiblings';
/** Fired on window when the cached switch changed (Settings re-reads it). */
export const BURY_SIBLINGS_CHANGED = 'bury-siblings-changed';

export function readBurySiblings(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Store the server's value (a boolean, or a user / sync response carrying `bury_siblings`). */
export function writeBurySiblings(src: boolean | { bury_siblings?: unknown } | null | undefined): void {
  const v = typeof src === 'boolean' ? src : src && typeof src === 'object' && typeof src.bury_siblings === 'boolean' ? src.bury_siblings : null;
  if (v === null) return;
  let changed = false;
  try {
    changed = readBurySiblings() !== v;
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch { /* storage unavailable */ }
  if (changed && typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(BURY_SIBLINGS_CHANGED, { detail: v })); } catch { /* no window events */ }
  }
}

/** Settings: save the switch (local at once, then the server). */
export async function saveBurySiblings(on: boolean): Promise<void> {
  writeBurySiblings(on);
  const r = await setBurySiblingsApi(on);
  writeBurySiblings(r.bury_siblings);
}
