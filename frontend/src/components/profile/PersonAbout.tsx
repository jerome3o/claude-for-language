import { useEffect, useState } from 'react';
import { localTimeLabel } from '@shared/profile';
import './profile.css';

/** The current time, re-rendered every `everyMs` (for a live "local time" line). */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/**
 * What someone wrote about themselves on their Profile + their local time —
 * under the name on a tutor / student page, on the /join page and in the
 * Profile screen's preview. Renders nothing when both are empty.
 */
export function PersonAbout({ about, timeZone, compact = false }: { about?: string | null; timeZone?: string | null; compact?: boolean }) {
  const now = useNow();
  const time = localTimeLabel(timeZone, now);
  if (!about && !time) return null;
  return (
    <div className={`person-about ${compact ? 'person-about-compact' : ''}`}>
      {about && <p className="person-about-text">{about}</p>}
      {time && (
        <div className="person-about-time" title={timeZone ?? undefined}>
          <span aria-hidden="true">🕘</span> {time}
        </div>
      )}
    </div>
  );
}
