/**
 * MiniMax clips for arbitrary text (lesson lines, chat read-aloud), kept in R2
 * by (text, voice, speed) so the same line in the same voice is generated
 * once for everybody. Only MiniMax clips are kept — the Google fallback is a
 * worse voice and stays ephemeral, so the next request tries MiniMax again.
 */
import type { Env } from '../types';
import { DEFAULT_MINIMAX_VOICE, DEFAULT_TTS_SPEED, bytesToBase64, generateConversationTTS, type ConversationTTSResult } from './audio';

export const TTS_CACHE_PREFIX = 'tts-cache/';

/** `tts-cache/v1/<sha-256 of voice|speed|text>.mp3` */
export async function ttsCacheKey(text: string, voiceId: string, speed: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${voiceId}|${speed}|${text}`));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${TTS_CACHE_PREFIX}v1/${hex}.mp3`;
}

export async function cachedConversationTTS(
  env: Env,
  text: string,
  options: { voiceId?: string; speed?: number } = {},
): Promise<(ConversationTTSResult & { voiceId: string; cached: boolean }) | null> {
  const voiceId = options.voiceId ?? DEFAULT_MINIMAX_VOICE;
  const speed = options.speed ?? DEFAULT_TTS_SPEED;
  const key = await ttsCacheKey(text, voiceId, speed);
  const stored = await env.AUDIO_BUCKET.get(key).catch(() => null);
  if (stored) {
    const bytes = new Uint8Array(await stored.arrayBuffer());
    return { audioBase64: bytesToBase64(bytes), contentType: 'audio/mpeg', provider: 'minimax', voiceId, cached: true };
  }
  const result = await generateConversationTTS(env, text, { voiceId, speed });
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
