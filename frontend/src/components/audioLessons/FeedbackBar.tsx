import { useEffect, useState } from 'react';
import './FeedbackBar.css';

/**
 * Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening"): two big buttons under the
 * player's controls — ⏪ Back a section (the line with its repeats again; within 2 s of a new line, the one
 * before) and 😵 Too hard (noted for Claude; playing carries on). On the lock screen the browser only offers
 * ⏮ / ⏭, which do the same as back / next a section; "Too hard" needs the page.
 */
export function FeedbackBar({
  disabled,
  notedAt,
  notedText,
  onBack,
  onTooHard,
}: {
  disabled: boolean;
  /** Changes on every press, so the confirmation shows again. */
  notedAt: number;
  notedText: string;
  onBack: () => void;
  onTooHard: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!notedAt) return;
    setShown(true);
    const t = window.setTimeout(() => setShown(false), 2200);
    return () => window.clearTimeout(t);
  }, [notedAt]);
  return (
    <div className="al-feedback">
      <div className="al-feedback-row">
        <button className="al-feedback-btn" onClick={onBack} disabled={disabled} data-testid="al-back-section">
          <span aria-hidden>⏪</span> Back a section
        </button>
        <button className="al-feedback-btn al-feedback-hard" onClick={onTooHard} disabled={disabled} data-testid="al-too-hard">
          <span aria-hidden>😵</span> Too hard
        </button>
      </div>
      <div className={`al-feedback-noted ${shown ? 'shown' : ''}`} role="status" aria-live="polite">
        {shown ? notedText : ''}
      </div>
    </div>
  );
}
