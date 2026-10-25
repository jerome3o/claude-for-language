/**
 * "Skip handwriting exercises" (shared/lesson/handwriting.ts; docs/STUDY_SESSION.md "Skip
 * handwriting"), cached on the device so a mini lesson played offline follows it. The server copy
 * is `users.skip_handwriting`: `/api/auth/me` and `/api/sync/changes` carry it,
 * `PUT /api/profile/skip-handwriting` changes it. Off by default.
 */
import { API_BASE, getAuthHeaders } from '../api/client';
import { recomputeAllLessonLearn } from './lessonLearn';

const KEY = 'skipHandwriting';
/** Fired on window when the cached switch changed (Settings / lesson lists re-read it). */
export const SKIP_HANDWRITING_CHANGED = 'skip-handwriting-changed';

export function readSkipHandwriting(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Store the server's value (a boolean, or a user / sync response carrying `skip_handwriting`). */
export function writeSkipHandwriting(src: boolean | { skip_handwriting?: unknown } | null | undefined): void {
  const v = typeof src === 'boolean' ? src : src && typeof src === 'object' && typeof src.skip_handwriting === 'boolean' ? src.skip_handwriting : null;
  if (v === null) return;
  let changed = false;
  try {
    changed = readSkipHandwriting() !== v;
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch { /* storage unavailable */ }
  if (!changed) return;
  // Earlier handwriting misses stop (or start) counting: every lesson's revision state follows.
  void recomputeAllLessonLearn().catch(() => undefined);
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(SKIP_HANDWRITING_CHANGED, { detail: v })); } catch { /* no window events */ }
  }
}

/** Settings / a row's menu: save the switch (on this device at once, then the server). */
export async function saveSkipHandwriting(on: boolean): Promise<void> {
  writeSkipHandwriting(on);
  const res = await fetch(`${API_BASE}/api/profile/skip-handwriting`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ skip_handwriting: on }),
  });
  if (!res.ok) throw new Error(`Couldn't save it to your account (${res.status})`);
  const r = (await res.json()) as { skip_handwriting?: unknown };
  writeSkipHandwriting(r);
}
