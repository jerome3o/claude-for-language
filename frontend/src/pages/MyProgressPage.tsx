import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMyDailyProgress } from '../api/client';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { formatTime } from '../components/DeckProgress';
import { KnownCountsSection } from '../components/progress/KnownCounts';
import './StudentProgressPage.css';

function formatDate(dateStr: string): { day: string; full: string } {
  const date = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const full = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  if (isToday) {
    return { day: 'Today', full };
  } else if (isYesterday) {
    return { day: 'Yesterday', full };
  } else {
    return {
      day: date.toLocaleDateString('en-US', { weekday: 'short' }),
      full,
    };
  }
}

export function MyProgressPage() {
  const progressQuery = useQuery({
    queryKey: ['myDailyProgress'],
    queryFn: () => getMyDailyProgress(),
  });

  const progress = progressQuery.data;

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="progress-header">
          <h1>My Progress</h1>
        </div>

        {/* Computed on the device: works offline even when the server numbers can't load. */}
        <KnownCountsSection />

        {progressQuery.isLoading && <Loading />}
        {progressQuery.error && (
          <ErrorMessage
            message={progressQuery.error instanceof Error ? progressQuery.error.message : 'Failed to load progress'}
          />
        )}
        {progress && (<>
        {/* 30-Day Summary */}
        <div className="summary-section">
          <h2>30-Day Summary</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{progress.summary.total_reviews_30d}</div>
              <div className="stat-label">Reviews</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{progress.summary.total_days_active}</div>
              <div className="stat-label">Days Active</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{progress.summary.average_accuracy}%</div>
              <div className="stat-label">Accuracy</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatTime(progress.summary.total_time_ms)}</div>
              <div className="stat-label">Study Time</div>
            </div>
          </div>
        </div>

        {/* Daily Activity */}
        <div className="progress-section">
          <h2>Daily Activity</h2>
          {progress.days.length === 0 ? (
            <EmptyState
              icon="📅"
              title="No activity yet"
              description="Start studying to see your progress here"
            />
          ) : (
            <div className="daily-list">
              {progress.days.map((day) => {
                const { day: dayLabel, full } = formatDate(day.date);
                return (
                  <Link
                    key={day.date}
                    to={`/progress/day/${day.date}`}
                    className="daily-item"
                  >
                    <div className="daily-item-header">
                      <span className="daily-day">{dayLabel}</span>
                      <span className="daily-date">({full})</span>
                      <span className="daily-arrow">→</span>
                    </div>
                    <div className="daily-stats">
                      <span>{day.reviews_count} reviews</span>
                      <span className="stat-separator">•</span>
                      <span>{day.unique_cards} cards</span>
                      <span className="stat-separator">•</span>
                      <span>{day.accuracy}%</span>
                      <span className="stat-separator">•</span>
                      <span>{formatTime(day.time_spent_ms)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
