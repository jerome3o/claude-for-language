import { useEffect, useState } from 'react';
import { readSkipHandwriting, saveSkipHandwriting, SKIP_HANDWRITING_CHANGED } from '../../services/skipHandwriting';
import { track } from '../../services/analytics';

/** Re-reads "Skip handwriting exercises" whenever it changes (Settings, a row's menu, a sync). */
export function useSkipHandwriting(): boolean {
  const [on, setOn] = useState(readSkipHandwriting);
  useEffect(() => {
    const sync = () => setOn(readSkipHandwriting());
    window.addEventListener(SKIP_HANDWRITING_CHANGED, sync);
    return () => window.removeEventListener(SKIP_HANDWRITING_CHANGED, sync);
  }, []);
  return on;
}

/**
 * Settings → Study: "Skip handwriting exercises" (per account, off by default —
 * shared/lesson/handwriting.ts). Mini lessons leave write_handwriting out and type dictation.
 */
export function SkipHandwritingSetting() {
  const on = useSkipHandwriting();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <label className="settings-toggle-row" style={{ marginTop: '1rem' }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked;
            setError(null);
            track('settings.skip_handwriting', { on: next, source: 'settings' });
            saveSkipHandwriting(next).catch((err) => setError(err instanceof Error ? `Saved on this device — ${err.message}` : null));
          }}
          data-testid="skip-handwriting-toggle"
        />
        <span>Skip handwriting exercises</span>
      </label>
      <p className="settings-section-desc" style={{ marginTop: '0.4rem' }}>
        {on
          ? 'Mini lessons leave out "write it by hand" exercises and you type dictation instead. Skipped exercises never count as mistakes, so they never bring a lesson back as a revision. Your tutor sees them as skipped.'
          : 'Off — mini lessons include handwriting exercises.'}
      </p>
      {error && <p className="settings-section-desc" role="alert">{error}</p>}
    </>
  );
}
