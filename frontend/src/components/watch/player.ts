/**
 * 📺 Watch — the video player behind one small interface (docs/WATCH.md): YouTube's official IFrame
 * Player API (embedded from youtube-nocookie.com; we never download, proxy or extract YouTube media),
 * or — in a dev build when `window.__watchStandIn` is set by an E2E spec / screenshot script — a
 * stand-in that draws its own colour clip with a clock, so no YouTube frame is ever recorded.
 */
import { createStandInPlayer } from './standInPlayer';

export interface WatchPlayerInfo {
  durationMs: number;
  title: string | null;
}

export interface WatchPlayerEvents {
  onReady: (info: WatchPlayerInfo) => void;
  onPlayingChange: (playing: boolean) => void;
  onError: (message: string) => void;
}

export interface WatchPlayer {
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setRate(rate: number): void;
  currentMs(): number;
  durationMs(): number;
  isPlaying(): boolean;
  destroy(): void;
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData?: () => { title?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
    /** Dev builds only: use the stand-in player (seconds of fake video, or true = 60). */
    __watchStandIn?: boolean | number;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Load https://www.youtube.com/iframe_api once (CSP: script-src www.youtube.com, frame-src youtube-nocookie.com). */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      s.remove();
      reject(new Error("YouTube's player couldn't load — check the connection"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** YouTube's onError codes, in words. */
export function youtubeErrorMessage(code: number): string {
  if (code === 100) return "This video isn't on YouTube any more (or it's private)";
  if (code === 101 || code === 150) return "This video's owner doesn't allow it to be played outside YouTube";
  if (code === 2) return "YouTube didn't recognise this video";
  if (code === 5) return "This browser can't play the video";
  if (code === 152 || code === 153) return "YouTube refused to play it here (error " + code + ')';
  return `YouTube couldn't play this video (error ${code})`;
}

function createYouTubePlayer(container: HTMLElement, videoId: string, startMs: number, events: WatchPlayerEvents): WatchPlayer {
  let yt: YTPlayer | null = null;
  let playing = false;
  let destroyed = false;
  let pendingRate: number | null = null;
  const host = document.createElement('div');
  container.appendChild(host);
  loadYouTubeApi()
    .then((YT) => {
      if (destroyed) return;
      yt = new YT.Player(host, {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          cc_load_policy: 0,
          start: Math.floor(startMs / 1000),
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (destroyed || !yt) return;
            if (pendingRate !== null) yt.setPlaybackRate(pendingRate);
            const report = (tries: number) => {
              if (destroyed || !yt) return;
              const d = yt.getDuration?.() ?? 0;
              if (d > 0 || tries <= 0) events.onReady({ durationMs: Math.round(d * 1000), title: yt.getVideoData?.().title || null });
              else window.setTimeout(() => report(tries - 1), 500);
            };
            report(20);
          },
          onStateChange: (e: { data: number }) => {
            // 1 playing, 3 buffering (still "playing" for the controls), 2 paused, 0 ended, 5 cued.
            const now = e.data === 1 || e.data === 3;
            if (now !== playing) {
              playing = now;
              events.onPlayingChange(now);
            }
          },
          onError: (e: { data: number }) => events.onError(youtubeErrorMessage(e.data)),
        },
      });
    })
    .catch((err: unknown) => events.onError(err instanceof Error ? err.message : "YouTube's player couldn't load"));
  return {
    play: () => yt?.playVideo(),
    pause: () => yt?.pauseVideo(),
    seekTo: (ms) => yt?.seekTo(Math.max(0, ms) / 1000, true),
    setRate: (rate) => {
      pendingRate = rate;
      yt?.setPlaybackRate(rate);
    },
    currentMs: () => Math.round((yt?.getCurrentTime?.() ?? 0) * 1000),
    durationMs: () => Math.round((yt?.getDuration?.() ?? 0) * 1000),
    isPlaying: () => playing,
    destroy: () => {
      destroyed = true;
      try {
        yt?.destroy();
      } catch {
        /* already gone */
      }
      host.remove();
    },
  };
}

/** The player for one video in `container` (filled entirely by it; nothing may be drawn over it). */
export function createWatchPlayer(container: HTMLElement, videoId: string, startMs: number, events: WatchPlayerEvents): WatchPlayer {
  if (import.meta.env.DEV && window.__watchStandIn) {
    const seconds = typeof window.__watchStandIn === 'number' ? window.__watchStandIn : 60;
    return createStandInPlayer(container, seconds * 1000, startMs, events);
  }
  return createYouTubePlayer(container, videoId, startMs, events);
}
