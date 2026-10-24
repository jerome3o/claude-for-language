import { Rating, RATING_INFO, IntervalPreview } from '../types';

/**
 * Again/Hard/Good/Easy buttons with the interval each gives. For a finished
 * mini lesson or graded reader, `onDoneForGood` adds a "Done for good" button
 * under them: finished, and never scheduled again (shared/study/revisit.ts).
 */
export function RatingButtons({
  intervalPreviews,
  onRate,
  onDoneForGood,
  disabled,
  locked,
}: {
  intervalPreviews: Record<Rating, IntervalPreview>;
  onRate: (rating: Rating) => void;
  onDoneForGood?: () => void;
  disabled: boolean;
  /**
   * Ratings held back ("Get two sentences right before Good / Easy"): shown disabled, but a tap
   * still reaches `onRate` so the card can say why (the caller refuses it).
   */
  locked?: readonly Rating[];
}) {
  return (
    <div>
      <div className="rating-buttons">
        {([0, 1, 2, 3] as Rating[]).map((rating) => {
          const isLocked = !!locked?.includes(rating);
          return (
          <button
            key={rating}
            className={`rating-btn ${RATING_INFO[rating].label.toLowerCase()}${isLocked ? ' is-locked' : ''}`}
            onClick={() => onRate(rating)}
            disabled={disabled}
            aria-disabled={isLocked || undefined}
            data-testid={`rating-${RATING_INFO[rating].label.toLowerCase()}`}
          >
            <span className="rating-label">{isLocked && <span aria-hidden="true">🔒 </span>}{RATING_INFO[rating].label}</span>
            <span className="rating-interval">{intervalPreviews[rating].intervalText}</span>
          </button>
          );
        })}
      </div>
      {onDoneForGood && (
        <button
          type="button"
          className="rating-done-for-good"
          onClick={onDoneForGood}
          disabled={disabled}
          data-testid="done-for-good"
        >
          ✓ Done for good <span className="rating-done-for-good-hint">· don't bring it back</span>
        </button>
      )}
    </div>
  );
}
