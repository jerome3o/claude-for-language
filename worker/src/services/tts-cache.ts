/**
 * Clips for arbitrary text (lesson lines, chat read-aloud), kept in R2 by
 * (provider, voice, speed, text) so the same line in the same voice is made
 * once for everybody. Only clips of a provider in the STORED order are kept
 * (docs/AUDIO.md "Providers"); a live-only stand-in (Google, by default) is
 * played once and the next request tries the stored order again.
 *
 * Lookup follows the stored-clip policy: the first provider's clip; a backup
 * provider's too while the first is unavailable (or when "upgrade backup
 * clips" is off) — so a backup clip is served instead of being remade, and
 * replaced by the first provider's once it is back.
 */
import type { Env } from '../types';
import { DEFAULT_MINIMAX_VOICE, DEFAULT_TTS_SPEED, bytesToBase64, generateConversationTTS, synthesizeOrdered, type ConversationTTSResult } from './audio';
import { TTS_MODEL } from './tts/settings';
import type { TtsPriority } from './tts/bucket';
import { conversationProviderVoice, loadTtsConfig, providerVoice, storedClipPolicy } from './tts/config';
import type { TtsConfig } from '@shared/tts';
import { TTS_PROVIDER_IMPLS } from './tts/providers';
import type { ConversationDelivery, TtsProviderId } from '@shared/tts';

export const TTS_CACHE_PREFIX = 'tts-cache/';

/**
 * `tts-cache/v2/<sha-256>.mp3`. MiniMax: of model|voice|speed|text (v2 added the
 * model, so a model change makes new clips) — unchanged, so clips made before
 * providers existed are still found. Other providers: of provider|voice|rate|text.
 */
/** A conversation line's key: its own material (provider, voice, rate, delivery), never a card clip's. */
export async function conversationTtsCacheKey(
  text: string,
  provider: TtsProviderId,
  v: { voice: string; rate: number; style?: string; emotion?: string },
): Promise<string> {
  const model = provider === 'minimax' ? TTS_MODEL : provider;
  const material = `conv|${model}|${v.voice}|${v.rate}|${v.style ?? v.emotion ?? ''}|${text}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${TTS_CACHE_PREFIX}v2/c-${hex}.mp3`;
}

export async function ttsCacheKey(text: string, voiceId: string, speed: number, provider: TtsProviderId = 'minimax'): Promise<string> {
  const material = provider === 'minimax' ? `${TTS_MODEL}|${voiceId}|${speed}|${text}` : `${provider}|${voiceId}|${speed}|${text}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${TTS_CACHE_PREFIX}v2/${hex}.mp3`;
}

/** The R2 key of a clip made by provider `p` (the same key `/api/practice/tts` reads and writes). */
function clipKeyFor(
  config: TtsConfig,
  text: string,
  o: { voiceId: string; speed: number; conversation?: { speed?: number; delivery?: ConversationDelivery } },
): (p: TtsProviderId) => Promise<string> {
  return (p) => {
    if (o.conversation) {
      return conversationTtsCacheKey(text, p, conversationProviderVoice(p, config, { voiceId: o.voiceId, ...o.conversation }));
    }
    const v = providerVoice(p, config, { voiceId: o.voiceId, speed: o.speed });
    return ttsCacheKey(text, v.voice, v.rate, p);
  };
}

export type PracticeClipStatus =
  | { status: 'cached' | 'made' }
  | { status: 'rate_limited'; retryAfterMs: number }
  | { status: 'failed'; reason: string };

/**
 * Make sure a `/api/practice/tts` clip is in R2 (background pre-generation of a lesson's
 * clips, services/lesson-audio.ts): nothing when a clip the stored-clip policy accepts is
 * there (an R2 HEAD), else made in the STORED order at the given priority (batch by
 * default — the limiter paces it behind anyone waiting) and kept. Never a live-only stand-in.
 */
export async function ensurePracticeClip(
  env: Env,
  text: string,
  options: {
    voiceId?: string; speed?: number; conversation?: { speed?: number; delivery?: ConversationDelivery }; priority?: TtsPriority;
    /** Wait this long for a slot in process (a batch caller books its place and sleeps: docs/AUDIO.md "Bookings"). */
    maxWaitMs?: number;
  } = {},
): Promise<PracticeClipStatus> {
  const voiceId = options.voiceId ?? DEFAULT_MINIMAX_VOICE;
  const speed = options.speed ?? DEFAULT_TTS_SPEED;
  const config = await loadTtsConfig(env);
  const policy = await storedClipPolicy(env);
  if (policy.order.length === 0) return { status: 'failed', reason: 'no provider makes stored clips' };
  const keyFor = clipKeyFor(config, text, { voiceId, speed, conversation: options.conversation });
  for (const p of policy.acceptable.length ? policy.acceptable : ['minimax' as const]) {
    if (await env.AUDIO_BUCKET.head(await keyFor(p)).catch(() => null)) return { status: 'cached' };
  }
  const out = await synthesizeOrdered(env, config.stored_order, text, {
    voiceId,
    speed,
    priority: options.priority ?? 'batch',
    maxWaitMs: options.maxWaitMs,
    conversation: options.conversation,
  }, config);
  if (!out.ok) {
    return out.rateLimited ? { status: 'rate_limited', retryAfterMs: out.retryAfterMs ?? 60_000 } : { status: 'failed', reason: out.reason };
  }
  if (!policy.order.includes(out.provider)) return { status: 'failed', reason: `${out.provider} is not a stored-clip provider` };
  await env.AUDIO_BUCKET.put(await keyFor(out.provider), out.bytes, { httpMetadata: { contentType: out.mime } });
  return { status: 'made' };
}

export async function cachedConversationTTS(
  env: Env,
  text: string,
  options: {
    voiceId?: string;
    speed?: number;
    priority?: TtsPriority;
    allowGoogleFallback?: boolean;
    /** A conversation line: `speed` is the provider's own rate, plus the delivery. */
    conversation?: { speed?: number; delivery?: ConversationDelivery };
    /** Make it again even when R2 has it (the Audio menu's "Regenerate"); the new clip replaces the old. */
    regenerate?: boolean;
  } = {},
): Promise<(ConversationTTSResult & { voiceId: string; cached: boolean }) | null> {
  const voiceId = options.voiceId ?? DEFAULT_MINIMAX_VOICE;
  const speed = options.speed ?? DEFAULT_TTS_SPEED;
  const config = await loadTtsConfig(env);
  const policy = await storedClipPolicy(env);
  const keyFor = clipKeyFor(config, text, { voiceId, speed, conversation: options.conversation });

  const lookup: TtsProviderId[] = options.regenerate ? [] : policy.acceptable.length ? policy.acceptable : ['minimax'];
  for (const p of lookup) {
    const stored = await env.AUDIO_BUCKET.get(await keyFor(p)).catch(() => null);
    if (stored) {
      const bytes = new Uint8Array(await stored.arrayBuffer());
      return { audioBase64: bytesToBase64(bytes), contentType: 'audio/mpeg', provider: TTS_PROVIDER_IMPLS[p].stored, providerId: p, voiceId, cached: true };
    }
  }
  const result = await generateConversationTTS(env, text, {
    voiceId,
    speed,
    priority: options.priority,
    allowGoogleFallback: options.allowGoogleFallback,
    conversation: options.conversation,
  });
  if (!result) return null;
  if (result.providerId && policy.order.includes(result.providerId)) {
    const binary = atob(result.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const key = await keyFor(result.providerId);
    await env.AUDIO_BUCKET.put(key, bytes, { httpMetadata: { contentType: result.contentType } }).catch((e) => {
      console.error('[tts-cache] put failed', e);
    });
  }
  return { ...result, voiceId, cached: false };
}
