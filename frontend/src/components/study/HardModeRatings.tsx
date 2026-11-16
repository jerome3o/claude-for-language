/**
 * The answer side's Again / Hard / Good / Easy under Hard mode (docs/STUDY_SESSION.md "Hard mode"): Good /
 * Easy are GREYED — never locked — while the sentences wait or after giving up (`goodEasyGate`). Hard is
 * suggested (ringed); the first tap on a greyed rating arms it ("tap again" on the button, ~3 s), the second
 * rates it (`overrideTap`). Jerome: "sometimes I'm just on the train … guiding me towards the lower review
 * scores, but I can still override it." NO line above the ratings (Jerome, Nov 2026: "I don't think we need that
 * extra bar above the ratings at all"): why they're greyed ("You looked at the answer — …", "Try the sentences
 * first · 1/2 right") and "Tap again to rate Good anyway" are the buttons' accessible labels only. Lab: `RatingBar`
 * in ui/study/CardStage.kt.
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
  /** Changes when a sentence is said right: the arm is dropped. */
  resetKey?: unknown;
}

export function HardModeRatings({ goodEasy, intervalPreviews, disabled, onRate, onArmed, onOverride, resetKey }: HardModeRatingsProps) {
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
    <div className="hard-mode-ratings" data-testid="hard-mode-ratings" data-state={goodEasy.state} data-gave-up={goodEasy.gaveUp || undefined}>
      <RatingButtons
        intervalPreviews={intervalPreviews}
        onRate={tap}
        disabled={disabled}
        greyed={greyed ? [2, 3] : undefined}
        suggested={suggestedRating(goodEasy) as Rating | null}
        armed={(armed?.rating as Rating | undefined) ?? null}
        why={goodEasy.label}
        armedLabel={armed ? overridePrompt(armed.rating) : null}
      />
    </div>
  );
}
