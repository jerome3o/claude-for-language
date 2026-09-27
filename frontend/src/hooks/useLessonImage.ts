/**
 * The picture of a describe_image exercise, whatever state it is in.
 *
 *   key on the exercise (or remembered for its prompt) → cached blob, else the
 *     direct /api/audio URL (and cached in the background) → ready
 *   no key yet, online → ask by prompt (services/lessonImages.ts):
 *     ready → shown; pending → "Drawing the picture…" and polled until it is
 *     there (then "still drawing" after a few minutes); failed / not available
 *     → the scene text
 *   no key and offline → the scene text, retried when the device comes online
 *
 * Never silently the text fallback forever: a picture being drawn says so and
 * appears on its own.
 */

import { useEffect, useState } from 'react';
import { getAudioWithCache, getCachedAudio } from '../services/audioCache';
import { getReaderImageUrl } from '../api/client';
import { ensureLessonImages, rememberedLessonImageKey } from '../services/lessonImages';

export type LessonImageState =
  | { state: 'ready'; url: string; key: string }
  | { state: 'loading' }
  | { state: 'pending' }
  | { state: 'slow' }
  | { state: 'offline' }
  | { state: 'failed' }
  | { state: 'none' };

export interface UseLessonImageOptions {
  /** false = only look the picture up, never start drawing it (the editor form while typing). */
  queue?: boolean;
  /** Wait this long after the prompt last changed before asking (the editor form). */
  debounceMs?: number;
  pollMs?: number;
  /** Polls before "still drawing" (default ≈ 3 minutes at 4 s). */
  maxPolls?: number;
}

/** What the placeholder says for a state with no picture (pure; unit-tested). */
export function lessonImagePlaceholder(state: LessonImageState['state']): { kind: 'drawing' | 'text'; title: string; detail?: string } {
  switch (state) {
    case 'loading':
      return { kind: 'drawing', title: 'Loading the picture…' };
    case 'pending':
      return { kind: 'drawing', title: 'Drawing the picture…', detail: 'It appears here in a moment.' };
    case 'slow':
      return { kind: 'drawing', title: 'Still drawing the picture…', detail: 'It will be here next time — meanwhile, imagine the scene:' };
    case 'offline':
      return { kind: 'text', title: 'Picture not downloaded yet — it comes with your next sync. Imagine the scene:' };
    case 'failed':
      return { kind: 'text', title: 'The picture could not be drawn. Imagine the scene:' };
    default:
      return { kind: 'text', title: 'Imagine this scene:' };
  }
}

export function useLessonImage(
  imageKey: string | null | undefined,
  prompt: string | null | undefined,
  opts: UseLessonImageOptions = {},
): LessonImageState & { onImageError: () => void } {
  const { queue = true, debounceMs = 0, pollMs = 4000, maxPolls = 45 } = opts;
  const [view, setView] = useState<LessonImageState>({ state: 'loading' });
  const [retry, setRetry] = useState(0);
  const [brokenKey, setBrokenKey] = useState<string | null>(null);

  // Coming back online retries a picture that couldn't be fetched.
  useEffect(() => {
    const onOnline = () => {
      setBrokenKey(null);
      setRetry(n => n + 1);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let polls = 0;

    const show = async (key: string) => {
      const blob = await getCachedAudio(key).catch(() => null);
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setView({ state: 'ready', url: objectUrl, key });
      } else if (navigator.onLine) {
        // The direct URL, so display never waits on a JS fetch; cache it for offline.
        setView({ state: 'ready', url: getReaderImageUrl(key), key });
        getAudioWithCache(key).catch(() => {});
      } else {
        setView({ state: 'offline' });
      }
    };

    const ask = async () => {
      if (cancelled || !prompt) return;
      if (!navigator.onLine) {
        setView({ state: 'offline' });
        return;
      }
      try {
        const [res] = await ensureLessonImages([prompt], { queue });
        if (cancelled) return;
        if (res?.status === 'ready' && res.image_url === brokenKey) {
          setView({ state: 'failed' });
        } else if (res?.status === 'ready' && res.image_url) {
          await show(res.image_url);
        } else if (res?.status === 'pending') {
          polls++;
          setView({ state: polls > maxPolls ? 'slow' : 'pending' });
          timer = setTimeout(ask, polls > maxPolls ? pollMs * 4 : pollMs);
        } else if (res?.status === 'failed') {
          setView({ state: 'failed' });
        } else {
          setView({ state: 'none' });
        }
      } catch {
        if (!cancelled) setView({ state: navigator.onLine ? 'none' : 'offline' });
      }
    };

    const start = () => {
      const key = imageKey || rememberedLessonImageKey(prompt);
      if (key && key !== brokenKey) {
        void show(key);
      } else if (prompt && prompt.trim()) {
        setView({ state: 'loading' });
        void ask();
      } else {
        setView({ state: 'none' });
      }
    };

    if (debounceMs > 0) timer = setTimeout(start, debounceMs);
    else start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageKey, prompt, queue, debounceMs, pollMs, maxPolls, retry, brokenKey]);

  const onImageError = () => {
    // The direct URL failed (flaky network, or a key whose file is gone):
    // fall back to asking by prompt, and retry when the device is online again.
    if (view.state === 'ready') {
      setBrokenKey(view.key);
      if (!navigator.onLine) setView({ state: 'offline' });
    }
  };

  return { ...view, onImageError };
}
