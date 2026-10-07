/**
 * Reader Study Service
 *
 * Graded readers are read ONCE, never repeated (shared/study/daily-reader.ts):
 * - the study session offers ONE unread story a day (the daily reader keeps
 *   being offered until it is read), never one that was already read;
 * - after reading, Finish (or listening to the end with ▶ Play whole story)
 *   writes a reader review event — that event is what "read" means;
 * - old reads can still be opened by hand from the Readers list.
 * - Reader review events are the source of truth (append-only, deduped by id);
 *   the row's read state is computed from them.
 * - Events sync to /api/reader-reviews (upload + cursor-paged download)
 *
 * Readers aren't deck-scoped, so they only appear in "All Decks" sessions.
 */

import {
  db,
  LocalReader,
  LocalReaderReviewEvent,
  getEventSyncMeta,
  updateEventSyncMeta,
  READER_EVENT_SYNC_ID,
} from '../db/database';
import {
  READERS_PER_DAY as SHARED_READERS_PER_DAY,
  nextUnreadReader as sharedNextUnreadReader,
  pickTodaysReader as sharedPickTodaysReader,
} from '@shared/study/daily-reader';
import { Rating, CardQueue } from '../types';
import { API_BASE } from '../api/client';
import { oneOffOnlyTargetIds, recordTargetDone } from './homework';

/** ONE graded reader a day (Jerome's rule) — see pickTodaysReader. */
export const READERS_PER_DAY = SHARED_READERS_PER_DAY;

/** A reader is studyable once generation finished and it actually has pages. */
export function isStudyableReader(reader: LocalReader): boolean {
  return reader.status === 'ready' && reader.pages.length > 0;
}

/** Whether a cached reader was read (it has at least one finish). */
export function isReaderRead(reader: Pick<LocalReader, 'queue'>): boolean {
  return reader.queue !== CardQueue.NEW;
}

type ReadFields = Pick<
  LocalReader,
  'queue' | 'stability' | 'difficulty' | 'lapses' | 'interval' | 'repetitions' |
  'next_review_at' | 'due_timestamp' | 'last_reviewed_at' | 'retired'
>;

/** The row fields for a reader's history: NEW until the first finish, then REVIEW = read. Never due again. */
export function readerReadFields(events: Array<Pick<LocalReaderReviewEvent, 'reviewed_at'>>): ReadFields {
  let last: string | null = null;
  for (const e of events) if (!last || e.reviewed_at > last) last = e.reviewed_at;
  return {
    queue: events.length > 0 ? CardQueue.REVIEW : CardQueue.NEW,
    stability: 0,
    difficulty: 0,
    lapses: 0,
    interval: 0,
    repetitions: events.length,
    next_review_at: null,
    due_timestamp: null,
    last_reviewed_at: last,
    retired: false,
  };
}

/** Recompute one reader's read state from its events and persist it (state repair). */
export async function fixReaderState(readerId: string): Promise<ReadFields> {
  const events = await db.readerReviewEvents.where('reader_id').equals(readerId).toArray();
  const fields = readerReadFields(events);
  await db.readers.update(readerId, fields);
  return fields;
}

/** Recompute every cached reader's read state (after a sync). */
export async function recomputeAllReaderRows(): Promise<void> {
  const [readers, events] = await Promise.all([db.readers.toArray(), db.readerReviewEvents.toArray()]);
  if (readers.length === 0) return;
  const byReader = new Map<string, LocalReaderReviewEvent[]>();
  for (const e of events) {
    const list = byReader.get(e.reader_id);
    if (list) list.push(e); else byReader.set(e.reader_id, [e]);
  }
  await db.readers.bulkPut(readers.map(r => ({ ...r, ...readerReadFields(byReader.get(r.id) ?? []) })));
}

/** How a reader was finished — the analytics `how` of reader.finish. */
export type ReaderFinishHow = 'finish' | 'listened';

/**
 * Record that a reader was read: append the event and update the row. Mirrors
 * the card flow (event first, state derived from events). The server's
 * reader_review_events still carry a rating; a finish is stored as Good (2).
 */
export async function recordReaderFinish(
  readerId: string,
  timeSpentMs: number,
): Promise<{ event: LocalReaderReviewEvent }> {
  const now = new Date().toISOString();

  const event: LocalReaderReviewEvent = {
    id: crypto.randomUUID(),
    reader_id: readerId,
    rating: 2 as Rating,
    time_spent_ms: timeSpentMs,
    reviewed_at: now,
    _synced: 0,
    _created_at: now,
  };

  await db.readerReviewEvents.put(event);
  await fixReaderState(readerId);
  // Reading it anywhere completes its homework (docs/HOMEWORK.md).
  await recordTargetDone('reader', readerId);

  return { event };
}

/** Whether a stored UTC ISO timestamp falls on today's LOCAL date. A string
 * prefix comparison would use the UTC date, which in timezones ahead of UTC
 * shifts the "day" boundary to midday (same bug class as
 * grammarCompletedToday's isSameLocalDay). */
function isTodayLocal(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Ids of readers with at least one review on today's LOCAL date. */
export async function readersReadToday(): Promise<Set<string>> {
  const events = await db.readerReviewEvents.toArray();
  const ids = new Set<string>();
  for (const e of events) {
    if (isTodayLocal(e.reviewed_at)) ids.add(e.reader_id);
  }
  return ids;
}

const offerRow = (r: LocalReader) => ({ id: r.id, created_at: r.created_at, studyable: isStudyableReader(r), read: isReaderRead(r), reader: r });

/**
 * Today's ONE reader, or null (shared/study/daily-reader.ts): nothing once a
 * story was read today, else the newest UNREAD story. A read story is never
 * offered again.
 */
export function pickTodaysReader(readers: LocalReader[], readToday: Set<string>): LocalReader | null {
  return sharedPickTodaysReader(readers.map(offerRow), readToday.size > 0)?.reader ?? null;
}

/** The unread story the session offers next, today or (once today's was read) tomorrow. */
export function nextUnreadReader(readers: LocalReader[]): LocalReader | null {
  return sharedNextUnreadReader(readers.map(offerRow))?.reader ?? null;
}

/** The readers the session rotates: everything but one-off homework readers (read in the homework pass). */
async function rotationReaders(): Promise<{ readers: LocalReader[]; readToday: Set<string> }> {
  const [allReaders, readToday, oneOffOnly] = await Promise.all([db.readers.toArray(), readersReadToday(), oneOffOnlyTargetIds()]);
  return {
    readers: allReaders.filter(r => !oneOffOnly.has(r.id)),
    readToday: new Set([...readToday].filter(id => !oneOffOnly.has(id))),
  };
}

/**
 * Readers for this study session: at most ONE (READERS_PER_DAY) — see
 * pickTodaysReader. An empty array means today's story has been read (or
 * there is no unread one yet; ensureDailyReader generates one).
 */
export async function getDueReaders(): Promise<LocalReader[]> {
  const { readers, readToday } = await rotationReaders();
  const reader = pickTodaysReader(readers, readToday);
  return reader ? [reader] : [];
}

/** Rotation state for ensureDailyReader / prefetch: read today? the next unread story? */
export async function readerRotationState(): Promise<{ readToday: boolean; next: LocalReader | null }> {
  const { readers, readToday } = await rotationReaders();
  return { readToday: readToday.size > 0, next: nextUnreadReader(readers) };
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
