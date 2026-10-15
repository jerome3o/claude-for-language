/**
 * A mini lesson's audio while it is open (docs/AUDIO.md "Lesson audio prefetch"):
 *
 * - `createClipPrefetcher`: the moment a lesson opens, every clip it can play that the
 *   device doesn't have yet is fetched — the exercise on screen first, then the ones after
 *   it (`orderClipsForPrefetch`), a few at a time; moving to another exercise moves its
 *   clips to the front. A clip already being fetched is joined, never asked for twice
 *   (ttsCache's in-flight map), so pressing Check while it downloads just waits for it.
 * - `createLessonSpeaker`: the player's fire-and-forget `speak`. Cache-first; a clip that
 *   arrives after the learner moved on to the NEXT exercise is dropped (`cancelPending`,
 *   called when the exercise changes) — Jerome heard a scramble's answer on the card after.
 *   Counts hits / misses / stale drops for the `lesson.audio` event.
 *
 * Both are plain objects with injected I/O so they are unit-tested without a browser.
 */
import { orderClipsForPrefetch, lessonClipId, type LessonAudioClip, type LessonAudioStats } from '@shared/lesson';

export interface ClipPrefetcher {
  /** The learner is on exercise `index` now: its clips (then the ones after it) go first. */
  focus(index: number): void;
  /** Stop fetching (the lesson closed); clips in flight finish but nothing new starts. */
  cancel(): void;
  /** Resolves when every clip was looked at (or the prefetcher was cancelled). */
  readonly done: Promise<PrefetchResult>;
}

export interface PrefetchResult {
  /** Clips already on the device when the lesson opened. */
  cached: number;
  /** Clips fetched now. */
  fetched: number;
  /** Clips that couldn't be had (offline, the server…). */
  failed: number;
  cancelled: boolean;
}

/** Clips fetched at once when a lesson opens (the server limits TTS per minute; most are R2 hits). */
export const LESSON_PREFETCH_CONCURRENCY = 3;

export function createClipPrefetcher(opts: {
  clips: readonly LessonAudioClip[];
  isCached: (clip: LessonAudioClip) => Promise<boolean>;
  /** Fetch + keep one clip; true when it is on the device now. */
  fetch: (clip: LessonAudioClip) => Promise<boolean>;
  /** False = stop (offline): what's left waits for the next open / sync. */
  online?: () => boolean;
  current?: number;
  concurrency?: number;
}): ClipPrefetcher {
  const online = opts.online ?? (() => true);
  let queue = orderClipsForPrefetch(opts.clips, opts.current ?? 0);
  const all = opts.clips;
  const taken = new Set<string>();
  let cancelled = false;
  const result: PrefetchResult = { cached: 0, fetched: 0, failed: 0, cancelled: false };

  const next = (): LessonAudioClip | null => {
    while (queue.length > 0) {
      const clip = queue.shift()!;
      const id = lessonClipId(clip);
      if (taken.has(id)) continue;
      taken.add(id);
      return clip;
    }
    return null;
  };

  async function worker(): Promise<void> {
    for (;;) {
      if (cancelled || !online()) return;
      const clip = next();
      if (!clip) return;
      try {
        if (await opts.isCached(clip)) {
          result.cached++;
          continue;
        }
        if (cancelled || !online()) return;
        if (await opts.fetch(clip)) result.fetched++;
        else result.failed++;
      } catch {
        result.failed++;
      }
    }
  }

  const n = Math.max(1, opts.concurrency ?? LESSON_PREFETCH_CONCURRENCY);
  const done = Promise.all(Array.from({ length: n }, () => worker())).then(() => ({ ...result, cancelled }));

  return {
    focus(index: number) {
      if (cancelled) return;
      queue = orderClipsForPrefetch(all, index).filter((c) => !taken.has(lessonClipId(c)));
    },
    cancel() {
      cancelled = true;
      queue = [];
    },
    done,
  };
}

/** The bits of the app's AudioPlayer the speaker needs (utils/audioPlayback.ts). */
export interface SpeakerPlayer {
  claim(): number;
  isCurrent(id: number): boolean;
  stop(): void;
  play(blob: Blob, handlers?: { label?: string }): number;
}

export interface LessonSpeaker {
  /** Play `text` in the default lesson voice; newest call wins. */
  speak(text: string): void;
  /** The exercise changed: a clip still on its way is dropped (a playing one plays on). */
  cancelPending(): void;
  stats(): LessonAudioStats;
}

export function createLessonSpeaker(opts: {
  player: SpeakerPlayer;
  load: (text: string) => Promise<Blob | null>;
  isCached: (text: string) => Promise<boolean>;
  now?: () => number;
}): LessonSpeaker {
  const now = opts.now ?? (() => Date.now());
  const stats: LessonAudioStats = { hits: 0, misses: 0, stale: 0, max_wait_ms: 0 };
  /** The play id still waiting for its clip (null = none). */
  let pending: number | null = null;
  /** Play ids dropped because the exercise changed (counted as stale when they arrive). */
  const dropped = new Set<number>();

  return {
    speak(text: string) {
      if (!text.trim()) return;
      const id = opts.player.claim();
      pending = id;
      const started = now();
      const cachedAtAsk = opts.isCached(text).catch(() => false);
      void opts.load(text).then(async (blob) => {
        if (pending === id) pending = null;
        const wasCached = await cachedAtAsk;
        if (wasCached) stats.hits++;
        else {
          stats.misses++;
          stats.max_wait_ms = Math.max(stats.max_wait_ms, now() - started);
        }
        if (dropped.delete(id)) {
          stats.stale++;
          return;
        }
        if (!blob || !opts.player.isCurrent(id)) return;
        opts.player.play(blob, { label: 'lesson-example' });
      });
    },
    cancelPending() {
      if (pending === null) return;
      if (opts.player.isCurrent(pending)) opts.player.stop();
      dropped.add(pending);
      pending = null;
    },
    stats: () => ({ ...stats }),
  };
}
