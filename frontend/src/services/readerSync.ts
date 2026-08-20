/**
 * Reader content sync + offline media prefetch.
 *
 * Readers are synced into IndexedDB so study sessions work fully offline:
 * - Content (titles, pages) comes from the server; scheduling state is local
 *   (computed from readerReviewEvents), so upserts never touch scheduling.
 * - Page images are R2 objects served from /api/audio/<key> — the same proxy
 *   as audio — so they reuse the existing media blob cache.
 * - Page TTS has no stored URL (it's generated on demand), so we generate and
 *   cache it ahead of time for readers that are due soon.
 */

import { db, getDueNoteIds, LocalReader, LocalReaderPage } from '../db/database';
import { initialCardState, DEFAULT_DECK_SETTINGS } from '@shared/scheduler';
import { API_BASE, getAuthHeaders, generatePracticeTTS, generateReaderPageImage, generateDailyReader } from '../api/client';
import { GradedReaderWithPages, DEFAULT_MINIMAX_VOICE, CardQueue } from '../types';
import { getAudioWithCache, getCachedAudio, cacheAudio, isAudioCached } from './audioCache';
import { base64ToBlob } from './ttsCache';
import { readerSchedulingFields, getDueReaders, isStudyableReader } from './reader-study';

function pageToLocal(page: GradedReaderWithPages['pages'][number]): LocalReaderPage {
  return {
    id: page.id,
    page_number: page.page_number,
    content_chinese: page.content_chinese,
    content_pinyin: page.content_pinyin,
    content_english: page.content_english,
    image_url: page.image_url,
    image_prompt: page.image_prompt,
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

    const initialState = initialCardState(DEFAULT_DECK_SETTINGS);
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
          }
        : readerSchedulingFields(initialState);
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

  return { synced: serverReaders.length };
}

/**
 * Make sure today has a graded reader, generating one in the background if
 * needed. Called when a study session starts (replaces the old home-screen
 * Reader button).
 *
 * No-buildup rule: if an unread (NEW) reader already exists — e.g. yesterday's
 * story was never read — nothing new is generated; that one IS today's reader.
 *
 * Returns true when a fresh reader is being generated and will arrive shortly
 * (the caller should poll sync until it lands), false when there's nothing to
 * wait for (a reader already exists locally, today's was already read,
 * offline, or generation failed).
 */
export async function ensureDailyReader(): Promise<boolean> {
  if (!navigator.onLine) return false;

  const readers = await db.readers.toArray();
  const hasUnread = readers.some(r => isStudyableReader(r) && r.queue === CardQueue.NEW);
  if (hasUnread) return false;

  try {
    // Today's due words (from the offline study queue) become the story's
    // best-effort target vocabulary. The server pairs them with the tutor's
    // recent lesson notes to pick the theme — no more canned scenarios.
    const dueNoteIds = await getDueNoteIds();
    // Idempotent per-day on the server: repeated calls return today's reader
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
 * Proactively cache reader media for offline study:
 * - Existing page images for ALL readers (cheap R2 fetches, deduped by cache)
 * - Missing illustrations for readers currently due (one image-generation
 *   API call per page, so limited to readers that will appear in a session)
 * - Page TTS for readers currently due (one TTS API call per uncached page)
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

  // Due readers: generate missing illustrations and TTS ahead of the session
  const dueReaders = await getDueReaders();
  for (const reader of dueReaders) {
    for (const page of reader.pages) {
      if (!navigator.onLine) return;
      if (!page.image_url && page.image_prompt) {
        await generateAndCachePageImage(reader.id, page);
      } else if (page.image_url && !(await isAudioCached(page.image_url))) {
        await getAudioWithCache(page.image_url);
      }
      if (!(await isAudioCached(readerTtsKey(page)))) {
        await getReaderPageTTS(page);
      }
    }
  }
}
