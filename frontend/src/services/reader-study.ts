/**
 * Reader Study Service
 *
 * Graded readers join the study rotation with the same event-sourced FSRS
 * model as cards:
 * - Reader review events are the source of truth (append-only, deduped by id)
 * - Reader scheduling state is computed from events with the shared scheduler
 * - Events sync to /api/reader-reviews (upload + cursor-paged download)
 *
 * Readers aren't deck-scoped, so they only appear in "All Decks" sessions.
 */

import {
  db,
  LocalReader,
  LocalReaderReviewEvent,
  getStudyCutoff,
  getEventSyncMeta,
  updateEventSyncMeta,
  READER_EVENT_SYNC_ID,
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
import { API_BASE } from '../api/client';

/**
 * Daily cap on NEW readers entering the rotation. One per day: skipping a
 * day must not stack up a backlog of stories at the end of a session — the
 * unread one from before is the day's reader (see ensureDailyReader, which
 * also skips generating while an unread reader exists).
 */
export const NEW_READERS_PER_DAY = 1;

/** A reader is studyable once generation finished and it actually has pages. */
export function isStudyableReader(reader: LocalReader): boolean {
  return reader.status === 'ready' && reader.pages.length > 0;
}

function toSchedulerEvents(events: LocalReaderReviewEvent[]) {
  // The shared scheduler is card-shaped; a reader is "the card" here.
  return events.map(e => ({
    id: e.id,
    card_id: e.reader_id,
    rating: e.rating,
    reviewed_at: e.reviewed_at,
  }));
}

async function getReaderEvents(readerId: string): Promise<LocalReaderReviewEvent[]> {
  return db.readerReviewEvents.where('reader_id').equals(readerId).sortBy('reviewed_at');
}

/** Scheduling fields of LocalReader derived from a computed state. */
export function readerSchedulingFields(state: ComputedCardState): Pick<
  LocalReader,
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

/** Recompute a reader's scheduling state from its full event history. */
export async function computeReaderState(readerId: string): Promise<ComputedCardState> {
  const events = await getReaderEvents(readerId);
  if (events.length === 0) {
    return initialCardState(DEFAULT_DECK_SETTINGS);
  }
  return computeCardState(toSchedulerEvents(events), DEFAULT_DECK_SETTINGS);
}

/** Recompute from events and persist onto the reader row (state repair). */
export async function fixReaderState(readerId: string): Promise<ComputedCardState> {
  const computed = await computeReaderState(readerId);
  await db.readers.update(readerId, readerSchedulingFields(computed));
  return computed;
}

/**
 * Record a review of a reader: append the event and update the cached state.
 * Mirrors the card flow (event first, state derived from events).
 */
export async function recordReaderReview(
  readerId: string,
  rating: Rating,
  timeSpentMs: number
): Promise<{ event: LocalReaderReviewEvent; newState: ComputedCardState }> {
  const now = new Date().toISOString();

  const events = await getReaderEvents(readerId);
  const currentState = events.length > 0
    ? computeCardState(toSchedulerEvents(events), DEFAULT_DECK_SETTINGS)
    : initialCardState(DEFAULT_DECK_SETTINGS);
  const newState = applyReview(currentState, rating, DEFAULT_DECK_SETTINGS, now);

  const event: LocalReaderReviewEvent = {
    id: crypto.randomUUID(),
    reader_id: readerId,
    rating,
    time_spent_ms: timeSpentMs,
    reviewed_at: now,
    _synced: 0,
    _created_at: now,
  };

  await db.readerReviewEvents.put(event);
  await db.readers.update(readerId, readerSchedulingFields(newState));

  return { event, newState };
}

/** FSRS interval previews for the reader rating buttons. */
export function getReaderIntervalPreviews(reader: LocalReader): Record<Rating, IntervalPreview> {
  const state: ComputedCardState = {
    queue: reader.queue,
    stability: reader.stability || reader.interval || 1,
    difficulty: reader.difficulty || 5,
    scheduled_days: reader.interval,
    reps: reader.repetitions,
    lapses: reader.lapses,
    next_review_at: reader.next_review_at,
    due_timestamp: reader.due_timestamp,
    last_reviewed_at: reader.last_reviewed_at,
    ease_factor: 2.5,
    interval: reader.interval,
    repetitions: reader.repetitions,
    learning_step: 0,
  };
  const previews = getIntervalPreviews(state, DEFAULT_DECK_SETTINGS, new Date());
  const result = {} as Record<Rating, IntervalPreview>;
  for (const rating of [0, 1, 2, 3] as Rating[]) {
    const p = previews.find(pr => pr.rating === rating);
    result[rating] = p
      ? { intervalText: p.intervalText, queue: p.nextState }
      : { intervalText: '?', queue: reader.queue };
  }
  return result;
}

/** Count readers whose first-ever review happened today (for the daily cap). */
async function countReadersIntroducedToday(): Promise<number> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const events = await db.readerReviewEvents.toArray();
  const firstReviewByReader = new Map<string, string>();
  for (const e of events) {
    const existing = firstReviewByReader.get(e.reader_id);
    if (!existing || e.reviewed_at < existing) {
      firstReviewByReader.set(e.reader_id, e.reviewed_at);
    }
  }

  let count = 0;
  for (const first of firstReviewByReader.values()) {
    if (first >= todayStr) count++;
  }
  return count;
}

/**
 * Readers due for study right now:
 * - Learning/relearning readers due by the study cutoff (end of today)
 * - Review readers due by the cutoff
 * - NEW readers, newest first, capped at NEW_READERS_PER_DAY per day
 */
export async function getDueReaders(): Promise<LocalReader[]> {
  const cutoff = getStudyCutoff();
  const readers = (await db.readers.toArray()).filter(isStudyableReader);

  const due: LocalReader[] = [];
  const newReaders: LocalReader[] = [];

  for (const reader of readers) {
    if (reader.queue === CardQueue.NEW) {
      newReaders.push(reader);
    } else if (reader.queue === CardQueue.LEARNING || reader.queue === CardQueue.RELEARNING) {
      if (!reader.due_timestamp || reader.due_timestamp <= cutoff.ts) due.push(reader);
    } else if (reader.queue === CardQueue.REVIEW) {
      if (!reader.next_review_at || reader.next_review_at <= cutoff.iso) due.push(reader);
    }
  }

  if (newReaders.length > 0) {
    const introducedToday = await countReadersIntroducedToday();
    const budget = Math.max(0, NEW_READERS_PER_DAY - introducedToday);
    if (budget > 0) {
      // Newest first so today's daily reader shows up today
      newReaders.sort((a, b) => b.created_at.localeCompare(a.created_at));
      due.push(...newReaders.slice(0, budget));
    }
  }

  return due;
}

// ============ Event Sync ============

interface ServerReaderReviewEvent {
  id: string;
  reader_id: string;
  rating: Rating;
  time_spent_ms: number | null;
  reviewed_at: string;
  created_at?: string;
}

const MAX_DOWNLOAD_PAGES = 100;

/** Upload unsynced reader review events. Orphans (deleted readers) are
 * skipped server-side, so everything sent can be marked synced. */
export async function syncReaderReviewEvents(authToken: string | null): Promise<{
  synced: number;
  errors: string[];
}> {
  if (!authToken) {
    return { synced: 0, errors: ['Not authenticated'] };
  }

  const unsynced = await db.readerReviewEvents.where('_synced').equals(0).limit(200).toArray();
  if (unsynced.length === 0) {
    return { synced: 0, errors: [] };
  }

  try {
    const response = await fetch(`${API_BASE}/api/reader-reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        events: unsynced.map(e => ({
          id: e.id,
          reader_id: e.reader_id,
          rating: e.rating,
          reviewed_at: e.reviewed_at,
          time_spent_ms: e.time_spent_ms,
        })),
      }),
    });

    if (!response.ok) {
      return { synced: 0, errors: [await response.text()] };
    }

    await db.readerReviewEvents.where('id').anyOf(unsynced.map(e => e.id)).modify({ _synced: 1 });
    return { synced: unsynced.length, errors: [] };
  } catch (err) {
    return { synced: 0, errors: [err instanceof Error ? err.message : 'Unknown error'] };
  }
}

/** Download reader review events from other devices; recompute affected readers. */
export async function downloadReaderReviewEvents(authToken: string | null): Promise<{
  downloaded: number;
  errors: string[];
}> {
  if (!authToken) {
    return { downloaded: 0, errors: ['Not authenticated'] };
  }

  const syncMeta = await getEventSyncMeta(READER_EVENT_SYNC_ID);
  let since = syncMeta?.last_event_synced_at || '1970-01-01 00:00:00';
  let afterId = '';
  let downloaded = 0;
  const affectedReaderIds = new Set<string>();

  try {
    for (let page = 0; page < MAX_DOWNLOAD_PAGES; page++) {
      const params = new URLSearchParams({ since });
      if (afterId) params.set('after_id', afterId);
      const response = await fetch(`${API_BASE}/api/reader-reviews?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });

      if (!response.ok) {
        return { downloaded, errors: [await response.text()] };
      }

      const result = await response.json() as {
        events: ServerReaderReviewEvent[];
        has_more: boolean;
      };

      if (result.events.length === 0) break;

      for (const serverEvent of result.events) {
        const exists = await db.readerReviewEvents.get(serverEvent.id);
        if (!exists) {
          await db.readerReviewEvents.put({
            id: serverEvent.id,
            reader_id: serverEvent.reader_id,
            rating: serverEvent.rating,
            time_spent_ms: serverEvent.time_spent_ms,
            reviewed_at: serverEvent.reviewed_at,
            _synced: 1,
            _created_at: new Date().toISOString(),
          });
          downloaded++;
          affectedReaderIds.add(serverEvent.reader_id);
        }
      }

      const last = result.events[result.events.length - 1];
      const cursor = last.created_at || last.reviewed_at;
      if (cursor === since && last.id === afterId) break; // no forward progress
      since = cursor;
      afterId = last.id;
      await updateEventSyncMeta(since, READER_EVENT_SYNC_ID);

      if (!result.has_more) break;
    }

    for (const readerId of affectedReaderIds) {
      if (await db.readers.get(readerId)) {
        await fixReaderState(readerId);
      }
    }

    return { downloaded, errors: [] };
  } catch (err) {
    return { downloaded, errors: [err instanceof Error ? err.message : 'Unknown error'] };
  }
}
