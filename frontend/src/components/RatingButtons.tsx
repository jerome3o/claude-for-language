import { Rating, RATING_INFO, IntervalPreview } from '../types';
import { HARD_MODE_SUGGESTED, HARD_MODE_TAP_AGAIN, HARD_MODE_TAP_TWICE } from '@shared/study/hardMode';

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
  greyed,
  suggested,
  armed,
}: {
  intervalPreviews: Record<Rating, IntervalPreview>;
  onRate: (rating: Rating) => void;
  onDoneForGood?: () => void;
  disabled: boolean;
  /**
   * Hard mode's greyed ratings (Good / Easy while the sentences wait, or after giving up): faded, never
   * locked — every tap reaches `onRate`, which arms the first and rates the second (`overrideTap`).
   */
  greyed?: readonly Rating[];
  /** The rating the card points to while Good / Easy are greyed (Hard): emphasised + "suggested". */
  suggested?: Rating | null;
  /** A greyed rating tapped once, waiting for the second tap. */
  armed?: Rating | null;
}) {
  return (
    <div>
      <div className="rating-buttons">
        {([0, 1, 2, 3] as Rating[]).map((rating) => {
          const isGreyed = !!greyed?.includes(rating);
          const isArmed = isGreyed && armed === rating;
          const isSuggested = suggested === rating;
          return (
          <button
            key={rating}
            className={`rating-btn ${RATING_INFO[rating].label.toLowerCase()}${isGreyed ? ' is-greyed' : ''}${isArmed ? ' is-armed' : ''}${isSuggested ? ' is-suggested' : ''}`}
            onClick={() => onRate(rating)}
            disabled={disabled}
            data-greyed={isGreyed || undefined}
            data-armed={isArmed || undefined}
            data-suggested={isSuggested || undefined}
            data-testid={`rating-${RATING_INFO[rating].label.toLowerCase()}`}
          >
            <span className="rating-label">{RATING_INFO[rating].label}</span>
            <span className="rating-interval">{intervalPreviews[rating].intervalText}</span>
            {isSuggested && <span className="rating-suggested-mark">{HARD_MODE_SUGGESTED}</span>}
            {isGreyed && <span className="rating-greyed-mark" aria-hidden="true">{isArmed ? HARD_MODE_TAP_AGAIN : HARD_MODE_TAP_TWICE}</span>}
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
