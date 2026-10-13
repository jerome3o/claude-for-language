import { useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from '../../hooks/useAudio';
import { getModelRecordingBlob } from '../../services/modelRecordings';
import { ClipButton } from './ModelRecordingButtons';
import './model-recording.css';

/** What the tutor has in the box: a new take to upload, or the saved clip marked for removal. */
export interface ModelRecordingDraft {
  blob: Blob | null;
  durationMs: number | null;
  removeSaved: boolean;
}

export const EMPTY_MODEL_DRAFT: ModelRecordingDraft = { blob: null, durationMs: null, removeSaved: false };

/** A model answer is a word or a sentence: stop by itself after a minute (the server's cap). */
export const MODEL_RECORDING_MAX_MS = 60_000;

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "🎤 Record how it should sound" — the tutor's own model answer on a needs-work mark
 * (docs/RECORDING_REVIEW.md "Model recordings"). Tap to record, tap to stop, ▶ to hear it back,
 * 🔁 to record again; nothing is uploaded until the mark is saved. A saved clip can be played,
 * replaced or removed. Optional — a mark can still be words only.
 */
export function ModelRecorder({
  savedUrl,
  value,
  onChange,
  studentName,
  disabled,
  onRecordingChange,
}: {
  savedUrl: string | null;
  value: ModelRecordingDraft;
  onChange: (next: ModelRecordingDraft) => void;
  studentName?: string | null;
  disabled?: boolean;
  /** True while the microphone is on (the caller holds Save until the take is in). */
  onRecordingChange?: (recording: boolean) => void;
}) {
  const recorder = useAudioRecorder();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const stoppedAt = useRef<number | null>(null);
  const lastBlob = useRef<Blob | null>(null);

  // Tick the clock while recording; stop by itself at the cap.
  useEffect(() => {
    if (startedAt === null) return;
    const t = window.setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MODEL_RECORDING_MAX_MS) stop();
    }, 200);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);

  // A finished take arrives after the recorder stops.
  useEffect(() => {
    const blob = recorder.audioBlob;
    if (!blob || blob === lastBlob.current || stoppedAt.current === null) return;
    lastBlob.current = blob;
    const duration = startedAt !== null ? stoppedAt.current - startedAt : null;
    stoppedAt.current = null;
    setStartedAt(null);
    if (blob.size > 0) onChange({ blob, durationMs: duration, removeSaved: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.audioBlob]);

  const start = async () => {
    const ok = await recorder.startRecording();
    if (ok) {
      setElapsed(0);
      setStartedAt(Date.now());
    }
  };
  function stop() {
    stoppedAt.current = Date.now();
    recorder.stopRecording();
  }
  const cancel = () => {
    recorder.cancelRecording();
    stoppedAt.current = null;
    setStartedAt(null);
  };

  const recording = recorder.isRecording && startedAt !== null;
  useEffect(() => {
    onRecordingChange?.(recording);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);
  const hasSaved = !!savedUrl && !value.removeSaved;

  return (
    <div className="model-recorder" data-testid="model-recorder">
      <p className="model-recorder-title">Your recording — how it should sound</p>
      <div className="model-recorder-row">
        {recording ? (
          <>
            <button type="button" className="model-recorder-rec recording" onClick={stop} data-testid="model-recorder-stop">
              <span className="model-recorder-dot" aria-hidden="true" /> Stop · {clock(elapsed)}
            </button>
            <span className="model-recorder-level" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.round(recorder.audioLevel * 300))}%` }} />
            </span>
            <button type="button" className="model-recorder-link" onClick={cancel}>Cancel</button>
          </>
        ) : value.blob ? (
          <>
            <ClipButton
              key={value.blob.size + ':' + (value.durationMs ?? 0)}
              label={`Your take${value.durationMs ? ` · ${clock(value.durationMs)}` : ''}`}
              kind="draft"
              load={() => Promise.resolve(value.blob)}
              onPlay={() => {}}
              testId="model-recorder-play-draft"
            />
            <button type="button" className="model-recorder-link" onClick={start} disabled={disabled}>🔁 Record again</button>
            <button type="button" className="model-recorder-link" onClick={() => onChange({ ...EMPTY_MODEL_DRAFT, removeSaved: value.removeSaved })} disabled={disabled}>
              Discard
            </button>
          </>
        ) : hasSaved ? (
          <>
            <ClipButton
              key={savedUrl}
              label="Your recording"
              kind="tutor"
              load={() => getModelRecordingBlob(savedUrl!)}
              onPlay={() => {}}
              testId="model-recorder-play-saved"
            />
            <button type="button" className="model-recorder-link" onClick={start} disabled={disabled}>🔁 Record again</button>
            <button type="button" className="model-recorder-link" onClick={() => onChange({ ...value, removeSaved: true })} disabled={disabled} data-testid="model-recorder-remove">
              Remove
            </button>
          </>
        ) : (
          <>
            <button type="button" className="model-recorder-rec" onClick={start} disabled={disabled} data-testid="model-recorder-start">
              <span className="model-recorder-dot" aria-hidden="true" /> 🎤 Record it
            </button>
            {savedUrl && value.removeSaved && (
              <button type="button" className="model-recorder-link" onClick={() => onChange({ ...value, removeSaved: false })}>
                Undo remove
              </button>
            )}
          </>
        )}
      </div>
      {recorder.error && <p className="model-recorder-error" role="alert">{recorder.error}</p>}
      <p className="model-recorder-hint">
        Optional. {studentName || 'They'} will hear it next to their own take on the back of this card.
      </p>
    </div>
  );
}
