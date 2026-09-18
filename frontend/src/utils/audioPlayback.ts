/**
 * Managed audio playback.
 *
 * Two engines, chosen per environment:
 *
 * - In the Android app, clips go to the native AudioBridge (window.AndroidAudio,
 *   see native/.../AudioBridge.java) and play through Android's own media
 *   stack. The WebView's renderer is a sandboxed, low-priority process and
 *   nothing on the web side can keep its audio thread fed while the page is
 *   busy — the first second of a clip stuttered on every card reveal, however
 *   the clip was played. MediaPlayer does not have that problem.
 * - Everywhere else, one <audio> element per player. Every clip used to get
 *   its own `new Audio(...)` around an object URL that was never revoked; the
 *   WebView capped the number of live media players and playback degraded
 *   past it. A player owns exactly ONE element and at most one object URL and
 *   releases both before the next clip.
 *
 * Callers keep one player for their lifetime and must `dispose()` it on
 * unmount.
 */

import { trackClip, trackNativeClip, ClipTracker, NativeClipStats } from './audioDiagnostics';

/** Live element count, so diagnostics can catch a leak reappearing. */
let livePlayers = 0;
export function livePlayerCount(): number {
  return livePlayers;
}

// ---- Playback activity, so background work can keep out of the way ----
//
// Bulk media caching (sentence sets, the offline prefetcher) downloads several
// clips at once and writes each into IndexedDB. Doing that while a clip is
// playing competes with it for network, disk and main thread. Playback is
// user-facing and lasts a second or two; caching is background work with no
// deadline. So caching yields to playback.

let activeClips = 0;
const idleWaiters = new Set<() => void>();

function clipStarted() {
  activeClips++;
}

function clipStopped() {
  activeClips = Math.max(0, activeClips - 1);
  if (activeClips === 0) {
    const waiters = [...idleWaiters];
    idleWaiters.clear();
    waiters.forEach(resolve => resolve());
  }
}

/** True while any player has a clip in flight. */
export function isAudioPlaying(): boolean {
  return activeClips > 0;
}

/**
 * Resolve once nothing is playing. Background cache fills await this before
 * each batch so they slot into the gaps between clips.
 *
 * Capped: if audio somehow never goes quiet, caching resumes anyway rather
 * than stalling forever.
 */
export function whenAudioIdle(maxWaitMs = 15_000): Promise<void> {
  if (activeClips === 0) return Promise.resolve();
  return new Promise<void>(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      idleWaiters.delete(done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, maxWaitMs);
    idleWaiters.add(done);
  });
}

export interface PlayHandlers {
  onPlay?: () => void;
  onEnded?: () => void;
  onError?: () => void;
  /** Which feature is playing, for diagnostics. Defaults to 'unknown'. */
  label?: string;
  /**
   * A stable name for the clip's bytes — the R2 audio key. The native app
   * keeps a copy under it, so replaying the clip skips the base64 hand-off
   * across the bridge. Clips without one (ad-hoc TTS) still play; they are
   * just not kept.
   */
  cacheKey?: string;
}

export interface AudioPlayer {
  /**
   * Play a blob (wrapped in a managed object URL) or a plain URL, replacing
   * whatever was playing. Returns the id of this playback; handlers only fire
   * while it is still the current one.
   */
  play(source: Blob | string, handlers?: PlayHandlers): number;
  /** Stop playback and release the media resource. */
  stop(): void;
  /** Stop and drop the element entirely. Call on unmount. */
  dispose(): void;
  /**
   * Reserve the next playback id without starting audio, so callers can guard
   * their own async work (cache lookups, TTS generation) against being
   * superseded. Also stops whatever is currently playing.
   */
  claim(): number;
  /** True while `playId` is the most recent play/claim. */
  isCurrent(playId: number): boolean;
}

// ---- Native bridge (the Android app) ----

/**
 * What the app injects as window.AndroidAudio. v1 (app 1.51) has only
 * play/stop; everything else arrived with v2 and is feature-detected, since
 * the page updates on every deploy while the app updates when Obtainium gets
 * round to it.
 */
interface AndroidAudioBridge {
  /** Start a clip. `source` is a data: URL (bytes) or an https URL. */
  play(id: number, source: string): boolean;
  /** Stop the clip with this id; a superseded id is ignored. */
  stop(id: number): void;
  /**
   * v2: start a clip by cache key. With a source, the bytes are stored under
   * the key; with an empty source, the stored bytes play.
   */
  playClip?(id: number, key: string, source: string): boolean;
  /** v2: whether the app's cache holds the key. */
  hasClip?(key: string): boolean;
  /** v2: run every clip through a compressor + limiter. */
  setCompression?(on: boolean): void;
  /** v2: allow the keep-alive stream while a screen holds the output. */
  setKeepAwake?(on: boolean): void;
  /** v2: refcounted hold on the audio output (see holdNativeOutput). */
  holdOutput?(hold: boolean): void;
  /** v2: JSON snapshot of the bridge's state. */
  describe?(): string;
}

declare global {
  interface Window {
    AndroidAudio?: AndroidAudioBridge;
  }
}

type NativeEvent = 'play' | 'ended' | 'error' | 'superseded';

/** True when running inside the Android app with the audio bridge. */
export function hasNativeAudio(): boolean {
  return typeof window !== 'undefined' && !!window.AndroidAudio;
}

/** 0 without the bridge, 1 for the play/stop-only app, 2 with the tuning API. */
export function nativeBridgeVersion(): number {
  const bridge = typeof window !== 'undefined' ? window.AndroidAudio : undefined;
  if (!bridge) return 0;
  return typeof bridge.playClip === 'function' ? 2 : 1;
}

export interface NativeBridgeState {
  bridge: number;
  compression: boolean;
  /** 'on' | 'off' | 'unavailable' | 'unsupported' */
  effect: string;
  keep_awake: boolean;
  output_held: boolean;
  holds: number;
  route: string;
  volume: number;
  volume_max: number;
  cached_clips: number;
  sdk: number;
}

/** The bridge's own account of its state, or null without a v2 bridge. */
export function describeNativeBridge(): NativeBridgeState | null {
  const bridge = typeof window !== 'undefined' ? window.AndroidAudio : undefined;
  if (!bridge || typeof bridge.describe !== 'function') return null;
  try {
    return JSON.parse(bridge.describe()) as NativeBridgeState;
  } catch {
    return null;
  }
}

export function setNativeCompression(on: boolean): void {
  try {
    window.AndroidAudio?.setCompression?.(on);
  } catch {
    // Bridge gone
  }
}

export function setNativeKeepAwake(on: boolean): void {
  try {
    window.AndroidAudio?.setKeepAwake?.(on);
  } catch {
    // Bridge gone
  }
}

// Screens that play clips back to back (study, reader) hold the output so
// the app keeps it awake between clips. Refcounted here so the bridge sees
// one hold per page however many components ask.
let outputHolds = 0;

/**
 * Keep the native audio output awake until the returned release is called.
 * A no-op outside the app.
 */
export function holdNativeOutput(): () => void {
  let released = false;
  outputHolds++;
  if (outputHolds === 1) {
    try {
      window.AndroidAudio?.holdOutput?.(true);
    } catch {
      // Bridge gone
    }
  }
  return () => {
    if (released) return;
    released = true;
    outputHolds = Math.max(0, outputHolds - 1);
    if (outputHolds === 0) {
      try {
        window.AndroidAudio?.holdOutput?.(false);
      } catch {
        // Bridge gone
      }
    }
  };
}

/** Test seam: how many holds are outstanding. */
export function nativeOutputHoldCount(): number {
  return outputHolds;
}

// Ids handed to the bridge are unique across all players, so its events can
// be routed back to the right one.
let nextNativeId = 1;
const nativeListeners = new Map<number, (event: NativeEvent, stats?: NativeClipStats) => void>();
let nativeEventsHooked = false;

function hookNativeEvents() {
  if (nativeEventsHooked) return;
  nativeEventsHooked = true;
  window.addEventListener('android-audio', (raw: Event) => {
    const detail = (raw as CustomEvent<{ id?: number; event?: NativeEvent; stats?: NativeClipStats }>).detail;
    if (!detail || typeof detail.id !== 'number' || !detail.event) return;
    nativeListeners.get(detail.id)?.(detail.event, detail.stats);
  });
}

/** The clip bytes as a data: URL — the one string form the bridge can take. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'audio/mpeg'};base64,${btoa(binary)}`;
}

/** MediaError codes are numeric; name them so a report is readable. */
function describeMediaError(el: HTMLAudioElement): string {
  const code = el.error?.code;
  switch (code) {
    case 1:
      return 'MEDIA_ERR_ABORTED';
    case 2:
      return 'MEDIA_ERR_NETWORK';
    case 3:
      return 'MEDIA_ERR_DECODE';
    case 4:
      return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
    default:
      return 'media-error';
  }
}

export function createAudioPlayer(): AudioPlayer {
  let element: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let playId = 0;
  let tracker: ClipTracker | null = null;
  // At most one clip per player is ever counted as active.
  let clipActive = false;
  // Native path: the bridge id of the clip in flight.
  let nativeId: number | null = null;

  function markActive() {
    if (clipActive) return;
    clipActive = true;
    clipStarted();
  }

  function markInactive() {
    if (!clipActive) return;
    clipActive = false;
    clipStopped();
  }

  /** Release the current source: detach handlers, free the decoder and the blob. */
  function release() {
    markInactive();
    if (tracker) {
      tracker.finish();
      tracker = null;
    }
    if (nativeId !== null) {
      nativeListeners.delete(nativeId);
      try {
        window.AndroidAudio?.stop(nativeId);
      } catch {
        // Bridge gone (page reloading) — nothing to stop.
      }
      nativeId = null;
    }
    if (element) {
      element.onplay = null;
      element.onended = null;
      element.onerror = null;
      element.pause();
      // pause() keeps the decoder alive; clearing src and re-loading is what
      // actually frees it. load() on an empty src is a no-op in some engines.
      element.removeAttribute('src');
      try {
        element.load();
      } catch {
        // Older WebViews / test environments without a real media stack
      }
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  /**
   * Play through the native bridge. Returns false when the bridge is absent,
   * so the caller uses the element instead.
   */
  function playViaNative(id: number, source: Blob | string, handlers: PlayHandlers): boolean {
    const bridge = window.AndroidAudio;
    if (!bridge) return false;
    hookNativeEvents();

    const clipId = nextNativeId++;
    nativeId = clipId;
    const key = handlers.cacheKey ?? '';
    const clip = trackNativeClip(source, handlers.label ?? 'unknown');
    tracker = clip;
    markActive();

    const finish = (outcome: { ended?: boolean; error?: string; native?: NativeClipStats }) => {
      nativeListeners.delete(clipId);
      if (nativeId === clipId) nativeId = null;
      clip.finish(outcome);
      if (tracker === clip) tracker = null;
    };

    nativeListeners.set(clipId, (event, stats) => {
      if (playId !== id) return;
      if (event === 'play') {
        clip.markStarted?.();
        handlers.onPlay?.();
      } else if (event === 'ended') {
        finish({ ended: true, native: stats });
        markInactive();
        handlers.onEnded?.();
      } else if (event === 'superseded') {
        // Another player took the one native output. Not an error, and not
        // the end of the media either — but this clip is over.
        finish({ ended: false, native: stats });
        markInactive();
        handlers.onEnded?.();
      } else {
        finish({ error: 'native-error', native: stats });
        markInactive();
        handlers.onError?.();
      }
    });

    const reject = (reason: string) => {
      finish({ error: reason });
      markInactive();
      handlers.onError?.();
    };

    /**
     * Hand the bridge a payload; false means it would not take it. An empty
     * payload with a key asks a v2 bridge to play the copy it already holds.
     */
    const submit = (payload: string): boolean => {
      try {
        if (bridge.playClip) {
          return bridge.playClip(clipId, key, payload);
        }
        return bridge.play(clipId, payload);
      } catch {
        return false;
      }
    };

    const sendBytes = (blob: Blob) => {
      blobToDataUrl(blob).then(
        dataUrl => {
          if (playId !== id) return;
          if (!submit(dataUrl)) reject('native-rejected');
        },
        () => {
          if (playId !== id) return;
          reject('native-rejected');
        }
      );
    };

    if (typeof source === 'string') {
      if (!submit(source)) reject('native-rejected');
      return true;
    }

    // v2 bridge with the clip already on the device: play by key, no
    // base64 round trip. If the file vanished between the check and the
    // play (cache trim), fall through to sending the bytes.
    let cachedHit = false;
    if (key && bridge.playClip && bridge.hasClip) {
      try {
        cachedHit = bridge.hasClip(key);
      } catch {
        cachedHit = false;
      }
    }
    if (cachedHit && submit('')) {
      return true;
    }
    sendBytes(source);
    return true;
  }

  /** Play through an <audio> element. */
  function playViaElement(id: number, source: Blob | string, handlers: PlayHandlers): void {
    if (!element) {
      element = new Audio();
      livePlayers++;
    }
    const el = element;

    if (typeof source === 'string') {
      el.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      el.src = objectUrl;
    }

    tracker = trackClip(el, source, handlers.label ?? 'unknown');
    const clip = tracker;
    markActive();

    el.onplay = () => {
      if (playId === id) handlers.onPlay?.();
    };
    el.onended = () => {
      clip.finish({ ended: true });
      if (playId === id) markInactive();
      if (playId === id) handlers.onEnded?.();
    };
    el.onerror = () => {
      clip.finish({ error: describeMediaError(el) });
      if (playId === id) markInactive();
      if (playId === id) handlers.onError?.();
    };

    const started = el.play();
    // Older WebViews return undefined instead of a promise.
    if (started && typeof started.catch === 'function') {
      started.catch((err: unknown) => {
        // An aborted play (superseded by the next clip) is not an error.
        if (playId !== id) return;
        clip.finish({ error: err instanceof Error ? err.name : 'play-rejected' });
        markInactive();
        handlers.onError?.();
      });
    }
  }

  return {
    play(source, handlers = {}) {
      const id = ++playId;
      release();
      if (!playViaNative(id, source, handlers)) {
        playViaElement(id, source, handlers);
      }
      return id;
    },

    stop() {
      playId++;
      release();
    },

    dispose() {
      playId++;
      release();
      if (element) {
        element = null;
        livePlayers--;
      }
    },

    claim() {
      const id = ++playId;
      release();
      return id;
    },

    isCurrent(id) {
      return playId === id;
    },
  };
}
