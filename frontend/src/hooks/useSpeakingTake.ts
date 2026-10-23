/**
 * A lesson's free-speaking take (oral_expression / speak; docs/STUDY_SESSION.md "Claude checks your
 * speaking"): the recording streams to the live transcriber while the learner speaks (the words
 * show as they come), and the transcript is ready a moment after Stop — else the take is uploaded
 * to POST /api/transcribe (transcribeTakeOutcome, the study card's path). Both failing →
 * "Couldn't transcribe — tap to retry" with the SAME take; offline → the recording is kept and
 * checked by the server once it uploads with the attempt. Minutes-long takes: the live key must
 * outlive the take (SPEAKING_LIVE_KEY_MARGIN_MS) and the take stops itself at SPEAKING_MAX_SECONDS.
 * Lab: `SpeakingTakeState` in ui/lessons/SpeakingCheckViews.kt.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from './useAudio';
import { getLiveSession, LiveTranscriber, liveSessionUnavailable, resetLiveSessionCache } from '../services/liveTranscription';
import { transcribeTakeOutcome } from '../services/takeTranscription';
import { transcribeAudio } from '../api/client';
import { liveErrorKind, liveFailureInvalidatesKey, transcriptText } from '@shared/transcription/soniox';
import { SPEAKING_FINISH_TIMEOUT_MS, SPEAKING_LIVE_KEY_MARGIN_MS, SPEAKING_MAX_SECONDS } from '@shared/lesson/speakingTake';
import { track } from '../services/analytics';

export type SpeakingTranscript =
  | { status: 'none' }
  | { status: 'transcribing' }
  | { status: 'done'; text: string; via: 'live' | 'upload' }
  | { status: 'offline' }
  | { status: 'failed' };

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function useSpeakingTake(exerciseType: string) {
  const recorder = useAudioRecorder();
  const { startRecording, stopRecording, cancelRecording, isRecording } = recorder;
  const [transcript, setTranscript] = useState<SpeakingTranscript>({ status: 'none' });
  /** The words so far while speaking (live stream only). */
  const [liveText, setLiveText] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [take, setTake] = useState<Blob | null>(null);
  const startedAt = useRef<number | null>(null);
  const liveRef = useRef<LiveTranscriber | null>(null);
  const generation = useRef(0);

  // Leaving the exercise mid-take: nothing is kept, the microphone is released.
  useEffect(() => () => { liveRef.current?.abort(); generation.current++; cancelRecording(); }, [cancelRecording]);

  const transcribe = useCallback(async (blob: Blob, live: Promise<string> | null, seconds: number) => {
    const gen = ++generation.current;
    const began = Date.now();
    setTranscript({ status: 'transcribing' });
    const outcome = await transcribeTakeOutcome({
      live,
      upload: (liveError) => transcribeAudio(blob, { liveError }),
      isOnline: online,
    });
    if (gen !== generation.current) return;
    if (outcome.liveError && liveFailureInvalidatesKey(outcome.liveError)) resetLiveSessionCache();
    // Enums + durations only (never the transcript).
    track('lesson.speaking_transcribed', {
      via: outcome.kind === 'done' ? outcome.via : outcome.kind,
      live_error: live ? liveErrorKind(outcome.liveError) : 'none',
      ms: Date.now() - began,
      seconds,
      exercise_type: exerciseType,
    });
    if (outcome.kind === 'done') {
      setTranscript(outcome.text.trim() ? { status: 'done', text: outcome.text.trim(), via: outcome.via } : { status: 'failed' });
    } else {
      setTranscript({ status: outcome.kind });
    }
  }, [exerciseType]);

  const start = useCallback(async () => {
    liveRef.current?.abort();
    generation.current++;
    setTranscript({ status: 'none' });
    setLiveText('');
    setTake(null);
    setElapsed(0);
    const live = online() && !liveSessionUnavailable()
      ? new LiveTranscriber(getLiveSession(undefined, Date.now(), SPEAKING_LIVE_KEY_MARGIN_MS), {
        finishTimeoutMs: SPEAKING_FINISH_TIMEOUT_MS,
        onUpdate: (t) => setLiveText(transcriptText(t)),
      })
      : null;
    liveRef.current = live;
    startedAt.current = Date.now();
    const ok = await startRecording(undefined, {
      onChunk: (chunk) => live?.push(chunk),
      onStop: (blob) => {
        const ms = startedAt.current ? Date.now() - startedAt.current : 0;
        setDurationMs(ms);
        setTake(blob);
        let p: Promise<string> | null = null;
        if (live) {
          p = live.finish();
          p.catch(() => { /* falls back to the upload */ });
        }
        void transcribe(blob, p, Math.round(ms / 1000));
      },
    });
    if (!ok) live?.abort();
  }, [startRecording, transcribe]);

  const stop = stopRecording;

  // The timer, and the automatic stop at SPEAKING_MAX_SECONDS.
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      const s = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
      setElapsed(s);
      if (s >= SPEAKING_MAX_SECONDS) stopRecording();
    }, 250);
    return () => clearInterval(timer);
  }, [isRecording, stopRecording]);

  /** "Couldn't transcribe — tap to retry": the same take, upload only. */
  const retry = useCallback(() => {
    if (take) void transcribe(take, null, Math.round(durationMs / 1000));
  }, [take, durationMs, transcribe]);

  /** 🔁 Try again / a fresh take: nothing pending. */
  const reset = useCallback(() => {
    liveRef.current?.abort();
    generation.current++;
    setTranscript({ status: 'none' });
    setLiveText('');
    setTake(null);
    setElapsed(0);
  }, []);

  return {
    isRecording,
    audioLevel: recorder.audioLevel,
    error: recorder.error,
    elapsed,
    durationMs,
    take,
    liveText,
    transcript,
    start,
    stop,
    retry,
    reset,
  };
}
