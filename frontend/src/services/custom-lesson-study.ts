/**
 * Custom mini lesson study service.
 *
 * Custom lessons are agent-authored (MCP tools, the in-app chats), cached
 * whole in IndexedDB for fully offline study, and scheduled with the same
 * event-sourced FSRS model as cards and readers:
 * - Completion events are the source of truth (append-only, deduped by id),
 *   each carrying the learner's Again/Hard/Good/Easy rating.
 * - The lesson row caches the scheduling state computed from those events.
 * - Events upload via POST /api/custom-lessons/offline-complete (idempotent
 *   by id); other devices' events come down inside GET /api/custom-lessons
 *   (a lesson has only a handful, so they ride along with the content).
 */

import { CustomLessonSpec, lessonTtsTexts } from '@shared/lesson';
import {
  db,
  getStudyCutoff,
  LocalCustomLesson,
  LocalCustomLessonCompletionEvent,
} from '../db/database';
import {
  computeCardState,
  initialCardState,
  applyReview,
  getIntervalPreviews,
  DEFAULT_DECK_SETTINGS,
  ComputedCardState,
} from '@shared/scheduler';
import { Rating, IntervalPreview, CardQueue } from '../types';
import { API_BASE, getAuthHeaders } from '../api/client';
import { prefetchTTS } from './ttsCache';
import { getAudioWithCache, isAudioCached } from './audioCache';

/** At most this many NEW (never-studied) lessons join a single study session,
 * so a big batch of agent-created lessons can't swamp the cards. Lessons due
 * for FSRS review are never capped — that's the schedule talking. */
export const MAX_NEW_LESSONS_PER_SESSION = 2;

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

function toSchedulerEvents(events: LocalCustomLessonCompletionEvent[]) {
  // The shared scheduler is card-shaped; the lesson is "the card" here.
  // Legacy events without a rating count as Good.
  return events.map(e => ({
    id: e.id,
    card_id: e.lesson_id,
    rating: (e.rating ?? 2) as Rating,
    reviewed_at: e.completed_at,
  }));
}

async function getLessonEvents(lessonId: string): Promise<LocalCustomLessonCompletionEvent[]> {
  return db.customLessonCompletionEvents.where('lesson_id').equals(lessonId).sortBy('completed_at');
}

/** Scheduling fields of LocalCustomLesson derived from a computed state. */
export function lessonSchedulingFields(state: ComputedCardState): Pick<
  LocalCustomLesson,
  'queue' | 'stability' | 'difficulty' | 'lapses' | 'interval' | 'repetitions' |
  'next_review_at' | 'due_timestamp' | 'last_reviewed_at'
> {
  return {
    queue: state.queue,
    stability: state.stability,
    difficulty: state.difficulty,
    lapses: state.lapses,
    interval: state.interval,
    repetitions: state.repetitions,
    next_review_at: state.next_review_at,
    due_timestamp: state.due_timestamp,
    last_reviewed_at: state.last_reviewed_at,
  };
}

/** Recompute a lesson's scheduling state from its full event history. */
export async function computeLessonState(lessonId: string): Promise<ComputedCardState> {
  const events = await getLessonEvents(lessonId);
  if (events.length === 0) {
    return initialCardState(DEFAULT_DECK_SETTINGS);
  }
  return computeCardState(toSchedulerEvents(events), DEFAULT_DECK_SETTINGS);
}

/**
 * Record a completed run of a lesson: append the rated completion event and
 * update the cached scheduling state. Mirrors the card/reader flow (event
 * first, state derived from events).
 */
export async function completeCustomLesson(
  lessonId: string,
  correct: number,
  total: number,
  rating: Rating,
): Promise<{ event: LocalCustomLessonCompletionEvent; newState: ComputedCardState }> {
  const now = new Date().toISOString();

  const events = await getLessonEvents(lessonId);
  const currentState = events.length > 0
    ? computeCardState(toSchedulerEvents(events), DEFAULT_DECK_SETTINGS)
    : initialCardState(DEFAULT_DECK_SETTINGS);
  const newState = applyReview(currentState, rating, DEFAULT_DECK_SETTINGS, now);

  const event: LocalCustomLessonCompletionEvent = {
    id: crypto.randomUUID(),
    lesson_id: lessonId,
    correct,
    total,
    completed_at: now,
    rating,
    _synced: 0,
  };

  await db.customLessonCompletionEvents.put(event);
  await db.customLessons.update(lessonId, lessonSchedulingFields(newState));

  return { event, newState };
}

/** FSRS interval previews for the lesson rating buttons. */
export function getCustomLessonIntervalPreviews(lesson: LocalCustomLesson): Record<Rating, IntervalPreview> {
  const state: ComputedCardState = {
    queue: lesson.queue ?? CardQueue.NEW,
    stability: lesson.stability || lesson.interval || 1,
    difficulty: lesson.difficulty || 5,
    scheduled_days: lesson.interval ?? 0,
    reps: lesson.repetitions ?? 0,
    lapses: lesson.lapses ?? 0,
    next_review_at: lesson.next_review_at ?? null,
    due_timestamp: lesson.due_timestamp ?? null,
    last_reviewed_at: lesson.last_reviewed_at ?? null,
    ease_factor: 2.5,
    interval: lesson.interval ?? 0,
    repetitions: lesson.repetitions ?? 0,
    learning_step: 0,
  };
  const previews = getIntervalPreviews(state, DEFAULT_DECK_SETTINGS, new Date());
  const result = {} as Record<Rating, IntervalPreview>;
  for (const rating of [0, 1, 2, 3] as Rating[]) {
    const p = previews.find(pr => pr.rating === rating);
    result[rating] = p
      ? { intervalText: p.intervalText, queue: p.nextState }
      : { intervalText: '?', queue: lesson.queue ?? CardQueue.NEW };
  }
  return result;
}

/**
 * Lessons due for study right now, mixed into the session's card flow:
 * - Learning/relearning lessons due by the study cutoff (end of today)
 * - Review lessons due by the cutoff
 * - NEW lessons, oldest first, capped at MAX_NEW_LESSONS_PER_SESSION
 * Learning-due lessons sort first so an Again'd lesson comes back promptly.
 */
export async function getDueCustomLessons(): Promise<LocalCustomLesson[]> {
  const cutoff = getStudyCutoff();
  const lessons = await db.customLessons.toArray();

  const due: LocalCustomLesson[] = [];
  const fresh: LocalCustomLesson[] = [];

  for (const lesson of lessons) {
    const queue = lesson.queue ?? CardQueue.NEW;
    if (queue === CardQueue.NEW) {
      fresh.push(lesson);
    } else if (queue === CardQueue.LEARNING || queue === CardQueue.RELEARNING) {
      if (!lesson.due_timestamp || lesson.due_timestamp <= cutoff.ts) due.push(lesson);
    } else if (queue === CardQueue.REVIEW) {
      if (!lesson.next_review_at || lesson.next_review_at <= cutoff.iso) due.push(lesson);
    }
  }

  due.sort((a, b) => (a.due_timestamp ?? 0) - (b.due_timestamp ?? 0));
  fresh.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...due, ...fresh.slice(0, MAX_NEW_LESSONS_PER_SESSION)];
}

/**
 * Push unsynced completion events, then pull all lessons (spec + completion
 * history) and rebuild the local cache. Scheduling state is recomputed from
 * the merged event set — server events from other devices plus any local
 * events that haven't uploaded yet — so state converges everywhere.
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
      const events = await getLessonEvents(lesson.id);
      const state = events.length > 0
        ? computeCardState(toSchedulerEvents(events), DEFAULT_DECK_SETTINGS)
        : initialCardState(DEFAULT_DECK_SETTINGS);
      await db.customLessons.put({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        icon: lesson.icon,
        source: lesson.source,
        status: lesson.status,
        created_at: lesson.created_at,
        spec: lesson.spec,
        ...lessonSchedulingFields(state),
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
 * Cache media for upcoming lessons so they work fully offline: TTS for every
 * Chinese sentence, and any generated describe_image illustrations (served
 * from the same R2 proxy as reader images, so they share the blob cache).
 */
export async function prefetchCustomLessonMedia(): Promise<void> {
  if (!navigator.onLine) return;

  const lessons = await getDueCustomLessons();
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
