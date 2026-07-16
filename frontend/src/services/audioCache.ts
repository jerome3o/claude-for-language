import { db } from '../db/database';
import { API_BASE } from '../api/client';
import { DEFAULT_TTS_SPEED } from '../types';

// Size budget for the audio cache. Audio clips are small (~30-60KB), so this
// comfortably fits every clip the user owns (Jerome is fine with ~1GB).
// Eviction is least-recently-used and only kicks in if the budget is hit.
export const MAX_CACHE_BYTES = 1024 * 1024 * 1024; // 1GB

/**
 * Cache audio blob in IndexedDB.
 * A lightweight metadata row (size, timestamps) is kept in cachedAudioMeta so
 * stats and eviction never need to load the blobs.
 */
export async function cacheAudio(audioUrl: string, blob: Blob): Promise<void> {
  const now = Date.now();
  await db.cachedAudio.put({
    key: audioUrl,
    blob,
    cached_at: now,
  });
  await db.cachedAudioMeta.put({
    key: audioUrl,
    size: blob.size,
    cached_at: now,
    last_used_at: now,
  });

  await evictIfOverBudget();
}

/**
 * Get cached audio blob from IndexedDB.
 * Cached audio never expires; playback refreshes its LRU timestamp.
 */
export async function getCachedAudio(audioUrl: string): Promise<Blob | null> {
  const cached = await db.cachedAudio.get(audioUrl);
  if (!cached) {
    return null;
  }

  // Refresh last-used for LRU eviction (fire and forget)
  db.cachedAudioMeta.update(audioUrl, { last_used_at: Date.now() }).catch(() => {});

  return cached.blob;
}

/**
 * Check if audio is cached (metadata only — never loads the blob)
 */
export async function isAudioCached(audioUrl: string): Promise<boolean> {
  const meta = await db.cachedAudioMeta.get(audioUrl);
  if (meta) {
    return true;
  }
  // Entries cached before the meta table existed: fall back to the blob
  // table and backfill the missing meta row.
  const cached = await db.cachedAudio.get(audioUrl);
  if (!cached) {
    return false;
  }
  await db.cachedAudioMeta.put({
    key: audioUrl,
    size: cached.blob?.size ?? 0,
    cached_at: cached.cached_at,
    last_used_at: Date.now(),
  });
  return true;
}

/**
 * Set of all cached audio keys (cheap — primary keys only, no blobs).
 * Used to diff the server's audio manifest against what's already local.
 */
export async function getCachedAudioKeys(): Promise<Set<string>> {
  const keys = await db.cachedAudio.toCollection().primaryKeys();
  return new Set(keys);
}

/**
 * Fetch audio and cache it
 * Returns cached version if available, otherwise fetches from network
 */
export async function getAudioWithCache(audioUrl: string): Promise<Blob | null> {
  // Check cache first
  const cached = await getCachedAudio(audioUrl);
  if (cached) {
    return cached;
  }

  // If offline and not cached, return null
  if (!navigator.onLine) {
    return null;
  }

  // Fetch from network
  try {
    const response = await fetch(`${API_BASE}/api/audio/${audioUrl}`);
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();

    // Cache for future use
    await cacheAudio(audioUrl, blob);

    return blob;
  } catch (error) {
    console.error('Failed to fetch audio:', error);
    return null;
  }
}

/**
 * Pre-cache audio for a list of URLs
 * Useful for caching audio for due cards during sync
 */
export async function preCacheAudio(audioUrls: string[]): Promise<void> {
  if (!navigator.onLine) {
    return;
  }

  const cachedKeys = await getCachedAudioKeys();
  const uncachedUrls = audioUrls.filter((url) => url && !cachedKeys.has(url));

  // Fetch and cache uncached URLs (in parallel, but limited)
  const BATCH_SIZE = 5;
  for (let i = 0; i < uncachedUrls.length; i += BATCH_SIZE) {
    const batch = uncachedUrls.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(url => getAudioWithCache(url)));
  }
}

/**
 * Evict least-recently-used entries if the cache exceeds its size budget.
 * Works entirely off the metadata table (no blobs loaded).
 */
export async function evictIfOverBudget(budgetBytes: number = MAX_CACHE_BYTES): Promise<number> {
  const metas = await db.cachedAudioMeta.toArray();
  let totalSize = metas.reduce((sum, m) => sum + (m.size || 0), 0);

  if (totalSize <= budgetBytes) {
    return 0;
  }

  // Oldest last_used_at first
  metas.sort((a, b) => a.last_used_at - b.last_used_at);

  const toDelete: string[] = [];
  for (const meta of metas) {
    if (totalSize <= budgetBytes) break;
    toDelete.push(meta.key);
    totalSize -= meta.size || 0;
  }

  if (toDelete.length > 0) {
    await db.cachedAudio.bulkDelete(toDelete);
    await db.cachedAudioMeta.bulkDelete(toDelete);
  }
  return toDelete.length;
}

/**
 * Clear all cached audio
 */
export async function clearAudioCache(): Promise<void> {
  await db.cachedAudio.clear();
  await db.cachedAudioMeta.clear();
}

/**
 * Get cache statistics (metadata only — never loads blobs)
 */
export async function getAudioCacheStats(): Promise<{
  count: number;
  totalSize: number;
  oldestEntry: Date | null;
}> {
  const metas = await db.cachedAudioMeta.toArray();

  let totalSize = 0;
  let oldest: number | null = null;

  for (const meta of metas) {
    totalSize += meta.size || 0;
    if (oldest === null || meta.cached_at < oldest) {
      oldest = meta.cached_at;
    }
  }

  return {
    count: metas.length,
    totalSize,
    oldestEntry: oldest ? new Date(oldest) : null,
  };
}

/**
 * Pick the best Chinese voice for speech synthesis.
 * Prefers voices synthesized on-device (localService) so playback works
 * offline — network-backed voices stall on spotty connections.
 */
export function pickChineseVoice(): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const chineseVoices = voices.filter(v =>
    v.lang.startsWith('zh') ||
    v.lang.toLowerCase().includes('chinese') ||
    v.name.toLowerCase().includes('chinese')
  );
  return chineseVoices.find(v => v.localService) || chineseVoices[0];
}

/**
 * Use browser's Web Speech API as fallback for TTS
 */
export function speakWithBrowserTTS(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('Speech synthesis not supported'));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);

    // Try to find a Chinese voice (prefer on-device voices)
    const chineseVoice = pickChineseVoice();
    if (chineseVoice) {
      utterance.voice = chineseVoice;
    }

    utterance.lang = 'zh-CN';
    utterance.rate = DEFAULT_TTS_SPEED;

    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(event.error));

    window.speechSynthesis.speak(utterance);
  });
}
