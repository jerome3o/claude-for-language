/**
 * One pronunciation take → text: the upload path behind POST /api/transcribe, used when the
 * live (Soniox real-time) stream on the device didn't give an answer.
 *
 * Providers are tried in order until one answers, so one provider being down, out of quota or
 * rejecting the audio never leaves the learner with nothing:
 *   1. whisper — Workers AI whisper-large-v3-turbo (fast, no key)
 *   2. soniox  — Soniox async (stt-async-v5) with the permanent SONIOX_API_KEY
 *   3. gemini  — Gemini Flash with audio input (GEMINI_API_KEY)
 * Every failure is logged with the provider's own message (never a key), and a total failure
 * is a TakeTranscriptionError listing each provider's reason.
 */
import { bytesToBase64 } from './audio';
import { transcribeWithGemini, transcribeWithSoniox, type RawSegment } from './calls/transcribe';
import type { Env } from '../types';

export type TakeProvider = 'whisper' | 'soniox' | 'gemini';

export interface TakeTranscription {
  text: string;
  language: string;
  provider: TakeProvider;
  /** Providers that failed before this one answered. */
  failed: Array<{ provider: TakeProvider; error: string }>;
}

export class TakeTranscriptionError extends Error {
  constructor(readonly failed: Array<{ provider: TakeProvider; error: string }>) {
    super(failed.length ? failed.map((f) => `${f.provider}: ${f.error}`).join(' | ') : 'No transcription provider is configured');
  }
}

export interface TakeProviders {
  whisper?: (bytes: Uint8Array) => Promise<{ text: string; language?: string | null }>;
  soniox?: (bytes: Uint8Array, mime: string) => Promise<{ text: string; language?: string | null }>;
  gemini?: (bytes: Uint8Array, mime: string) => Promise<{ text: string; language?: string | null }>;
}

/** A provider error as one readable line: Workers AI's "AiError: 3040: Capacity …", an HTTP status + body. */
export function describeProviderError(err: unknown): string {
  if (err instanceof Error) {
    const msg = (err.message || '').trim();
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
    return (msg ? `${name}${msg}` : `${name || 'Error'} (no message)`).replace(/\s+/g, ' ').slice(0, 300);
  }
  return String(err).replace(/\s+/g, ' ').slice(0, 300) || 'unknown error';
}

function joinSegments(segments: RawSegment[]): string {
  return segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
}

/** The real providers for this deployment (only the configured ones). */
export function takeProviders(env: Pick<Env, 'AI' | 'SONIOX_API_KEY' | 'GEMINI_API_KEY' | 'CALL_GEMINI_MODEL'>): TakeProviders {
  const providers: TakeProviders = {};
  if (env.AI) {
    providers.whisper = async (bytes) => {
      const res = (await env.AI.run('@cf/openai/whisper-large-v3-turbo' as never, {
        audio: bytesToBase64(bytes),
        language: 'zh',
        initial_prompt: '以下是普通话的句子。',
      } as never)) as { text?: string; transcription_info?: { language?: string }; detected_language?: string };
      return { text: res.text || '', language: res.transcription_info?.language || res.detected_language || 'zh' };
    };
  }
  const soniox = (env.SONIOX_API_KEY || '').trim();
  if (soniox) {
    providers.soniox = async (bytes, mime) => {
      const segments = await transcribeWithSoniox(soniox, bytes, mime, {
        filename: mime.includes('wav') ? 'take.wav' : mime.includes('mp4') ? 'take.m4a' : 'take.webm',
        pollMs: { first: 350, later: 1000 },
      });
      return { text: joinSegments(segments), language: 'zh' };
    };
  }
  const gemini = (env.GEMINI_API_KEY || '').trim();
  if (gemini) {
    providers.gemini = async (bytes, mime) => ({ text: joinSegments(await transcribeWithGemini(gemini, bytes, mime, env.CALL_GEMINI_MODEL)), language: 'zh' });
  }
  return providers;
}

const ORDER: TakeProvider[] = ['whisper', 'soniox', 'gemini'];

export async function transcribeTake(providers: TakeProviders, bytes: Uint8Array, mime: string): Promise<TakeTranscription> {
  const failed: TakeTranscription['failed'] = [];
  for (const provider of ORDER) {
    const run = providers[provider];
    if (!run) continue;
    try {
      const out = await run(bytes, mime);
      if (failed.length) console.warn(`[transcribe] ${provider} answered after ${failed.map((f) => f.provider).join(', ')} failed`);
      return { text: out.text || '', language: out.language || 'zh', provider, failed };
    } catch (err) {
      const error = describeProviderError(err);
      console.error(`[transcribe] ${provider} failed: ${error}`);
      failed.push({ provider, error });
    }
  }
  throw new TakeTranscriptionError(failed);
}

/** What the device says about its live stream, as one safe log line (no key can be in it, but cap and flatten it anyway). */
export function cleanClientNote(raw: unknown, max = 200): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\r\n\t]+/g, ' ').replace(/temp:[A-Za-z0-9_-]+/g, 'temp:…').trim().slice(0, max);
  return s || null;
}
