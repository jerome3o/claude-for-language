import { Env } from '../types';
import { TTS_AUDIO_SETTING, TTS_MODEL, TTS_SPEED, TTS_VOICE, ttsSettings } from './tts/settings';
import type { TtsPriority } from './tts/bucket';
import { acquireTtsSlot, reportTts } from './tts/limiter';
import { accountErrorCode } from './tts/account';

/**
 * Audio service for TTS generation and storage using MiniMax and Google Cloud TTS.
 */

export type AudioProvider = 'minimax' | 'gtts';

/** services/tts/settings.ts is the one place these are set. */
export const DEFAULT_TTS_SPEED = TTS_SPEED;
// Radio Host: clearest enunciation of the MiniMax voices (Jerome's pick)
export const DEFAULT_MINIMAX_VOICE = TTS_VOICE;

export interface TTSResult {
  audioKey: string;
  provider: AudioProvider;
  model: string;
  voice: string;
  speed: number;
}

export interface TTSOptions {
  speed?: number;
  /** Ignored for 'gtts': stored clips are MiniMax only (docs/AUDIO.md). Kept for old clients. */
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

// ---------- Provider calls (HTTP + decode, no storage) ----------

function decodeMiniMaxAudio(audioData: string): Uint8Array {
  // MiniMax returns either hex or base64 depending on response.
  const isLikelyHex = /^[0-9a-fA-F]+$/.test(audioData.slice(0, 100));
  if (isLikelyHex) {
    const bytes = new Uint8Array(audioData.length / 2);
    for (let i = 0; i < audioData.length; i += 2) {
      bytes[i / 2] = parseInt(audioData.substr(i, 2), 16);
    }
    return bytes;
  }
  return Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
}

/**
 * One MiniMax answer. `rateLimited` = MiniMax's RPM / TPM limit (1002, 1039,
 * HTTP 429), our own limiter said no, or the ACCOUNT is paused: wait and try
 * again later, never in the request — nothing is recorded against the clip.
 * `account` = an account problem (no credit, bad key; services/tts/account.ts)
 * — set with `rateLimited`. `network` = no answer from MiniMax at all.
 * `permanent` = stop trying this text.
 */
export type MiniMaxOutcome =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; permanent: boolean; rateLimited: boolean; reason: string; retryAfterMs?: number; account?: number | string; network?: boolean };

/** Clip-level only: account codes (1004, 2053…) pause everything instead (services/tts/account.ts). */
const MINIMAX_PERMANENT_CODES = new Set([
  1042, // invalid characters exceed 10%
  2013, // invalid params (e.g. unsupported text)
]);
export const MINIMAX_RATE_LIMIT_CODES = new Set([1002, 1039]);
/** After MiniMax itself says rate limit: requeue this long (docs/AUDIO.md). */
export const RATE_LIMIT_REQUEUE_MS = 60_000;

async function callMiniMaxOnce(
  env: Env,
  text: string,
  speed: number,
  voiceId: string,
  model: string = TTS_MODEL,
): Promise<MiniMaxOutcome> {
  try {
    const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        text,
        stream: false,
        voice_setting: { voice_id: voiceId, speed },
        // Pin the encode: a service-side default change here is inaudible in
        // logs but very audible on the phone.
        audio_setting: { ...TTS_AUDIO_SETTING },
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error('[TTS] MiniMax HTTP error:', response.status, body.slice(0, 300));
      const rateLimited = response.status === 429;
      const account = accountErrorCode({ httpStatus: response.status }) ?? undefined;
      return {
        ok: false,
        permanent: false,
        rateLimited: rateLimited || account !== undefined,
        reason: `http ${response.status}`,
        retryAfterMs: rateLimited ? RATE_LIMIT_REQUEUE_MS : undefined,
        account,
      };
    }
    const data = (await response.json()) as {
      data?: { audio?: string };
      base_resp?: { status_code: number; status_msg: string };
    };
    const audioData = data.data?.audio;
    if (!audioData) {
      const code = data.base_resp?.status_code ?? -1;
      const rateLimited = MINIMAX_RATE_LIMIT_CODES.has(code);
      const account = accountErrorCode({ code }) ?? undefined;
      if (!rateLimited) console.error('[TTS] MiniMax: no audio in response', data.base_resp);
      return {
        ok: false,
        permanent: MINIMAX_PERMANENT_CODES.has(code),
        rateLimited: rateLimited || account !== undefined,
        reason: `base_resp ${code} ${data.base_resp?.status_msg ?? ''}`.trim(),
        retryAfterMs: rateLimited ? RATE_LIMIT_REQUEUE_MS : undefined,
        account,
      };
    }
    return { ok: true, bytes: decodeMiniMaxAudio(audioData) };
  } catch (error) {
    console.error('[TTS] MiniMax request failed:', error);
    return { ok: false, permanent: false, rateLimited: false, reason: 'network', network: true };
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * The ONE way to call MiniMax: a slot from the shared limiter first, then the
 * call. A rate limit is never retried here — the caller requeues (batch) or
 * queues the clip (interactive). Interactive callers get one retry on a network
 * blip / 5xx; batch callers none (the queue comes back to them).
 */
export async function callMiniMaxTTS(
  env: Env,
  text: string,
  speed: number,
  voiceId: string,
  opts: { priority?: TtsPriority; maxWaitMs?: number; model?: string } = {},
): Promise<MiniMaxOutcome> {
  if (!env.MINIMAX_API_KEY) return { ok: false, permanent: true, rateLimited: false, reason: 'not configured' };
  const priority = opts.priority ?? 'interactive';
  const attempts = priority === 'interactive' ? 2 : 1;
  let last: MiniMaxOutcome = { ok: false, permanent: false, rateLimited: false, reason: 'unattempted' };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(500);
    const slot = await acquireTtsSlot(env, priority, opts.maxWaitMs);
    if (!slot.granted) {
      // An account pause is the limiter saying no too: wait, record nothing against the clip.
      return { ok: false, permanent: false, rateLimited: true, reason: slot.account ? 'account paused' : 'limiter', retryAfterMs: slot.retryAfterMs, account: slot.account };
    }
    last = await callMiniMaxOnce(env, text, speed, voiceId, opts.model);
    if (last.ok) {
      await reportTts(env, 'ok');
      return last;
    }
    if (last.account !== undefined) {
      // No credit / bad key: pause every call (services/tts/account.ts) and wait out the pause.
      const pause = await reportTts(env, 'account_error', { code: last.account, message: last.reason });
      return { ...last, retryAfterMs: pause ?? last.retryAfterMs };
    }
    await reportTts(env, last.rateLimited ? 'rate_limited' : last.network ? 'network' : 'failed');
    if (last.permanent || last.rateLimited) return last;
  }
  return last;
}

async function callGoogleTTS(env: Env, text: string, speed: number): Promise<Uint8Array | null> {
  if (!env.GOOGLE_TTS_API_KEY) return null;
  try {
    const response = await fetch(
      'https://texttospeech.googleapis.com/v1/text:synthesize',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GOOGLE_TTS_API_KEY },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-C', ssmlGender: 'FEMALE' },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: speed,
            sampleRateHertz: 24000,
          },
        }),
      }
    );
    if (!response.ok) {
      console.error('[TTS] Google error:', response.status, await response.text());
      return null;
    }
    const data = (await response.json()) as { audioContent: string };
    return Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
  } catch (error) {
    console.error('[TTS] Google request failed:', error);
    return null;
  }
}

// ---------- Public API ----------

export type TTSOutcome =
  | { ok: true; result: TTSResult }
  | { ok: false; permanent: boolean; rateLimited: boolean; reason: string; retryAfterMs?: number; account?: number | string };

/**
 * Generate a clip with MiniMax and store it in R2. MiniMax only: a stored clip
 * is permanent, and the Google voice is "pretty terrible" — a clip that can't
 * be made now waits in the queue for MiniMax (docs/AUDIO.md).
 */
export async function generateTTSDetailed(
  env: Env,
  text: string,
  keyId: string,
  options: TTSOptions = {}
): Promise<TTSOutcome> {
  const settings = ttsSettings(env);
  const speed = options.speed ?? settings.speed;
  const voiceId = options.voiceId ?? settings.voice;
  const mm = await callMiniMaxTTS(env, text, speed, voiceId, { priority: options.priority, maxWaitMs: options.maxWaitMs });
  if (!mm.ok) {
    if (!mm.rateLimited) console.warn('[TTS] MiniMax could not make the clip:', mm.reason);
    return mm;
  }
  const key = getUniqueAudioKey(keyId);
  await storeAudio(env.AUDIO_BUCKET, key, mm.bytes.buffer as ArrayBuffer, 'audio/mpeg');
  return { ok: true, result: { audioKey: key, provider: 'minimax', model: TTS_MODEL, voice: voiceId, speed } };
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
  voiceId?: string;
  speed?: number;
  priority?: TtsPriority;
  /**
   * Live playback only (docs/AUDIO.md "Google fallback"): when MiniMax can't
   * speak now, return a Google clip (`provider: 'gtts'`) for this one play.
   * Never for anything a server or device keeps — those wait for MiniMax.
   */
  allowGoogleFallback?: boolean;
}

export interface ConversationTTSResult {
  audioBase64: string;
  contentType: string;
  provider: AudioProvider;
}

/**
 * MiniMax only, no Google fallback: for voice samples (Settings → Conversation
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
 * Generate TTS for conversation messages and return base64 (no R2 storage).
 */
export async function generateConversationTTS(
  env: Env,
  text: string,
  options: ConversationTTSOptions = {}
): Promise<ConversationTTSResult | null> {
  const speed = options.speed ?? DEFAULT_TTS_SPEED;
  const voiceId = options.voiceId ?? DEFAULT_MINIMAX_VOICE;

  const mm = await callMiniMaxTTS(env, text, speed, voiceId, { priority: options.priority ?? 'interactive' });
  if (mm.ok) {
    return { audioBase64: bytesToBase64(mm.bytes), contentType: 'audio/mpeg', provider: 'minimax' };
  }
  if (!options.allowGoogleFallback) return null;
  // Live playback that nobody keeps (services/tts-cache.ts stores only MiniMax
  // clips; the caller plays it once), so a worse voice beats none in the moment.
  const google = await callGoogleTTS(env, text, speed);
  if (google) {
    return { audioBase64: bytesToBase64(google), contentType: 'audio/mpeg', provider: 'gtts' };
  }
  return null;
}

// ---------- Identifying what's already stored ----------

/**
 * Which provider produced an MP3, from its first frame header. MiniMax encodes
 * MPEG-1 at 32 kHz; Google's TTS returns MPEG-2 at 24 kHz. Anything else is
 * unknown. Used to classify clips stored before the provider was recorded, so
 * the bad ones can be found and replaced.
 */
export function classifyMp3(bytes: Uint8Array): AudioProvider | 'unknown' {
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
