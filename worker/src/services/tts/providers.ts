/**
 * The TTS providers (docs/AUDIO.md "Providers"): one `TtsProvider` per service,
 * each a plain HTTP call + decode with NO limiter and NO storage — the limiter,
 * account pause and fallback order live in services/audio.ts
 * (`callProviderTTS`, `synthesizeOrdered`). Every answer is classified into the
 * categories the pipeline already uses:
 *   rateLimited (+ account) — wait, never a failure against the clip;
 *   permanent — this text will never work with this provider;
 *   network — no answer at all; anything else = a transient failure.
 */
import type { Env } from '../../types';
import { accountErrorCode } from './account';
import { TTS_AUDIO_SETTING, TTS_MODEL } from './settings';
import { azureRateAttr, isFixedRateVoice, type TtsProviderId } from '@shared/tts';

export interface SynthRequest {
  text: string;
  voice: string;
  /** The provider's own rate / speed (already mapped from the app's speed). */
  rate: number;
  /** MiniMax only: another model (the admin calibration). */
  model?: string;
  /** Azure only: `<mstts:express-as style>` (conversation delivery; the voice must support it). */
  style?: string;
  /** MiniMax only: `voice_setting.emotion` (conversation delivery). */
  emotion?: string;
}

export type ProviderOutcome =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; permanent: boolean; rateLimited: boolean; reason: string; retryAfterMs?: number; account?: number | string; network?: boolean };

export interface TtsProvider {
  id: TtsProviderId;
  /** What `audio_provider` columns record ('gtts' for Google, as before providers existed). */
  stored: 'minimax' | 'azure' | 'gtts';
  /** `audio_model` for a voice. */
  model(voice: string): string;
  configured(env: Env): boolean;
  synthesize(env: Env, req: SynthRequest, fetcher?: typeof fetch): Promise<ProviderOutcome>;
}

/** After a provider's own rate limit: requeue this long (docs/AUDIO.md). */
export const RATE_LIMIT_REQUEUE_MS = 60_000;

// ---------------- MiniMax ----------------

/** Clip-level only: account codes (1004, 2053…) pause everything instead (services/tts/account.ts). */
const MINIMAX_PERMANENT_CODES = new Set([
  1042, // invalid characters exceed 10%
  2013, // invalid params (e.g. unsupported text)
]);
export const MINIMAX_RATE_LIMIT_CODES = new Set([1002, 1039]);

function decodeMiniMaxAudio(audioData: string): Uint8Array {
  // MiniMax returns either hex or base64 depending on response.
  const isLikelyHex = /^[0-9a-fA-F]+$/.test(audioData.slice(0, 100));
  if (isLikelyHex) {
    const bytes = new Uint8Array(audioData.length / 2);
    for (let i = 0; i < audioData.length; i += 2) bytes[i / 2] = parseInt(audioData.substr(i, 2), 16);
    return bytes;
  }
  return Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0));
}

export const minimaxProvider: TtsProvider = {
  id: 'minimax',
  stored: 'minimax',
  model: () => TTS_MODEL,
  configured: (env) => !!env.MINIMAX_API_KEY,
  async synthesize(env, req, fetcher = fetch) {
    try {
      const response = await fetcher('https://api.minimax.io/v1/t2a_v2', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model ?? TTS_MODEL,
          text: req.text,
          stream: false,
          voice_setting: { voice_id: req.voice, speed: req.rate, ...(req.emotion ? { emotion: req.emotion } : {}) },
          // Pin the encode: a service-side default change is inaudible in logs but very audible on the phone.
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
      const data = (await response.json()) as { data?: { audio?: string }; base_resp?: { status_code: number; status_msg: string } };
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
      return { ok: true, bytes: decodeMiniMaxAudio(audioData), mime: 'audio/mpeg' };
    } catch (error) {
      console.error('[TTS] MiniMax request failed:', error);
      return { ok: false, permanent: false, rateLimited: false, reason: 'network', network: true };
    }
  },
};

// ---------------- Azure Speech ----------------

export const AZURE_OUTPUT_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * The SSML for one clip. HD voices (`name:DragonHD…`) take no <prosody>: they
 * speak at their own pace, so the rate is left out for them.
 */
export function buildAzureSsml(text: string, voice: string, rate: number, style?: string): string {
  const body = xmlEscape(text);
  let inner = isFixedRateVoice('azure', voice) || rate === 1 ? body : `<prosody rate="${azureRateAttr(rate)}">${body}</prosody>`;
  if (style) inner = `<mstts:express-as style="${xmlEscape(style)}">${inner}</mstts:express-as>`;
  const ns = style ? ' xmlns:mstts="https://www.w3.org/2001/mstts"' : '';
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"${ns} xml:lang="zh-CN"><voice name="${xmlEscape(voice)}">${inner}</voice></speak>`;
}

/**
 * An Azure HTTP status → the pipeline's categories. 401 / 403 = the key, the
 * region or the subscription (F0 quota used up) → account pause; 429 = rate /
 * concurrency limit; 400 = this SSML / text; 5xx = transient.
 */
export function classifyAzureError(status: number, body = ''): Exclude<ProviderOutcome, { ok: true }> {
  const reason = `azure http ${status}${body ? ' ' + body.replace(/\s+/g, ' ').slice(0, 120) : ''}`;
  if (status === 401 || status === 403) return { ok: false, permanent: false, rateLimited: true, reason, account: `azure http ${status}` };
  if (status === 429) return { ok: false, permanent: false, rateLimited: true, reason, retryAfterMs: RATE_LIMIT_REQUEUE_MS };
  if (status === 400 || status === 415) return { ok: false, permanent: true, rateLimited: false, reason };
  return { ok: false, permanent: false, rateLimited: false, reason };
}

export function azureEndpoint(region: string): string {
  return `https://${region.trim().toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export const azureProvider: TtsProvider = {
  id: 'azure',
  stored: 'azure',
  model: (voice) => (isFixedRateVoice('azure', voice) ? 'azure-hd' : 'azure-neural'),
  configured: (env) => !!env.AZURE_SPEECH_KEY && !!env.AZURE_SPEECH_REGION,
  async synthesize(env, req, fetcher = fetch) {
    try {
      const response = await fetcher(azureEndpoint(env.AZURE_SPEECH_REGION!), {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY!,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': AZURE_OUTPUT_FORMAT,
          'User-Agent': 'chinese-learning-worker',
        },
        body: buildAzureSsml(req.text, req.voice, req.rate, req.style),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error('[TTS] Azure HTTP error:', response.status, body.slice(0, 300));
        return classifyAzureError(response.status, body);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) return { ok: false, permanent: false, rateLimited: false, reason: 'azure empty audio' };
      return { ok: true, bytes, mime: 'audio/mpeg' };
    } catch (error) {
      console.error('[TTS] Azure request failed:', error);
      return { ok: false, permanent: false, rateLimited: false, reason: 'azure network', network: true };
    }
  },
};

/** Azure's zh voices in the configured region (admin status; read-only, proves the key works). */
export async function listAzureVoices(env: Env, fetcher: typeof fetch = fetch): Promise<{ ok: true; voices: Array<{ name: string; gender: string; local: string }> } | { ok: false; error: string }> {
  if (!azureProvider.configured(env)) return { ok: false, error: 'not configured' };
  try {
    const res = await fetcher(`https://${env.AZURE_SPEECH_REGION!.trim().toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY! },
    });
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const all = (await res.json()) as Array<{ ShortName: string; Gender: string; LocalName: string; Locale: string }>;
    return {
      ok: true,
      voices: all.filter((v) => /^zh-CN/i.test(v.Locale)).map((v) => ({ name: v.ShortName, gender: v.Gender, local: v.LocalName })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network' };
  }
}

// ---------------- Google ----------------

export function classifyGoogleError(status: number, body = ''): Exclude<ProviderOutcome, { ok: true }> {
  const reason = `google http ${status}${body ? ' ' + body.replace(/\s+/g, ' ').slice(0, 120) : ''}`;
  if (status === 401 || status === 403) return { ok: false, permanent: false, rateLimited: true, reason, account: `google http ${status}` };
  if (status === 429) return { ok: false, permanent: false, rateLimited: true, reason, retryAfterMs: RATE_LIMIT_REQUEUE_MS };
  if (status === 400) return { ok: false, permanent: true, rateLimited: false, reason };
  return { ok: false, permanent: false, rateLimited: false, reason };
}

export const googleProvider: TtsProvider = {
  id: 'google',
  stored: 'gtts',
  model: () => 'wavenet',
  configured: (env) => !!env.GOOGLE_TTS_API_KEY,
  async synthesize(env, req, fetcher = fetch) {
    try {
      const languageCode = req.voice.split('-').slice(0, 2).join('-') || 'cmn-CN';
      const response = await fetcher('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GOOGLE_TTS_API_KEY },
        body: JSON.stringify({
          input: { text: req.text },
          voice: { languageCode, name: req.voice },
          audioConfig: { audioEncoding: 'MP3', speakingRate: req.rate, sampleRateHertz: 24000 },
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error('[TTS] Google error:', response.status, body.slice(0, 300));
        return classifyGoogleError(response.status, body);
      }
      const data = (await response.json()) as { audioContent?: string };
      if (!data.audioContent) return { ok: false, permanent: false, rateLimited: false, reason: 'google empty audio' };
      return { ok: true, bytes: Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0)), mime: 'audio/mpeg' };
    } catch (error) {
      console.error('[TTS] Google request failed:', error);
      return { ok: false, permanent: false, rateLimited: false, reason: 'google network', network: true };
    }
  },
};

export const TTS_PROVIDER_IMPLS: Record<TtsProviderId, TtsProvider> = {
  minimax: minimaxProvider,
  azure: azureProvider,
  google: googleProvider,
};

export function configuredProviders(env: Env): Record<TtsProviderId, boolean> {
  return { minimax: minimaxProvider.configured(env), azure: azureProvider.configured(env), google: googleProvider.configured(env) };
}
