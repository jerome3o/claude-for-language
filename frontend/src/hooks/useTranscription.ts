import { useState, useCallback, useRef } from 'react';
import { transcribeAudio, TranscriptionResult } from '../api/client';
import { transcribeTakeOutcome } from '../services/takeTranscription';
import { resetLiveSessionCache } from '../services/liveTranscription';
import { liveErrorKind, liveFailureInvalidatesKey } from '@shared/transcription/soniox';
import { track } from '../services/analytics';
import { compareTranscription, type TranscriptionComparison } from '@shared/recordings/transcript';

// The comparison lives in shared/ so the worker's recording check agrees with the card.
export { compareTranscription };
export type { TranscriptionComparison };

export interface TranscriptionState {
  isTranscribing: boolean;
  result: TranscriptionResult | null;
  comparison: TranscriptionComparison | null;
  error: string | null;
  isOffline: boolean;
}

export function useTranscription() {
  const [state, setState] = useState<TranscriptionState>({
    isTranscribing: false,
    result: null,
    comparison: null,
    error: null,
    isOffline: false,
  });

  // A newer take (or reset) makes an older, still-running transcription stale.
  const generation = useRef(0);
  // The last take, so "Couldn't transcribe — tap to retry" can send the SAME recording again.
  const lastTake = useRef<{ audioBlob: Blob; expectedHanzi: string; expectedPinyin: string } | null>(null);

  /**
   * Called as soon as a take exists (not on "Check answer"), so the result is usually
   * waiting by the time the card flips. `live` is the streaming transcriber's final text
   * (Soniox, ready a few hundred ms after Stop); when it's missing, empty or fails, the take
   * is uploaded to POST /api/transcribe (Whisper, then Soniox async / Gemini on the server).
   * Offline: "will transcribe when online" (the recording still goes up with the review).
   * Both failing sets `error` — the card shows "Couldn't transcribe — tap to retry".
   */
  const transcribe = useCallback(async (audioBlob: Blob, expectedHanzi: string, expectedPinyin: string, live?: Promise<string> | null) => {
    const gen = ++generation.current;
    lastTake.current = { audioBlob, expectedHanzi, expectedPinyin };
    const set = (next: TranscriptionState) => { if (gen === generation.current) setState(next); };
    const startedAt = performance.now();

    if (!live && !navigator.onLine) {
      set({ isTranscribing: false, result: null, comparison: null, error: null, isOffline: true });
      return;
    }
    set({ isTranscribing: true, result: null, comparison: null, error: null, isOffline: false });

    const outcome = await transcribeTakeOutcome({
      live,
      upload: (liveError) => transcribeAudio(audioBlob, { liveError }),
      isOnline: () => navigator.onLine,
    });
    if (outcome.liveError) {
      console.warn('[transcribe] live transcription gave nothing, uploading instead:', outcome.liveError);
      // A refused key would fail every take until it expires: mint a fresh one next time.
      if (liveFailureInvalidatesKey(outcome.liveError)) resetLiveSessionCache();
    }
    const ms = Math.round(performance.now() - startedAt);
    // Enums + a duration only (never the transcript): makes a broken live path visible in analytics.
    track('study.take_transcribed', {
      via: outcome.kind === 'done' ? outcome.via : outcome.kind,
      live_error: live ? liveErrorKind(outcome.liveError) : 'none',
      ms,
    });
    switch (outcome.kind) {
      case 'done':
        console.info(`[transcribe] ${outcome.via === 'live' ? 'live (Soniox)' : 'upload'} ready ${ms} ms after stop`);
        set({ isTranscribing: false, result: outcome.result, comparison: compareTranscription(outcome.text, expectedHanzi, expectedPinyin), error: null, isOffline: false });
        return;
      case 'offline':
        set({ isTranscribing: false, result: null, comparison: null, error: null, isOffline: true });
        return;
      case 'failed':
        console.warn(`[transcribe] failed after ${ms} ms: ${outcome.reason}`);
        set({ isTranscribing: false, result: null, comparison: null, error: "Couldn't transcribe", isOffline: false });
    }
  }, []);

  /** "Tap to retry": the saved take again, straight to the upload path. */
  const retry = useCallback(() => {
    const take = lastTake.current;
    if (take) void transcribe(take.audioBlob, take.expectedHanzi, take.expectedPinyin, null);
  }, [transcribe]);

  const reset = useCallback(() => {
    generation.current++;
    lastTake.current = null;
    setState({
      isTranscribing: false,
      result: null,
      comparison: null,
      error: null,
      isOffline: false,
    });
  }, []);

  return { ...state, transcribe, retry, reset };
}
