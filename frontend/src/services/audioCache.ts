import { db } from '../db/database';

const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CACHE_SIZE = 500; // Max number of cached audio files

/**
 * Cache audio blob in IndexedDB
 */
export async function cacheAudio(audioUrl: string, blob: Blob): Promise<void> {
  await db.cachedAudio.put({
    key: audioUrl,
    blob,
    cached_at: Date.now(),
  });

  // Clean up old entries if we exceed max size
  await cleanupOldCache();
}

/**
 * Get cached audio blob from IndexedDB
 */
export async function getCachedAudio(audioUrl: string): Promise<Blob | null> {
  const cached = await db.cachedAudio.get(audioUrl);
  if (!cached) {
    return null;
  }

  // Check if cache is expired
  if (Date.now() - cached.cached_at > MAX_CACHE_AGE_MS) {
    await db.cachedAudio.delete(audioUrl);
    return null;
  }

  return cached.blob;
}

/**
 * Check if audio is cached
 */
export async function isAudioCached(audioUrl: string): Promise<boolean> {
  const cached = await db.cachedAudio.get(audioUrl);
  if (!cached) {
    return false;
  }

  // Check if cache is expired
  if (Date.now() - cached.cached_at > MAX_CACHE_AGE_MS) {
    return false;
  }

  return true;
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
    const response = await fetch(`/api/audio/${audioUrl}`);
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

  const uncachedUrls: string[] = [];

  // Check which URLs are not cached
  for (const url of audioUrls) {
    if (url) {
      const isCached = await isAudioCached(url);
      if (!isCached) {
        uncachedUrls.push(url);
      }
    }
  }

  // Fetch and cache uncached URLs (in parallel, but limited)
  const BATCH_SIZE = 5;
  for (let i = 0; i < uncachedUrls.length; i += BATCH_SIZE) {
    const batch = uncachedUrls.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(url => getAudioWithCache(url)));
  }
}

/**
 * Clean up old cache entries
 */
export async function cleanupOldCache(): Promise<void> {
  const count = await db.cachedAudio.count();

  if (count <= MAX_CACHE_SIZE) {
    return;
  }

  // Get all entries sorted by cached_at
  const entries = await db.cachedAudio.orderBy('cached_at').toArray();

  // Delete oldest entries to get under the limit
  const toDelete = entries.slice(0, count - MAX_CACHE_SIZE);
  await db.cachedAudio.bulkDelete(toDelete.map(e => e.key));
}

/**
 * Clear all cached audio
 */
export async function clearAudioCache(): Promise<void> {
  await db.cachedAudio.clear();
}

/**
 * Get cache statistics
 */
export async function getAudioCacheStats(): Promise<{
  count: number;
  totalSize: number;
  oldestEntry: Date | null;
}> {
  const entries = await db.cachedAudio.toArray();

  let totalSize = 0;
  let oldest: number | null = null;

  for (const entry of entries) {
    totalSize += entry.blob.size;
    if (oldest === null || entry.cached_at < oldest) {
      oldest = entry.cached_at;
    }
  }

  return {
    count: entries.length,
    totalSize,
    oldestEntry: oldest ? new Date(oldest) : null,
  };
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

    // Try to find a Chinese voice
    const voices = window.speechSynthesis.getVoices();
    const chineseVoice = voices.find(v =>
      v.lang.startsWith('zh') ||
      v.lang.includes('chinese') ||
      v.name.toLowerCase().includes('chinese')
    );

    if (chineseVoice) {
      utterance.voice = chineseVoice;
    }

    utterance.lang = 'zh-CN';
    utterance.rate = 0.9; // Slightly slower for learning

    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(event.error));

    window.speechSynthesis.speak(utterance);
  });
}
