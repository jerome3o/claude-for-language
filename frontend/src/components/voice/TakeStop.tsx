/**
 * The take lock on screen (shared/voice/takeLock.ts, services/takeLock.ts; docs/STUDY_SESSION.md "While a take
 * is recording"):
 *
 * - `TakeLockedActions` — a row of advancing buttons (Next, Continue, Check, Send, Skip …) that gives way to ONE
 *   red "■ Stop recording" in the same place while a take records (a thumb aimed at Next stops the take
 *   instead of losing it), then a held "Checking what you said…" until the result shows.
 * - `TakeBackGuard` (App.tsx) — back stops a recording take instead of leaving the page.
 *
 * The button is the reader's / the sentence rows' own (`StopRecordingFooter` styles). Lab twin:
 * ui/kit/TakeLock.kt (`TakeLockedActions`, `TakeBackGuard`).
 */
import type { ReactNode } from 'react';
import '../reader/ReadAloud.css';
import './TakeStop.css';
import { TAKE_LOCK_CHECKING, TAKE_LOCK_STOP } from '@shared/voice/takeLock';
import { stopTakes, useAppTakeLock, useTakeLockSnapshot } from '../../services/takeLock';
import { useBackLevels } from '../../hooks/useBackLevels';

/** The red "■ Stop recording" / held "Checking…" button, or null when no take is under way. */
export function TakeStopButton({ testId = 'take-stop', label = TAKE_LOCK_STOP, checkingLabel = TAKE_LOCK_CHECKING }: {
  testId?: string;
  label?: string;
  checkingLabel?: string;
}) {
  const lock = useAppTakeLock();
  if (!lock.locked) return null;
  return (
    <button
      type="button"
      className={`btn reader-read-aloud-stop-btn take-stop-btn${lock.recording ? '' : ' checking'}`}
      onClick={(e) => { e.stopPropagation(); lock.stop(); }}
      disabled={!lock.recording}
      data-testid={testId}
      data-state={lock.recording ? 'stop' : 'checking'}
    >
      {lock.recording ? (
        <>
          <span className="reader-read-aloud-stop-square" aria-hidden="true" />
          {label}
        </>
      ) : (
        <>
          <span className="spinner reader-read-aloud-spinner" aria-hidden="true" />
          {checkingLabel}
        </>
      )}
    </button>
  );
}

/**
 * `children` (the row's own buttons) — or, while a take is under way, the stop button in their place. When the screen
 * already pins its own "■ Stop recording" for the take (the study sentence rows' `SentenceStopBar`), the row is HELD
 * instead: greyed and untappable where it is, no second stop (`takeLockRow`).
 */
export function TakeLockedActions({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  const lock = useAppTakeLock();
  if (lock.row === 'proceed') return <>{children}</>;
  if (lock.row === 'held') {
    return (
      <div className={`take-locked-held${className ? ` ${className}` : ''}`} aria-disabled="true" data-testid="take-locked-held" ref={holdInert}>
        {children}
      </div>
    );
  }
  return (
    <div className={`take-locked-actions reader-read-aloud-footer${className ? ` ${className}` : ''}`} data-testid="take-locked-actions">
      <TakeStopButton testId={testId} />
    </div>
  );
}

/** `inert` set by hand (React 18 types don't know the attribute). */
function holdInert(el: HTMLDivElement | null) {
  el?.setAttribute('inert', '');
}

/** Back stops a recording take (and waits while it is checked) instead of leaving. One, in App.tsx. */
export function TakeBackGuard() {
  const { backPhase } = useTakeLockSnapshot();
  useBackLevels(backPhase !== 'idle' ? 1 : 0, () => stopTakes({ backOnly: true }), 'take');
  return null;
}
