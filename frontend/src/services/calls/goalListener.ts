/**
 * 🎯 The call's structure listener (docs/VIDEO_CALLS.md "Structures to use"): streams the STUDENT's
 * own microphone to Soniox real-time while the call has goals, and hands back each finished
 * utterance (`foldGoalSpeech`: endpoint detection's `<end>`, sentence punctuation). Same path as a
 * study take (shared/transcription/soniox.ts: a temporary key from POST /api/transcribe/live, the
 * key on the connection, webm/Opus chunks from a MediaRecorder of the mic track) — only text comes
 * back; no audio goes anywhere new.
 *
 * A call is ~1 h, longer than a key / session lives: a SEGMENT is one socket + one MediaRecorder
 * on one key. A new segment starts before the old one's key runs out (or ROTATE_MS in), and the old
 * one is ended (end-of-audio → its last words still arrive) once the new one is streaming, so at most
 * a second is lost. A segment that drops reconnects with a backoff; too many failures in a row, or
 * no live provider (`{ provider: 'upload' }`), → 'unavailable' (manual ticks still work) and one more
 * try after UNAVAILABLE_RETRY_MS.
 */
import {
  EMPTY_GOAL_SPEECH,
  flushGoalSpeech,
  foldGoalSpeech,
  type GoalSpeechState,
} from '@shared/calls';
import {
  buildSonioxConfig,
  SONIOX_END_OF_AUDIO,
  sonioxBrowserAuth,
  type LiveTranscriptionSession,
} from '@shared/transcription/soniox';

type SonioxSession = Extract<LiveTranscriptionSession, { provider: 'soniox' }>;

export type GoalListenerState = 'idle' | 'connecting' | 'listening' | 'unavailable';

/** Start the next segment this long before the key expires… */
export const ROTATE_BEFORE_EXPIRY_MS = 90_000;
/** …or this long after the segment started, whichever is first (the session cap is 30 min). */
export const ROTATE_MS = 25 * 60_000;
/** Reconnect backoff after a dropped segment. */
export const RECONNECT_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
/** This many failures in a row → 'unavailable' for a while. */
export const MAX_FAILURES = 5;
export const UNAVAILABLE_RETRY_MS = 120_000;
/** How long an ending segment waits for its last words. */
export const END_WAIT_MS = 3_000;
const CHUNK_MS = 250;

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
};
type RecorderLike = Pick<MediaRecorder, 'start' | 'stop' | 'state'> & { ondataavailable: ((ev: BlobEvent) => unknown) | null };

export interface GoalListenerOptions {
  /** A key for one long session (POST /api/transcribe/live { purpose: 'call' }). */
  getSession: () => Promise<LiveTranscriptionSession>;
  onUtterance: (text: string) => void;
  onState?: (state: GoalListenerState, reason?: string) => void;
  createSocket?: (url: string, protocols?: string[]) => SocketLike;
  createRecorder?: (track: MediaStreamTrack) => RecorderLike;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const OPEN = 1;

interface Segment {
  socket: SocketLike | null;
  recorder: RecorderLike | null;
  speech: GoalSpeechState;
  queue: Blob[];
  ending: boolean;
  dead: boolean;
  rotateTimer: unknown;
  endTimer: unknown;
}

export class CallGoalListener {
  private track: MediaStreamTrack | null = null;
  private seg: Segment | null = null;
  /** Every segment not yet closed (an older one keeps streaming until the new one is). */
  private live = new Set<Segment>();
  private failures = 0;
  private retryTimer: unknown = null;
  private state: GoalListenerState = 'idle';
  private readonly opts: Required<Pick<GoalListenerOptions, 'now' | 'setTimer' | 'clearTimer'>> & GoalListenerOptions;

  constructor(opts: GoalListenerOptions) {
    this.opts = {
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      ...opts,
    };
  }

  get current(): GoalListenerState {
    return this.state;
  }

  private setState(s: GoalListenerState, reason?: string) {
    if (this.state === s) return;
    this.state = s;
    this.opts.onState?.(s, reason);
  }

  /** Listen to this track (the same track again is a no-op; another track starts over). */
  start(track: MediaStreamTrack): void {
    if (this.track === track && this.seg && !this.seg.dead) return;
    this.stop();
    this.track = track;
    this.failures = 0;
    this.setState('connecting');
    void this.openSegment();
  }

  /** Stop listening (mute, leave, no goals left); the words in flight still come back. */
  stop(): void {
    this.track = null;
    if (this.retryTimer) this.opts.clearTimer(this.retryTimer);
    this.retryTimer = null;
    for (const seg of this.live) this.endSegment(seg);
    this.seg = null;
    this.setState('idle');
  }

  private emit(utterances: string[]) {
    for (const u of utterances) {
      try {
        this.opts.onUtterance(u);
      } catch (err) {
        console.error('[goal-listener] utterance handler failed:', err);
      }
    }
  }

  private async openSegment(): Promise<void> {
    const track = this.track;
    if (!track) return;
    let session: LiveTranscriptionSession | null = null;
    try {
      session = await this.opts.getSession();
    } catch {
      session = null;
    }
    if (this.track !== track) return; // stopped meanwhile
    if (!session || session.provider !== 'soniox') {
      this.unavailable(session ? 'no live provider' : 'no key');
      return;
    }
    const seg: Segment = { socket: null, recorder: null, speech: EMPTY_GOAL_SPEECH, queue: [], ending: false, dead: false, rotateTimer: null, endTimer: null };
    this.seg = seg;
    this.live.add(seg);
    const s = session as SonioxSession;
    const auth = sonioxBrowserAuth(s.api_key);
    let socket: SocketLike;
    try {
      const create = this.opts.createSocket ?? ((url: string, protocols?: string[]) => new WebSocket(url, protocols) as SocketLike);
      socket = auth.protocols ? create(s.websocket_url, auth.protocols) : create(s.websocket_url);
    } catch {
      this.segmentFailed(seg, 'socket');
      return;
    }
    seg.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify(buildSonioxConfig({ kind: 'auto' }, s.model, s.language_hints, auth.configApiKey, true)));
      for (const chunk of seg.queue) socket.send(chunk);
      seg.queue = [];
      this.failures = 0;
      this.setState('listening');
      // The new segment streams: older ones end now (their last words still arrive).
      for (const old of this.live) if (old !== seg) this.endSegment(old);
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const r = foldGoalSpeech(seg.speech, ev.data);
      seg.speech = r.state;
      this.emit(r.utterances);
      try {
        const msg = JSON.parse(ev.data) as { error_code?: unknown; error_message?: unknown; finished?: unknown };
        if ((msg.error_code ?? null) !== null || (msg.error_message ?? null) !== null) this.segmentFailed(seg, `Soniox ${String(msg.error_code ?? '')}`);
        else if (msg.finished === true && seg.ending) this.closeSegment(seg);
      } catch {
        /* not JSON */
      }
    };
    socket.onerror = () => this.segmentFailed(seg, 'socket error');
    socket.onclose = () => (seg.ending ? this.closeSegment(seg) : this.segmentFailed(seg, 'closed'));
    // The recorder: its own MediaRecorder on the mic track (the call's recorder is untouched).
    try {
      const recorder = this.opts.createRecorder ? this.opts.createRecorder(track) : (new MediaRecorder(new MediaStream([track])) as RecorderLike);
      recorder.ondataavailable = (ev) => {
        if (seg.dead || seg.ending || !ev.data || ev.data.size === 0) return;
        if (seg.socket?.readyState === OPEN) seg.socket.send(ev.data);
        else seg.queue.push(ev.data);
      };
      recorder.start(CHUNK_MS);
      seg.recorder = recorder;
    } catch {
      this.segmentFailed(seg, 'recorder');
      return;
    }
    // Rotate before the key / session runs out.
    const expires = Date.parse(s.expires_at);
    const now = this.opts.now();
    const until = Math.max(30_000, Math.min(ROTATE_MS, (Number.isFinite(expires) ? expires - now : ROTATE_MS) - ROTATE_BEFORE_EXPIRY_MS));
    seg.rotateTimer = this.opts.setTimer(() => {
      if (this.seg === seg && this.track) void this.openSegment();
    }, until);
  }

  /** End of audio: the server finalises what it has and closes (or we close after END_WAIT_MS). */
  private endSegment(seg: Segment) {
    if (seg.dead || seg.ending) return;
    seg.ending = true;
    if (seg.rotateTimer) this.opts.clearTimer(seg.rotateTimer);
    this.stopRecorder(seg);
    try {
      if (seg.socket?.readyState === OPEN) seg.socket.send(SONIOX_END_OF_AUDIO);
      else return this.closeSegment(seg);
    } catch {
      return this.closeSegment(seg);
    }
    seg.endTimer = this.opts.setTimer(() => this.closeSegment(seg), END_WAIT_MS);
  }

  private stopRecorder(seg: Segment) {
    const r = seg.recorder;
    seg.recorder = null;
    if (!r) return;
    r.ondataavailable = null;
    try {
      if (r.state !== 'inactive') r.stop();
    } catch {
      /* already stopped */
    }
  }

  private closeSegment(seg: Segment) {
    if (seg.dead) return;
    seg.dead = true;
    this.live.delete(seg);
    if (seg.rotateTimer) this.opts.clearTimer(seg.rotateTimer);
    if (seg.endTimer) this.opts.clearTimer(seg.endTimer);
    this.stopRecorder(seg);
    const r = flushGoalSpeech(seg.speech);
    seg.speech = r.state;
    this.emit(r.utterances);
    const s = seg.socket;
    seg.socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onerror = s.onclose = null;
      try {
        s.close();
      } catch {
        /* closed */
      }
    }
  }

  private segmentFailed(seg: Segment, reason: string) {
    if (seg.dead) return;
    const wasCurrent = this.seg === seg;
    this.closeSegment(seg);
    if (!wasCurrent || !this.track) return;
    this.failures++;
    if (this.failures >= MAX_FAILURES) {
      this.unavailable(reason);
      return;
    }
    this.setState('connecting', reason);
    const wait = RECONNECT_MS[Math.min(this.failures - 1, RECONNECT_MS.length - 1)];
    this.retryTimer = this.opts.setTimer(() => {
      this.retryTimer = null;
      if (this.track) void this.openSegment();
    }, wait);
  }

  private unavailable(reason: string) {
    this.setState('unavailable', reason);
    if (this.retryTimer) this.opts.clearTimer(this.retryTimer);
    this.retryTimer = this.opts.setTimer(() => {
      this.retryTimer = null;
      if (!this.track) return;
      this.failures = 0;
      this.setState('connecting');
      void this.openSegment();
    }, UNAVAILABLE_RETRY_MS);
  }
}
