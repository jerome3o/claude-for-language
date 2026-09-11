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

import { trackClip, trackNativeClip, ClipTracker } from './audioDiagnostics';

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

interface AndroidAudioBridge {
  /** Start a clip. `source` is a data: URL (bytes) or an https URL. */
  play(id: number, source: string): boolean;
  /** Stop the clip with this id; a superseded id is ignored. */
  stop(id: number): void;
}

declare global {
  interface Window {
    AndroidAudio?: AndroidAudioBridge;
  }
}

type NativeEvent = 'play' | 'ended' | 'error';

/** True when running inside the Android app with the audio bridge. */
export function hasNativeAudio(): boolean {
  return typeof window !== 'undefined' && !!window.AndroidAudio;
}

// Ids handed to the bridge are unique across all players, so its events can
// be routed back to the right one.
let nextNativeId = 1;
const nativeListeners = new Map<number, (event: NativeEvent) => void>();
let nativeEventsHooked = false;

function hookNativeEvents() {
  if (nativeEventsHooked) return;
  nativeEventsHooked = true;
  window.addEventListener('android-audio', (raw: Event) => {
    const detail = (raw as CustomEvent<{ id?: number; event?: NativeEvent }>).detail;
    if (!detail || typeof detail.id !== 'number' || !detail.event) return;
    nativeListeners.get(detail.id)?.(detail.event);
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
    const clip = trackNativeClip(source, handlers.label ?? 'unknown');
    tracker = clip;
    markActive();

    const finish = (outcome: { ended?: boolean; error?: string }) => {
      nativeListeners.delete(clipId);
      if (nativeId === clipId) nativeId = null;
      clip.finish(outcome);
      if (tracker === clip) tracker = null;
    };

    nativeListeners.set(clipId, (event) => {
      if (playId !== id) return;
      if (event === 'play') {
        clip.markStarted?.();
        handlers.onPlay?.();
      } else if (event === 'ended') {
        finish({ ended: true });
        markInactive();
        handlers.onEnded?.();
      } else {
        finish({ error: 'native-error' });
        markInactive();
        handlers.onError?.();
      }
    });

    const start = (payload: string) => {
      if (playId !== id) return;
      let accepted = false;
      try {
        accepted = bridge.play(clipId, payload);
      } catch {
        accepted = false;
      }
      if (!accepted) {
        finish({ error: 'native-rejected' });
        markInactive();
        handlers.onError?.();
      }
    };

    if (typeof source === 'string') {
      start(source);
    } else {
      blobToDataUrl(source).then(start, () => start(''));
    }
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
