import type { PassOutcome } from '@shared/homework';
import './homework.css';

/**
 * The homework pass's Not yet / Got it, where the study card has Again / Hard / Good / Easy
 * (docs/HOMEWORK.md §3). What the card saw before the reveal may SUGGEST one (`passSuggestion`:
 * a right typed / said answer, a "You said" that matched) — it is ringed and marked, nothing more:
 * the learner always chooses. Lab: `PassAnswerBar` in ui/study/CardStage.kt.
 */
export function PassAnswerButtons({
  suggested,
  onAnswer,
  disabled,
}: {
  suggested: PassOutcome | null;
  onAnswer: (right: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="hw-pass-rate" data-testid="hw-pass-rate" data-suggested={suggested ?? 'none'}>
      <button
        type="button"
        className={`btn hw-btn-notyet${suggested === 'wrong' ? ' hw-btn--suggested' : ''}`}
        onClick={() => onAnswer(false)}
        disabled={disabled}
        data-testid="hw-notyet"
      >
        Not yet
        {suggested === 'wrong' && <span className="hw-btn-hint">suggested</span>}
      </button>
      <button
        type="button"
        className={`btn hw-btn-gotit${suggested === 'right' ? ' hw-btn--suggested' : ''}`}
        onClick={() => onAnswer(true)}
        disabled={disabled}
        data-testid="hw-gotit"
      >
        Got it
        {suggested === 'right' && <span className="hw-btn-hint">✓ suggested</span>}
      </button>
    </div>
  );
}
