import { useRef } from 'react';
import { pickReviewLoadCap, REVIEW_LOAD_CAP_MAX, REVIEW_LOAD_CAP_MIN, REVIEW_LOAD_CAP_SUGGESTED } from '@shared/decks';
import './ReviewLoadCapField.css';

/** The value can be saved: off, or a whole number REVIEW_LOAD_CAP_MIN–MAX. */
export function reviewLoadCapValid(v: number | null): boolean {
  return !pickReviewLoadCap(v).problem;
}

/**
 * "Pause new cards on heavy days" (shared/decks/review-load.ts) under the daily budget's
 * steppers — the learner's Settings and the tutor's "Daily new cards" sheet:
 * [✓] Pause new cards on heavy days · when more than [100] reviews are due.
 * `value` null = off; switching it on offers the last number, else 100.
 */
export function ReviewLoadCapField({ value, onChange, disabled, testId, hint }: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  testId: string;
  /** The one-line explanation under it (who it is for decides the words). */
  hint: string;
}) {
  const lastOn = useRef<number>(value ?? REVIEW_LOAD_CAP_SUGGESTED);
  if (value !== null && reviewLoadCapValid(value)) lastOn.current = value;
  const on = value !== null;
  const invalid = on && !reviewLoadCapValid(value);
  return (
    <div className="review-cap" data-testid={testId}>
      <label className="review-cap-toggle">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? lastOn.current : null)}
          data-testid={`${testId}-toggle`}
        />
        <span className="review-cap-label">Pause new cards on heavy days</span>
      </label>
      <div className={`review-cap-row${on ? '' : ' off'}`}>
        <span>when more than</span>
        <input
          type="number"
          inputMode="numeric"
          min={REVIEW_LOAD_CAP_MIN}
          max={REVIEW_LOAD_CAP_MAX}
          placeholder={String(REVIEW_LOAD_CAP_SUGGESTED)}
          value={on ? value : ''}
          disabled={disabled || !on}
          aria-label="Reviews due"
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const raw = e.target.value.trim();
            onChange(raw === '' ? 0 : Math.round(Number(raw)) || 0);
          }}
          data-testid={`${testId}-input`}
        />
        <span>reviews are due</span>
      </div>
      {invalid && (
        <p className="review-cap-error" role="alert">A number from {REVIEW_LOAD_CAP_MIN} to {REVIEW_LOAD_CAP_MAX}</p>
      )}
      <p className="review-cap-hint">{hint}</p>
    </div>
  );
}
