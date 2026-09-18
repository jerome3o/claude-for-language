/**
 * Playback instrumentation.
 *
 * "It sounds choppy" is not something code can act on, and the interesting
 * failures (a buffer underrun, a cache miss that quietly streams over a weak
 * connection, background work starving the media thread) all leave the same
 * impression on the ear. So measure the thing directly: while a clip plays,
 * sample `currentTime` against the wall clock. Playback that keeps up advances
 * one second of media per second of real time; every millisecond it falls
 * behind is audible as a stutter, drop-out or crunch.
 *
 * Each clip's record also captures what it was playing from (cached blob vs
 * network) and what else the app was doing at the time, so a report can
 * distinguish "the audio arrived late" from "the audio was fine but something
 * blocked playback".
 *
 * Records live in a small ring buffer and are copied out of Settings. Always
 * on: the cost is one 250 ms timer for the couple of seconds a clip is
 * playing, and requiring the user to enable it first means never capturing the
 * session where it actually went wrong.
 */

/** How often to compare media time against wall-clock time. */
const SAMPLE_MS = 250;

/**
 * Slack allowed per sample before counting time as lost. Timer callbacks are
 * not punctual and `currentTime` updates in coarse steps, so a small
 * discrepancy is measurement noise rather than a real gap.
 */
const TOLERANCE_MS = 80;

const MAX_RECORDS = 60;

/**
 * What the Android app's media stack reported about a clip (see
 * AudioBridge.ClipStats). The page cannot sample a MediaPlayer itself, so
 * the bridge samples it the same way and sends the result with 'ended'.
 */
export interface NativeClipStats {
  /** Bridge protocol version. */
  bridge: number;
  /** Played from the app's own clip cache rather than bytes sent across. */
  cached: boolean;
  /** ms from the page's request to the decoder being ready. */
  prepare_ms: number;
  /** ms from the page's request to sound starting. */
  start_ms: number;
  /** Wall clock minus media position at the end: time lost, in ms. */
  drift_ms: number;
  worst_drift_ms: number;
  samples: number;
  /** MEDIA_INFO_AUDIO_NOT_PLAYING count: the output starved. */
  not_playing: number;
  buffering: number;
  duration_ms: number;
  position_ms: number;
  /** 'speaker' | 'bluetooth' | 'wired' | 'unknown' */
  route: string;
  volume: number;
  volume_max: number;
  /** Compressor state when the clip started: 'on' | 'off' | 'unavailable' | 'unsupported'. */
  effect: string;
  /** Whether the keep-alive stream was holding the output open. */
  output_held: boolean;
  error?: string;
}

export interface AudioClipRecord {
  seq: number;
  at: string;
  /** Which feature played it (note, sentence, reader, grammar, …). */
  label: string;
  source: 'blob' | 'url';
  /** Which playback path ran it: the app's native bridge, or an <audio> element. */
  engine: 'native' | 'element';
  bytes: number | null;
  mime: string | null;
  /** Network sources only, query string stripped. */
  url: string | null;
  /** ms from play() to the `playing` event — how long before sound started. */
  start_ms: number | null;
  /** Clip length as the decoder reported it. */
  duration_s: number | null;
  /**
   * Encoded bitrate, from bytes / duration. MiniMax clips are 128 kbps; the
   * Google fallback is 64 kbps, and that difference is audible — this is what
   * finally distinguished bad audio from bad playback.
   */
  kbps: number | null;
  /** How far playback actually got. */
  played_s: number | null;
  ended: boolean;
  error: string | null;
  /**
   * `waiting` + `stalled` events AFTER audio started. The one that fires while
   * the element is still opening its stream is startup, not a drop-out, and
   * counting it flagged every clip as choppy.
   */
  stalls: number;
  /**
   * How far media time fell behind the wall clock between the first frame and
   * the end, in ms. Measured cumulatively rather than by summing per-sample
   * shortfalls: `currentTime` advances in coarse steps, so summing only the
   * positive errors accumulated the jitter and never the catch-up, which
   * inflated every clip.
   */
  stutter_ms: number;
  /** Longest single gap, in ms. */
  worst_gap_ms: number;
  /**
   * Worst lateness of the sampling timer, in ms. The sampler is scheduled on a
   * fixed interval, so a late tick means the main thread was busy. High values
   * alongside stutter point at work blocking the page (bulk caching, a big
   * render); punctual ticks alongside stutter point at the media pipeline
   * itself being starved.
   */
  worst_timer_late_ms: number;
  samples: number;
  /** Live <audio> elements at the time — a leak check. */
  players_live: number;
  /** Whether bulk audio prefetch was running (it competes for disk + network). */
  prefetch: string;
  online: boolean;
  offline_mode: boolean;
  /** Native engine only: the media stack's own measurement of the clip. */
  native: NativeClipStats | null;
}

/** Context the diagnostics layer cannot see for itself. */
export interface DiagnosticsContext {
  playersLive: () => number;
  prefetchStatus: () => string;
  offlineMode: () => boolean;
}

let context: DiagnosticsContext = {
  playersLive: () => 0,
  prefetchStatus: () => 'unknown',
  offlineMode: () => false,
};

/** Wire up the ambient signals. Called once at startup. */
export function setDiagnosticsContext(next: Partial<DiagnosticsContext>): void {
  context = { ...context, ...next };
}

const records: AudioClipRecord[] = [];
let nextSeq = 1;

function push(record: AudioClipRecord) {
  records.push(record);
  if (records.length > MAX_RECORDS) {
    records.splice(0, records.length - MAX_RECORDS);
  }
}

export function getAudioRecords(): AudioClipRecord[] {
  return [...records];
}

export function clearAudioRecords(): void {
  records.length = 0;
}

/** A single clip's in-flight measurement. */
export interface ClipTracker {
  /** Stop sampling and file the record. Safe to call twice. */
  finish(outcome?: { error?: string | null; ended?: boolean; native?: NativeClipStats }): void;
  /** Native only: note the moment the bridge reported sound starting. */
  markStarted?(): void;
}

/**
 * Begin measuring a clip. The returned tracker must be finished when playback
 * ends, errors, or is superseded — otherwise its sampler keeps running.
 */
export function trackClip(
  element: HTMLAudioElement,
  source: Blob | string,
  label: string
): ClipTracker {
  const startedAt = Date.now();
  const isBlob = typeof source !== 'string';

  const record: AudioClipRecord = {
    seq: nextSeq++,
    at: new Date(startedAt).toISOString(),
    label,
    source: isBlob ? 'blob' : 'url',
    engine: 'element',
    bytes: isBlob ? source.size : null,
    mime: isBlob ? source.type || null : null,
    url: isBlob ? null : source.split('?')[0],
    start_ms: null,
    duration_s: null,
    kbps: null,
    played_s: null,
    ended: false,
    error: null,
    stalls: 0,
    stutter_ms: 0,
    worst_gap_ms: 0,
    worst_timer_late_ms: 0,
    samples: 0,
    players_live: context.playersLive(),
    prefetch: context.prefetchStatus(),
    online: navigator.onLine,
    offline_mode: context.offlineMode(),
    native: null,
  };

  const onPlaying = () => {
    if (record.start_ms === null) record.start_ms = Date.now() - startedAt;
  };
  const onStall = () => {
    // Before the first frame this is the element opening its stream, which
    // start_ms already reports. Only a dry decoder mid-clip is a stall.
    if (record.start_ms !== null) record.stalls++;
  };
  element.addEventListener('playing', onPlaying);
  element.addEventListener('waiting', onStall);
  element.addEventListener('stalled', onStall);

  let lastWall = Date.now();
  let lastMedia = element.currentTime;
  // Anchored at the first frame, so drift is measured over the whole clip
  // rather than summed per sample.
  let firstFrameWall: number | null = null;
  let firstFrameMedia = 0;

  const timer = setInterval(() => {
    const now = Date.now();
    const media = element.currentTime;
    const wallDelta = now - lastWall;
    const mediaDelta = (media - lastMedia) * 1000;
    lastWall = now;
    lastMedia = media;

    // A tick that arrives late means the main thread was blocked for at least
    // that long — recorded whether or not the clip itself stuttered.
    const timerLate = Math.round(wallDelta - SAMPLE_MS);
    if (timerLate > 0) {
      record.worst_timer_late_ms = Math.max(record.worst_timer_late_ms, timerLate);
    }

    // Before the first frame, "not advancing" is startup latency, which
    // start_ms already covers — only measure once audio is flowing.
    if (firstFrameWall === null) {
      if (mediaDelta <= 0) return;
      firstFrameWall = now;
      firstFrameMedia = media;
      return;
    }
    if (element.paused) return;

    record.samples++;

    // Cumulative: total real time elapsed minus total media time played. Coarse
    // currentTime updates cancel out instead of accumulating.
    const drift = Math.round(
      now - firstFrameWall - (media - firstFrameMedia) * 1000
    );
    record.stutter_ms = Math.max(0, drift);

    const gap = Math.round(wallDelta - mediaDelta - TOLERANCE_MS);
    if (gap > 0) {
      record.worst_gap_ms = Math.max(record.worst_gap_ms, gap);
    }
  }, SAMPLE_MS);

  let done = false;
  return {
    finish(outcome = {}) {
      if (done) return;
      done = true;
      clearInterval(timer);
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('waiting', onStall);
      element.removeEventListener('stalled', onStall);

      const duration = element.duration;
      record.duration_s = Number.isFinite(duration) ? Number(duration.toFixed(2)) : null;
      record.kbps = bitrateKbps(record.bytes, record.duration_s);
      record.played_s = Number.isFinite(element.currentTime)
        ? Number(element.currentTime.toFixed(2))
        : null;
      record.ended = outcome.ended ?? false;
      record.error = outcome.error ?? null;
      push(record);
    },
  };
}

/**
 * Record a clip handed to the app's native bridge. Playback happens outside
 * the page, so there is nothing to sample here; the bridge samples the
 * MediaPlayer itself and hands its numbers over when the clip finishes,
 * and they are folded into the same fields the element path fills so the
 * summary treats both engines alike.
 */
export function trackNativeClip(source: Blob | string, label: string): ClipTracker {
  const startedAt = Date.now();
  const isBlob = typeof source !== 'string';
  const record: AudioClipRecord = {
    seq: nextSeq++,
    at: new Date(startedAt).toISOString(),
    label,
    source: isBlob ? 'blob' : 'url',
    engine: 'native',
    bytes: isBlob ? source.size : null,
    mime: isBlob ? source.type || null : null,
    url: isBlob ? null : source.split('?')[0],
    start_ms: null,
    duration_s: null,
    kbps: null,
    played_s: null,
    ended: false,
    error: null,
    stalls: 0,
    stutter_ms: 0,
    worst_gap_ms: 0,
    worst_timer_late_ms: 0,
    samples: 0,
    players_live: context.playersLive(),
    prefetch: context.prefetchStatus(),
    online: navigator.onLine,
    offline_mode: context.offlineMode(),
    native: null,
  };

  let started: number | null = null;
  let done = false;
  return {
    finish(outcome = {}) {
      if (done) return;
      done = true;
      if (started !== null) {
        record.played_s = Number(((Date.now() - started) / 1000).toFixed(2));
      }
      const native = outcome.native;
      if (native) {
        record.native = native;
        if (record.start_ms === null && native.start_ms >= 0) record.start_ms = native.start_ms;
        record.stutter_ms = Math.max(0, native.drift_ms);
        record.worst_gap_ms = Math.max(0, native.worst_drift_ms);
        record.stalls = native.not_playing + native.buffering;
        record.samples = native.samples;
        if (native.duration_ms > 0) {
          record.duration_s = Number((native.duration_ms / 1000).toFixed(2));
          record.kbps = bitrateKbps(record.bytes, record.duration_s);
        }
        if (native.position_ms >= 0) {
          record.played_s = Number((native.position_ms / 1000).toFixed(2));
        }
      }
      record.ended = outcome.ended ?? false;
      record.error = outcome.error ?? null;
      push(record);
    },
    markStarted() {
      if (started !== null || done) return;
      started = Date.now();
      record.start_ms = started - startedAt;
    },
  };
}

export interface AudioDiagnosticsSummary {
  clips: number;
  /** Clips that lost more than a quarter second of wall clock. */
  choppy_clips: number;
  /** Clips that stopped before the end of the media. */
  truncated_clips: number;
  from_cache: number;
  from_network: number;
  errored: number;
  median_start_ms: number | null;
  worst_gap_ms: number;
  total_stutter_ms: number;
  max_players_live: number;
  choppy_while_prefetching: number;
  choppy_from_network: number;
  /** Choppy clips where the main thread was also visibly blocked. */
  choppy_with_main_thread_block: number;
  worst_timer_late_ms: number;
  /** Clips played by the app's native bridge rather than an element. */
  via_native: number;
  /** Slowest time-to-first-sound, in ms. */
  worst_start_ms: number;
  /** Clips whose encode is the low-quality fallback (~64 kbps). */
  low_bitrate_clips: number;
  /** Native clips played from the app's own clip cache. */
  native_cached: number;
  /** Native clips that went through the compressor. */
  native_compressed: number;
  /** Native clips that started on an output the keep-alive was holding open. */
  native_output_held: number;
  /** Native clips by output route (speaker / bluetooth / wired). */
  native_routes: Record<string, number>;
  /** Choppy native clips whose output was NOT held — the standby-wake case. */
  choppy_on_cold_output: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export function bitrateKbps(bytes: number | null, durationSeconds: number | null): number | null {
  if (!bytes || !durationSeconds || durationSeconds <= 0) return null;
  return Math.round((bytes * 8) / durationSeconds / 1000);
}

/** Below MiniMax's 128 kbps by a wide margin — the Google fallback encode. */
export function isLowBitrate(record: AudioClipRecord): boolean {
  return record.kbps !== null && record.kbps < 96;
}

/** A clip counts as choppy once it loses a noticeable fraction of a second. */
export function isChoppy(record: AudioClipRecord): boolean {
  return record.stutter_ms >= 250 || record.stalls > 0;
}

/** Stopped early: playback ended well short of the decoded duration. */
export function isTruncated(record: AudioClipRecord): boolean {
  if (record.duration_s === null || record.played_s === null) return false;
  return record.ended && record.duration_s - record.played_s > 0.35;
}

export function summarize(list: AudioClipRecord[]): AudioDiagnosticsSummary {
  const choppy = list.filter(isChoppy);
  const measuredNative = list.filter((r) => r.native !== null);
  const routes: Record<string, number> = {};
  for (const r of measuredNative) {
    const route = r.native!.route || 'unknown';
    routes[route] = (routes[route] ?? 0) + 1;
  }
  return {
    clips: list.length,
    choppy_clips: choppy.length,
    truncated_clips: list.filter(isTruncated).length,
    from_cache: list.filter((r) => r.source === 'blob').length,
    from_network: list.filter((r) => r.source === 'url').length,
    errored: list.filter((r) => r.error !== null).length,
    median_start_ms: median(
      list.map((r) => r.start_ms).filter((v): v is number => v !== null)
    ),
    worst_gap_ms: list.reduce((max, r) => Math.max(max, r.worst_gap_ms), 0),
    total_stutter_ms: list.reduce((sum, r) => sum + r.stutter_ms, 0),
    max_players_live: list.reduce((max, r) => Math.max(max, r.players_live), 0),
    // The two correlations worth testing first: is choppiness tied to
    // background prefetch, or to streaming instead of playing from cache?
    choppy_while_prefetching: choppy.filter((r) => r.prefetch === 'running').length,
    choppy_from_network: choppy.filter((r) => r.source === 'url').length,
    // Distinguishes "something blocked the page" from "the media pipeline was
    // starved" — the two look identical to the ear.
    choppy_with_main_thread_block: choppy.filter((r) => r.worst_timer_late_ms >= 100).length,
    worst_timer_late_ms: list.reduce((max, r) => Math.max(max, r.worst_timer_late_ms), 0),
    via_native: list.filter((r) => r.engine === 'native').length,
    worst_start_ms: list.reduce((max, r) => Math.max(max, r.start_ms ?? 0), 0),
    low_bitrate_clips: list.filter(isLowBitrate).length,
    native_cached: measuredNative.filter((r) => r.native!.cached).length,
    native_compressed: measuredNative.filter((r) => r.native!.effect === 'on').length,
    native_output_held: measuredNative.filter((r) => r.native!.output_held).length,
    native_routes: routes,
    choppy_on_cold_output: choppy.filter((r) => r.native !== null && !r.native.output_held).length,
  };
}

/** Copy-pasteable report: aggregates first, then the individual clips. */
export function buildAudioDiagnosticsReport(): string {
  const list = getAudioRecords();
  return JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      user_agent: navigator.userAgent,
      summary: summarize(list),
      clips: list,
    },
    null,
    1
  );
}
