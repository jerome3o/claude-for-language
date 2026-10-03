/**
 * Settings → Cards: "Check new words for mistakes" (worker services/card-check.ts).
 * On by default for tutors; anyone can switch it on or off.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { setCardCheck } from '../api/cardChecks';
import { track } from '../services/analytics';

export function CardCheckSettingsSection() {
  const { user, refreshUser } = useAuth();
  const current = !!user?.card_check;
  const [on, setOn] = useState(current);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setOn(current), [current]);

  const toggle = async (next: boolean) => {
    setOn(next);
    setNote(null);
    try {
      await setCardCheck(next);
      track('settings.change', { setting: 'card_check', value: next ? 'on' : 'off' });
      void refreshUser().catch(() => {});
    } catch (err) {
      setOn(!next);
      setNote(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <div className="settings-section" data-testid="card-check-settings">
      <h2>Cards</h2>
      <label className="settings-toggle-row" data-testid="card-check-toggle">
        <input type="checkbox" checked={on} onChange={(e) => void toggle(e.target.checked)} />
        <span>Check new words for mistakes</span>
      </label>
      <p className="settings-section-desc" style={{ marginTop: '0.4rem' }}>
        {on
          ? 'Claude double-checks the pinyin and meaning of words you add — about a cent per 100 words. A likely mistake shows as “⚠ Possible issue” on the word, with Apply fix / Dismiss; nothing changes on its own.'
          : 'Off — you can still check a whole deck from its ⋯ menu → Check for errors.'}
      </p>
      {note && <p className="settings-section-desc" role="status">{note}</p>}
    </div>
  );
}
