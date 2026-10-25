import { useEffect, useState } from 'react';
import type { PassOutcome } from '@shared/homework';
import './homework.css';

/**
 * The homework pass's Not yet / Got it, where the study card has Again / Hard / Good / Easy
 * (docs/HOMEWORK.md §3). What the card saw before the reveal may SUGGEST one (`passSuggestion`:
 * a right typed / said answer, a "You said" that matched) — it is ringed and marked, nothing more:
 * the learner always chooses. Lab: `PassAnswerBar` in ui/study/CardStage.kt.
 *
 * Hard mode in the pass (docs/HOMEWORK.md §3e): after giving up (👁 Show answer before a right answer)
 * Got it is LOCKED (🔒, faded) with a line above saying so — a tap on it says why; Not yet is suggested.
 */
export function PassAnswerButtons({
  suggested,
  onAnswer,
  disabled,
  gotItLocked,
}: {
  suggested: PassOutcome | null;
  onAnswer: (right: boolean) => void;
  disabled?: boolean;
  gotItLocked?: { line: string; blockedNote: string };
}) {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!blocked) return;
    const id = window.setTimeout(() => setBlocked(false), 5000);
    return () => window.clearTimeout(id);
  }, [blocked]);
  return (
    <>
    {gotItLocked && (
      <p className="sentence-gate-line is-locked is-gave-up hw-pass-locked-line" data-testid="hw-pass-locked" aria-live="polite">
        {blocked ? gotItLocked.blockedNote : gotItLocked.line}
      </p>
    )}
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
        className={`btn hw-btn-gotit${suggested === 'right' ? ' hw-btn--suggested' : ''}${gotItLocked ? ' hw-btn--locked' : ''}`}
        onClick={() => (gotItLocked ? setBlocked(true) : onAnswer(true))}
        disabled={disabled}
        aria-disabled={gotItLocked ? true : undefined}
        data-testid="hw-gotit"
        data-locked={gotItLocked ? 'true' : undefined}
      >
        {gotItLocked ? '🔒 Got it' : 'Got it'}
        {suggested === 'right' && !gotItLocked && <span className="hw-btn-hint">✓ suggested</span>}
      </button>
    </div>
    </>
  );
}
