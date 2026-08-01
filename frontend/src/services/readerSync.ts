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

import { db, LocalReader, LocalReaderPage } from '../db/database';
import { initialCardState, DEFAULT_DECK_SETTINGS } from '@shared/scheduler';
import { API_BASE, getAuthHeaders, generatePracticeTTS } from '../api/client';
import { GradedReaderWithPages } from '../types';
import { getAudioWithCache, getCachedAudio, cacheAudio, isAudioCached } from './audioCache';
import { readerSchedulingFields, getDueReaders } from './reader-study';

function pageToLocal(page: GradedReaderWithPages['pages'][number]): LocalReaderPage {
  return {
    id: page.id,
    page_number: page.page_number,
    content_chinese: page.content_chinese,
    content_pinyin: page.content_pinyin,
    content_english: page.content_english,
    image_url: page.image_url,
  };
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

// ============ Media Prefetch ============

/** Stable cache key for a page's generated TTS. Content-hashed so edited
 * pages regenerate instead of replaying stale audio. */
export function readerTtsKey(page: Pick<LocalReaderPage, 'id' | 'content_chinese'>): string {
  // djb2 string hash — tiny, deterministic, good enough for cache busting
  let hash = 5381;
  for (let i = 0; i < page.content_chinese.length; i++) {
    hash = ((hash << 5) + hash + page.content_chinese.charCodeAt(i)) >>> 0;
  }
  return `reader-tts/${page.id}/${hash.toString(36)}`;
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

/**
 * Cache-first TTS for a reader page. Offline with no cached audio → null
 * (the play button fails gracefully).
 */
export async function getReaderPageTTS(
  page: Pick<LocalReaderPage, 'id' | 'content_chinese'>
): Promise<Blob | null> {
  const key = readerTtsKey(page);
  const cached = await getCachedAudio(key);
  if (cached) return cached;
  if (!navigator.onLine) return null;

  try {
    const result = await generatePracticeTTS(page.content_chinese);
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
 * - Page images for ALL readers (cheap R2 fetches, deduped by the cache)
 * - Page TTS for readers currently due (each page is one TTS API call, so
 *   this is limited to readers that will actually appear in a session)
 */
export async function prefetchReaderMedia(): Promise<void> {
  if (!navigator.onLine) return;

  const readers = await db.readers.toArray();

  // Images: every page of every reader
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

  // TTS: only readers that are due now (one API call per uncached page)
  const dueReaders = await getDueReaders();
  for (const reader of dueReaders) {
    for (const page of reader.pages) {
      if (!navigator.onLine) return;
      if (!(await isAudioCached(readerTtsKey(page)))) {
        await getReaderPageTTS(page);
      }
    }
  }
}
