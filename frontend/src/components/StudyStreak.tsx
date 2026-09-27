import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/database';
import { studyStreak, formatStreakTime } from '@shared/progress';
import './StudyStreak.css';

function getDaysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export function StudyStreak() {
  // Get all review events from last 30 days
  const thirtyDaysAgo = getDaysAgo(30).toISOString().slice(0, 10);

  const reviewEvents = useLiveQuery(
    () => db.reviewEvents.where('reviewed_at').aboveOrEqual(thirtyDaysAgo).toArray(),
    [thirtyDaysAgo]
  );

  // While the query is in flight render an empty card with the same structure so
  // the Study button below doesn't jump when data arrives.
  const isLoading = reviewEvents === undefined;
  if (!isLoading && reviewEvents.length === 0) {
    return null;
  }

  // Streak, today's numbers and the 30-day heatmap: shared/progress/streak.ts (the Lab
  // app's Progress tab is parity-tested against the same function).
  const { streak, today, heatmap: heatmapDays, max_count: maxCount } = studyStreak(reviewEvents ?? []);
  const todayReviews = today.reviews;
  const todayAccuracy = today.accuracy;
  const todayTimeMs = today.time_ms;
  const formatTime = formatStreakTime;

  return (
    <Link
      to="/progress"
      className="study-streak-card"
      style={{ textDecoration: 'none', color: 'inherit', visibility: isLoading ? 'hidden' : 'visible' }}
      aria-hidden={isLoading}
    >
      <div className="streak-header">
        <div className="streak-count">
          <span className="streak-fire">🔥</span>
          <span className="streak-number">{streak}</span>
          <span className="streak-label">day{streak !== 1 ? 's' : ''}</span>
        </div>
        {todayReviews > 0 && (
          <div className="streak-today">
            <span>{todayReviews} reviews</span>
            <span className="streak-sep">&middot;</span>
            <span>{todayAccuracy}%</span>
            {todayTimeMs > 0 && (
              <>
                <span className="streak-sep">&middot;</span>
                <span>{formatTime(todayTimeMs)}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="streak-heatmap">
        {heatmapDays.map((day) => {
          const intensity = day.count === 0 ? 0 : Math.max(0.25, day.count / maxCount);
          return (
            <div
              key={day.date}
              className="streak-heatmap-cell"
              style={{
                backgroundColor: day.count === 0
                  ? 'var(--streak-empty, #e5e7eb)'
                  : `rgba(34, 197, 94, ${intensity})`,
              }}
              title={`${day.date}: ${day.count} reviews`}
            />
          );
        })}
      </div>
    </Link>
  );
}
