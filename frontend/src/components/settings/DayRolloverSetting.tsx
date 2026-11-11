import { useEffect, useState } from 'react';
import {
  DAY_ROLLOVER_CHOICES,
  DEFAULT_DAY_ROLLOVER_HOUR,
  dayRolloverLabel,
} from '@shared/study/studyDay';
import { updateDayRollover } from '../../api/client';
import { DAY_ROLLOVER_CHANGED, readDayRolloverHour, writeDayRolloverHour } from '../../services/studyDay';
import { track } from '../../services/analytics';

/**
 * Settings → Study → "New day starts at" (per account, 4 am by default; shared/study/studyDay.ts,
 * docs/STUDY_SESSION.md "When does a new day start"): before this hour it is still yesterday —
 * the queue, the new-card budget, the daily reader and the celebration don't roll over at midnight.
 * Saved on the device at once (offline too) and on the server.
 */
export function DayRolloverSetting() {
  const [hour, setHour] = useState(readDayRolloverHour);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onChange = () => setHour(readDayRolloverHour());
    window.addEventListener(DAY_ROLLOVER_CHANGED, onChange);
    return () => window.removeEventListener(DAY_ROLLOVER_CHANGED, onChange);
  }, []);

  const choose = async (next: number) => {
    if (next === hour || saving) return;
    const before = hour;
    setHour(next);
    setError(null);
    setSaving(true);
    writeDayRolloverHour(next);
    track('settings.day_rollover', { hour: next, from: before, reset: next === DEFAULT_DAY_ROLLOVER_HOUR });
    try {
      writeDayRolloverHour(await updateDayRollover(next === DEFAULT_DAY_ROLLOVER_HOUR ? null : next));
    } catch (err) {
      writeDayRolloverHour(before);
      setHour(before);
      setError(err instanceof Error && navigator.onLine ? err.message : 'You are offline — try again when you have a connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-subsetting" data-testid="day-rollover">
      <div className="settings-subsetting-title" id="day-rollover-label">New day starts at</div>
      <div className="settings-segmented settings-segmented-hours" role="radiogroup" aria-labelledby="day-rollover-label">
        {DAY_ROLLOVER_CHOICES.map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={hour === h}
            aria-label={dayRolloverLabel(h)}
            className={`settings-segment${hour === h ? ' selected' : ''}`}
            onClick={() => void choose(h)}
            disabled={saving}
            data-testid={`day-rollover-${h}`}
          >
            {h === 0 ? 'Midnight' : h}
          </button>
        ))}
      </div>
      <p className="settings-section-desc" style={{ marginTop: '0.4rem' }}>
        {hour === 0
          ? 'A new day starts at midnight: your queue, new cards and story roll over at 00:00.'
          : `Until ${dayRolloverLabel(hour)} it's still yesterday — study past midnight and your queue, new cards and story don't roll over.`}
      </p>
      {error && <div className="export-error">{error}</div>}
    </div>
  );
}
