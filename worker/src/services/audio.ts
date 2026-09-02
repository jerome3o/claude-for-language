import { Env } from '../types';

/**
 * Audio service for TTS generation and storage using MiniMax and Google Cloud TTS.
 */

export type AudioProvider = 'minimax' | 'gtts';

export const DEFAULT_TTS_SPEED = 0.6;
// Radio Host: clearest enunciation of the MiniMax voices (Jerome's pick)
export const DEFAULT_MINIMAX_VOICE = 'Chinese (Mandarin)_Radio_Host';

export interface TTSResult {
  audioKey: string;
  provider: AudioProvider;
}

export interface TTSOptions {
  speed?: number;
  preferProvider?: AudioProvider;
  voiceId?: string;
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

type MiniMaxOutcome =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; permanent: boolean; reason: string };

/**
 * MiniMax reports most failures inside a 200 response via base_resp; only a
 * few of them mean "stop trying". Everything else — rate limits above all —
 * is a reason to wait and retry, never a reason to hand the clip to a
 * different, worse-sounding voice.
 */
const MINIMAX_PERMANENT_CODES = new Set([
  1004, // invalid API key / auth
  2013, // invalid params (e.g. unsupported text)
]);

async function callMiniMaxOnce(
  env: Env,
  text: string,
  speed: number,
  voiceId: string
): Promise<MiniMaxOutcome> {
  try {
    const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'speech-02-hd',
        text,
        stream: false,
        voice_setting: { voice_id: voiceId, speed },
        // Pin the encode: a service-side default change here is inaudible in
        // logs but very audible on the phone.
        audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error('[TTS] MiniMax HTTP error:', response.status, body);
      const permanent = response.status === 401 || response.status === 403;
      return { ok: false, permanent, reason: `http ${response.status}` };
    }
    const data = (await response.json()) as {
      data?: { audio?: string };
      base_resp?: { status_code: number; status_msg: string };
    };
    const audioData = data.data?.audio;
    if (!audioData) {
      const code = data.base_resp?.status_code ?? -1;
      console.error('[TTS] MiniMax: no audio in response', data.base_resp);
      return {
        ok: false,
        permanent: MINIMAX_PERMANENT_CODES.has(code),
        reason: `base_resp ${code} ${data.base_resp?.status_msg ?? ''}`.trim(),
      };
    }
    return { ok: true, bytes: decodeMiniMaxAudio(audioData) };
  } catch (error) {
    console.error('[TTS] MiniMax request failed:', error);
    return { ok: false, permanent: false, reason: 'network' };
  }
}

const MINIMAX_ATTEMPTS = 3;
const MINIMAX_BACKOFF_MS = [400, 1200];

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** MiniMax with retries on transient failure. Null key → permanent failure. */
async function callMiniMaxTTS(
  env: Env,
  text: string,
  speed: number,
  voiceId: string
): Promise<MiniMaxOutcome> {
  if (!env.MINIMAX_API_KEY) return { ok: false, permanent: true, reason: 'not configured' };
  let last: MiniMaxOutcome = { ok: false, permanent: false, reason: 'unattempted' };
  for (let attempt = 0; attempt < MINIMAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(MINIMAX_BACKOFF_MS[attempt - 1] ?? 1200);
    last = await callMiniMaxOnce(env, text, speed, voiceId);
    if (last.ok || last.permanent) return last;
  }
  return last;
}

async function callGoogleTTS(env: Env, text: string, speed: number): Promise<Uint8Array | null> {
  if (!env.GOOGLE_TTS_API_KEY) return null;
  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

/**
 * Generate TTS audio, store it in R2, and return the key + provider used.
 * Tries MiniMax first (or `preferProvider`), falls back to the other.
 */
/**
 * Generate TTS audio, store it in R2, and return the key + provider used.
 *
 * MiniMax is the voice the learner hears everywhere else; Google is a last
 * resort with a different voice, half the bitrate, and time-stretched slow
 * speech that sounds crunchy. A stored clip is permanent, so a transient
 * MiniMax failure (rate limit during a bulk sentence-set run, a blip) returns
 * null and lets the caller retry later — never a quietly-worse clip. Google is
 * only used when MiniMax is unavailable for good, or the caller asked for it.
 */
export async function generateTTS(
  env: Env,
  text: string,
  noteId: string,
  options: TTSOptions = {}
): Promise<TTSResult | null> {
  const speed = options.speed ?? DEFAULT_TTS_SPEED;
  const voiceId = options.voiceId ?? DEFAULT_MINIMAX_VOICE;

  const store = async (bytes: Uint8Array, provider: AudioProvider): Promise<TTSResult> => {
    const key = getUniqueAudioKey(noteId);
    await storeAudio(env.AUDIO_BUCKET, key, bytes.buffer as ArrayBuffer, 'audio/mpeg');
    return { audioKey: key, provider };
  };

  if (options.preferProvider === 'gtts') {
    const google = await callGoogleTTS(env, text, speed);
    if (google) return store(google, 'gtts');
    const mm = await callMiniMaxTTS(env, text, speed, voiceId);
    return mm.ok ? store(mm.bytes, 'minimax') : null;
  }

  const mm = await callMiniMaxTTS(env, text, speed, voiceId);
  if (mm.ok) return store(mm.bytes, 'minimax');
  if (!mm.permanent) {
    console.warn('[TTS] MiniMax unavailable for now, leaving clip for retry:', mm.reason);
    return null;
  }
  const google = await callGoogleTTS(env, text, speed);
  return google ? store(google, 'gtts') : null;
}

export interface ConversationTTSOptions {
  voiceId?: string;
  speed?: number;
}

export interface ConversationTTSResult {
  audioBase64: string;
  contentType: string;
  provider: AudioProvider;
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

  const mm = await callMiniMaxTTS(env, text, speed, voiceId);
  if (mm.ok) {
    return { audioBase64: bytesToBase64(mm.bytes), contentType: 'audio/mpeg', provider: 'minimax' };
  }
  // Ephemeral (never stored), so a worse voice beats no voice — but only once
  // MiniMax has been given its retries.
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
