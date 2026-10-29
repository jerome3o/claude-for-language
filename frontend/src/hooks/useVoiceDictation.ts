/**
 * The state behind a voice-first text box (`components/voice/VoiceTextInput.tsx`; rules in
 * shared/voice/dictation.ts): the typing study cards' "Say the answer" flow — the SAME controller
 * (services/spokenAnswer.ts `SpokenAnswerController`), the same live Soniox stream with the upload
 * fallback and "Couldn't transcribe — tap to retry" — without the card.
 *
 * Voice is always the default (nothing remembers that he typed last time); typing is one tap away;
 * offline / no microphone / permission denied fall back to typing with a short reason.
 * `voice_input.used` records each settled take / typed answer (enums + durations only).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { transcribeAudio } from '../api/client';
import { useAudioRecorder } from './useAudio';
import { getLiveSession, LiveTranscriber, liveSessionUnavailable, prefetchLiveSession, resetLiveSessionCache } from '../services/liveTranscription';
import { IDLE_SPOKEN, SpokenAnswerController, type SpokenAnswerState } from '../services/spokenAnswer';
import { useManualOfflineMode } from '../services/offlineMode';
import { track } from '../services/analytics';
import { liveFailureInvalidatesKey } from '@shared/transcription/soniox';
import {
  dictationAnswer,
  dictationLanguageHints,
  dictationOutcome,
  initialDictationMode,
  joinDictation,
  micErrorBlock,
  typedOutcome,
  type DictationMode,
  type DictationSource,
  type DictationState,
  type VoiceBlock,
} from '@shared/voice/dictation';

export interface DictatedAnswer {
  text: string;
  /** spoken = submitted as heard; edited = a transcript changed in the box; typed. */
  source: DictationSource;
  /** What was heard (null when typed). */
  transcript: string | null;
  /** How a spoken take was transcribed: live | upload (none when typed). */
  via?: string;
}

export interface VoiceDictationOptions {
  /** Where the box is (analytics enum: lesson_translate, coach, chat…). */
  surface: string;
  /** The typed box's text (controlled by the caller). */
  value: string;
  onChange: (value: string) => void;
  onSubmit: (answer: DictatedAnswer) => void;
  defaultMode?: DictationMode;
  /** The answer's language: zh (default) or en — the transcriber's hints. */
  lang?: 'zh' | 'en';
  /** Submit as soon as the take is transcribed (no review). Off by default. */
  autoSubmit?: boolean;
  /** Override the connection state (tests / callers that know better). */
  online?: boolean;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
const navigatorOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

function voiceSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function useVoiceDictation(opts: VoiceDictationOptions) {
  const latest = useRef(opts);
  latest.current = opts;
  const recorder = useAudioRecorder();
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const browserOnline = useSyncExternalStore(subscribeOnline, navigatorOnline, () => true);
  const manualOffline = useManualOfflineMode();
  const online = opts.online ?? (browserOnline && !manualOffline);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  // A microphone that failed to open: typing, with why (cleared by a 🎤 that works).
  const [micBlock, setMicBlock] = useState<VoiceBlock | null>(null);
  useEffect(() => {
    if (recorder.errorName) setMicBlock(micErrorBlock(recorder.errorName));
  }, [recorder.errorName]);
  const supported = useMemo(voiceSupported, []);
  const blocked: VoiceBlock | null = !supported ? 'unsupported' : !online ? 'offline' : micBlock;

  const [mode, setMode] = useState<DictationMode>(() => initialDictationMode(opts.defaultMode, !supported ? 'unsupported' : null));
  const [spoken, setSpoken] = useState<SpokenAnswerState>(IDLE_SPOKEN);
  /** What ✏️ Edit put in the box (null = nothing spoken): unchanged = still a spoken answer. */
  const filled = useRef<string | null>(null);
  /** Text typed before going back to 🎤: the take is joined onto it. */
  const prefix = useRef('');
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  /** The latest take's transcription path (reported just before its answer is delivered). */
  const lastVia = useRef('none');

  const report = useCallback((outcome: string, props: Partial<Record<'via' | 'live_error' | 'speech_ms' | 'ms', string | number>> = {}) => {
    track('voice_input.used', {
      surface: latest.current.surface,
      outcome,
      via: 'none',
      live_error: 'none',
      speech_ms: 0,
      ms: 0,
      blocked: blockedRef.current ?? 'none',
      ...props,
    });
  }, []);

  const controller = useMemo(() => new SpokenAnswerController({
    startRecorder: (hooks) => recorderRef.current.startRecording(localStorage.getItem('preferredMicDeviceId') || undefined, hooks, false),
    stopRecorder: () => recorderRef.current.stopRecording(),
    cancelRecorder: () => recorderRef.current.cancelRecording(),
    discardTake: () => recorderRef.current.clearRecording(),
    createLive: (onUpdate) => (liveSessionUnavailable()
      ? null
      : new LiveTranscriber(getLiveSession(), {
        languageHints: dictationLanguageHints(latest.current.lang),
        onUpdate: (t) => onUpdate(t.finalText, t.partialText),
      })),
    upload: (take, liveError) => transcribeAudio(take, { liveError }),
    isOnline: () => onlineRef.current && navigatorOnline(),
    skipReview: () => !!latest.current.autoSubmit,
    onState: setSpoken,
    onResult: (answer) => {
      const text = joinDictation(prefix.current, answer.text);
      prefix.current = '';
      if (answer.submit) {
        filled.current = null;
        latest.current.onSubmit({ text, source: 'spoken', transcript: answer.transcript, via: lastVia.current });
        return;
      }
      // ✏️ Edit: into the box, focused; still "spoken" until he changes it.
      filled.current = text;
      latest.current.onChange(text);
      setMode('type');
    },
    onLiveError: (reason) => {
      console.warn('[voice input] live transcription gave nothing, uploaded instead:', reason);
      if (liveFailureInvalidatesKey(reason)) resetLiveSessionCache();
    },
    track: (result, p) => {
      // A submit is reported when it lands; the controller's own call covers takes that end otherwise.
      lastVia.current = p.via;
      const outcome = dictationOutcome(result);
      if (!outcome) return;
      report(outcome, { via: p.via, live_error: p.live_error, speech_ms: p.speech_ms, ms: p.ms });
    },
  }), [report]);

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => { if (online && supported) prefetchLiveSession(); }, [online, supported]);
  // Going offline mid-take: the take is thrown away (the box says why).
  useEffect(() => {
    if (blocked === 'offline' && (spoken.phase === 'listening' || spoken.phase === 'review')) controller.cancel();
  }, [blocked, spoken.phase, controller]);

  const state: DictationState = {
    mode: blocked ? 'type' : mode,
    phase: spoken.phase === 'editing' ? 'review' : spoken.phase,
    failure: spoken.failure,
    blocked,
  };

  const start = useCallback(() => {
    setMicBlock(null);
    void controller.start();
  }, [controller]);

  return {
    state,
    /** Confirmed so far (black) and the provisional tail (grey), while listening; the transcript on review. */
    finalText: joinDictation(prefix.current, spoken.finalText),
    partialText: spoken.partialText,
    listening: spoken.phase === 'listening',
    busy: spoken.phase === 'listening' || spoken.phase === 'finishing',
    level: recorder.audioLevel,
    /** 🎤 Say it (from voice idle, a failed take, or the typing box's 🎤 — typed text stays as a prefix). */
    say: () => {
      if (state.mode === 'type') {
        prefix.current = latest.current.value.trim();
        filled.current = null;
        setMode('voice');
      }
      start();
    },
    stop: () => controller.stop(),
    cancel: () => {
      controller.cancel();
      prefix.current = '';
    },
    retake: () => { setMicBlock(null); void controller.retake(); },
    retryUpload: () => void controller.retry(),
    edit: () => controller.edit(),
    /** ✏️ Type: the keyboard (a take under way is thrown away). */
    type: () => {
      if (spoken.phase !== 'idle') controller.cancel();
      prefix.current = '';
      setMode('type');
    },
    /** ✓ Submit: the transcript on review, or the typed box. */
    submit: () => {
      const answer = dictationAnswer(state, spoken.finalText, latest.current.value, filled.current);
      if (!answer) return;
      if (state.mode === 'voice') {
        controller.submit(); // reported + delivered through onResult
        return;
      }
      report(typedOutcome(answer.source));
      latest.current.onSubmit({ text: answer.text, source: answer.source, transcript: filled.current });
      filled.current = null;
    },
    canSubmit: dictationAnswer(state, spoken.finalText, opts.value, filled.current) != null,
    /** Reset after the caller consumed an answer (next exercise): voice again, nothing pending. */
    reset: () => {
      controller.cancel();
      filled.current = null;
      prefix.current = '';
      setMode(initialDictationMode(latest.current.defaultMode, blockedRef.current));
    },
  };
}

export type VoiceDictation = ReturnType<typeof useVoiceDictation>;
