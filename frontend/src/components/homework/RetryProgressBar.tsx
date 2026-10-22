/**
 * The retry progress bar (docs/HOMEWORK.md §3c): blue = steps done from the left, orange (hatched)
 * = "Not yet" items still owed at the RIGHT end, the track between = items not shown yet. When the
 * blue reaches the orange he is on cards he has already seen. The numbers come from the pure
 * `retryBar` / `passRetryBar` (shared/homework/retry-bar.ts), so any pass with retries can use it
 * (homework word passes; mini lessons' retry round — StudyCustomLesson). Lab: ui/kit `RetryProgressBar`.
 *
 * Colour-blind safe: blue vs orange, the orange is hatched, and "↺ 3" sits at its right end, so it
 * reads without colour. The slot for "↺ N" is always kept so the track never shrinks (the blue
 * would look as if it went backwards). Widths animate; `prefers-reduced-motion` turns that off.
 */
import { retryBarBadge, retryBarLabel, WORD_UNIT, type RetryBar, type RetryBarUnit } from '@shared/homework';
import './RetryProgressBar.css';

const pct = (f: number) => `${Math.max(0, Math.min(1, f)) * 100}%`;

export function RetryProgressBar({
  bar,
  unit = WORD_UNIT,
  showBadge = true,
  className,
  testId = 'retry-progress-bar',
}: {
  bar: RetryBar;
  /** What an item is called in the label ("word" / "words", "exercise" / "exercises"). */
  unit?: RetryBarUnit;
  /** "↺ N" at the right end (its slot is kept even while there are no retries). */
  showBadge?: boolean;
  className?: string;
  testId?: string;
}) {
  const label = retryBarLabel(bar, unit);
  const badge = retryBarBadge(bar);
  const classes = ['retry-bar'];
  if (bar.onRetries) classes.push('retry-bar--on-retries');
  if (bar.complete) classes.push('retry-bar--complete');
  if (className) classes.push(className);
  return (
    <div
      className={classes.join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={bar.slots}
      aria-valuenow={bar.answered}
      aria-valuetext={label}
      data-testid={testId}
      data-answered={bar.answered}
      data-slots={bar.slots}
      data-retries={bar.retries}
    >
      <div className="retry-bar-track">
        <span
          className={`retry-bar-retry${bar.retries > 0 ? ' retry-bar-retry--shown' : ''}`}
          style={{ width: pct(bar.retryFraction) }}
          data-testid={`${testId}-retry`}
        />
        <span className="retry-bar-done" style={{ width: pct(bar.doneFraction) }} data-testid={`${testId}-done`} />
      </div>
      {showBadge && (
        <span className="retry-bar-badge" aria-hidden="true" data-testid={`${testId}-badge`}>
          {badge ?? ''}
        </span>
      )}
    </div>
  );
}
