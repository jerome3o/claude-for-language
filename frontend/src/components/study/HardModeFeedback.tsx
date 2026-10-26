import {
  HARD_MODE_CHECKING, HARD_MODE_MISS_NOTE, HARD_MODE_RESULT, HARD_MODE_SHOW_ANSWER, HARD_MODE_TRY_AGAIN, HARD_MODE_UNKNOWN,
  hardModeNextLabel, hardModeSaidLine, type HardModeQuestionResult,
} from '@shared/study/hardMode';
import { DIFFERENCE_CARD, DIFFERENCE_TITLE, type DifferenceReason } from '@shared/study/answerDifference';
import { DifferenceCompare } from './DifferenceCompare';
import './HardModeFeedback.css';

export interface HardModeFeedbackProps {
  result: HardModeQuestionResult;
  /** His own answer / what was heard (never the card's answer); null = nothing to show. */
  said: string | null;
  spoken: boolean;
  /** The Sentence round comes next (else the answer). */
  roundFollows: boolean;
  /**
   * Right, but not the card's hanzi (a homophone / a listed alternative): the check stays up with
   * "You said" vs the card until Next — no going on by itself (shared/study/answerDifference.ts).
   */
  difference?: { reason: DifferenceReason; said: string; model: string; modelPinyin?: string | null } | null;
  onTryAgain: () => void;
  onShowAnswer: () => void;
  onNext: () => void;
}

/**
 * Hard mode's check of the question's own answer, on the question (docs/STUDY_SESSION.md "Hard mode"):
 * ✓ Right → "Next: harder questions" (it goes on by itself after a beat — unless it was right in other
 * characters: then it holds with "You said" vs the card, `difference`); ✗ Not quite / ≈ Nearly →
 * 🔁 Try again, or 👁 Show answer (a miss: Again or Hard). Nothing here gives the answer away.
 */
export function HardModeFeedback({ result, said, spoken, roundFollows, difference, onTryAgain, onShowAnswer, onNext }: HardModeFeedbackProps) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  const saidLine = said ? <p className="hard-feedback-said" data-testid="hard-said">{hardModeSaidLine(said, spoken)}</p> : null;
  if (result === 'checking') {
    return (
      <div className="hard-feedback hard-feedback--checking" data-testid="hard-feedback" data-result="checking" aria-live="polite">
        <p className="hard-feedback-title"><span className="spinner hard-feedback-spinner" aria-hidden="true" /> {HARD_MODE_CHECKING}</p>
        <div className="hard-feedback-row">
          <button type="button" className="btn btn-secondary" onClick={stop(onShowAnswer)} data-testid="hard-show-answer">
            <span aria-hidden="true">👁</span> {HARD_MODE_SHOW_ANSWER}
          </button>
        </div>
      </div>
    );
  }
  if (result === 'right') {
    return (
      <div className="hard-feedback hard-feedback--right" data-testid="hard-feedback" data-result="right" data-held={difference ? 'true' : undefined} aria-live="polite">
        <p className="hard-feedback-title">{difference ? DIFFERENCE_TITLE[difference.reason] : HARD_MODE_RESULT.right}</p>
        {difference ? (
          <DifferenceCompare said={difference.said} model={difference.model} modelPinyin={difference.modelPinyin} accepted modelLabel={DIFFERENCE_CARD} />
        ) : saidLine}
        <div className="hard-feedback-row">
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-next">
            {hardModeNextLabel(roundFollows)} →
          </button>
        </div>
      </div>
    );
  }
  if (result === 'unknown') {
    return (
      <div className="hard-feedback hard-feedback--unknown" data-testid="hard-feedback" data-result="unknown" aria-live="polite">
        <p className="hard-feedback-title">{HARD_MODE_UNKNOWN}</p>
        <div className="hard-feedback-row">
          <button type="button" className="btn btn-secondary" onClick={stop(onTryAgain)} data-testid="hard-try-again">
            <span aria-hidden="true">🔁</span> {HARD_MODE_TRY_AGAIN}
          </button>
          <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onNext)} data-testid="hard-next">
            {hardModeNextLabel(roundFollows)} →
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`hard-feedback hard-feedback--${result}`} data-testid="hard-feedback" data-result={result} aria-live="polite">
      <p className="hard-feedback-title">{HARD_MODE_RESULT[result]}</p>
      {saidLine}
      <div className="hard-feedback-row">
        <button type="button" className="btn btn-secondary" onClick={stop(onShowAnswer)} data-testid="hard-show-answer">
          <span aria-hidden="true">👁</span> {HARD_MODE_SHOW_ANSWER}
        </button>
        <button type="button" className="btn btn-primary hard-feedback-main" onClick={stop(onTryAgain)} data-testid="hard-try-again" autoFocus>
          <span aria-hidden="true">🔁</span> {HARD_MODE_TRY_AGAIN}
        </button>
      </div>
      <p className="hard-feedback-note">{HARD_MODE_MISS_NOTE}</p>
    </div>
  );
}
