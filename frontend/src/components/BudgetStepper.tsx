import { STUDY_BUDGET_MAX } from '@shared/decks';
import './BudgetStepper.css';

/**
 * − [n] + for one half of the daily new-card budget (0–STUDY_BUDGET_MAX):
 * the learner's Settings and the tutor's "Daily new cards" sheet.
 */
export function BudgetStepper({ label, hint, value, onChange, disabled, testId, tone }: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  testId: string;
  /** Colour dot of the pool: blue new words, purple extra cards. */
  tone?: 'primary' | 'secondary';
}) {
  const clamp = (v: number) => Math.max(0, Math.min(STUDY_BUDGET_MAX, Math.round(v)));
  return (
    <div className={`settings-stepper${tone ? ` tone-${tone}` : ''}`} data-testid={testId}>
      <div className="settings-stepper-text">
        <span className="settings-stepper-label">{label}</span>
        <span className="settings-stepper-hint">{hint}</span>
      </div>
      <div className="settings-stepper-controls">
        <button type="button" onClick={() => onChange(clamp(value - 1))} disabled={disabled || value <= 0} aria-label={`Fewer ${label}`}>−</button>
        <input
          type="number" inputMode="numeric" min={0} max={STUDY_BUDGET_MAX} value={value} disabled={disabled}
          onChange={(e) => onChange(clamp(Number(e.target.value) || 0))} aria-label={label}
        />
        <button type="button" onClick={() => onChange(clamp(value + 1))} disabled={disabled || value >= STUDY_BUDGET_MAX} aria-label={`More ${label}`}>+</button>
      </div>
    </div>
  );
}
