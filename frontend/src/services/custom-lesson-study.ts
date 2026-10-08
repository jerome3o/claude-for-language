/**
 * Custom mini lesson study service.
 *
 * Custom lessons are agent-authored (MCP tools, the in-app chats), cached
 * whole in IndexedDB for fully offline study, and come back on the "revisit
 * later" schedule (shared/study/revisit.ts) — a lesson is a
 * big chunk, not a flashcard, so Good means "in two weeks", not "in 10 min":
 * - Completion events are the source of truth (append-only, deduped by id),
 *   each carrying the learner's Again/Hard/Good/Easy rating; "Done for good"
 *   is a revisit event (services/revisit.ts).
 * - The lesson row caches the schedule computed from those events.
 * - Events upload via POST /api/custom-lessons/offline-complete (idempotent
 *   by id); other devices' events come down inside GET /api/custom-lessons
 *   (a lesson has only a handful, so they ride along with the content).
 */

import { CustomLessonSpec, LessonAttemptData, lessonTtsTexts, lessonConversationClips } from '@shared/lesson';
import {
  pickTodaysLessons,
  newLessonsIntroducedToday,
  type RevisitState,
} from '@shared/study/revisit';
import { lessonsStartedToday } from './lessonsStarted';
import { audioForConversation } from './conversationAudio';
import {
  db,
  getStudyCutoff,
  LocalCustomLesson,
  LocalCustomLessonCompletionEvent,
} from '../db/database';
import { Rating, IntervalPreview } from '../types';
import { API_BASE, getAuthHeaders } from '../api/client';
import { homeworkPassTargetIds, oneOffOnlyTargetIds, recordTargetDone } from './homework';
import { prefetchConversationClips, prefetchTTSClips } from './ttsCache';
import { describeImageKeys } from '@shared/lesson/images';
import { prefetchStrokeData } from './strokeData';
import { writableCharacters } from '@shared/strokes';
import { getAudioWithCache, isAudioCached } from './audioCache';
import {
  computeItemRevisitState,
  markRevisit,
  recomputeAllRevisitStates,
  refreshRevisitRow,
  revisitButtonPreviews,
  readRevisitSettings,
  revisitRowFields,
  rowRevisitState,
} from './revisit';

interface ServerCompletion {
  id: string;
  lesson_id: string;
  correct: number;
  total: number;
  completed_at: string;
  rating: number | null;
}

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
    completions?: ServerCompletion[];
  }>;
}

/** Scheduling fields of LocalCustomLesson derived from a revisit state. */
export const lessonSchedulingFields = revisitRowFields;

/** A lesson's schedule from its full history (completions + Done for good / Bring back). */
export function computeLessonState(lessonId: string): Promise<RevisitState> {
  return computeItemRevisitState('lesson', lessonId);
}

/**
 * Record a completed run of a lesson: append the rated completion event and
 * update the cached scheduling state. Mirrors the card/reader flow (event
 * first, state derived from events).
 */
/** A recording made in one exercise of an attempt, keyed like the attempt data. */
export interface LessonRecording {
  media_key: string;
  blob: Blob;
}

export async function completeCustomLesson(
  lessonId: string,
  correct: number,
  total: number,
  rating: Rating,
  attempt?: LessonAttemptData,
  recordings: LessonRecording[] = [],
  /** "Done for good": finished, and never scheduled again. */
  opts: { retire?: boolean; source?: string } = {},
): Promise<{ event: LocalCustomLessonCompletionEvent; newState: RevisitState }> {
  const now = new Date().toISOString();

  const event: LocalCustomLessonCompletionEvent = {
    id: crypto.randomUUID(),
    lesson_id: lessonId,
    correct,
    total,
    completed_at: now,
    rating,
    attempt,
    _synced: 0,
  };

  await db.customLessonCompletionEvents.put(event);
  // Recordings wait in their own queue: they upload after the attempt has
  // reached the server (the media endpoint 404s until then).
  for (const rec of recordings) {
    await db.lessonAttemptMedia.put({
      id: `${event.id}:${rec.media_key}`,
      attempt_id: event.id,
      media_key: rec.media_key,
      blob: rec.blob,
      content_type: rec.blob.type || 'audio/webm',
      created_at: now,
      _synced: 0,
    });
  }
  if (opts.retire) await markRevisit('lesson', lessonId, 'retire', opts.source);
  const newState = await refreshRevisitRow('lesson', lessonId);
  // Finishing a lesson anywhere completes its homework (docs/HOMEWORK.md).
  await recordTargetDone('lesson', lessonId);

  return { event, newState };
}

/** "Back in 2 wk"-style labels for the lesson rating buttons (shared/study/revisit.ts). */
export function getCustomLessonIntervalPreviews(lesson: LocalCustomLesson): Record<Rating, IntervalPreview> {
  return revisitButtonPreviews(lesson);
}

/** Whether a stored UTC ISO timestamp falls on today's LOCAL date. */
function isTodayLocal(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/** How many lessons were REVISITED today (finished today after an earlier finish). */
export async function lessonRevisitsToday(): Promise<number> {
  const events = await db.customLessonCompletionEvents.toArray();
  const first = new Map<string, string>();
  for (const e of events) {
    const f = first.get(e.lesson_id);
    if (!f || e.completed_at < f) first.set(e.lesson_id, e.completed_at);
  }
  const revisited = new Set<string>();
  for (const e of events) {
    if (isTodayLocal(e.completed_at) && e.completed_at > (first.get(e.lesson_id) ?? '')) revisited.add(e.lesson_id);
  }
  return revisited.size;
}

/** Local midnight today (ms) — the start of "today" for the new-lesson count. */
function localDayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** How many NEW lessons were introduced today (first-ever finish today), one-off homework left out. */
export async function newLessonsToday(exclude?: ReadonlySet<string>): Promise<number> {
  const events = await db.customLessonCompletionEvents.toArray();
  return newLessonsIntroducedToday(events, localDayStartMs(), exclude ?? await oneOffOnlyTargetIds());
}

/**
 * Today's mini lessons, mixed into the session's card flow (the ONE rule,
 * `pickTodaysLessons` in shared/study/revisit.ts):
 * - revisits due by the study cutoff (end of today), most overdue first, at
 *   most MAX_LESSON_REVISITS_PER_DAY a day; they never count against the
 *   new-lesson budget;
 * - NEW lessons, oldest first, paced per local DAY: at most "New lessons a
 *   day" (Settings → Lessons & readers, default 1) minus the lessons already
 *   introduced today (from completion events). A homework lesson the tutor
 *   sent (both) comes on top: it doesn't take that place, and finishing it
 *   doesn't use it up. A lesson opened today and left half-way keeps its place.
 * Done-for-good lessons and one-off-only homework are never offered.
 */
export async function getDueCustomLessons(): Promise<LocalCustomLesson[]> {
  const cutoff = getStudyCutoff();
  const [allLessons, events, oneOffOnly, homeworkPass, revisitedToday] = await Promise.all([
    db.customLessons.toArray(),
    db.customLessonCompletionEvents.toArray(),
    oneOffOnlyTargetIds(),
    homeworkPassTargetIds(),
    lessonRevisitsToday(),
  ]);
  const picked = pickTodaysLessons({
    lessons: allLessons.map(l => ({ id: l.id, created_at: l.created_at, state: rowRevisitState(l), row: l })),
    events,
    dayStartMs: localDayStartMs(),
    cutoffMs: cutoff.ts,
    oneOffOnly,
    homeworkPass,
    startedToday: lessonsStartedToday(),
    revisitedToday,
    perDay: readRevisitSettings().new_lessons_per_day,
  });
  return picked.map(p => p.row);
}

/**
 * Push unsynced completion events, then pull all lessons (spec + completion
 * history) and rebuild the local cache. Scheduling state is recomputed from
 * the merged event set — server events from other devices plus any local
 * events that haven't uploaded yet — so state converges everywhere.
 */
export async function syncCustomLessons(): Promise<{ synced: number }> {
  await uploadCustomLessonCompletions();
  // Recordings from a just-finished attempt go up right behind it.
  await uploadLessonAttemptMedia().catch(err => console.warn('[custom-lessons] recording upload failed:', err));

  const response = await fetch(`${API_BASE}/api/custom-lessons`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch custom lessons: ${response.status}`);
  }
  const data = await response.json() as CustomLessonListResponse;

  await db.transaction('rw', [db.customLessons, db.customLessonCompletionEvents], async () => {
    // Merge server completion events into the local event table
    for (const lesson of data.lessons) {
      for (const completion of lesson.completions ?? []) {
        const exists = await db.customLessonCompletionEvents.get(completion.id);
        if (!exists) {
          await db.customLessonCompletionEvents.put({
            id: completion.id,
            lesson_id: completion.lesson_id,
            correct: completion.correct,
            total: completion.total,
            completed_at: completion.completed_at,
            rating: (completion.rating ?? null) as Rating | null,
            _synced: 1,
          });
        }
      }
    }

    // Rebuild the lesson cache, recomputing scheduling from the full event set
    const serverIds = new Set(data.lessons.map(l => l.id));
    await db.customLessons.clear();
    for (const lesson of data.lessons) {
      await db.customLessons.put({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        icon: lesson.icon,
        source: lesson.source,
        status: lesson.status,
        created_at: lesson.created_at,
        spec: lesson.spec,
        ...revisitRowFields({ status: 'new', due_ms: null, gap_days: 0, last_ms: null, finishes: 0 }),
        _synced_at: Date.now(),
      });
    }

    // Drop orphaned events of lessons deleted on the server
    const allEvents = await db.customLessonCompletionEvents.toArray();
    const orphaned = allEvents.filter(e => !serverIds.has(e.lesson_id)).map(e => e.id);
    if (orphaned.length > 0) {
      await db.customLessonCompletionEvents.bulkDelete(orphaned);
    }
  });
  // The schedule from the merged history (+ Done for good / Bring back).
  await recomputeAllRevisitStates();

  return { synced: data.lessons.length };
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
        rating: e.rating,
        ...(e.attempt ? { attempt: e.attempt } : {}),
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to upload custom lesson completions: ${response.status}`);
  }

  await db.customLessonCompletionEvents.where('id').anyOf(unsynced.map(e => e.id)).modify({ _synced: 1 });
  return { uploaded: unsynced.length };
}

/** Keep uploaded recordings on the device this long (the learner may replay them). */
const UPLOADED_MEDIA_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Upload recordings made in lesson attempts (after the attempts themselves —
 * call uploadCustomLessonCompletions first). Idempotent server-side (PUT by
 * attempt + media key); a 404 means the attempt hasn't landed yet and the
 * recording waits for the next sync.
 */
export async function uploadLessonAttemptMedia(): Promise<{ uploaded: number }> {
  const pending = await db.lessonAttemptMedia.where('_synced').equals(0).toArray();
  let uploaded = 0;
  for (const media of pending) {
    try {
      const response = await fetch(
        `${API_BASE}/api/lesson-attempts/${encodeURIComponent(media.attempt_id)}/media/${encodeURIComponent(media.media_key)}`,
        { method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': media.content_type }, body: media.blob },
      );
      if (response.ok) {
        await db.lessonAttemptMedia.update(media.id, { _synced: 1, error: undefined });
        uploaded++;
      } else {
        const attempts = (media.attempts ?? 0) + 1;
        // 413 / 400 won't get better; give up after a few tries so the queue can't clog.
        const giveUp = response.status === 413 || response.status === 400 || attempts >= 20;
        await db.lessonAttemptMedia.update(media.id, { attempts, error: `HTTP ${response.status}`, ...(giveUp ? { _synced: 1 } : {}) });
      }
    } catch (err) {
      await db.lessonAttemptMedia.update(media.id, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  const cutoff = new Date(Date.now() - UPLOADED_MEDIA_TTL_MS).toISOString();
  const old = await db.lessonAttemptMedia.where('_synced').equals(1).filter(m => m.created_at < cutoff).primaryKeys();
  if (old.length > 0) await db.lessonAttemptMedia.bulkDelete(old);
  return { uploaded };
}

/** Every character a lesson asks to be written by hand (the stroke pad needs their data). */
export function lessonHandwritingText(spec: CustomLessonSpec): string {
  let text = '';
  for (const section of spec.sections) {
    for (const ex of section.exercises) {
      if (ex.type === 'write_handwriting') text += ex.answer.hanzi;
      else if (ex.type === 'dictation' && ex.input === 'handwrite') text += ex.audio.hanzi;
    }
  }
  return text;
}

/**
 * Cache media for upcoming lessons so they work fully offline: TTS for every
 * Chinese sentence, and any generated describe_image illustrations (served
 * from the same R2 proxy as reader images, so they share the blob cache).
 */
export async function prefetchCustomLessonMedia(): Promise<void> {
  if (!navigator.onLine) return;

  const lessons = await getDueCustomLessons();
  for (const lesson of lessons) {
    await prefetchTTSClips(lessonTtsTexts(lesson.spec).map(text => ({ text })));
    // Conversation lines in this account's voices / speed / delivery (the ⚙︎ Audio menu).
    await prefetchConversationClips(lessonConversationClips(lesson.spec, audioForConversation));
    // Stroke-order data for handwriting, so the writing pad checks strokes offline.
    const handwritten = lessonHandwritingText(lesson.spec);
    if (handwritten) await prefetchStrokeData(writableCharacters(handwritten)).catch(() => {});
  }
  // Pictures of EVERY lesson on the device, not only today's: homework-only
  // lessons skip the FSRS mix, and a picture drawn after the lesson first
  // synced arrives with a later sync (its key written in server-side).
  for (const lesson of await db.customLessons.toArray()) {
    for (const key of describeImageKeys(lesson.spec)) {
      if (!(await isAudioCached(key))) await getAudioWithCache(key).catch(() => {});
    }
  }
}
