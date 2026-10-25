import { useState } from 'react';
import { useFeedback } from '../feedback/FeedbackProvider';
import { isShakeEnabled, setShakeEnabled, shakeSupported } from '../../services/feedback';
import { track } from '../../services/analytics';
import { FEEDBACK_COPY } from '@shared/feedback';

/** Settings → Feedback: send some, and "Shake to send feedback" on phones (docs/FEEDBACK.md). */
export function FeedbackSettingsSection() {
  const { openFeedback } = useFeedback();
  const supported = shakeSupported();
  const [shake, setShake] = useState(isShakeEnabled);
  return (
    <div className="settings-section" data-testid="feedback-settings">
      <h2>Feedback</h2>
      <p className="settings-section-desc">
        Something wrong, or an idea? Send it with a screenshot of the app — it goes to the feature request list below (Advanced).
        {!supported && ' On a keyboard: Shift + ?.'}
      </p>
      <button type="button" className="btn btn-secondary" onClick={() => openFeedback('settings')} data-testid="settings-send-feedback">
        💬 Send feedback
      </button>
      {supported && (
        <label className="feedback-checkbox-label" style={{ marginTop: '0.75rem' }}>
          <input
            type="checkbox"
            checked={shake}
            onChange={(e) => {
              setShake(e.target.checked);
              setShakeEnabled(e.target.checked);
              track('settings.change', { setting: 'shake_feedback', value: e.target.checked ? 'on' : 'off' });
            }}
            data-testid="feedback-shake-toggle"
          />
          <span>{FEEDBACK_COPY.shakeSetting} — never during a call or a recording</span>
        </label>
      )}
    </div>
  );
}
