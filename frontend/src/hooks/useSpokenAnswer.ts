/**
 * The 🎤 on a typing card (services/spokenAnswer.ts): wires the controller to the card's
 * recorder (the SAME `useAudioRecorder` a read card records with — so the take lands in
 * `audioBlob` and goes up with the review), the live Soniox transcriber and the upload path.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { transcribeAudio } from '../api/client';
import { getLiveSession, LiveTranscriber, liveSessionUnavailable, resetLiveSessionCache } from '../services/liveTranscription';
import { IDLE_SPOKEN, SpokenAnswerController, type SpokenAnswerState } from '../services/spokenAnswer';
import { readSpokenAutoSubmit } from '../services/spokenAnswerPrefs';
import { liveFailureInvalidatesKey } from '@shared/transcription/soniox';
import { track } from '../services/analytics';

interface Recorder {
  startRecording: (deviceId?: string, live?: { onChunk: (chunk: Blob) => void; onStop: (take: Blob) => void }, keepPrevious?: boolean) => Promise<boolean>;
  stopRecording: () => void;
  cancelRecording: () => void;
  clearRecording: () => void;
  /** Put a take back (a cancelled "Say it again" restores the one from before it). */
  restoreRecording: (take: Blob | null) => void;
}

export function useSpokenAnswer(opts: {
  recorder: Recorder;
  micDeviceId?: string;
  cardType: string;
  /** Online and not forced offline. */
  online: boolean;
  /** The recorder's current take (`audioBlob`): what a "Say it again" keeps until its new take lands. */
  currentTake: Blob | null;
  onResult: (text: string, submit: boolean, again: boolean) => void;
}) {
  const [state, setState] = useState<SpokenAnswerState>(IDLE_SPOKEN);
  const latest = useRef(opts);
  latest.current = opts;
  // The take from before a "Say it again" — put back when it is cancelled, saved with a rating made meanwhile.
  const previousTake = useRef<Blob | null>(null);

  const controller = useMemo(() => new SpokenAnswerController({
    startRecorder: (hooks, { keepPrevious }) => latest.current.recorder.startRecording(latest.current.micDeviceId || undefined, hooks, keepPrevious),
    stopRecorder: () => latest.current.recorder.stopRecording(),
    cancelRecorder: () => latest.current.recorder.cancelRecording(),
    discardTake: () => latest.current.recorder.clearRecording(),
    restorePrevious: () => latest.current.recorder.restoreRecording(previousTake.current),
    createLive: (onUpdate) => (liveSessionUnavailable()
      ? null
      : new LiveTranscriber(getLiveSession(), { onUpdate: (t) => onUpdate(t.finalText, t.partialText) })),
    upload: (take, liveError) => transcribeAudio(take, { liveError }),
    isOnline: () => latest.current.online && navigator.onLine,
    autoSubmit: readSpokenAutoSubmit,
    onState: setState,
    onResult: (text, submit, again) => latest.current.onResult(text, submit, again),
    onLiveError: (reason) => {
      console.warn('[spoken answer] live transcription gave nothing, uploaded instead:', reason);
      if (liveFailureInvalidatesKey(reason)) resetLiveSessionCache();
    },
    // Enums, durations and a boolean only — never the transcript.
    track: (result, props) => track('study.answer_spoken', { card_type: latest.current.cardType, result, ...props }),
  }), []);

  useEffect(() => () => controller.dispose(), [controller]);

  return {
    ...state,
    listening: state.phase === 'listening',
    busy: state.phase === 'listening' || state.phase === 'finishing',
    /** Under way: listening, finishing, or a failed / empty take still on screen. */
    active: state.phase !== 'idle',
    start: () => void controller.start(),
    /** "🎤 Say it again" on the answer side: the take so far is kept until the new one lands. */
    startAgain: () => {
      if (controller.current.phase === 'idle') previousTake.current = latest.current.currentTake;
      void controller.start({ again: true });
    },
    /** The take a rating keeps: during a "Say it again", the one from before it. */
    keptTake: (): Blob | null => (controller.current.again ? previousTake.current : latest.current.currentTake),
    stop: () => controller.stop(),
    cancel: () => controller.cancel(),
    retry: () => void controller.retry(),
  };
}
