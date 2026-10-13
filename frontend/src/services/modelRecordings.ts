/**
 * The tutor's model recording on a needs-work mark ("▶ 明慧老师 says it" beside "▶ You";
 * docs/RECORDING_REVIEW.md "Model recordings").
 *
 * The clip is private to the tutor and the student, so it is fetched WITH the session from
 * `/api/recording-marks/<eventId>/model-audio?v=…` (never the public /api/audio/*) and kept in the
 * device's audio cache (IndexedDB `cachedAudio`) under the URL, which changes with every new clip.
 * The sync prefetches the clips of my notes (`prefetchModelRecordings`), so the card back and the
 * Tutor notes page play them on the train. My own take is the ordinary recording clip
 * (`getAudioWithCache`), prefetched alongside.
 */

import { API_BASE, getAuthHeaders } from '../api/client';
import { cacheAudio, getAudioWithCache, getCachedAudio } from './audioCache';

/** The audio-cache key of a model recording (distinct from every /api/audio key). */
export function modelRecordingCacheKey(url: string): string {
  return `model-recording:${url}`;
}

const inflight = new Map<string, Promise<Blob | null>>();

/** The clip: device cache first, else fetched with the session and cached. Null offline / on failure. */
export function getModelRecordingBlob(url: string): Promise<Blob | null> {
  const key = modelRecordingCacheKey(url);
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const cached = await getCachedAudio(key).catch(() => null);
    if (cached) return cached;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    try {
      const full = /^https?:/.test(url) ? url : `${API_BASE}${url}`;
      const res = await fetch(full, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) return null;
      const blob = await res.blob();
      await cacheAudio(key, blob).catch(() => {});
      return blob;
    } catch {
      return null;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Keep a clip the tutor just recorded under its server URL (no download needed). */
export async function primeModelRecording(url: string, blob: Blob): Promise<void> {
  await cacheAudio(modelRecordingCacheKey(url), blob).catch(() => {});
}

/**
 * Sync step: download the tutor clips of my notes (and my own take next to each) so both play
 * offline. Cheap once cached — a cached key is a single IndexedDB read.
 */
export async function prefetchModelRecordings(notes: ReadonlyArray<{ model_audio_url?: string | null; recording_url?: string | null }>): Promise<number> {
  let fetched = 0;
  const seen = new Set<string>();
  for (const n of notes) {
    if (!n.model_audio_url || seen.has(n.model_audio_url)) continue;
    seen.add(n.model_audio_url);
    if (await getModelRecordingBlob(n.model_audio_url)) fetched++;
    if (n.recording_url) await getAudioWithCache(n.recording_url).catch(() => null);
  }
  return fetched;
}
