import { useSyncExternalStore } from 'react';
import { API_BASE, getAuthHeaders } from '../api/client';
import { getAudioWithCache, getCachedAudioKeys } from './audioCache';

/**
 * Audio prefetch service: downloads every audio clip the user owns into the
 * IndexedDB cache so study works fully offline (spotty train connections).
 *
 * The server exposes GET /api/audio-manifest with all audio URLs (note audio,
 * sentence clues, recordings). We diff that against the local cache and
 * download only what's missing, a few files at a time.
 */

export interface AudioPrefetchProgress {
  status: 'idle' | 'running' | 'done' | 'error';
  /** Files downloaded (or attempted) so far in the current run */
  done: number;
  /** Files missing at the start of the current run */
  total: number;
  /** Downloads that failed in the current run */
  failed: number;
  /** Total number of URLs in the last-fetched manifest */
  manifestTotal: number;
  /** How many manifest URLs are cached locally (updated as the run progresses) */
  cachedCount: number;
}

const IDLE: AudioPrefetchProgress = {
  status: 'idle',
  done: 0,
  total: 0,
  failed: 0,
  manifestTotal: 0,
  cachedCount: 0,
};

const LAST_RUN_KEY = 'audioPrefetchLastRun';
const MIN_AUTO_RUN_INTERVAL_MS = 15 * 60 * 1000; // auto-runs at most every 15 min
const CONCURRENCY = 4;

let progress: AudioPrefetchProgress = IDLE;
let running = false;
const listeners = new Set<() => void>();

function setProgress(next: Partial<AudioPrefetchProgress>) {
  progress = { ...progress, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AudioPrefetchProgress {
  return progress;
}

/** React hook: live progress of the audio prefetch. */
export function useAudioPrefetchProgress(): AudioPrefetchProgress {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Fetch the list of every audio URL the user owns. */
export async function fetchAudioManifest(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/audio-manifest`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch audio manifest: ${response.status}`);
  }
  const data = await response.json() as { urls: string[] };
  return data.urls || [];
}

/**
 * Compute which manifest URLs are missing from the cache.
 * Exported for tests.
 */
export function diffManifest(manifest: string[], cachedKeys: Set<string>): string[] {
  return manifest.filter((url) => url && !cachedKeys.has(url));
}

/**
 * Download all missing audio into the cache.
 *
 * @param options.force  Run even if an auto-run happened recently (used by
 *                       the Settings "Download all" button). Auto-runs after
 *                       sync are throttled to every 15 minutes.
 * @returns summary of the run, or null if skipped (already running/throttled/offline)
 */
export async function prefetchAllAudio(options: { force?: boolean } = {}): Promise<
  { total: number; downloaded: number; failed: number } | null
> {
  if (running) return null;
  if (!navigator.onLine) return null;

  if (!options.force) {
    const lastRun = Number(localStorage.getItem(LAST_RUN_KEY) || 0);
    if (Date.now() - lastRun < MIN_AUTO_RUN_INTERVAL_MS) {
      return null;
    }
  }

  running = true;
  try {
    const manifest = await fetchAudioManifest();
    const cachedKeys = await getCachedAudioKeys();
    const cachedFromManifest = manifest.filter((url) => cachedKeys.has(url)).length;
    const missing = diffManifest(manifest, cachedKeys);

    setProgress({
      status: 'running',
      done: 0,
      total: missing.length,
      failed: 0,
      manifestTotal: manifest.length,
      cachedCount: cachedFromManifest,
    });

    let done = 0;
    let failed = 0;

    // Simple worker pool over the missing list
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < missing.length) {
        if (!navigator.onLine) return; // connection dropped — resume on next run
        const url = missing[nextIndex++];
        const blob = await getAudioWithCache(url);
        done++;
        if (blob) {
          setProgress({ done, cachedCount: progress.cachedCount + 1 });
        } else {
          failed++;
          setProgress({ done, failed });
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
    setProgress({ status: 'done' });
    console.log(`[AudioPrefetch] Done: ${done - failed}/${missing.length} downloaded, ${failed} failed (${manifest.length} total in manifest)`);
    return { total: missing.length, downloaded: done - failed, failed };
  } catch (error) {
    console.error('[AudioPrefetch] Failed:', error);
    setProgress({ status: 'error' });
    return null;
  } finally {
    running = false;
  }
}

/**
 * Ask the browser to make our storage persistent so the audio cache can't be
 * evicted under storage pressure. Safe to call repeatedly; browsers remember
 * the grant. PWAs installed to the home screen are typically granted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      const alreadyPersisted = await navigator.storage.persisted();
      if (alreadyPersisted) return true;
      const granted = await navigator.storage.persist();
      console.log(`[AudioPrefetch] Persistent storage ${granted ? 'granted' : 'denied'}`);
      return granted;
    }
  } catch {
    // Not supported — nothing to do
  }
  return false;
}
