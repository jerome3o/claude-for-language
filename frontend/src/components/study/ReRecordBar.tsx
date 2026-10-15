import type { ReactNode } from 'react';

/**
 * The card back's footer while a take is being made AGAIN (docs/STUDY_SESSION.md "Say the answer"
 * → "Say it again", "Record again"): a read card's 🎤 Record again, a typing card's 🎤 Say it again
 * and the 🎤 Say it practice. The ratings (and the Ask Claude · Edit card · ⋯ row) are NOT there —
 * Jerome kept hitting Again / Good when he meant to go back — and the re-record's own controls take
 * their place, where the thumb is: the big primary button exactly where the ratings were (⏹ Stop,
 * ✓ Submit, Check, 🔁 Retry), ← Back plus 🔁 Retry · ✏️ Edit above it. ← Back = the answer side as it
 * was (the previous answer and take kept). The ratings come back after Submit / Check or Back.
 *
 * The card above shows only what is going on (time + level, the live transcript, the review's
 * hanzi + pinyin, the ✏️ Edit box, "Couldn't transcribe — tap to retry"): the controls live here,
 * once. The bar sits in the sticky footer, so with the keyboard up (the viewport resizes its
 * content) it stays above the IME. Lab twin: CardStage `ReRecordBar`.
 */
export type ReRecordStep =
  /** Record again: the microphone is opening. */
  | 'starting'
  /** Record again: recording. */
  | 'recording'
  /** Say it again: listening (live transcript on the card). */
  | 'listening'
  | 'finishing'
  /** Say it again: the transcript waiting for Retry / Edit / Submit. */
  | 'review'
  /** Say it again: ✏️ Edit — the box on the card, Check here. */
  | 'editing'
  /** Say it again: the take gave nothing (couldn't transcribe / nothing heard). */
  | 'failed';

export interface ReRecordBarProps {
  step: ReRecordStep;
  /** Say it practice: what was said is shown as said — nothing to edit. */
  practice?: boolean;
  /** Editing: something is in the box. */
  canCheck?: boolean;
  onBack: () => void;
  onStop?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  onSubmit?: () => void;
  onCheck?: () => void;
}

const stop = (fn?: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  fn?.();
};

export function ReRecordBar({ step, practice, canCheck, onBack, onStop, onRetry, onEdit, onSubmit, onCheck }: ReRecordBarProps) {
  const retry = (
    <button type="button" className="btn btn-secondary study-rerecord-bar-side" onClick={stop(onRetry)} aria-label="Retry" data-testid="spoken-review-retry">
      <span aria-hidden="true">🔁</span> Retry
    </button>
  );
  let primary: ReactNode;
  switch (step) {
    case 'starting':
    case 'recording':
    case 'listening':
      primary = (
        <button
          type="button"
          className={`btn btn-error study-rerecord-bar-main${step === 'starting' ? '' : ' is-listening'}`}
          onClick={stop(step === 'starting' ? undefined : onStop)}
          aria-label="Stop"
          aria-disabled={step === 'starting'}
          data-testid="rerecord-stop"
        >
          {step === 'starting' ? 'Starting…' : <><span aria-hidden="true">⏹</span> Stop</>}
        </button>
      );
      break;
    case 'finishing':
      primary = (
        <button type="button" className="btn btn-primary study-rerecord-bar-main" aria-label="Finishing" aria-disabled data-testid="rerecord-finishing">
          <span className="spinner study-voice-say-spinner" aria-hidden="true" /> Finishing…
        </button>
      );
      break;
    case 'review':
      primary = (
        <button type="button" className="btn btn-primary study-rerecord-bar-main" onClick={stop(onSubmit)} aria-label="Submit" data-testid="spoken-review-submit">
          <span aria-hidden="true">✓</span> Submit
        </button>
      );
      break;
    case 'editing':
      primary = (
        <button
          type="button"
          className="btn btn-primary study-rerecord-bar-main"
          onClick={stop(canCheck ? onCheck : undefined)}
          aria-disabled={!canCheck}
          data-testid="spoken-edit-check"
        >
          <span aria-hidden="true">✓</span> Check
        </button>
      );
      break;
    case 'failed':
      primary = (
        <button type="button" className="btn btn-primary study-rerecord-bar-main" onClick={stop(onRetry)} aria-label="Retry" data-testid="spoken-review-retry">
          <span aria-hidden="true">🔁</span> Retry
        </button>
      );
      break;
  }
  return (
    <div className="study-rerecord-bar" data-testid="study-rerecord-bar" role="group" aria-label="Recording again">
      <div className="study-rerecord-bar-row">
        <button
          type="button"
          className="btn btn-secondary study-rerecord-bar-back"
          onClick={stop(onBack)}
          aria-label="Back to the answer"
          data-testid="rerecord-back"
        >
          <span aria-hidden="true">←</span> Back
        </button>
        {(step === 'review' || step === 'editing') && retry}
        {step === 'review' && !practice && (
          <button type="button" className="btn btn-secondary study-rerecord-bar-side" onClick={stop(onEdit)} aria-label="Edit what I said" data-testid="spoken-review-edit">
            <span aria-hidden="true">✏️</span> Edit
          </button>
        )}
      </div>
      {primary}
    </div>
  );
}

/**
 * The card back's sticky footer: the action row + the ratings (or the pass's answer buttons) — or,
 * while a take is being made again, ONLY the re-record bar (`rerecord`), so nothing can be rated
 * from inside it.
 */
export function StudyCardFooter({ rerecord, actions, ratings }: { rerecord: ReRecordBarProps | null; actions: ReactNode; ratings: ReactNode }) {
  return (
    <div className="study-rating-sticky">
      {rerecord ? (
        <ReRecordBar {...rerecord} />
      ) : (
        <>
          <div className="study-card-actions study-card-actions--footer">{actions}</div>
          {ratings}
        </>
      )}
    </div>
  );
}
