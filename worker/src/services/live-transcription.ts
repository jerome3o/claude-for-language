/**
 * Live (streaming) pronunciation transcription: the worker's half.
 *
 * The client streams the microphone straight to Soniox's real-time WebSocket so the
 * transcript is ready the moment the learner stops (shared/transcription/soniox.ts has
 * the protocol). The permanent SONIOX_API_KEY stays here: we mint a short-lived
 * TEMPORARY key (POST https://api.soniox.com/v1/auth/temporary-api-key,
 * usage_type `transcribe_websocket`) tagged with the user's id, and the client reuses it
 * for every take until a minute before it expires. No key configured → `{ provider:
 * 'upload' }` and the client keeps the old path (upload the take to POST /api/transcribe,
 * Workers AI Whisper).
 */
import {
  SONIOX_LANGUAGE_HINTS,
  SONIOX_RT_MODEL,
  SONIOX_WS_URL,
  type LiveTranscriptionSession,
} from '@shared/transcription/soniox';
import type { Env } from '../types';

const SONIOX_TEMP_KEY_URL = 'https://api.soniox.com/v1/auth/temporary-api-key';
/** How long one temporary key lives (Soniox allows 1–3600 s). */
export const LIVE_KEY_TTL_SECONDS = 1800;
/** One take is a few seconds; cap a runaway session. */
export const LIVE_MAX_SESSION_SECONDS = 300;

export class LiveTranscriptionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function mintLiveSession(
  env: Pick<Env, 'SONIOX_API_KEY'>,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveTranscriptionSession> {
  const key = (env.SONIOX_API_KEY || '').trim();
  if (!key) return { provider: 'upload' };
  const res = await fetchImpl(SONIOX_TEMP_KEY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: LIVE_KEY_TTL_SECONDS,
      client_reference_id: userId.slice(0, 256),
      max_session_duration_seconds: LIVE_MAX_SESSION_SECONDS,
      // The device reuses one key for every take until a minute before it expires.
      single_use: false,
    }),
  });
  if (!res.ok) {
    // Never echo the body verbatim to the client; it is Soniox's error text, logged here.
    console.error('[transcribe/live] Soniox temporary key failed:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    throw new LiveTranscriptionError('Live transcription is unavailable right now', 502);
  }
  const body = await res.json<{ api_key?: unknown; expires_at?: unknown }>();
  if (typeof body.api_key !== 'string' || !body.api_key) {
    throw new LiveTranscriptionError('Live transcription is unavailable right now', 502);
  }
  const expiresAt = typeof body.expires_at === 'string' && Number.isFinite(Date.parse(body.expires_at))
    ? body.expires_at
    : new Date(Date.now() + LIVE_KEY_TTL_SECONDS * 1000).toISOString();
  return {
    provider: 'soniox',
    api_key: body.api_key,
    expires_at: expiresAt,
    websocket_url: SONIOX_WS_URL,
    model: SONIOX_RT_MODEL,
    language_hints: [...SONIOX_LANGUAGE_HINTS],
  };
}

/** Which transcription paths this deployment has — booleans only, never a key. */
export function transcriptionCapabilities(env: Pick<Env, 'SONIOX_API_KEY' | 'GEMINI_API_KEY' | 'AI'>) {
  const soniox = !!(env.SONIOX_API_KEY || '').trim();
  return {
    live: soniox ? 'soniox' : null,
    upload: env.AI ? 'whisper' : null,
    soniox_configured: soniox,
    gemini_configured: !!(env.GEMINI_API_KEY || '').trim(),
    workers_ai: !!env.AI,
    live_model: soniox ? SONIOX_RT_MODEL : null,
  };
}
