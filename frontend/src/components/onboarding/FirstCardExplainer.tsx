import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import './onboarding.css';

const SEEN_KEY = 'firstCardExplainerSeen';

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * A one-time, three-line explainer shown over the very first card of a
 * learner's very first session (no review events anywhere yet). Self-contained:
 * the study page just renders it; it decides for itself whether to appear.
 */
export function FirstCardExplainer() {
  const [seen, setSeen] = useState(readSeen);
  const reviewCount = useLiveQuery(() => db.reviewEvents.count(), []);

  if (seen || reviewCount === undefined || reviewCount > 0) return null;

  const dismiss = () => {
    setSeen(true);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  };

  return (
    <div className="onb-explainer-backdrop" role="dialog" aria-modal="true" aria-labelledby="onb-explainer-title">
      <div className="onb-explainer">
        <h2 id="onb-explainer-title">Before your first card</h2>
        <ol className="onb-explainer-list">
          <li>
            <strong>You'll see each word three ways</strong> — read it and say it, hear it and type it, see the English and type it.
          </li>
          <li>
            <strong>Answer first, then tap to reveal.</strong> Tap the speaker any time to hear the word again.
          </li>
          <li>
            <strong>Rate yourself honestly</strong> — if you didn't get it right, <strong>always tap Again</strong>. That is how the app knows what to show you tomorrow.
          </li>
        </ol>
        <p className="onb-explainer-note">
          Recording your voice is optional — you can skip it. Your phone asks for the microphone the first time you tap <em>Record</em>.
        </p>
        <button type="button" className="btn btn-primary btn-block" onClick={dismiss} autoFocus>
          Got it
        </button>
      </div>
    </div>
  );
}
