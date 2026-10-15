/**
 * The open lesson's audio (services/lessonAudio.ts): every clip the lesson can play is
 * fetched as soon as it opens — the exercise on screen first — and `speak` is cache-first
 * with late clips dropped once the learner has moved on (`cancelPending` on every exercise
 * change). On close it reports how the audio did (`lesson.audio`: counts only).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { lessonAudioClips, type CustomLessonSpec } from '@shared/lesson';
import { createAudioPlayer } from '../utils/audioPlayback';
import { getLessonClip, getTTSWithCache, isLessonClipCached, lessonClipCacheKey } from '../services/ttsCache';
import { isAudioCached } from '../services/audioCache';
import { audioForConversation } from '../services/conversationAudio';
import { createClipPrefetcher, createLessonSpeaker, type ClipPrefetcher, type PrefetchResult } from '../services/lessonAudio';
import { track } from '../services/analytics';

export function useLessonAudio(spec: CustomLessonSpec, index: number, source: string): {
  speak: (text: string) => void;
  /** Call when the exercise changes, before the next one renders. */
  cancelPending: () => void;
} {
  const playerRef = useRef(createAudioPlayer());
  const speaker = useMemo(
    () => createLessonSpeaker({
      player: playerRef.current,
      load: (text) => getTTSWithCache(text),
      isCached: (text) => isAudioCached(lessonClipCacheKey({ kind: 'tts', text })),
    }),
    [],
  );
  const indexRef = useRef(index);
  indexRef.current = index;
  const prefetcher = useRef<ClipPrefetcher | null>(null);
  const result = useRef<PrefetchResult | null>(null);
  const clipCount = useRef(0);

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  // Open: fetch every clip the device doesn't have yet, current exercise first.
  useEffect(() => {
    const clips = lessonAudioClips(spec, audioForConversation);
    clipCount.current = clips.length;
    const p = createClipPrefetcher({
      clips,
      isCached: isLessonClipCached,
      fetch: async (clip) => !!(await getLessonClip(clip)),
      online: () => navigator.onLine,
      current: indexRef.current,
    });
    prefetcher.current = p;
    void p.done.then((r) => { result.current = r; });
    return () => {
      p.cancel();
      if (prefetcher.current === p) prefetcher.current = null;
    };
  }, [spec]);

  useEffect(() => { prefetcher.current?.focus(index); }, [index]);

  // Close: how the audio did this run (only when something was spoken).
  useEffect(() => () => {
    const s = speaker.stats();
    if (s.hits + s.misses === 0) return;
    track('lesson.audio', {
      source,
      hits: s.hits,
      misses: s.misses,
      stale: s.stale,
      max_wait_ms: s.max_wait_ms,
      clips: clipCount.current,
      prefetched: result.current?.fetched ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speak = useCallback((text: string) => speaker.speak(text), [speaker]);
  const cancelPending = useCallback(() => speaker.cancelPending(), [speaker]);
  return { speak, cancelPending };
}
