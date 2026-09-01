/**
 * Managed audio playback.
 *
 * Every clip used to get its own `new Audio(...)`, usually wrapped around a
 * fresh `URL.createObjectURL(blob)` that was never revoked. Pausing an element
 * does not release its decoder, so in the Android WebView a study session
 * accumulates one live media player (and one pinned blob) per clip played.
 * Chromium caps how many media players a renderer may hold; past that limit
 * playback degrades instead of failing outright — crunchy, dropping out,
 * distorted. It shows up first on the longest clips (example sentences,
 * reader pages) because they need the most decoder buffer.
 *
 * An AudioPlayer owns exactly ONE <audio> element and at most one object URL,
 * and releases both before starting the next clip. Callers keep one player for
 * their lifetime and must `dispose()` it on unmount.
 */

import { trackClip, trackBufferClip, ClipTracker } from './audioDiagnostics';

/** Live element count, so diagnostics can catch a leak reappearing. */
let livePlayers = 0;
export function livePlayerCount(): number {
  return livePlayers;
}

// ---- Playback activity, so background work can keep out of the way ----
//
// Bulk media caching (sentence sets, the offline prefetcher) downloads several
// clips at once and writes each into IndexedDB. Doing that while a clip is
// playing starves the media pipeline of network, disk and main thread, and the
// clip comes out choppy. Playback is user-facing and lasts a second or two;
// caching is background work with no deadline. So caching yields to playback.

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

// ---- Shared audio output ----
//
// An <audio> element acquires and releases the device's audio output around
// every clip. On Android that acquisition is not free: a report from the device
// showed ~1s to first sound for a 17KB clip already in memory, and a `waiting`
// event on every single clip — with the main thread idle and the bytes local.
// Short card clips played back to back pay that cost over and over, and the
// first moments of a clip are exactly where a freshly-opened output glitches.
//
// One AudioContext, opened once and kept open for the session, removes the
// per-clip acquisition entirely: each clip is a buffer scheduled on an output
// that is already running. Element playback stays as the fallback.

let sharedContext: AudioContext | null = null;
let contextUnavailable = false;

function getSharedContext(): AudioContext | null {
  if (sharedContext) return sharedContext;
  if (contextUnavailable) return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    contextUnavailable = true;
    return null;
  }
  try {
    sharedContext = new Ctor();
    return sharedContext;
  } catch {
    contextUnavailable = true;
    return null;
  }
}

/**
 * Open (or resume) the shared output. Browsers only allow this from a user
 * gesture, so call it from an early interaction — the output is then warm
 * before the first clip needs it.
 */
export function warmAudioOutput(): void {
  const ctx = getSharedContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
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
  // Web Audio path: the buffer currently scheduled on the shared output.
  let bufferSource: AudioBufferSourceNode | null = null;

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
    if (bufferSource) {
      bufferSource.onended = null;
      try {
        bufferSource.stop();
      } catch {
        // Already finished — stop() on a spent source throws.
      }
      bufferSource.disconnect();
      bufferSource = null;
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
   * Play through the shared output. Returns false when Web Audio is
   * unavailable or the clip cannot be decoded, so the caller falls back to the
   * element path rather than leaving the user with silence.
   */
  function playViaSharedOutput(
    id: number,
    source: Blob,
    handlers: PlayHandlers
  ): boolean {
    const ctx = getSharedContext();
    if (!ctx) return false;

    markActive();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

    void (async () => {
      let buffer: AudioBuffer;
      try {
        buffer = await ctx.decodeAudioData(await source.arrayBuffer());
      } catch {
        // Undecodable here but possibly fine for the element (some WebViews
        // decode formats Web Audio refuses) — hand it back.
        if (playId !== id) return;
        markInactive();
        playViaElement(id, source, handlers);
        return;
      }
      if (playId !== id) return;

      const clip = trackBufferClip(source, handlers.label ?? 'unknown', buffer.duration);
      tracker = clip;

      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.onended = () => {
        if (playId !== id) return;
        clip.finish({ ended: true });
        tracker = null;
        markInactive();
        handlers.onEnded?.();
      };
      bufferSource = node;
      node.start();
      clip.markStarted?.();
      handlers.onPlay?.();
    })();

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

      // Cached clips (everything in the study session) go through the shared
      // output; plain URLs stay on the element, which streams them.
      if (typeof source !== 'string' && playViaSharedOutput(id, source, handlers)) {
        return id;
      }
      playViaElement(id, source, handlers);
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
