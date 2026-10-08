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
  startRecording: (deviceId?: string, live?: { onChunk: (chunk: Blob) => void; onStop: (take: Blob) => void }) => Promise<boolean>;
  stopRecording: () => void;
  cancelRecording: () => void;
  clearRecording: () => void;
}

export function useSpokenAnswer(opts: {
  recorder: Recorder;
  micDeviceId?: string;
  cardType: string;
  /** Online and not forced offline. */
  online: boolean;
  onResult: (text: string, submit: boolean) => void;
}) {
  const [state, setState] = useState<SpokenAnswerState>(IDLE_SPOKEN);
  const latest = useRef(opts);
  latest.current = opts;

  const controller = useMemo(() => new SpokenAnswerController({
    startRecorder: (hooks) => latest.current.recorder.startRecording(latest.current.micDeviceId || undefined, hooks),
    stopRecorder: () => latest.current.recorder.stopRecording(),
    cancelRecorder: () => latest.current.recorder.cancelRecording(),
    discardTake: () => latest.current.recorder.clearRecording(),
    createLive: (onUpdate) => (liveSessionUnavailable()
      ? null
      : new LiveTranscriber(getLiveSession(), { onUpdate: (t) => onUpdate(t.finalText, t.partialText) })),
    upload: (take, liveError) => transcribeAudio(take, { liveError }),
    isOnline: () => latest.current.online && navigator.onLine,
    autoSubmit: readSpokenAutoSubmit,
    onState: setState,
    onResult: (text, submit) => latest.current.onResult(text, submit),
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
    start: () => void controller.start(),
    stop: () => controller.stop(),
    cancel: () => controller.cancel(),
    retry: () => void controller.retry(),
  };
}
