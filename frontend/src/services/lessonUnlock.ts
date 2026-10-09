/**
 * Unlockable mini lessons on the device (shared/lesson/unlock.ts; docs/STUDY_SESSION.md
 * "Unlockable lessons"): a locked lesson waits until its audio lesson has been listened to, or
 * the learner taps "✓ Done — unlock".
 *
 * Offline-first like the completions: an unlock is written to IndexedDB (`lessonUnlocks`) and
 * onto the cached lesson row at once, so today's lessons include it straight away; it uploads to
 * POST /api/custom-lessons/unlock now when online, else in the next sync (idempotent — the
 * earliest time wins). A listen that reaches the end of an audio lesson (`audioLessonListened`)
 * is remembered in localStorage and uploaded to POST /api/audio-lessons/listened, which also
 * unlocks the lessons waiting on it server-side; the device unlocks its own copies right away.
 */
import {
  earlierUnlock,
  lessonLockStatus,
  lessonsUnlockedByListen,
  type LessonUnlock,
  type LessonUnlockVia,
} from '@shared/lesson';
import { db, type LocalCustomLesson } from '../db/database';
import { API_BASE, getAuthHeaders } from '../api/client';
import { track } from './analytics';

/** Fired on window when a lesson was unlocked here (lists refresh). */
export const LESSON_UNLOCKED_EVENT = 'lesson-unlocked';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/**
 * Unlock a lesson (no-op when it has no condition or is already unlocked). Returns whether it
 * was unlocked now.
 */
export async function unlockLesson(lessonId: string, via: LessonUnlockVia, kindHint?: LessonUnlock['kind']): Promise<boolean> {
  const row = await db.customLessons.get(lessonId);
  const unlock = row?.unlock ?? null;
  // null = no condition; undefined = a row cached before unlocks existed (the server decides).
  if (row && (row.unlock === null || row.unlocked_at)) return false;
  const now = new Date().toISOString();
  await db.lessonUnlocks.put({ lesson_id: lessonId, unlocked_at: now, via, _synced: 0 });
  if (row) await db.customLessons.update(lessonId, { unlocked_at: now });
  track('lesson.unlock', { via, kind: unlock?.kind ?? kindHint ?? 'manual' });
  try {
    window.dispatchEvent(new CustomEvent(LESSON_UNLOCKED_EVENT, { detail: { lessonId } }));
  } catch { /* no window */ }
  if (online()) void uploadLessonUnlocks().catch(() => {});
  return true;
}

/** Upload this device's pending unlocks (idempotent server-side). */
export async function uploadLessonUnlocks(): Promise<{ uploaded: number }> {
  const pending = await db.lessonUnlocks.where('_synced').equals(0).toArray();
  if (pending.length === 0) return { uploaded: 0 };
  const res = await fetch(`${API_BASE}/api/custom-lessons/unlock`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: pending.map(p => ({ lesson_id: p.lesson_id, unlocked_at: p.unlocked_at, via: p.via })) }),
  });
  if (!res.ok) throw new Error(`Failed to upload lesson unlocks: ${res.status}`);
  const result = await res.json() as { unlocked?: string[]; already?: string[]; not_found?: string[] };
  const done = [...(result.unlocked ?? []), ...(result.already ?? [])];
  if (done.length) await db.lessonUnlocks.where('lesson_id').anyOf(done).modify({ _synced: 1 });
  // A lesson the server doesn't know (deleted) or without a condition: nothing to keep.
  if (result.not_found?.length) await db.lessonUnlocks.bulkDelete(result.not_found);
  return { uploaded: result.unlocked?.length ?? 0 };
}

/**
 * After the lesson cache was rebuilt from the server: this device's unlocks go on top (the
 * earliest time wins), and the ones the server now carries are forgotten.
 */
export async function applyLocalUnlocks(): Promise<void> {
  const local = await db.lessonUnlocks.toArray();
  if (local.length === 0) return;
  const done: string[] = [];
  for (const u of local) {
    const row = await db.customLessons.get(u.lesson_id);
    if (!row) { if (u._synced === 1) done.push(u.lesson_id); continue; }
    if (u._synced === 1 && row.unlocked_at) { done.push(u.lesson_id); continue; }
    const at = earlierUnlock(row.unlocked_at, u.unlocked_at);
    if (row.unlock && at !== row.unlocked_at) await db.customLessons.update(u.lesson_id, { unlocked_at: at });
  }
  if (done.length) await db.lessonUnlocks.bulkDelete(done);
}

/** A cached lesson's lock status. */
export function lockStatusOf(row: Pick<LocalCustomLesson, 'unlock' | 'unlocked_at'>) {
  return lessonLockStatus(row.unlock ?? null, row.unlocked_at ?? null);
}

// ============ Listening to the end of an audio lesson ============

const LISTENED_KEY = 'audio-lessons-listened-v1';
type ListenedMap = Record<string, { at: string; synced: boolean }>;

function readListened(): ListenedMap {
  try {
    const raw = localStorage.getItem(LISTENED_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as ListenedMap) : {};
  } catch {
    return {};
  }
}

function writeListened(map: ListenedMap): void {
  try {
    localStorage.setItem(LISTENED_KEY, JSON.stringify(map));
  } catch { /* private mode: the server copy still counts */ }
}

/** When this device first heard the audio lesson to the end (null = not yet). */
export function listenedHere(audioLessonId: string): string | null {
  return readListened()[audioLessonId]?.at ?? null;
}

/**
 * A listen reached the end of an audio lesson: remembered (earliest), the lessons waiting on it
 * unlocked here at once (`auto`), and uploaded (the server unlocks its copies too). Returns the
 * lessons it unlocked on this device.
 */
export async function markAudioLessonListened(audioLessonId: string): Promise<string[]> {
  const map = readListened();
  const now = new Date().toISOString();
  // A later listen is uploaded again (it unlocks a companion made since the first one).
  map[audioLessonId] = { at: map[audioLessonId]?.at ?? now, synced: false };
  writeListened(map);
  const lessons = await db.customLessons.toArray();
  const ids = lessonsUnlockedByListen(lessons, audioLessonId);
  const unlocked: string[] = [];
  for (const id of ids) if (await unlockLesson(id, 'auto', 'audio_lesson')) unlocked.push(id);
  if (online()) void uploadListened().catch(() => {});
  return unlocked;
}

/** Upload the listens not on the server yet. */
export async function uploadListened(): Promise<void> {
  const map = readListened();
  const pending = Object.entries(map).filter(([, v]) => !v.synced);
  if (pending.length === 0) return;
  const res = await fetch(`${API_BASE}/api/audio-lessons/listened`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: pending.map(([id, v]) => ({ audio_lesson_id: id, listened_at: v.at })) }),
  });
  if (!res.ok) throw new Error(`Failed to upload listens: ${res.status}`);
  const next = readListened();
  for (const [id] of pending) if (next[id]) next[id].synced = true;
  writeListened(next);
}

/** The cached companion lesson of an audio lesson (newest), if this device has it. */
export async function localCompanionOf(audioLessonId: string): Promise<LocalCustomLesson | null> {
  const rows = (await db.customLessons.toArray()).filter(l => l.companion_of === audioLessonId);
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows[0] ?? null;
}
