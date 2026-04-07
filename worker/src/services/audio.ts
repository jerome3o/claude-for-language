import { Env } from '../types';

/**
 * Audio service for TTS generation and storage using MiniMax and Google Cloud TTS.
 */

export type AudioProvider = 'minimax' | 'gtts';

export const DEFAULT_TTS_SPEED = 0.6;
export const DEFAULT_MINIMAX_VOICE = 'Chinese (Mandarin)_Gentleman';

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

export async function getAudio(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
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

async function callMiniMaxTTS(
  env: Env,
  text: string,
  speed: number,
  voiceId: string
): Promise<Uint8Array | null> {
  if (!env.MINIMAX_API_KEY) return null;
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
        audio_setting: { format: 'mp3', sample_rate: 32000 },
      }),
    });
    if (!response.ok) {
      console.error('[TTS] MiniMax error:', response.status, await response.text());
      return null;
    }
    const data = (await response.json()) as {
      data?: { audio?: string };
      base_resp?: { status_code: number; status_msg: string };
    };
    const audioData = data.data?.audio;
    if (!audioData) {
      console.error('[TTS] MiniMax: no audio in response', data.base_resp);
      return null;
    }
    return decodeMiniMaxAudio(audioData);
  } catch (error) {
    console.error('[TTS] MiniMax request failed:', error);
    return null;
  }
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
            effectsProfileId: ['headphone-class-device'],
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
export async function generateTTS(
  env: Env,
  text: string,
  noteId: string,
  options: TTSOptions = {}
): Promise<TTSResult | null> {
  const speed = options.speed ?? DEFAULT_TTS_SPEED;
  const voiceId = options.voiceId ?? DEFAULT_MINIMAX_VOICE;

  const tryProviders: AudioProvider[] =
    options.preferProvider === 'gtts' ? ['gtts', 'minimax'] : ['minimax', 'gtts'];

  for (const provider of tryProviders) {
    const bytes =
      provider === 'minimax'
        ? await callMiniMaxTTS(env, text, speed, voiceId)
        : await callGoogleTTS(env, text, speed);
    if (bytes) {
      const key = getUniqueAudioKey(noteId);
      await storeAudio(env.AUDIO_BUCKET, key, bytes.buffer as ArrayBuffer, 'audio/mpeg');
      return { audioKey: key, provider };
    }
  }
  return null;
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

  const minimax = await callMiniMaxTTS(env, text, speed, voiceId);
  if (minimax) {
    return { audioBase64: bytesToBase64(minimax), contentType: 'audio/mpeg', provider: 'minimax' };
  }
  const google = await callGoogleTTS(env, text, speed);
  if (google) {
    return { audioBase64: bytesToBase64(google), contentType: 'audio/mpeg', provider: 'gtts' };
  }
  return null;
}
