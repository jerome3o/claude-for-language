/**
 * Persistent, offline-capable TTS for arbitrary text.
 *
 * Generated clips are stored in the media blob cache keyed by a hash of
 * (text, voice, speed), so anything spoken once — or prefetched during sync —
 * plays offline. Used by the in-session grammar lessons; graded readers use
 * the same pattern with page-scoped keys (see readerSync).
 */

import { generatePracticeTTS } from '../api/client';
import { DEFAULT_MINIMAX_VOICE, DEFAULT_TTS_SPEED } from '../types';
import { getCachedAudio, cacheAudio, isAudioCached } from './audioCache';

export function ttsCacheKey(text: string, speed: number = DEFAULT_TTS_SPEED): string {
  // djb2 string hash — deterministic, good enough for cache busting
  const input = `${text}|${DEFAULT_MINIMAX_VOICE}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `tts/${hash.toString(36)}-x${speed}`;
}

export function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

/**
 * Cache-first TTS. Offline with nothing cached → null (callers fail soft).
 */
export async function getTTSWithCache(
  text: string,
  speed: number = DEFAULT_TTS_SPEED
): Promise<Blob | null> {
  const key = ttsCacheKey(text, speed);
  const cached = await getCachedAudio(key);
  if (cached) return cached;
  if (!navigator.onLine) return null;

  try {
    const result = await generatePracticeTTS(text, speed);
    const blob = base64ToBlob(result.audio_base64, result.content_type);
    await cacheAudio(key, blob);
    return blob;
  } catch (err) {
    console.error('[ttsCache] TTS generation failed:', err);
    return null;
  }
}

/** Generate + cache clips for texts not yet cached (offline prep). */
export async function prefetchTTS(texts: string[], speed: number = DEFAULT_TTS_SPEED): Promise<void> {
  for (const text of texts) {
    if (!navigator.onLine) return;
    if (!text.trim()) continue;
    if (!(await isAudioCached(ttsCacheKey(text, speed)))) {
      await getTTSWithCache(text, speed);
    }
  }
}
