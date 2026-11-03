import { useEffect, useState } from 'react';
import type { PassOutcome } from '@shared/homework';
import { overrideTap, HARD_MODE_OVERRIDE_MS, HARD_MODE_TAP_AGAIN, HARD_MODE_TAP_TWICE, type OverrideArm } from '@shared/study/hardMode';
import { track } from '../../services/analytics';
import './homework.css';

/**
 * The homework pass's Not yet / Got it, where the study card has Again / Hard / Good / Easy
 * (docs/HOMEWORK.md §3). What the card saw before the reveal may SUGGEST one (`passSuggestion`:
 * a right typed / said answer, a "You said" that matched) — it is ringed and marked, nothing more:
 * the learner always chooses. Lab: `PassAnswerBar` in ui/study/CardStage.kt.
 *
 * Hard mode in the pass (docs/HOMEWORK.md §3e): after giving up (👁 Show answer before a right answer)
 * Got it is GREYED (never locked) with a line above saying so — the first tap says "Tap again to say Got
 * it anyway", a second within 3 s (`overrideTap`) still counts it; Not yet is suggested.
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
  gotItLocked?: { line: string; overridePrompt: string };
}) {
  const [armed, setArmed] = useState<OverrideArm | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(null), HARD_MODE_OVERRIDE_MS);
    return () => window.clearTimeout(id);
  }, [armed]);
  const tapGotIt = () => {
    const tap = overrideTap({ needsOverride: !!gotItLocked, rating: 2, armed, now: Date.now() });
    setArmed(tap.armed);
    if (!tap.rate) return;
    if (tap.override) track('study.hard_mode_override', { rating: 'got_it', reason: 'gave_up', card_type: undefined });
    onAnswer(true);
  };
  return (
    <>
    {gotItLocked && (
      <p className="sentence-gate-line is-locked is-gave-up hw-pass-locked-line" data-testid="hw-pass-locked" aria-live="polite">
        {armed ? gotItLocked.overridePrompt : gotItLocked.line}
      </p>
    )}
    <div className="hw-pass-rate" data-testid="hw-pass-rate" data-suggested={suggested ?? 'none'}>
      <button
        type="button"
        className={`btn hw-btn-notyet${suggested === 'wrong' || gotItLocked ? ' hw-btn--suggested' : ''}`}
        onClick={() => onAnswer(false)}
        disabled={disabled}
        data-testid="hw-notyet"
      >
        Not yet
        {(suggested === 'wrong' || gotItLocked) && <span className="hw-btn-hint">suggested</span>}
      </button>
      <button
        type="button"
        className={`btn hw-btn-gotit${suggested === 'right' ? ' hw-btn--suggested' : ''}${gotItLocked ? ' hw-btn--locked' : ''}${armed ? ' is-armed' : ''}`}
        onClick={tapGotIt}
        disabled={disabled}
        data-testid="hw-gotit"
        data-locked={gotItLocked ? 'true' : undefined}
        data-armed={armed ? 'true' : undefined}
      >
        Got it
        {gotItLocked && <span className="hw-btn-hint">{armed ? HARD_MODE_TAP_AGAIN : HARD_MODE_TAP_TWICE}</span>}
        {suggested === 'right' && !gotItLocked && <span className="hw-btn-hint">✓ suggested</span>}
      </button>
    </div>
    </>
  );
}
