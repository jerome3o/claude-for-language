/**
 * Deleting a mini lesson, offline-first (the row menu's "Delete lesson", Mini Lessons' 🗑; docs/STUDY_SESSION.md
 * "Row menu"): the lesson leaves this device at once (its row, its completion events, its half-done run) and its id
 * waits in a pending list (localStorage) until `DELETE /api/custom-lessons/:id` succeeds — straight away when online,
 * else on the next sync (`uploadLessonDeletes`). Until then every sync leaves it out (`pendingLessonDeletes`), so a
 * deleted lesson never comes back — not as a row, not as a revision. A 404 counts as done (already gone).
 */
import { API_BASE, getAuthHeaders } from '../api/client';
import { db } from '../db/database';
import { clearLessonRun } from './lessonRuns';
import { isEffectivelyOffline } from './offlineMode';

const KEY = 'pendingLessonDeletes';

export function pendingLessonDeletes(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writePending(ids: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])); } catch { /* storage unavailable */ }
}

/** Delete a lesson here at once; the server hears of it now or on the next sync. */
export async function deleteLessonOfflineFirst(lessonId: string): Promise<void> {
  const pending = pendingLessonDeletes();
  pending.add(lessonId);
  writePending(pending);
  await db.transaction('rw', [db.customLessons, db.customLessonCompletionEvents], async () => {
    await db.customLessons.delete(lessonId);
    await db.customLessonCompletionEvents.where('lesson_id').equals(lessonId).delete();
  });
  await clearLessonRun(lessonId);
  if (!isEffectivelyOffline()) void uploadLessonDeletes().catch(() => undefined);
}

/** Send the pending deletes (sync, and right after a delete). Returns how many the server took. */
export async function uploadLessonDeletes(): Promise<number> {
  const pending = pendingLessonDeletes();
  let done = 0;
  for (const id of pending) {
    const res = await fetch(`${API_BASE}/api/custom-lessons/${encodeURIComponent(id)}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok && res.status !== 404) continue;
    const now = pendingLessonDeletes();
    now.delete(id);
    writePending(now);
    done++;
  }
  return done;
}
