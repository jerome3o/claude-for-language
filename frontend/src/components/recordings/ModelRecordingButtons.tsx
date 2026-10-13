import { useEffect, useRef, useState } from 'react';
import { tutorSaysItLabel } from '@shared/tutor-notes';
import { useAudioPlayer } from '../../hooks/useAudio';
import { getAudioWithCache } from '../../services/audioCache';
import { getModelRecordingBlob } from '../../services/modelRecordings';
import { track } from '../../services/analytics';
import './model-recording.css';

type Where = 'card' | 'notes' | 'practice';

/**
 * "▶ 明慧老师 says it" · "▶ You" — the tutor's model recording on a needs-work note next to the
 * student's own take, so he can compare (docs/RECORDING_REVIEW.md "Model recordings"). Both clips
 * come from the device cache first (the sync prefetches them), so this works offline.
 */
export function ModelRecordingButtons({
  tutorName,
  modelAudioUrl,
  recordingUrl,
  where,
}: {
  tutorName: string | null;
  modelAudioUrl: string;
  recordingUrl?: string | null;
  where: Where;
}) {
  return (
    <div className="model-rec-row" data-testid="model-recording-buttons" onClick={(e) => e.stopPropagation()}>
      <ClipButton
        label={tutorSaysItLabel(tutorName)}
        kind="tutor"
        load={() => getModelRecordingBlob(modelAudioUrl)}
        onPlay={() => track('study.tutor_model_play', { where, which: 'tutor' })}
        testId="model-rec-tutor"
      />
      {recordingUrl && (
        <ClipButton
          label="You"
          kind="mine"
          load={() => getAudioWithCache(recordingUrl)}
          onPlay={() => track('study.tutor_model_play', { where, which: 'mine' })}
          testId="model-rec-mine"
        />
      )}
    </div>
  );
}

/** A play button for a clip the caller loads itself (a private URL, a cached blob, a fresh take). */
export function ClipButton({
  label,
  kind,
  load,
  onPlay,
  testId,
}: {
  label: string;
  kind: 'tutor' | 'mine' | 'draft';
  load: () => Promise<Blob | null>;
  onPlay: () => void;
  testId: string;
}) {
  const { isPlaying, play, stop } = useAudioPlayer();
  const [state, setState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const urlRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const toggle = async () => {
    if (isPlaying) {
      stop();
      return;
    }
    if (!urlRef.current) {
      setState('loading');
      const blob = await load().catch(() => null);
      if (!blob) {
        setState('missing');
        return;
      }
      urlRef.current = URL.createObjectURL(blob);
    }
    setState('idle');
    play(urlRef.current);
    onPlay();
  };

  return (
    <button
      type="button"
      className={`model-rec-btn model-rec-${kind}${isPlaying ? ' playing' : ''}`}
      onClick={toggle}
      disabled={state === 'loading'}
      data-testid={testId}
      aria-label={`${isPlaying ? 'Stop' : 'Play'}: ${label}`}
    >
      <span aria-hidden="true">{isPlaying ? '■' : state === 'loading' ? '…' : '▶'}</span>{' '}
      <span>{state === 'missing' ? `${label} — needs a connection` : label}</span>
    </button>
  );
}
