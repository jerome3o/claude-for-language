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

export interface PlayHandlers {
  onPlay?: () => void;
  onEnded?: () => void;
  onError?: () => void;
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

export function createAudioPlayer(): AudioPlayer {
  let element: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let playId = 0;

  /** Release the current source: detach handlers, free the decoder and the blob. */
  function release() {
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

  return {
    play(source, handlers = {}) {
      const id = ++playId;
      release();

      if (!element) {
        element = new Audio();
      }
      const el = element;

      if (typeof source === 'string') {
        el.src = source;
      } else {
        objectUrl = URL.createObjectURL(source);
        el.src = objectUrl;
      }

      el.onplay = () => {
        if (playId === id) handlers.onPlay?.();
      };
      el.onended = () => {
        if (playId === id) handlers.onEnded?.();
      };
      el.onerror = () => {
        if (playId === id) handlers.onError?.();
      };

      const started = el.play();
      // Older WebViews return undefined instead of a promise.
      if (started && typeof started.catch === 'function') {
        started.catch(() => {
          // An aborted play (superseded by the next clip) is not an error.
          if (playId === id) handlers.onError?.();
        });
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
      element = null;
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
