/**
 * Cache-first TTS for the editor and preview — the same play path the study
 * session uses (StudyCustomLesson), so anything the author listens to here
 * is already cached for the learner's offline session.
 */

import { useCallback, useEffect, useRef } from 'react';
import { getTTSWithCache } from '../../services/ttsCache';
import { createAudioPlayer } from '../../utils/audioPlayback';

export function useLessonSpeak(): (text: string) => void {
  const playerRef = useRef(createAudioPlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  return useCallback((text: string) => {
    if (!text.trim()) return;
    const playId = playerRef.current.claim();
    void getTTSWithCache(text).then(blob => {
      if (!blob || !playerRef.current.isCurrent(playId)) return;
      playerRef.current.play(blob, { label: 'lesson-editor' });
    });
  }, []);
}
