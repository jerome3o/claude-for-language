/**
 * MiniMax clips for arbitrary text (lesson lines, chat read-aloud), kept in R2
 * by (text, voice, speed) so the same line in the same voice is generated
 * once for everybody. Only MiniMax clips are kept. The Google fallback is off
 * unless a caller asks for it for LIVE playback (chat Read aloud) — a worse
 * voice that is never kept, so the next request tries MiniMax again.
 */
import type { Env } from '../types';
import { DEFAULT_MINIMAX_VOICE, DEFAULT_TTS_SPEED, bytesToBase64, generateConversationTTS, type ConversationTTSResult } from './audio';
import { TTS_MODEL } from './tts/settings';
import type { TtsPriority } from './tts/bucket';

export const TTS_CACHE_PREFIX = 'tts-cache/';

/**
 * `tts-cache/v2/<sha-256 of model|voice|speed|text>.mp3`. v2 added the model, so a
 * model change (speech-02-hd → speech-2.8-hd) makes new clips instead of serving old ones.
 */
export async function ttsCacheKey(text: string, voiceId: string, speed: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${TTS_MODEL}|${voiceId}|${speed}|${text}`));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${TTS_CACHE_PREFIX}v2/${hex}.mp3`;
}

export async function cachedConversationTTS(
  env: Env,
  text: string,
  options: { voiceId?: string; speed?: number; priority?: TtsPriority; allowGoogleFallback?: boolean } = {},
): Promise<(ConversationTTSResult & { voiceId: string; cached: boolean }) | null> {
  const voiceId = options.voiceId ?? DEFAULT_MINIMAX_VOICE;
  const speed = options.speed ?? DEFAULT_TTS_SPEED;
  const key = await ttsCacheKey(text, voiceId, speed);
  const stored = await env.AUDIO_BUCKET.get(key).catch(() => null);
  if (stored) {
    const bytes = new Uint8Array(await stored.arrayBuffer());
    return { audioBase64: bytesToBase64(bytes), contentType: 'audio/mpeg', provider: 'minimax', voiceId, cached: true };
  }
  const result = await generateConversationTTS(env, text, { voiceId, speed, priority: options.priority, allowGoogleFallback: options.allowGoogleFallback });
  if (!result) return null;
  if (result.provider === 'minimax') {
    const binary = atob(result.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await env.AUDIO_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'audio/mpeg' } }).catch((e) => {
      console.error('[tts-cache] put failed', e);
    });
  }
  return { ...result, voiceId, cached: false };
}
