/**
 * The recorded half of a free-speaking exercise (oral_expression "Speak — recorded 🎙", speak "Say it
 * out loud"; docs/STUDY_SESSION.md "Claude checks your speaking"):
 *
 *   🎙 → Recording… 0:42 / ~0:30  (the words appear as they are said) → ■
 *   🎤 You said: 你好，你就是…sorry，你就是新来的Annie吧？…      ← the transcript, tappable Chinese
 *   ▶ Listen back · 🎙 Again · Done
 *   → Claude's check: the task's parts ✓ ~ ✗, a cleaner version, ≤ 4 tips with the better words
 *   One way to say it: … 🔊
 *   ✗ Not quite   ✓ I said it well      ← the suggested one ringed; 🔁 Try again · 💬 Ask about this
 *
 * Transcription: live while speaking, else the upload (useSpeakingTake); both failing → "Couldn't
 * transcribe — tap to retry"; offline → the recording is kept and the server checks it once the
 * attempt uploads. The check never blocks the buttons. Lab: SpeakingAnswerView (ui/lessons).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExerciseAnswer, LessonSentence } from '@shared/lesson';
import { speakingClock, speakingTakeLine } from '@shared/lesson/speakingTake';
import { useSpeakingTake } from '../../hooks/useSpeakingTake';
import { useLessonAnswerCheck } from './useLessonAnswerCheck';
import { ExplorableText } from '../explorer/ExplorableText';
import { createAudioPlayer } from '../../utils/audioPlayback';

export function SpeakingAnswer(props: {
  exerciseType: 'oral_expression' | 'speak';
  prompt: string;
  hints?: string[];
  question?: string;
  example?: LessonSentence | null;
  targetSeconds?: number;
  /** Where the recording is kept for the tutor (oral expression in a real run); none = not kept. */
  mediaKey?: string;
  focus?: string;
  speak: (text: string) => void;
  /** Labels of the two self-assessment buttons. */
  gotItLabel?: string;
  /** "I've said it" without a microphone (speak); oral expression offers it only when recording fails. */
  allowWithoutRecording?: boolean;
  onNext: (correct: boolean, answer: ExerciseAnswer, recording?: Blob) => void;
}) {
  const { exerciseType, prompt, hints, question, example, targetSeconds = 30, mediaKey, focus, speak, onNext } = props;
  const take = useSpeakingTake(exerciseType);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const playerRef = useRef(createAudioPlayer());
  const checkedFor = useRef<string | null>(null);
  const ac = useLessonAnswerCheck({
    exerciseType, promptEn: prompt, modelAnswer: example?.hanzi ?? '', modelPinyin: example?.pinyin, focus, hints, question,
    onRetry: () => { setDone(false); setSkipped(false); checkedFor.current = null; take.reset(); },
  });

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  const text = take.transcript.status === 'done' ? take.transcript.text : '';
  // The check starts once the answer is final (Done) and its transcript exists — whichever comes last.
  useEffect(() => {
    if (!done || skipped || !text || checkedFor.current === text) return;
    checkedFor.current = text;
    ac.onFinal(text, 'spoken');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, skipped, text]);

  function start() {
    playerRef.current.stop();
    void take.start();
  }

  function finish(withoutRecording = false) {
    if (withoutRecording) setSkipped(true);
    setDone(true);
    if (example) speak(example.hanzi);
  }

  const blob = skipped ? null : take.take;
  const answer = (): ExerciseAnswer => ac.report({
    self_assessed: true,
    ...(text && !skipped ? { text, input: 'spoken' as const } : {}),
    recording: blob && mediaKey ? { media_key: mediaKey, duration_ms: take.durationMs, mime: blob.type || 'audio/webm' } : undefined,
  });
  const listen = () => { if (blob) playerRef.current.play(blob, { label: 'lesson-recording' }); };

  const transcriptBlock = (
    <TranscriptBlock state={take.transcript} onRetry={take.retry}>
      {done && text ? ac.view(text, speak) : null}
    </TranscriptBlock>
  );

  if (!done) {
    return (
      <div className="oral-recorder">
        {take.isRecording ? (
          <>
            <div className="rec-status">
              <span className="rec-dot" /> Recording… {speakingClock(take.elapsed)} <span className="rec-target">/ ~{speakingClock(targetSeconds)}</span>
            </div>
            <div className="rec-level"><div style={{ width: `${Math.round(take.audioLevel * 100)}%` }} /></div>
            {take.liveText && <div className="speaking-live" lang="zh-CN" data-testid="speaking-live">{take.liveText}</div>}
            <button className="rec-btn stop" onClick={take.stop} aria-label="Stop recording">■</button>
          </>
        ) : take.take ? (
          <>
            <div className="rec-status">Recorded {speakingClock(Math.round(take.durationMs / 1000))}</div>
            {transcriptBlock}
            <div className="exercise-actions">
              <button className="practice-btn" onClick={listen}>▶ Listen back</button>
              <button className="practice-btn" onClick={start}>🎙 Again</button>
            </div>
            <div className="exercise-actions">
              <button className="practice-btn primary" onClick={() => finish()} data-testid="speaking-done">Done</button>
            </div>
          </>
        ) : (
          <>
            <button className="rec-btn" onClick={start} aria-label="Start recording" data-testid="speaking-record">🎙</button>
            <div className="rec-hint">Tap to record your answer (about {targetSeconds} seconds)</div>
            {take.error && <p className="result-explanation">{take.error}</p>}
            {(take.error || props.allowWithoutRecording) && (
              <div className="exercise-actions">
                <button className="practice-btn" onClick={() => finish(true)}>
                  {props.allowWithoutRecording && !take.error ? '🎤 I said it without recording' : 'Say it without recording'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {blob && (
        <div className="exercise-actions">
          <button className="practice-btn" onClick={listen}>▶ Your answer</button>
        </div>
      )}
      {!skipped && take.take && transcriptBlock}
      {example && (
        <>
          <p className="result-explanation">One way to say it:</p>
          <div className="translate-ref">
            <div className="translate-ref-hanzi" onClick={() => speak(example.hanzi)} lang="zh-CN">{example.hanzi} 🔊</div>
            {example.pinyin && <div className="translate-ref-pinyin">{example.pinyin}</div>}
            {example.english && <div className="contrast-english">{example.english}</div>}
          </div>
        </>
      )}
      {mediaKey && blob && <p className="result-explanation small">Your tutor can listen to this recording.</p>}
      <div className="exercise-actions">
        <button className={`practice-btn${ac.suggested === 'missed_it' ? ' suggested' : ''}`} onClick={() => onNext(false, answer(), blob ?? undefined)} data-testid="lesson-missed-it">✗ Not quite</button>
        <button className={`practice-btn primary${ac.suggested === 'got_it' ? ' suggested' : ''}`} onClick={() => onNext(true, answer(), blob ?? undefined)} data-testid="lesson-got-it">{props.gotItLabel ?? '✓ I said it well'}</button>
      </div>
    </>
  );
}

/** "🎤 You said" — the transcript, or where it is (writing it down / saved offline / tap to retry). */
function TranscriptBlock({ state, onRetry, children }: {
  state: ReturnType<typeof useSpeakingTake>['transcript'];
  onRetry: () => void;
  children?: ReactNode;
}) {
  if (state.status === 'none') return null;
  return (
    <div className="speak-transcript" data-testid="speaking-transcript" data-status={state.status}>
      <div className="speak-transcript-label">🎤 You said</div>
      {state.status === 'done' ? (
        <div className="speak-transcript-text" lang="zh-CN"><ExplorableText text={state.text} source="lesson" /></div>
      ) : state.status === 'failed' ? (
        <button type="button" className="speaking-transcript-retry" onClick={onRetry} data-testid="speaking-transcript-retry">
          ⚠ {speakingTakeLine('failed')}
        </button>
      ) : (
        <div className="speaking-transcript-state" role="status">{speakingTakeLine(state.status)}</div>
      )}
      {children}
    </div>
  );
}
