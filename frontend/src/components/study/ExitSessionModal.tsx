import { useEffect } from 'react';
import { SessionStats } from '../../hooks/useStudySession';
import { OverviewStats } from '../../types';
import { SessionRecap } from './SessionRecap';

/**
 * Shown when ✕ is tapped mid-session after at least one review: the recap
 * the learner would otherwise only see on the All Done screen, and a clear
 * "End session?" so a stray tap doesn't end the sitting.
 */
export function ExitSessionModal({
  stats,
  dayStats,
  todayTotalTimeMs,
  onKeepStudying,
  onEndSession,
}: {
  stats: SessionStats;
  dayStats?: OverviewStats | null;
  todayTotalTimeMs?: number;
  onKeepStudying: () => void;
  onEndSession: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onKeepStudying();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKeepStudying]);

  const n = stats.totalReviews;

  return (
    <div className="modal-overlay study-exit-overlay" onClick={onKeepStudying} role="presentation">
      <div
        className="modal study-exit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-exit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="study-exit-title">End session?</div>
          <button className="modal-close" onClick={onKeepStudying} aria-label="Keep studying">×</button>
        </div>
        <p className="text-light study-exit-lede">
          {n === 1 ? 'Your review is saved.' : `Your ${n} reviews are saved.`} Here's how it went:
        </p>
        <SessionRecap stats={stats} dayStats={dayStats} todayTotalTimeMs={todayTotalTimeMs} />
        <div className="modal-actions">
          <button className="btn btn-primary btn-block" onClick={onKeepStudying} autoFocus>
            Keep studying
          </button>
          <button className="btn btn-secondary btn-block" onClick={onEndSession}>
            End session
          </button>
        </div>
      </div>
    </div>
  );
}
