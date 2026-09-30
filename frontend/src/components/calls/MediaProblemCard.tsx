/**
 * Why the camera / microphone aren't on, and what to do about it — the exact
 * steps for this browser and computer (services/calls/mediaAccess.ts), a
 * "Try again" that asks again from a tap, and never a dead end: joining works
 * without them.
 */

import { mainProblem, mediaHelp, problemDevice } from '../../services/calls/mediaAccess';
import type { MediaProblems } from '../../hooks/useCall';

export function MediaProblemCard({
  problems,
  pending,
  onRetry,
  compact,
}: {
  problems: MediaProblems;
  pending: boolean;
  onRetry: () => void;
  /** In the call (a sheet): shorter. */
  compact?: boolean;
}) {
  const problem = mainProblem(problems.audio, problems.video);
  const device = problemDevice(problems.audio, problems.video);
  if (!problem || !device) return null;
  const help = mediaHelp(problem, device, typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const consequence =
    device === 'both'
      ? 'You can still join — to listen and watch — and turn them on from the call bar later.'
      : device === 'camera'
        ? 'You can still join with your microphone only.'
        : 'You can still join to listen and watch; turn the microphone on from the call bar later.';
  return (
    <div className={`call-media-problem${compact ? ' compact' : ''}`} role="alert" data-testid="media-problem" data-problem={problem} data-device={device}>
      <div className="call-media-problem-title">
        <span aria-hidden="true">{problem === 'waiting' ? '⏳' : problem === 'in-use' ? '📷' : '🚫'}</span> {help.title}
      </div>
      <ol className="call-media-problem-steps">
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {!compact && <p className="call-media-problem-note">{consequence}</p>}
      {help.canRetry && (
        <button type="button" className="btn btn-secondary call-media-retry" onClick={onRetry} disabled={pending} data-testid="media-retry">
          {pending ? 'Asking…' : 'Try again'}
        </button>
      )}
    </div>
  );
}
