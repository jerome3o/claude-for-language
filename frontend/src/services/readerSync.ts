/**
 * Reader content sync + offline media prefetch.
 *
 * Readers are synced into IndexedDB so study sessions work fully offline:
 * - Content (titles, pages) comes from the server; scheduling state is local
 *   (computed from readerReviewEvents), so upserts never touch scheduling.
 * - Page images are R2 objects served from /api/audio/<key> — the same proxy
 *   as audio — so they reuse the existing media blob cache.
 * - Page TTS has no stored URL (it's generated on demand), so we generate and
 *   cache it ahead of time — every page of the next unread story, as soon as
 *   it exists (listen-first: it must play offline, on the train).
 */

import { db, getDueNoteIds, LocalReader, LocalReaderPage } from '../db/database';
import { shouldGenerateDailyReader } from '@shared/study/daily-reader';
import { API_BASE, getAuthHeaders, generatePracticeTTS, generateReaderPageImage, generateDailyReader, getLocalDateString } from '../api/client';
import { GradedReaderWithPages, DEFAULT_MINIMAX_VOICE } from '../types';
import { getAudioWithCache, getCachedAudio, cacheAudio, isAudioCached } from './audioCache';
import { base64ToBlob } from './ttsCache';
import { readerReadFields, recomputeAllReaderRows, readerRotationState } from './reader-study';

function pageToLocal(page: GradedReaderWithPages['pages'][number]): LocalReaderPage {
  return {
    id: page.id,
    page_number: page.page_number,
    content_chinese: page.content_chinese,
    content_pinyin: page.content_pinyin,
    content_english: page.content_english,
    image_url: page.image_url,
    image_prompt: page.image_prompt,
    words: page.words ?? null,
  };
}

/**
 * Persist a freshly generated page image key onto the locally cached reader,
 * so the study session sees it without waiting for the next content sync.
 */
export async function updateLocalReaderPageImage(
  readerId: string,
  pageId: string,
  imageUrl: string
): Promise<void> {
  const reader = await db.readers.get(readerId);
  if (!reader) return;
  await db.readers.update(readerId, {
    pages: reader.pages.map(p => (p.id === pageId ? { ...p, image_url: imageUrl } : p)),
  });
}

/**
 * Reader page illustrations are generated lazily server-side: pages start
 * with image_url null and an image_prompt. Ask the server to generate (a
 * no-op returning the key if the image already exists), persist the key
 * locally, and pull the bytes into the offline cache.
 */
async function generateAndCachePageImage(
  readerId: string,
  page: Pick<LocalReaderPage, 'id' | 'image_prompt'>
): Promise<void> {
  try {
    const result = await generateReaderPageImage(readerId, page.id);
    if (result.image_url) {
      await updateLocalReaderPageImage(readerId, page.id, result.image_url);
      await getAudioWithCache(result.image_url);
    }
  } catch (err) {
    console.error('[ReaderSync] Image generation failed for page', page.id, err);
  }
}

/**
 * Fetch all readers (with pages) and reconcile the local cache.
 * Content fields are always refreshed; scheduling state is preserved for
 * existing readers and initialized as NEW for first-seen ones.
 */
export async function syncReadersFromServer(): Promise<{ synced: number }> {
  const response = await fetch(`${API_BASE}/api/readers?include_pages=true`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch readers: ${response.status}`);
  }
  const serverReaders = await response.json() as GradedReaderWithPages[];

  await db.transaction('rw', [db.readers, db.readerReviewEvents], async () => {
    const localReaders = await db.readers.toArray();
    const localById = new Map(localReaders.map(r => [r.id, r]));
    const serverIds = new Set(serverReaders.map(r => r.id));

    // Delete readers (and their events) that no longer exist on the server
    const removedIds = localReaders.filter(r => !serverIds.has(r.id)).map(r => r.id);
    if (removedIds.length > 0) {
      await db.readers.bulkDelete(removedIds);
      await db.readerReviewEvents.where('reader_id').anyOf(removedIds).delete();
    }

    const rows: LocalReader[] = serverReaders.map(server => {
      const existing = localById.get(server.id);
      const scheduling = existing
        ? {
            queue: existing.queue,
            stability: existing.stability,
            difficulty: existing.difficulty,
            lapses: existing.lapses,
            interval: existing.interval,
            repetitions: existing.repetitions,
            next_review_at: existing.next_review_at,
            due_timestamp: existing.due_timestamp,
            last_reviewed_at: existing.last_reviewed_at,
            retired: existing.retired,
          }
        : readerReadFields([]);
      return {
        id: server.id,
        title_chinese: server.title_chinese,
        title_english: server.title_english,
        difficulty_level: server.difficulty_level,
        status: server.status,
        created_at: server.created_at,
        pages: server.pages.map(pageToLocal),
        ...scheduling,
        _synced_at: Date.now(),
      };
    });
    await db.readers.bulkPut(rows);
  });
  // New readers arrive NEW; any whose events are already here are marked read.
  await recomputeAllReaderRows();

  return { synced: serverReaders.length };
}

/**
 * Make sure today has a graded reader, generating one in the background if
 * needed. Called when a study session starts (replaces the old home-screen
 * Reader button) AND from the background sync (throttled), so generation
 * usually starts well before the session reaches the reader slot.
 *
 * One reader a day, read once (shared/study/daily-reader.ts): nothing is
 * generated while an unread story is waiting (the session keeps offering it)
 * or a story was read today; a new one is asked for only when the previous
 * daily reader has been read (or none exists), at most once per local day.
 *
 * Returns true when a fresh reader is being generated and will arrive shortly
 * (the caller should poll sync until it lands), false when there's nothing to
 * wait for (today already has a reader, offline, or generation failed).
 */
export async function ensureDailyReader(): Promise<boolean> {
  if (!navigator.onLine) return false;

  const rotation = await readerRotationState();
  // One generation attempt per local day. Without it, every session end and
  // every hourly sync re-asked the server while today's reader sat in
  // 'failed' (e.g. AI keys missing, offline API), and each ask produced a
  // fresh dead card. A failed story can still be retried by hand from the
  // Readers list.
  const today = getLocalDateString();
  if (!shouldGenerateDailyReader({
    readToday: rotation.readToday,
    hasUnread: rotation.next !== null,
    lastAttemptDate: getDailyReaderAttemptDate(),
    today,
  })) return false;

  try {
    // The story anchors on the tutor's recent lesson notes (server-side);
    // today's due words (from the offline study queue) ride along as
    // secondary targets to weave in — no canned scenarios.
    const dueNoteIds = await getDueNoteIds();
    // Idempotent per-day on the server: repeated calls return today's reader
    recordDailyReaderAttempt(today);
    const status = await generateDailyReader(dueNoteIds);
    if (status.status === 'generating') return true;
    if (status.status === 'ready') {
      // Generated earlier (other device / earlier session) but possibly not
      // synced locally yet — pull it in now so the session can pick it up.
      await syncReadersFromServer();
      return false;
    }
    return false;
  } catch (err) {
    console.error('[ReaderSync] ensureDailyReader failed:', err);
    return false;
  }
}

// ============ Daily reader attempt guard ============

const DAILY_READER_ATTEMPT_KEY = 'daily-reader-attempt';

/** Pure: is a generation attempt allowed today, given the last attempt's local date? */
export function shouldAttemptDailyReader(lastAttemptDate: string | null, today: string): boolean {
  return lastAttemptDate !== today;
}

export function getDailyReaderAttemptDate(): string | null {
  try {
    return localStorage.getItem(DAILY_READER_ATTEMPT_KEY);
  } catch {
    return null;
  }
}

export function recordDailyReaderAttempt(today: string): void {
  try {
    localStorage.setItem(DAILY_READER_ATTEMPT_KEY, today);
  } catch {
    // localStorage unavailable (private mode) — we just retry next time
  }
}

/** Test/debug helper: forget today's attempt so the next call asks again. */
export function clearDailyReaderAttempt(): void {
  try {
    localStorage.removeItem(DAILY_READER_ATTEMPT_KEY);
  } catch {
    // ignore
  }
}

// ============ Media Prefetch ============

/** Reader narration speed (matches the app-wide TTS default). */
export const READER_TTS_SPEED = 0.6;

/** Stable cache key for a page's generated TTS. Hashes content + speed +
 * default voice, so edited pages or narration-setting changes regenerate
 * instead of replaying stale audio. */
export function readerTtsKey(page: Pick<LocalReaderPage, 'id' | 'content_chinese'>): string {
  // djb2 string hash — tiny, deterministic, good enough for cache busting
  const input = `${page.content_chinese}|${DEFAULT_MINIMAX_VOICE}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `reader-tts/${page.id}/${hash.toString(36)}-x${READER_TTS_SPEED}`;
}

/**
 * Cache-first TTS for a reader page. Offline with no cached audio → null
 * (the play button fails gracefully).
 *
 * options.regenerate skips the cache read and overwrites the cached clip with
 * a freshly generated one — for when a cached clip is glitchy or was made with
 * the Google fallback voice while MiniMax was down.
 */
export async function getReaderPageTTS(
  page: Pick<LocalReaderPage, 'id' | 'content_chinese'>,
  options: { regenerate?: boolean } = {}
): Promise<Blob | null> {
  const key = readerTtsKey(page);
  if (!options.regenerate) {
    const cached = await getCachedAudio(key);
    if (cached) return cached;
  }
  if (!navigator.onLine) return null;

  try {
    const result = await generatePracticeTTS(page.content_chinese, READER_TTS_SPEED);
    const blob = base64ToBlob(result.audio_base64, result.content_type);
    await cacheAudio(key, blob);
    return blob;
  } catch (err) {
    console.error('[ReaderSync] TTS generation failed for page', page.id, err);
    return null;
  }
}

/**
 * Every page's narration of a reader, generated and cached on the device
 * (MiniMax → Azure through /api/practice/tts's stored order), so the whole
 * story plays offline. Returns how many pages have audio on the device.
 */
export async function cacheReaderNarration(reader: Pick<LocalReader, 'pages'>): Promise<number> {
  let cached = 0;
  for (const page of reader.pages) {
    if (await isAudioCached(readerTtsKey(page))) { cached++; continue; }
    if (!navigator.onLine) continue;
    if (await getReaderPageTTS(page)) cached++;
  }
  return cached;
}

/**
 * Proactively cache reader media for offline study:
 * - Existing page images for ALL readers (cheap R2 fetches, deduped by cache)
 * - The next unread story (today's, or tomorrow's once today's was read):
 *   missing illustrations and EVERY page's narration — listen-first, so the
 *   whole story plays offline as soon as it exists
 */
export async function prefetchReaderMedia(): Promise<void> {
  if (!navigator.onLine) return;

  const readers = await db.readers.toArray();

  // Images already generated: every page of every reader
  const imageKeys = readers
    .flatMap(r => r.pages)
    .map(p => p.image_url)
    .filter((key): key is string => !!key);

  const CONCURRENCY = 4;
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (nextIndex < imageKeys.length) {
        if (!navigator.onLine) return;
        const key = imageKeys[nextIndex++];
        if (!(await isAudioCached(key))) {
          await getAudioWithCache(key);
        }
      }
    })
  );

  // The next unread story: narration first (it is what he listens to), then pictures
  const { next } = await readerRotationState();
  if (!next) return;
  await cacheReaderNarration(next);
  for (const page of next.pages) {
    if (!navigator.onLine) return;
    if (!page.image_url && page.image_prompt) {
      await generateAndCachePageImage(next.id, page);
    } else if (page.image_url && !(await isAudioCached(page.image_url))) {
      await getAudioWithCache(page.image_url);
    }
  }
}
