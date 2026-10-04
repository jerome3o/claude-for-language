import { Env } from '../types';
import { TTS_SPEED, TTS_VOICE, houseSpeed } from './tts/settings';
import type { TtsPriority } from './tts/bucket';
import { acquireTtsSlot, reportTts } from './tts/limiter';
import { TTS_PROVIDER_IMPLS, configuredProviders, type SynthRequest } from './tts/providers';
import { loadTtsConfig, providerVoice, storedClipHash } from './tts/config';
import { usableOrder, type TtsConfig, type TtsProviderId } from '@shared/tts';

/**
 * Audio service: TTS generation (MiniMax, Azure Speech, Google — in the admin's
 * order, docs/AUDIO.md "Providers") and storage in R2.
 */

/** What `audio_provider` columns hold ('gtts' = Google). */
export type AudioProvider = 'minimax' | 'azure' | 'gtts';

/** services/tts/settings.ts is the one place these are set. */
export const DEFAULT_TTS_SPEED = TTS_SPEED;
// Radio Host: clearest enunciation of the MiniMax voices (Jerome's pick)
export const DEFAULT_MINIMAX_VOICE = TTS_VOICE;

export interface TTSResult {
  audioKey: string;
  provider: AudioProvider;
  model: string;
  voice: string;
  /** The provider's own rate (MiniMax: the app's speed). */
  speed: number;
  /** The provider's stored-clip settings hash when made with the house voice + speed, else null (a custom clip). */
  settingsHash?: string | null;
}

export interface TTSOptions {
  speed?: number;
  /** Ignored: the admin's stored-clip order decides (docs/AUDIO.md). Kept for old clients. */
  preferProvider?: AudioProvider;
  voiceId?: string;
  /** Who is waiting (docs/AUDIO.md "Rate limit"). Default interactive. */
  priority?: TtsPriority;
  /** Interactive: how long to wait for a limiter slot. */
  maxWaitMs?: number;
}

// ---------- R2 storage ----------

export async function storeAudio(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer,
  contentType: string = 'audio/webm'
): Promise<string> {
  await bucket.put(key, data, { httpMetadata: { contentType } });
  return key;
}

export async function getAudio(
  bucket: R2Bucket,
  key: string,
  range?: R2Range
): Promise<R2ObjectBody | null> {
  return bucket.get(key, range ? { range } : undefined);
}

/**
 * Parse a single-range `Range: bytes=...` header into an R2 range.
 * Returns undefined for absent, malformed, or multi-range headers — callers
 * then serve the whole object, which is a valid response to any Range request.
 */
export function parseByteRange(header: string | undefined | null): R2Range | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, startRaw, endRaw] = match;

  if (startRaw === '') {
    // Suffix range: "bytes=-500" means the last 500 bytes.
    const suffix = Number(endRaw);
    return endRaw === '' || !Number.isFinite(suffix) || suffix <= 0 ? undefined : { suffix };
  }

  const offset = Number(startRaw);
  if (!Number.isFinite(offset)) return undefined;
  if (endRaw === '') return { offset };

  const end = Number(endRaw);
  if (!Number.isFinite(end) || end < offset) return undefined;
  return { offset, length: end - offset + 1 };
}

/**
 * Normalise the range R2 actually served into absolute offset/length, so the
 * Content-Range header matches the bytes in the body. R2 echoes the range in
 * whichever of its three shapes was requested (offset, offset+length, or
 * suffix); a suffix has to be converted against the object size.
 */
export function resolveServedRange(
  served: R2Range | undefined,
  size: number
): { offset: number; length: number } | null {
  if (!served) return null;
  if ('suffix' in served) {
    const length = Math.min(served.suffix, size);
    return { offset: size - length, length };
  }
  const offset = served.offset ?? 0;
  const length = served.length ?? size - offset;
  if (offset < 0 || length <= 0 || offset + length > size) return null;
  return { offset, length };
}

export async function deleteAudio(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

export function getUniqueAudioKey(noteId: string): string {
  const id = crypto.randomUUID().split('-')[0];
  return `generated/${noteId}_${id}.mp3`;
}

export function getRecordingKey(reviewId: string): string {
  return `recordings/${reviewId}.webm`;
}

// ---------- Provider calls (limiter + account pause + fallback order) ----------

/**
 * One provider's answer (services/tts/providers.ts). `rateLimited` = the
 * provider's own RPM limit, our limiter said no, or its ACCOUNT is paused: wait
 * and try again later, never in the request — nothing is recorded against the
 * clip. `account` = an account problem (no credit, bad key; services/tts/account.ts)
 * — set with `rateLimited`. `network` = no answer at all. `permanent` = stop
 * trying this text (with this provider).
 */
export type MiniMaxOutcome =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; permanent: boolean; rateLimited: boolean; reason: string; retryAfterMs?: number; account?: number | string; network?: boolean };
export type ProviderCallOutcome = Exclude<MiniMaxOutcome, { ok: true }> | { ok: true; bytes: Uint8Array; mime: string };

export { MINIMAX_RATE_LIMIT_CODES, RATE_LIMIT_REQUEUE_MS } from './tts/providers';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * The ONE way to call a TTS provider: a slot from that provider's limiter first,
 * then the call, the outcome reported back. A rate limit is never retried here
 * — the caller requeues (batch), queues the clip or falls back (interactive).
 * Interactive callers get one retry on a network blip / 5xx; batch callers none.
 */
export async function callProviderTTS(
  env: Env,
  providerId: TtsProviderId,
  req: SynthRequest,
  opts: { priority?: TtsPriority; maxWaitMs?: number; maxRpm?: number } = {},
): Promise<ProviderCallOutcome> {
  const provider = TTS_PROVIDER_IMPLS[providerId];
  if (!provider.configured(env)) return { ok: false, permanent: true, rateLimited: false, reason: 'not configured' };
  const target = { provider: providerId, maxRpm: opts.maxRpm };
  const priority = opts.priority ?? 'interactive';
  const attempts = priority === 'interactive' ? 2 : 1;
  let last: ProviderCallOutcome = { ok: false, permanent: false, rateLimited: false, reason: 'unattempted' };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(500);
    const slot = await acquireTtsSlot(env, priority, opts.maxWaitMs, target);
    if (!slot.granted) {
      // An account pause is the limiter saying no too: wait, record nothing against the clip.
      return { ok: false, permanent: false, rateLimited: true, reason: slot.account ? 'account paused' : 'limiter', retryAfterMs: slot.retryAfterMs, account: slot.account };
    }
    last = await provider.synthesize(env, req);
    if (last.ok) {
      await reportTts(env, 'ok', undefined, target);
      return last;
    }
    if (last.account !== undefined) {
      // No credit / bad key: pause every call to this provider and wait out the pause.
      const pause = await reportTts(env, 'account_error', { code: last.account, message: last.reason }, target);
      return { ...last, retryAfterMs: pause ?? last.retryAfterMs };
    }
    await reportTts(env, last.rateLimited ? 'rate_limited' : last.network ? 'network' : 'failed', { code: 'failed', message: last.reason }, target);
    if (last.permanent || last.rateLimited) return last;
  }
  return last;
}

/** MiniMax through its limiter (voice samples, the admin calibration). */
export async function callMiniMaxTTS(
  env: Env,
  text: string,
  speed: number,
  voiceId: string,
  opts: { priority?: TtsPriority; maxWaitMs?: number; model?: string } = {},
): Promise<MiniMaxOutcome> {
  if (!env.MINIMAX_API_KEY) return { ok: false, permanent: true, rateLimited: false, reason: 'not configured' };
  const config = await loadTtsConfig(env);
  const out = await callProviderTTS(env, 'minimax', { text, voice: voiceId, rate: speed, model: opts.model }, {
    priority: opts.priority,
    maxWaitMs: opts.maxWaitMs,
    maxRpm: config.providers.minimax.max_rpm,
  });
  return out.ok ? { ok: true, bytes: out.bytes } : out;
}

/**
 * Should the next provider in the order get a go? An account pause, "not
 * configured" or a failure of this provider: yes. A plain rate limit (the
 * limiter's wait, the provider's 1002 / 429): only for someone waiting
 * (interactive) — background work waits for the first provider instead of
 * spending the backup on every clip.
 */
export function shouldTryNextProvider(outcome: Exclude<ProviderCallOutcome, { ok: true }>, priority: TtsPriority): boolean {
  if (outcome.account !== undefined) return true;
  if (outcome.rateLimited) return priority === 'interactive';
  return true;
}

/** Many failed attempts → one answer: wait (shortest wait) if any provider asked to, else a failure. */
export function combineProviderFailures(
  attempts: Array<{ provider: TtsProviderId; outcome: Exclude<ProviderCallOutcome, { ok: true }> }>,
): Exclude<MiniMaxOutcome, { ok: true }> {
  if (attempts.length === 0) return { ok: false, permanent: true, rateLimited: false, reason: 'not configured' };
  const waits = attempts.filter((a) => a.outcome.rateLimited);
  if (waits.length) {
    const first = waits.reduce((a, b) => ((b.outcome.retryAfterMs ?? 60_000) < (a.outcome.retryAfterMs ?? 60_000) ? b : a));
    // `account` only when every provider that asked to wait is account-paused (else it's a plain wait).
    const allAccount = waits.every((w) => w.outcome.account !== undefined);
    return {
      ok: false,
      permanent: false,
      rateLimited: true,
      reason: first.outcome.reason,
      retryAfterMs: first.outcome.retryAfterMs,
      account: allAccount ? first.outcome.account : undefined,
    };
  }
  const reason = attempts.map((a) => (a.provider === 'minimax' ? a.outcome.reason : a.outcome.reason.startsWith(a.provider) ? a.outcome.reason : `${a.provider} ${a.outcome.reason}`)).join('; ');
  return {
    ok: false,
    permanent: attempts.every((a) => a.outcome.permanent),
    rateLimited: false,
    reason: reason.slice(0, 300),
    network: attempts.every((a) => a.outcome.network),
  };
}

export type OrderedOutcome =
  | { ok: true; bytes: Uint8Array; mime: string; provider: TtsProviderId; voice: string; rate: number; model: string }
  | Exclude<MiniMaxOutcome, { ok: true }>;

/**
 * Speak `text` with the first provider of `order` that can (docs/AUDIO.md
 * "Providers"). Disabled / unconfigured providers are skipped; each provider's
 * voice and rate come from the admin settings (`providerVoice`).
 */
export async function synthesizeOrdered(
  env: Env,
  order: readonly TtsProviderId[],
  text: string,
  req: { voiceId?: string; speed: number; priority: TtsPriority; maxWaitMs?: number },
  config?: TtsConfig,
): Promise<OrderedOutcome> {
  const cfg = config ?? (await loadTtsConfig(env));
  const usable = usableOrder(order, cfg, configuredProviders(env));
  const attempts: Array<{ provider: TtsProviderId; outcome: Exclude<ProviderCallOutcome, { ok: true }> }> = [];
  for (const providerId of usable) {
    const { voice, rate } = providerVoice(providerId, cfg, { voiceId: req.voiceId, speed: req.speed });
    const out = await callProviderTTS(env, providerId, { text, voice, rate }, {
      priority: req.priority,
      maxWaitMs: req.maxWaitMs,
      maxRpm: cfg.providers[providerId].max_rpm,
    });
    if (out.ok) {
      return { ok: true, bytes: out.bytes, mime: out.mime, provider: providerId, voice, rate, model: TTS_PROVIDER_IMPLS[providerId].model(voice) };
    }
    attempts.push({ provider: providerId, outcome: out });
    if (!shouldTryNextProvider(out, req.priority)) break;
  }
  return combineProviderFailures(attempts);
}

// ---------- Public API ----------

export type TTSOutcome =
  | { ok: true; result: TTSResult }
  | { ok: false; permanent: boolean; rateLimited: boolean; reason: string; retryAfterMs?: number; account?: number | string };

/**
 * Make a STORED clip and put it in R2: the stored-clip order (MiniMax first by
 * default), never Google unless an admin put it in that order. A clip that
 * can't be made now waits in the queue (docs/AUDIO.md).
 */
export async function generateTTSDetailed(
  env: Env,
  text: string,
  keyId: string,
  options: TTSOptions = {}
): Promise<TTSOutcome> {
  const config = await loadTtsConfig(env);
  const houseDefaults = options.speed === undefined && options.voiceId === undefined;
  const speed = options.speed ?? houseSpeed(env);
  const out = await synthesizeOrdered(env, config.stored_order, text, {
    voiceId: options.voiceId,
    speed,
    priority: options.priority ?? 'interactive',
    maxWaitMs: options.maxWaitMs,
  }, config);
  if (!out.ok) {
    if (!out.rateLimited) console.warn('[TTS] no provider could make the clip:', out.reason);
    return out;
  }
  const key = getUniqueAudioKey(keyId);
  await storeAudio(env.AUDIO_BUCKET, key, out.bytes.buffer as ArrayBuffer, out.mime);
  return {
    ok: true,
    result: {
      audioKey: key,
      provider: TTS_PROVIDER_IMPLS[out.provider].stored,
      model: out.model,
      voice: out.voice,
      speed: out.rate,
      settingsHash: houseDefaults ? storedClipHash(out.provider, config, env) : null,
    },
  };
}

/** `generateTTSDetailed` for callers that only need "a clip or nothing". */
export async function generateTTS(
  env: Env,
  text: string,
  noteId: string,
  options: TTSOptions = {}
): Promise<TTSResult | null> {
  const outcome = await generateTTSDetailed(env, text, noteId, options);
  return outcome.ok ? outcome.result : null;
}

export interface ConversationTTSOptions {
  /** A MiniMax catalogue voice (shared/lesson/voices.ts); other providers map it by gender. */
  voiceId?: string;
  speed?: number;
  priority?: TtsPriority;
  /**
   * Live playback only (docs/AUDIO.md "Providers"): use the LIVE order (Google
   * may stand in). Without it the stored order — for anything a server or
   * device keeps.
   */
  allowGoogleFallback?: boolean;
}

export interface ConversationTTSResult {
  audioBase64: string;
  contentType: string;
  provider: AudioProvider;
  /** The provider + voice + rate that actually spoke (tts-cache keys by them). */
  providerId?: TtsProviderId;
  providerVoice?: string;
  providerRate?: number;
}

/**
 * MiniMax only, no fallback: for voice samples (Settings → Conversation
 * voices), where a different voice would misrepresent the one being auditioned.
 * Null when MiniMax can't speak it (e.g. a voice id it doesn't know).
 */
export async function generateMiniMaxTTS(
  env: Env,
  text: string,
  speed: number,
  voiceId: string,
): Promise<Uint8Array | null> {
  const mm = await callMiniMaxTTS(env, text, speed, voiceId, { priority: 'interactive' });
  if (!mm.ok) {
    console.error('[TTS] MiniMax only failed for', voiceId, mm.reason);
    return null;
  }
  return mm.bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * TTS for conversation lines / chat messages, returned as base64 (no R2 here;
 * services/tts-cache.ts keeps clips). Stored order by default, the live order
 * with `allowGoogleFallback`.
 */
export async function generateConversationTTS(
  env: Env,
  text: string,
  options: ConversationTTSOptions = {}
): Promise<ConversationTTSResult | null> {
  const config = await loadTtsConfig(env);
  const order = options.allowGoogleFallback ? config.live_order : config.stored_order;
  const out = await synthesizeOrdered(env, order, text, {
    voiceId: options.voiceId ?? DEFAULT_MINIMAX_VOICE,
    speed: options.speed ?? DEFAULT_TTS_SPEED,
    priority: options.priority ?? 'interactive',
  }, config);
  if (!out.ok) return null;
  return {
    audioBase64: bytesToBase64(out.bytes),
    contentType: out.mime,
    provider: TTS_PROVIDER_IMPLS[out.provider].stored,
    providerId: out.provider,
    providerVoice: out.voice,
    providerRate: out.rate,
  };
}

// ---------- Identifying what's already stored ----------

/**
 * Which provider produced an MP3, from its first frame header. MiniMax encodes
 * MPEG-1 at 32 kHz; Google's TTS returns MPEG-2 at 24 kHz. Anything else is
 * unknown. Used to classify clips stored before the provider was recorded, so
 * the bad ones can be found and replaced.
 */
export function classifyMp3(bytes: Uint8Array): 'minimax' | 'gtts' | 'unknown' {
  let offset = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    offset = 10 + size;
  }
  // Find the first frame sync (0xFFE…).
  for (; offset + 4 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[offset + 1] >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2
    const layer = (bytes[offset + 1] >> 1) & 0x03; // 1 = Layer III
    const sampleIndex = (bytes[offset + 2] >> 2) & 0x03;
    if (layer !== 1 || sampleIndex === 3) continue;
    const rate =
      version === 3 ? [44100, 48000, 32000][sampleIndex]
      : version === 2 ? [22050, 24000, 16000][sampleIndex]
      : null;
    if (rate === 32000 && version === 3) return 'minimax';
    if (rate === 24000 && version === 2) return 'gtts';
    return 'unknown';
  }
  return 'unknown';
}
