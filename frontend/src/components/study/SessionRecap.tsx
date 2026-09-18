import { SessionStats } from '../../hooks/useStudySession';
import { OverviewStats } from '../../types';

export function formatTimeMs(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * The session's numbers: reviews, accuracy, time, streak, leeches, plus
 * today's totals when they are known. Shown on the All Done screen and in
 * the "End session?" confirm when the learner leaves early.
 */
export function SessionRecap({
  stats,
  dayStats,
  todayTotalTimeMs,
}: {
  stats: SessionStats;
  dayStats?: OverviewStats | null;
  todayTotalTimeMs?: number;
}) {
  if (stats.totalReviews === 0) return null;

  const accuracy = Math.round((stats.correctCount / stats.totalReviews) * 100);
  const sessionTimeMs = Date.now() - stats.timeStarted;
  const sessionTimeStr = formatTimeMs(sessionTimeMs);
  // Total today = previous time from backend + current session time
  const totalTodayMs = (todayTotalTimeMs || 0) + sessionTimeMs;
  const totalTodayStr = formatTimeMs(totalTodayMs);
  const leechCount = stats.cardsRatedAgainMultiple.size;

  return (
    <div className="session-recap">
      <h3>Session Recap</h3>
      <div className="recap-grid">
        <div className="recap-stat">
          <div className="recap-stat-value">{stats.totalReviews}</div>
          <div className="recap-stat-label">Reviews</div>
        </div>
        <div className="recap-stat">
          <div className="recap-stat-value">{accuracy}%</div>
          <div className="recap-stat-label">Accuracy</div>
        </div>
        <div className="recap-stat">
          <div className="recap-stat-value">{totalTodayStr}</div>
          <div className="recap-stat-label">Total Study Time Today</div>
        </div>
        <div className="recap-stat">
          <div className="recap-stat-value">{sessionTimeStr}</div>
          <div className="recap-stat-label">This Session</div>
        </div>
        <div className="recap-stat">
          <div className="recap-stat-value">{stats.bestStreak}</div>
          <div className="recap-stat-label">Best Streak</div>
        </div>
        {leechCount > 0 && (
          <div className="recap-stat recap-attention">
            <div className="recap-stat-value">{leechCount}</div>
            <div className="recap-stat-label">Cards needing attention</div>
          </div>
        )}
      </div>
      {dayStats && (
        <>
          <h3 style={{ marginTop: '1rem' }}>Today's Progress</h3>
          <div className="recap-grid">
            <div className="recap-stat">
              <div className="recap-stat-value">{dayStats.cards_studied_today}</div>
              <div className="recap-stat-label">Total Reviews Today</div>
            </div>
            <div className="recap-stat">
              <div className="recap-stat-value">{dayStats.cards_due_today}</div>
              <div className="recap-stat-label">Still Due</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
