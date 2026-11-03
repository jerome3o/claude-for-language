/**
 * The answer side's Again / Hard / Good / Easy under Hard mode (docs/STUDY_SESSION.md "Hard mode"): Good /
 * Easy are GREYED — never locked — while the sentences wait or after giving up (`goodEasyGate`). Hard is
 * suggested; the first tap on a greyed rating arms it ("Tap again to rate Good anyway", ~3 s), the second
 * rates it (`overrideTap`). Jerome: "sometimes I'm just on the train … guiding me towards the lower review
 * scores, but I can still override it." Lab: `HardModeRatingBar` in ui/study/HardModeUi.kt.
 */
import { useEffect, useState } from 'react';
import {
  overridePrompt, overrideTap, ratingNeedsOverride, suggestedRating, HARD_MODE_OVERRIDE_MS,
  type GoodEasyGate, type OverrideArm,
} from '@shared/study/hardMode';
import { RatingButtons } from '../RatingButtons';
import type { IntervalPreview, Rating } from '../../types';

export interface HardModeRatingsProps {
  goodEasy: GoodEasyGate;
  intervalPreviews: Record<Rating, IntervalPreview>;
  disabled: boolean;
  /** Rate (a greyed Good / Easy only on its second tap). */
  onRate: (rating: Rating) => void;
  /** A greyed rating tapped once (armed). */
  onArmed?: (rating: Rating) => void;
  /** A greyed rating rated on its second tap (`study.hard_mode_override`). */
  onOverride?: (rating: Rating) => void;
  /** A tap on the line (not after giving up): scroll to the sentences. */
  onLineClick?: () => void;
  /** Changes when a sentence is said right: the arm is dropped, the line goes back to the count. */
  resetKey?: unknown;
}

export function HardModeRatings({ goodEasy, intervalPreviews, disabled, onRate, onArmed, onOverride, onLineClick, resetKey }: HardModeRatingsProps) {
  const [armed, setArmed] = useState<OverrideArm | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(null), HARD_MODE_OVERRIDE_MS);
    return () => window.clearTimeout(id);
  }, [armed]);
  useEffect(() => {
    setArmed(null);
  }, [resetKey]);
  const greyed = goodEasy.state === 'suggest_lower';
  const tap = (rating: Rating) => {
    const t = overrideTap({ needsOverride: ratingNeedsOverride(rating, goodEasy), rating, armed, now: Date.now() });
    setArmed(t.armed);
    if (!t.rate) {
      onArmed?.(rating);
      return;
    }
    if (t.override) onOverride?.(rating);
    onRate(rating);
  };
  return (
    <>
      {(goodEasy.label || armed) && (
        <button
          type="button"
          className={`sentence-gate-line${greyed ? ' is-locked' : ' is-open'}${goodEasy.gaveUp ? ' is-gave-up' : ''}${armed ? ' is-armed' : ''}`}
          onClick={goodEasy.gaveUp ? undefined : onLineClick}
          data-testid="sentence-gate"
          data-locked={greyed}
          data-state={goodEasy.state}
          data-gave-up={goodEasy.gaveUp}
          aria-live="polite"
        >
          {armed ? overridePrompt(armed.rating) : goodEasy.label}
        </button>
      )}
      <RatingButtons
        intervalPreviews={intervalPreviews}
        onRate={tap}
        disabled={disabled}
        greyed={greyed ? [2, 3] : undefined}
        suggested={suggestedRating(goodEasy) as Rating | null}
        armed={(armed?.rating as Rating | undefined) ?? null}
      />
    </>
  );
}
