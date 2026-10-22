import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BURY_SIBLINGS_CHANGED, readBurySiblings, saveBurySiblings } from '../../services/burySiblings';
import { useCardHolds } from '../../services/cardHolds';
import { track } from '../../services/analytics';

/**
 * Settings → Study: "Don't show a word's other card types on the same day" (Anki's sibling burying,
 * off by default, per account — shared/decks/holds.ts) and the way into "Suspended & snoozed cards".
 */
export function CardControlsSettings() {
  const [on, setOn] = useState(readBurySiblings);
  const [error, setError] = useState<string | null>(null);
  const held = useCardHolds();
  useEffect(() => {
    const sync = () => setOn(readBurySiblings());
    window.addEventListener(BURY_SIBLINGS_CHANGED, sync);
    return () => window.removeEventListener(BURY_SIBLINGS_CHANGED, sync);
  }, []);
  const suspended = [...held.values()].filter((h) => h.kind === 'suspend').length;
  const snoozed = held.size - suspended;
  return (
    <>
      <label className="settings-toggle-row" style={{ marginTop: '1rem' }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            setError(null);
            track('settings.bury_siblings', { on: next });
            saveBurySiblings(next).catch((err) => setError(err instanceof Error ? `Saved on this device — ${err.message}` : null));
          }}
          data-testid="bury-siblings-toggle"
        />
        <span>Don't show a word's other card types on the same day</span>
      </label>
      <p className="settings-section-desc" style={{ marginTop: '0.4rem' }}>
        {on
          ? 'Once you review one card of a word, its other new and review cards wait until tomorrow. Cards you are still learning, and words you bumped to today (⚡), still come.'
          : 'Off — a word can come up as several card types on the same day.'}
      </p>
      {error && <p className="settings-section-desc" role="alert">{error}</p>}
      <Link to="/cards/held" className="settings-link-row" data-testid="held-cards-link" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, marginTop: '0.75rem' }}>
        <span>⏸ Suspended &amp; snoozed cards</span>
        <span className="settings-section-desc" style={{ margin: 0 }}>
          {held.size === 0 ? 'None' : [suspended ? `${suspended} suspended` : '', snoozed ? `${snoozed} snoozed` : ''].filter(Boolean).join(' · ')} ›
        </span>
      </Link>
    </>
  );
}
