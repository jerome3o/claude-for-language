/**
 * 🎤 Read it again — in Hard mode's answer in place (after 👁 Show answer; docs/STUDY_SESSION.md "Hard mode"):
 * Jerome: "when I get it wrong and show the answer, I'd still like to read it here and see if I can get it right
 * with the transcription."
 *
 * The take goes through the question's pipeline (`useVoiceDictation`: the live Soniox words as he speaks, the upload
 * when live gives nothing, "Couldn't transcribe — tap to retry" with the same take) and is judged with the READ
 * card's own rule (`compareTranscription` → `hardModeReadAgainResult`, shared/study/hardMode.ts), shown as the
 * "You said" row (its characters marked) under ✓ Right this time / ≈ Nearly / ✗ Not quite, and FELT like the
 * question's check (`hardModeQuestionFeel`). Practice only: nothing here touches the card — it stays a miss
 * (Good / Easy and the pass's Got it stay greyed), no review, no take kept. Lab: `ReadAgainBlock` in ui/study/HardModeUi.kt.
 */
import { useEffect, useRef, useState } from 'react';
import {
  HARD_MODE_CHECKING,
  HARD_MODE_READ_AGAIN_EMPTY,
  HARD_MODE_READ_AGAIN_LISTENING,
  HARD_MODE_READ_AGAIN_PRACTICE,
  HARD_MODE_READ_AGAIN_RESULT,
  HARD_MODE_READ_AGAIN_STOP,
  hardModeQuestionFeel,
  hardModeReadAgainLabel,
  hardModeReadAgainResult,
  hardModeReadAgainVerdict,
  type ReadAgainResult,
} from '@shared/study/hardMode';
import { compareTranscription } from '@shared/recordings/transcript';
import { tidySpokenTranscript, type AnswerVerdict } from '@shared/cards/answer';
import { practiseBlockNote, practiseMicEnabled } from '@shared/coach';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { track } from '../../services/analytics';
import { studyFeel } from '../../services/studyFeel';
import { YouSaidFailed, YouSaidRow } from './YouSaid';

export interface HardModeReadAgainProps {
  /** The answer on show (what he reads aloud). */
  hanzi: string;
  pinyin: string | null;
  cardType: string;
  /** session | homework (analytics). */
  where: 'session' | 'homework';
  /** A take starts (stop the card's own clip so the microphone doesn't hear it). */
  onStart?: () => void;
}

interface ReadAgainTakeView {
  said: string;
  result: ReadAgainResult;
  verdict: AnswerVerdict;
}

export function HardModeReadAgain({ hanzi, pinyin, cardType, where, onStart }: HardModeReadAgainProps) {
  const [take, setTake] = useState<ReadAgainTakeView | null>(null);
  const [tries, setTries] = useState(0);
  const latest = useRef({ hanzi, pinyin, cardType, where, tries });
  latest.current = { hanzi, pinyin, cardType, where, tries };
  const dictation = useVoiceDictation({
    surface: 'hard_mode_read_again',
    value: '',
    onChange: () => {},
    autoSubmit: true,
    onSubmit: (answer) => {
      const l = latest.current;
      const c = compareTranscription(answer.text, l.hanzi, l.pinyin ?? '');
      const said = tidySpokenTranscript(c.transcribedHanzi, l.hanzi) || c.transcribedHanzi;
      const result = hardModeReadAgainResult(c);
      const n = l.tries + 1;
      setTake({ said, result, verdict: hardModeReadAgainVerdict(c, said, l.hanzi) });
      setTries(n);
      studyFeel(hardModeQuestionFeel(result));
      track('study.hard_mode_read_again', { result, tries: n, via: answer.via ?? 'none', card_type: l.cardType, where: l.where });
    },
  });
  const { state } = dictation;
  const listening = state.phase === 'listening';
  const finishing = state.phase === 'finishing';
  const failed = state.phase === 'failed';

  // A take that gave nothing is reported once.
  const reported = useRef(false);
  useEffect(() => {
    if (failed && !reported.current) {
      reported.current = true;
      const l = latest.current;
      track('study.hard_mode_read_again', { result: state.failure === 'empty' ? 'empty' : 'failed', tries: l.tries, via: 'none', card_type: l.cardType, where: l.where });
    }
    if (!failed) reported.current = false;
  }, [failed, state.failure]);

  // Enter stops the take (like the sentence rows' 🎤).
  const stopRef = useRef(dictation.stop);
  stopRef.current = dictation.stop;
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        stopRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening]);

  const enabled = practiseMicEnabled(state.blocked);
  const blockNote = practiseBlockNote(state.blocked);
  const onMic = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (listening) return dictation.stop();
    if (finishing) return;
    setTake(null);
    onStart?.();
    dictation.say();
  };

  return (
    <div className="hard-read-again" data-testid="hard-read-again" data-phase={state.phase} onClick={(e) => e.stopPropagation()}>
      {listening ? (
        <div className="hard-read-again-live" aria-live="polite" data-testid="hard-read-again-live">
          {dictation.finalText || dictation.partialText ? (
            <span lang="zh-CN">
              {dictation.finalText}
              <span className="hard-read-again-partial">{dictation.partialText}</span>
            </span>
          ) : (
            <span className="hard-read-again-hint">{HARD_MODE_READ_AGAIN_LISTENING}</span>
          )}
        </div>
      ) : finishing ? (
        <p className="hard-read-again-checking" role="status" data-testid="hard-read-again-checking">
          <span className="spinner hard-feedback-spinner" aria-hidden="true" /> {HARD_MODE_CHECKING}
        </p>
      ) : failed ? (
        state.failure === 'empty'
          ? <p className="hard-read-again-hint" role="status" data-testid="hard-read-again-empty">{HARD_MODE_READ_AGAIN_EMPTY}</p>
          : <YouSaidFailed onRetry={dictation.retryUpload} note="Or read it again" testId="hard-read-again-retry" signedOut={state.failure === 'signed_out'} />
      ) : take ? (
        <div className={`hard-read-again-result hard-read-again-result--${take.result}`} data-testid="hard-read-again-result" data-result={take.result} aria-live="polite">
          <p className="hard-read-again-title">{HARD_MODE_READ_AGAIN_RESULT[take.result]}</p>
          <YouSaidRow transcript={take.said} correct={hanzi} verdict={take.verdict} testId="hard-read-again-said" />
          {take.result === 'right' && <p className="hard-read-again-practice">{HARD_MODE_READ_AGAIN_PRACTICE}</p>}
        </div>
      ) : null}
      <button
        type="button"
        className={`btn ${listening ? 'btn-error' : 'btn-secondary'} hard-read-again-mic${listening ? ' is-listening' : ''}`}
        onClick={onMic}
        disabled={!enabled || finishing}
        aria-pressed={listening}
        title={enabled ? undefined : blockNote ?? undefined}
        data-testid="hard-read-again-mic"
      >
        <span aria-hidden="true">{listening ? '⏹' : '🎤'}</span> {listening ? HARD_MODE_READ_AGAIN_STOP : hardModeReadAgainLabel(tries)}
      </button>
      {!enabled && blockNote && <p className="hard-read-again-hint" data-testid="hard-read-again-blocked">{blockNote}</p>}
    </div>
  );
}
