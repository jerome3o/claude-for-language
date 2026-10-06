/**
 * Awaitable TTS playback for lesson exercises that play several clips in a
 * row (a conversation in two voices). Cache-first like every lesson clip, so
 * it works offline once prefetched; a clip that can't be had resolves false
 * instead of hanging the sequence.
 */

import { useCallback, useEffect, useRef } from 'react';
import { createAudioPlayer } from '../utils/audioPlayback';
import { getConversationClip, getTTSWithCache, type ConversationClip } from '../services/ttsCache';

/** Longest a single clip may take before the sequence moves on anyway. */
const CLIP_TIMEOUT_MS = 30_000;

export function useLessonClips() {
  const playerRef = useRef(createAudioPlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  const playBlob = useCallback((load: () => Promise<Blob | null>): Promise<boolean> => {
    const player = playerRef.current;
    const playId = player.claim();
    return new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(player.isCurrent(playId)), CLIP_TIMEOUT_MS);
      void load().then(blob => {
        if (!blob || !player.isCurrent(playId)) return finish(false);
        player.play(blob, {
          label: 'lesson-conversation',
          onEnded: () => finish(true),
          onError: () => finish(false),
        });
      });
    });
  }, []);

  /** Play one clip; resolves true when it finished, false when it couldn't play.
   * `speed` is the TTS speaking rate baked into the clip (a conversation's
   * CONVERSATION_TTS_SPEED); undefined = the app-wide default. */
  const playClip = useCallback((text: string, voice?: string, speed?: number): Promise<boolean> => {
    return playBlob(() => getTTSWithCache(text, speed, voice));
  }, [playBlob]);

  /** Play one conversation line (its own voice / rate / delivery); `regenerate` makes it again first. */
  const playLine = useCallback((clip: ConversationClip, opts: { regenerate?: boolean } = {}): Promise<boolean> => {
    return playBlob(() => getConversationClip(clip, opts));
  }, [playBlob]);

  const stop = useCallback(() => {
    playerRef.current.stop();
  }, []);

  return { playClip, playLine, stop };
}
