/**
 * Live pronunciation transcription with Soniox real-time (WebSocket) — the pure parts,
 * shared by the worker (what it hands the client), the web app and (ported) the Lab app.
 *
 * Why streaming: the old path uploads the finished take to `POST /api/transcribe`
 * (Workers AI Whisper) only after the learner taps "Check answer" — p50 ≈ 1.1 s and
 * p90 ≈ 3.2 s of server time alone, plus the upload. Streaming the microphone to Soniox
 * WHILE the learner speaks means the transcript is final a few hundred ms after Stop.
 *
 * Protocol (soniox.com/docs/stt/api-reference/websocket-api):
 *   1. open `wss://stt-rt.soniox.com/transcribe-websocket`
 *   2. send the config JSON (`buildSonioxConfig`) as the first text frame
 *   3. send audio as binary frames (webm/Opus chunks from MediaRecorder → `audio_format:
 *      'auto'`; raw 16 kHz mono PCM from Android's AudioRecord → `pcm_s16le`)
 *   4. send an EMPTY frame: end of audio. The server finalises every token, replies with
 *      `finished: true` and closes.
 * Responses carry `tokens: [{ text, is_final }]`; final tokens never change, non-final ones
 * may. Errors come back as `{ error_code, error_message }`.
 *
 * The permanent SONIOX_API_KEY never leaves the worker: `POST /api/transcribe/live`
 * mints a short-lived temporary key (`usage_type: transcribe_websocket`).
 */

export const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export const SONIOX_RT_MODEL = 'stt-rt-v5';
/** Mandarin first; English because learners mix it in ("我想 order 一个 coffee"). */
export const SONIOX_LANGUAGE_HINTS = ['zh', 'en'] as const;

/** What `POST /api/transcribe/live` returns (and the Lab app decodes). */
export type LiveTranscriptionSession =
  | {
      provider: 'soniox';
      api_key: string;
      /** ISO time the temporary key stops working. */
      expires_at: string;
      websocket_url: string;
      model: string;
      language_hints: string[];
    }
  /** No live provider configured: record, then upload to POST /api/transcribe as before. */
  | { provider: 'upload' };

export type SonioxAudio = { kind: 'auto' } | { kind: 'pcm_s16le'; sampleRate: number; channels: number };

/**
 * The first frame. Deliberately NO `context` with the expected word: biasing the
 * recogniser towards the answer would hide exactly the mistakes a pronunciation check
 * is for.
 */
export function buildSonioxConfig(apiKey: string, audio: SonioxAudio, model: string = SONIOX_RT_MODEL, languageHints: readonly string[] = SONIOX_LANGUAGE_HINTS): Record<string, unknown> {
  const config: Record<string, unknown> = {
    api_key: apiKey,
    model,
    language_hints: [...languageHints],
    audio_format: audio.kind,
  };
  if (audio.kind === 'pcm_s16le') {
    config.sample_rate = audio.sampleRate;
    config.num_channels = audio.channels;
  }
  return config;
}

export interface SonioxTranscript {
  /** Confirmed text — never changes once here. */
  finalText: string;
  /** Provisional tail (replaced by every response). */
  partialText: string;
  /** The server has finalised everything after our end-of-audio frame. */
  finished: boolean;
  error: string | null;
}

export const EMPTY_TRANSCRIPT: SonioxTranscript = { finalText: '', partialText: '', finished: false, error: null };

interface SonioxToken { text?: unknown; is_final?: unknown }

/** Markers Soniox puts in the token stream (manual finalization / endpoint detection). */
const MARKERS = new Set(['<fin>', '<end>']);

/** Folds one server message (the raw JSON text) into the running transcript. */
export function applySonioxMessage(state: SonioxTranscript, raw: string): SonioxTranscript {
  let msg: { tokens?: SonioxToken[]; finished?: unknown; error_code?: unknown; error_message?: unknown };
  try {
    msg = JSON.parse(raw);
  } catch {
    return state;
  }
  // Only a real error: a null / absent `error_code` next to tokens is a normal response.
  if ((msg.error_code !== undefined && msg.error_code !== null) || (msg.error_message !== undefined && msg.error_message !== null)) {
    return { ...state, error: `Soniox ${String(msg.error_code ?? '')}: ${String(msg.error_message ?? 'error')}`.trim() };
  }
  let finalText = state.finalText;
  let partialText = '';
  for (const t of Array.isArray(msg.tokens) ? msg.tokens : []) {
    if (typeof t?.text !== 'string' || MARKERS.has(t.text)) continue;
    if (t.is_final === true) finalText += t.text;
    else partialText += t.text;
  }
  return { finalText, partialText, finished: state.finished || msg.finished === true, error: state.error };
}

/** The text to compare: everything confirmed plus any tail still provisional. */
export function transcriptText(state: SonioxTranscript): string {
  return (state.finalText + state.partialText).trim();
}

/** A cached temporary key is reused until a minute before it expires. */
export function liveKeyUsable(session: LiveTranscriptionSession | null | undefined, nowMs: number, marginMs = 60_000): boolean {
  if (!session || session.provider !== 'soniox') return false;
  const expires = Date.parse(session.expires_at);
  return Number.isFinite(expires) && expires - marginMs > nowMs;
}

/**
 * The live stream was refused because of the key (401 unauthenticated, 403 expired / not
 * allowed): drop the cached temporary key so the next take mints a fresh one instead of
 * failing the same way until it expires.
 */
export function liveFailureInvalidatesKey(reason: string): boolean {
  return /^Soniox (401|403)\b/.test(reason.trim());
}
