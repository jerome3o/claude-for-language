/**
 * Persistent, offline-capable TTS for arbitrary text.
 *
 * Generated clips are stored in the media blob cache keyed by a hash of
 * (text, voice, speed), so anything spoken once — or prefetched during sync —
 * plays offline. Used by the in-session grammar lessons; graded readers use
 * the same pattern with page-scoped keys (see readerSync).
 */

import { generateConversationLineTTS, generatePracticeTTS } from '../api/client';
import type { ConversationDelivery } from '@shared/tts';
import { DEFAULT_MINIMAX_VOICE, DEFAULT_TTS_SPEED } from '../types';
import { getCachedAudio, cacheAudio, isAudioCached } from './audioCache';
import type { LessonAudioClip } from '@shared/lesson';

/**
 * Requests in flight by cache key: a clip the lesson prefetch is already fetching
 * is awaited, never asked for twice (the learner presses Check while it downloads).
 */
const inflight = new Map<string, Promise<Blob | null>>();

function once(key: string, make: () => Promise<Blob | null>): Promise<Blob | null> {
  const running = inflight.get(key);
  if (running) return running;
  const p = make().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export function ttsCacheKey(text: string, speed: number = DEFAULT_TTS_SPEED, voice: string = DEFAULT_MINIMAX_VOICE): string {
  // djb2 string hash — deterministic, good enough for cache busting. The
  // default voice hashes exactly as before, so existing caches stay valid.
  const input = `${text}|${voice}`;
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
  speed: number = DEFAULT_TTS_SPEED,
  voice?: string,
): Promise<Blob | null> {
  const key = ttsCacheKey(text, speed, voice);
  const cached = await getCachedAudio(key);
  if (cached) return cached;
  if (!navigator.onLine) return null;

  return once(key, async () => {
    try {
      const result = await generatePracticeTTS(text, speed, voice);
      const blob = base64ToBlob(result.audio_base64, result.content_type);
      await cacheAudio(key, blob);
      return blob;
    } catch (err) {
      console.error('[ttsCache] TTS generation failed:', err);
      return null;
    }
  });
}

/** Generate + cache clips (text + optional voice and speed) not yet cached.
 * A clip's own speed (a conversation line) wins over `speed`. */
export async function prefetchTTSClips(clips: Array<{ text: string; voice?: string; speed?: number }>, speed: number = DEFAULT_TTS_SPEED): Promise<void> {
  for (const clip of clips) {
    if (!navigator.onLine) return;
    if (!clip.text.trim()) continue;
    const clipSpeed = clip.speed ?? speed;
    if (!(await isAudioCached(ttsCacheKey(clip.text, clipSpeed, clip.voice)))) {
      await getTTSWithCache(clip.text, clipSpeed, clip.voice);
    }
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

// ---------- Conversation lines (docs/AUDIO.md "Conversation audio") ----------

export interface ConversationClip {
  text: string;
  voice: string;
  /** The provider's own rate (shared/tts/conversation.ts). */
  speed: number;
  delivery: ConversationDelivery;
}

/** A conversation line's device key: text + voice + delivery + speed, apart from every other clip. */
export function conversationClipKey(clip: ConversationClip): string {
  const input = `${clip.text}|${clip.voice}|conv:${clip.delivery}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `tts/c-${hash.toString(36)}-x${clip.speed}`;
}

/**
 * Cache-first conversation line. `regenerate` asks the server to make it
 * again (replacing the stored clip) and overwrites the device copy; offline
 * the cached copy is played as it is.
 */
export async function getConversationClip(clip: ConversationClip, opts: { regenerate?: boolean } = {}): Promise<Blob | null> {
  const key = conversationClipKey(clip);
  const cached = await getCachedAudio(key);
  if (cached && (!opts.regenerate || !navigator.onLine)) return cached;
  if (!navigator.onLine) return null;
  const make = async () => {
    try {
      const result = await generateConversationLineTTS(clip.text, { ...clip, regenerate: opts.regenerate });
      const blob = base64ToBlob(result.audio_base64, result.content_type);
      await cacheAudio(key, blob);
      return blob;
    } catch (err) {
      console.error('[ttsCache] conversation line failed:', err);
      return cached ?? null;
    }
  };
  // A regeneration is its own request (it must reach the server); a plain fetch joins one in flight.
  return opts.regenerate ? make() : once(key, make);
}

/** Prefetch conversation lines not yet on the device. */
export async function prefetchConversationClips(clips: ConversationClip[]): Promise<void> {
  for (const clip of clips) {
    if (!navigator.onLine) return;
    if (!clip.text.trim()) continue;
    if (!(await isAudioCached(conversationClipKey(clip)))) await getConversationClip(clip);
  }
}

// ---------- Lesson clips (shared/lesson/audioClips.ts) ----------

/** The device cache key of a lesson clip (the same keys `speak` and the conversation player use). */
export function lessonClipCacheKey(clip: Pick<LessonAudioClip, 'kind' | 'text' | 'voice' | 'speed' | 'delivery'>): string {
  if (clip.kind === 'conversation' && clip.voice) {
    return conversationClipKey({ text: clip.text, voice: clip.voice, speed: clip.speed ?? DEFAULT_TTS_SPEED, delivery: clip.delivery ?? 'natural' });
  }
  return ttsCacheKey(clip.text, clip.speed ?? DEFAULT_TTS_SPEED, clip.voice);
}

export function isLessonClipCached(clip: LessonAudioClip): Promise<boolean> {
  return isAudioCached(lessonClipCacheKey(clip));
}

/** Cache-first: a lesson clip from the device, else fetched (and kept); null offline / on failure. */
export function getLessonClip(clip: LessonAudioClip): Promise<Blob | null> {
  if (clip.kind === 'conversation' && clip.voice) {
    return getConversationClip({ text: clip.text, voice: clip.voice, speed: clip.speed ?? DEFAULT_TTS_SPEED, delivery: clip.delivery ?? 'natural' });
  }
  return getTTSWithCache(clip.text, clip.speed ?? DEFAULT_TTS_SPEED, clip.voice);
}
