/**
 * "🎤 Practise saying it" beside a Sentence Coach answer's sentence (docs/CHAT.md "Chat ↔ Coach";
 * shared/coach/practise.ts): ▶ plays the sentence (practice TTS, cached on the device), 🎤 records a
 * take through the voice boxes' pipeline (`useVoiceDictation`: live Soniox transcript while speaking,
 * upload fallback, "Couldn't transcribe — tap to retry"); tap 🎤 again, press Enter or tap anywhere
 * (the card) to stop, and the take is checked against the sentence like a spoken answer — the
 * compact "You said" row (`YouSaidRow`) with the characters that differ marked, then 🔁 Try again.
 * Nothing is stored (no review event, no recording kept). Lab: `PractiseSentenceRow` in
 * ui/coach/CoachPractise.kt.
 */
import { useEffect, useRef, useState } from 'react';
import {
  COACH_PRACTISE_AGAIN,
  COACH_PRACTISE_CHECKING,
  COACH_PRACTISE_EMPTY,
  COACH_PRACTISE_LABEL,
  COACH_PRACTISE_LISTEN,
  COACH_PRACTISE_LISTENING,
  COACH_PRACTISE_STOP,
  practiseBlockNote,
  practiseMicEnabled,
  practiseOutcome,
  practiseSentence,
  type PractisedSentence,
} from '@shared/coach';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { useLessonSpeak } from '../editor/useLessonSpeak';
import { YouSaidFailed, YouSaidRow } from '../study/YouSaid';
import { track } from '../../services/analytics';

export function PractiseSentence({ hanzi, testId = 'coach-practise' }: { hanzi: string; testId?: string }) {
  const speak = useLessonSpeak();
  const [result, setResult] = useState<PractisedSentence | null>(null);
  const target = useRef(hanzi);
  target.current = hanzi;
  const dictation = useVoiceDictation({
    surface: 'coach_practise',
    value: '',
    onChange: () => {},
    autoSubmit: true,
    onSubmit: (answer) => {
      const p = practiseSentence(answer.text, target.current);
      setResult(p);
      track('coach.practise_say', { result: practiseOutcome(p, null) });
    },
  });
  const { state } = dictation;
  const listening = state.phase === 'listening';
  const finishing = state.phase === 'finishing';
  const failed = state.phase === 'failed';

  // A take that gave nothing is reported once (a result is reported when it lands).
  const reportedFailure = useRef(false);
  useEffect(() => {
    if (failed && !reportedFailure.current) {
      reportedFailure.current = true;
      track('coach.practise_say', { result: practiseOutcome(null, state.failure) });
    }
    if (!failed) reportedFailure.current = false;
  }, [failed, state.failure]);

  const micRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef(dictation.stop);
  stopRef.current = dictation.stop;
  // While recording: Enter, or a tap anywhere but 🎤 itself (the card, the page), stops the take.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        stopRef.current();
      }
    };
    const onTap = (e: PointerEvent) => {
      if (micRef.current && e.target instanceof Node && micRef.current.contains(e.target)) return;
      stopRef.current();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onTap, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onTap, true);
    };
  }, [listening]);

  const toggle = () => {
    if (listening) return dictation.stop();
    if (finishing) return;
    setResult(null);
    dictation.say();
  };

  const blockedNote = practiseBlockNote(state.blocked);
  const micEnabled = practiseMicEnabled(state.blocked);

  return (
    <div className="coach-practise" data-testid={testId} data-phase={result && !listening ? 'result' : state.phase}>
      <div className="coach-practise-row">
        <button
          type="button"
          className="btn btn-secondary coach-practise-listen"
          onClick={() => speak(hanzi)}
          aria-label={`${COACH_PRACTISE_LISTEN}: ${hanzi}`}
          title={COACH_PRACTISE_LISTEN}
          data-testid={`${testId}-listen`}
        >
          <span aria-hidden="true">▶</span>
        </button>
        <button
          ref={micRef}
          type="button"
          className={`btn ${listening ? 'btn-error is-listening' : 'btn-secondary'} coach-practise-mic`}
          onClick={toggle}
          disabled={!micEnabled || finishing}
          aria-pressed={listening}
          aria-label={listening ? `${COACH_PRACTISE_STOP} — check what I said` : `${COACH_PRACTISE_LABEL}: ${hanzi}`}
          data-testid={`${testId}-mic`}
        >
          {finishing ? (
            <><span className="spinner coach-practise-spinner" aria-hidden="true" /> {COACH_PRACTISE_CHECKING}</>
          ) : listening ? (
            <><span aria-hidden="true">⏹</span> {COACH_PRACTISE_STOP}</>
          ) : result || failed ? (
            <><span aria-hidden="true">🔁</span> {COACH_PRACTISE_AGAIN}</>
          ) : (
            <><span aria-hidden="true">🎤</span> {COACH_PRACTISE_LABEL}</>
          )}
        </button>
      </div>
      {listening && (
        <div className="coach-practise-live" aria-live="polite" data-testid={`${testId}-live`}>
          {dictation.finalText || dictation.partialText ? (
            <span lang="zh-CN">
              {dictation.finalText}
              <span className="coach-practise-partial">{dictation.partialText}</span>
            </span>
          ) : (
            <span className="coach-practise-hint">{COACH_PRACTISE_LISTENING}</span>
          )}
        </div>
      )}
      {result && !listening && !finishing && (
        <YouSaidRow transcript={result.said} correct={hanzi} verdict={result.verdict} testId={`${testId}-result`} />
      )}
      {failed && state.failure !== 'empty' && (
        <YouSaidFailed onRetry={dictation.retryUpload} note="Or record it again" testId={`${testId}-retry`} />
      )}
      {failed && state.failure === 'empty' && (
        <p className="coach-practise-hint" role="status" data-testid={`${testId}-empty`}>{COACH_PRACTISE_EMPTY}</p>
      )}
      {blockedNote && !listening && (
        <p className="coach-practise-hint" data-testid={`${testId}-blocked`}>{blockedNote}</p>
      )}
    </div>
  );
}
