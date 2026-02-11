import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/database';
import './StudyStreak.css';

function getDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDaysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export function StudyStreak() {
  // Get all review events from last 30 days
  const thirtyDaysAgo = getDateString(getDaysAgo(30));

  const reviewEvents = useLiveQuery(async () => {
    return db.reviewEvents
      .filter(e => e.reviewed_at >= thirtyDaysAgo)
      .toArray();
  }, [thirtyDaysAgo]);

  if (!reviewEvents || reviewEvents.length === 0) {
    return null; // Don't show anything if no study history
  }

  // Group events by date
  const eventsByDate = new Map<string, typeof reviewEvents>();
  for (const event of reviewEvents) {
    const date = event.reviewed_at.slice(0, 10);
    if (!eventsByDate.has(date)) {
      eventsByDate.set(date, []);
    }
    eventsByDate.get(date)!.push(event);
  }

  // Calculate streak (consecutive days counting back from today)
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i <= 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = getDateString(d);
    if (eventsByDate.has(dateStr)) {
      streak++;
    } else if (i === 0) {
      // Haven't studied today yet — that's ok, check yesterday
      continue;
    } else {
      break;
    }
  }

  // Today's stats
  const todayStr = getDateString(today);
  const todayEvents = eventsByDate.get(todayStr) || [];
  const todayReviews = todayEvents.length;
  const todayCorrect = todayEvents.filter(
    e => e.rating === 2 || e.rating === 3 // Good=2, Easy=3
  ).length;
  const todayAccuracy = todayReviews > 0 ? Math.round((todayCorrect / todayReviews) * 100) : 0;
  const todayTimeMs = todayEvents.reduce((sum, e) => sum + (e.time_spent_ms || 0), 0);

  // Build 30-day heatmap data (most recent on right)
  const heatmapDays: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = getDaysAgo(i);
    const dateStr = getDateString(d);
    const events = eventsByDate.get(dateStr);
    heatmapDays.push({
      date: dateStr,
      count: events ? events.length : 0,
    });
  }

  // Find max for color scaling
  const maxCount = Math.max(...heatmapDays.map(d => d.count), 1);

  return (
    <Link to="/progress" className="study-streak-card" style={{ textDecoration: 'none', color: 'inherit' }}>
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
