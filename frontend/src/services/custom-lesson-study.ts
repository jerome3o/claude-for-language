/**
 * Custom mini lesson study service.
 *
 * Custom lessons are agent-authored (MCP tools, the in-app chat) and cached
 * whole in IndexedDB so they can be studied fully offline, mixed into the
 * study session's card flow. Completions are recorded locally as events and
 * uploaded via POST /api/custom-lessons/offline-complete (idempotent by
 * event id) — the same pattern as grammar lessons.
 */

import { CustomLessonSpec, lessonTtsTexts } from '@shared/lesson';
import {
  db,
  LocalCustomLesson,
  LocalCustomLessonCompletionEvent,
} from '../db/database';
import { API_BASE, getAuthHeaders } from '../api/client';
import { prefetchTTS } from './ttsCache';
import { getAudioWithCache, isAudioCached } from './audioCache';

/** At most this many custom lessons join a single study session, so a big
 * batch of agent-created lessons can't swamp the cards. */
export const MAX_LESSONS_PER_SESSION = 2;

interface CustomLessonListResponse {
  lessons: Array<{
    id: string;
    title: string;
    description: string | null;
    icon: string | null;
    source: string;
    status: 'active' | 'done';
    created_at: string;
    spec: CustomLessonSpec;
  }>;
}

/**
 * Push unsynced completion events, then pull the active lessons and replace
 * the local cache. Upload happens first so a lesson completed offline doesn't
 * come back as active.
 */
export async function syncCustomLessons(): Promise<{ synced: number }> {
  await uploadCustomLessonCompletions();

  const response = await fetch(`${API_BASE}/api/custom-lessons`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch custom lessons: ${response.status}`);
  }
  const data = await response.json() as CustomLessonListResponse;

  const rows: LocalCustomLesson[] = data.lessons.map(lesson => ({
    id: lesson.id,
    title: lesson.title,
    description: lesson.description,
    icon: lesson.icon,
    source: lesson.source,
    status: lesson.status,
    created_at: lesson.created_at,
    spec: lesson.spec,
    _synced_at: Date.now(),
  }));

  await db.transaction('rw', [db.customLessons, db.customLessonCompletionEvents], async () => {
    // A lesson completed locally but not yet uploaded must not come back as
    // active — keep the local 'done' for ids with a pending completion event.
    const pendingDone = new Set(
      (await db.customLessonCompletionEvents.where('_synced').equals(0).toArray()).map(e => e.lesson_id),
    );
    await db.customLessons.clear();
    await db.customLessons.bulkPut(
      rows.map(row => (pendingDone.has(row.id) ? { ...row, status: 'done' as const } : row)),
    );
  });

  return { synced: rows.length };
}

/** Upload unsynced completion events (idempotent server-side by event id). */
export async function uploadCustomLessonCompletions(): Promise<{ uploaded: number }> {
  const unsynced = await db.customLessonCompletionEvents.where('_synced').equals(0).toArray();
  if (unsynced.length === 0) return { uploaded: 0 };

  const response = await fetch(`${API_BASE}/api/custom-lessons/offline-complete`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: unsynced.map(e => ({
        id: e.id,
        lesson_id: e.lesson_id,
        correct: e.correct,
        total: e.total,
        completed_at: e.completed_at,
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to upload custom lesson completions: ${response.status}`);
  }

  await db.customLessonCompletionEvents.where('id').anyOf(unsynced.map(e => e.id)).modify({ _synced: 1 });
  return { uploaded: unsynced.length };
}

/**
 * Lessons waiting to be studied, oldest first, capped per session. These get
 * mixed into the study session's card flow (not saved for the end).
 */
export async function getPendingCustomLessons(): Promise<LocalCustomLesson[]> {
  const lessons = await db.customLessons.where('status').equals('active').toArray();
  lessons.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return lessons.slice(0, MAX_LESSONS_PER_SESSION);
}

/**
 * Record a completed lesson: append the completion event (synced up later)
 * and mark the lesson done locally so it leaves the queue immediately.
 */
export async function completeCustomLesson(
  lessonId: string,
  correct: number,
  total: number,
): Promise<LocalCustomLessonCompletionEvent> {
  const event: LocalCustomLessonCompletionEvent = {
    id: crypto.randomUUID(),
    lesson_id: lessonId,
    correct,
    total,
    completed_at: new Date().toISOString(),
    _synced: 0,
  };
  await db.customLessonCompletionEvents.put(event);
  await db.customLessons.update(lessonId, { status: 'done' });
  return event;
}

/**
 * Cache media for pending lessons so they work fully offline: TTS for every
 * Chinese sentence, and any generated describe_image illustrations (served
 * from the same R2 proxy as reader images, so they share the blob cache).
 */
export async function prefetchCustomLessonMedia(): Promise<void> {
  if (!navigator.onLine) return;

  const lessons = await getPendingCustomLessons();
  for (const lesson of lessons) {
    await prefetchTTS(lessonTtsTexts(lesson.spec));
    for (const section of lesson.spec.sections) {
      for (const ex of section.exercises) {
        if (ex.type === 'describe_image' && ex.image_url && !(await isAudioCached(ex.image_url))) {
          await getAudioWithCache(ex.image_url).catch(() => {});
        }
      }
    }
  }
}
