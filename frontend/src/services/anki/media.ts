/**
 * Resolve the `AudioRef`s an adapter produced into media bytes.
 *
 * Cache first: the study prefetch usually has every clip in the IndexedDB
 * audio cache already, so exports work offline. Clips that aren't cached are
 * fetched (R2 audio) or generated (TTS) when online, and simply reported as
 * missing otherwise — a deck without a few clips is still a useful deck.
 *
 * Files are named by a hash of their bytes, so identical clips dedupe and
 * re-exports overwrite rather than pile up in Anki's media folder.
 */

import { getAudioWithCache, getCachedAudio } from '../audioCache';
import { getTTSWithCache, ttsCacheKey } from '../ttsCache';
import { getReaderPageTTS, readerTtsKey } from '../readerSync';
import { sha1Hex } from './hash';
import type { AudioRef } from './sources';

export interface ResolvedMedia {
  filename: string;
  data: Uint8Array;
}

export interface ResolveAudioOptions {
  /** Generate uncached TTS / fetch uncached R2 clips when online (default true). */
  fetchMissing?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** Injectable loader for tests. */
  load?: (ref: AudioRef, fetchMissing: boolean) => Promise<Blob | null>;
}

/** Canonical cache key for a ref — also what dedupes refs across notes. */
export function audioRefKey(ref: AudioRef): string {
  switch (ref.kind) {
    case 'r2':
      return ref.key;
    case 'tts':
      return ttsCacheKey(ref.text);
    case 'reader-page':
      return readerTtsKey({ id: ref.pageId, content_chinese: ref.text });
  }
}

async function defaultLoad(ref: AudioRef, fetchMissing: boolean): Promise<Blob | null> {
  const key = audioRefKey(ref);
  const cached = await getCachedAudio(key);
  if (cached) return cached;
  if (!fetchMissing || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
  switch (ref.kind) {
    case 'r2':
      return getAudioWithCache(ref.key);
    case 'tts':
      return getTTSWithCache(ref.text);
    case 'reader-page':
      return getReaderPageTTS({ id: ref.pageId, content_chinese: ref.text });
  }
}

function extensionFor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('webm')) return 'webm';
  if (t.includes('aac') || t.includes('mp4')) return 'm4a';
  return 'mp3';
}

export async function blobToMedia(blob: Blob): Promise<ResolvedMedia> {
  const data = new Uint8Array(await blob.arrayBuffer());
  return { filename: `${sha1Hex(data).slice(0, 20)}.${extensionFor(blob.type)}`, data };
}

/**
 * Resolve every ref (deduped by key) with limited concurrency.
 * Returns a map from ref key to media, plus how many refs had no clip.
 */
export async function resolveAudio(
  refs: AudioRef[],
  options: ResolveAudioOptions = {},
): Promise<{ files: Map<string, ResolvedMedia>; missing: number }> {
  const fetchMissing = options.fetchMissing ?? true;
  const load = options.load ?? defaultLoad;
  const unique = new Map<string, AudioRef>();
  for (const ref of refs) unique.set(audioRefKey(ref), ref);

  const entries = Array.from(unique.entries());
  const files = new Map<string, ResolvedMedia>();
  let missing = 0;
  let done = 0;
  let next = 0;
  options.onProgress?.(0, entries.length);

  const worker = async () => {
    while (next < entries.length) {
      const [key, ref] = entries[next++];
      try {
        const blob = await load(ref, fetchMissing);
        if (blob && blob.size > 0) files.set(key, await blobToMedia(blob));
        else missing++;
      } catch {
        missing++;
      }
      done++;
      options.onProgress?.(done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  return { files, missing };
}
