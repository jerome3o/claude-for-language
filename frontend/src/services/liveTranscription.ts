/**
 * Streams a pronunciation take to Soniox while the learner speaks, so "You said: …" is
 * ready the moment they stop (the old path uploads the finished take to Whisper after
 * "Check answer": ~1–3 s more). Protocol + pure parsing: shared/transcription/soniox.ts.
 *
 * - `getLiveSession()` — the temporary key from POST /api/transcribe/live, cached until a
 *   minute before it expires; `prefetchLiveSession()` warms it when a read card shows.
 *   `null` means "no live path" (not configured, offline, the mint failed) → the caller
 *   uploads the take to POST /api/transcribe as before.
 * - `LiveTranscriber` — one take: chunks queue until the socket is open, `finish()` sends
 *   the end-of-audio frame and resolves with the final text (rejects on any error or after
 *   a timeout, so the caller falls back to the upload).
 */
import { getLiveTranscriptionSession } from '../api/client';
import {
  applySonioxMessage,
  buildSonioxConfig,
  EMPTY_TRANSCRIPT,
  liveKeyUsable,
  SONIOX_END_OF_AUDIO,
  sonioxBrowserAuth,
  transcriptText,
  type LiveTranscriptionSession,
  type SonioxTranscript,
} from '@shared/transcription/soniox';

type SonioxSession = Extract<LiveTranscriptionSession, { provider: 'soniox' }>;

let cached: LiveTranscriptionSession | null = null;
let inflight: Promise<SonioxSession | null> | null = null;
/** After a failed mint, don't ask again for a while (each take would pay for it). */
let retryAfter = 0;

export function resetLiveSessionCache() {
  cached = null;
  inflight = null;
  retryAfter = 0;
}

export async function getLiveSession(fetchSession: () => Promise<LiveTranscriptionSession> = getLiveTranscriptionSession, now = Date.now()): Promise<SonioxSession | null> {
  if (cached?.provider === 'upload') return null;
  if (liveKeyUsable(cached, now)) return cached as SonioxSession;
  if (now < retryAfter) return null;
  if (!inflight) {
    inflight = fetchSession()
      .then((s) => {
        cached = s;
        return s.provider === 'soniox' ? s : null;
      })
      .catch(() => {
        retryAfter = Date.now() + 60_000;
        return null;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** The server said it has no live provider: don't open a transcriber for this take. */
export function liveSessionUnavailable(): boolean {
  return cached?.provider === 'upload';
}

export function prefetchLiveSession() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  void getLiveSession();
}

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
};

export interface LiveTranscriberOptions {
  /** How long finish() waits for the server's final answer before giving up. */
  finishTimeoutMs?: number;
  /** `protocols` carries the key (`['soniox-api-key', key]`, Soniox's browser auth). */
  createSocket?: (url: string, protocols?: string[]) => SocketLike;
  /**
   * Every server response folded in: the confirmed text and the provisional tail, as the
   * learner speaks — a typing card's 🎤 shows them in the answer box (final black, tail grey).
   */
  onUpdate?: (transcript: SonioxTranscript) => void;
}

const OPEN = 1;

export class LiveTranscriber {
  private socket: SocketLike | null = null;
  private queue: Blob[] = [];
  private transcript: SonioxTranscript = EMPTY_TRANSCRIPT;
  private ended = false;
  private failed: string | null = null;
  private settle: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly startedAt = Date.now();
  stoppedAt = 0;

  constructor(session: Promise<SonioxSession | null>, private readonly opts: LiveTranscriberOptions = {}) {
    session.then((s) => (s ? this.connect(s) : this.fail('no live session')), () => this.fail('no live session'));
  }

  private connect(s: SonioxSession) {
    if (this.failed) return;
    // The key goes WITH the connection (Soniox, from 15 Jan 2027 the only way): browsers can't
    // set headers on a WebSocket, so it is the second subprotocol after 'soniox-api-key'. Only a
    // legacy `temp:` key (not a valid subprotocol) still rides in the config frame.
    const auth = sonioxBrowserAuth(s.api_key);
    let socket: SocketLike;
    try {
      const create = this.opts.createSocket ?? ((url: string, protocols?: string[]) => new WebSocket(url, protocols) as SocketLike);
      socket = auth.protocols ? create(s.websocket_url, auth.protocols) : create(s.websocket_url);
    } catch {
      return this.fail('socket');
    }
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify(buildSonioxConfig({ kind: 'auto' }, s.model, s.language_hints, auth.configApiKey)));
      for (const chunk of this.queue) socket.send(chunk);
      this.queue = [];
      if (this.ended) socket.send(SONIOX_END_OF_AUDIO);
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      this.transcript = applySonioxMessage(this.transcript, ev.data);
      if (this.transcript.error) return this.fail(this.transcript.error);
      this.opts.onUpdate?.(this.transcript);
      if (this.transcript.finished) this.done();
    };
    socket.onerror = () => this.fail('socket error');
    socket.onclose = () => {
      // Closed after end-of-audio with what we have → that is the answer.
      if (this.ended && !this.failed) this.done();
      else this.fail('closed early');
    };
  }

  /** One MediaRecorder chunk (webm/Opus; Soniox detects the format). */
  push(chunk: Blob) {
    if (this.failed || this.ended || chunk.size === 0) return;
    if (this.socket?.readyState === OPEN) this.socket.send(chunk);
    else this.queue.push(chunk);
  }

  /** End of audio: resolves with the final text as soon as Soniox has finalised it. */
  finish(): Promise<string> {
    this.stoppedAt = Date.now();
    const p = new Promise<string>((resolve, reject) => { this.settle = { resolve, reject }; });
    if (this.failed) {
      this.settle!.reject(new Error(this.failed));
      return p;
    }
    this.ended = true;
    if (this.socket?.readyState === OPEN) this.socket.send(SONIOX_END_OF_AUDIO);
    this.timer = setTimeout(() => this.fail('timeout'), this.opts.finishTimeoutMs ?? 4000);
    return p;
  }

  /** The take was thrown away (re-record, card changed). */
  abort() {
    this.fail('aborted');
  }

  private done() {
    if (this.timer) clearTimeout(this.timer);
    const text = transcriptText(this.transcript);
    const s = this.settle;
    this.settle = null;
    this.closeSocket();
    s?.resolve(text);
  }

  private fail(reason: string) {
    if (this.failed) return;
    this.failed = reason;
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
    this.closeSocket();
    const s = this.settle;
    this.settle = null;
    s?.reject(new Error(reason));
  }

  private closeSocket() {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onerror = s.onclose = null;
    try { s.close(); } catch { /* already closed */ }
  }
}
