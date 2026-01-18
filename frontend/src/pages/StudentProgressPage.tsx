import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStudentDailyProgress, getRelationship } from '../api/client';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { getMyRoleInRelationship } from '../types';
import './StudentProgressPage.css';

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function formatDate(dateStr: string): { day: string; full: string } {
  const date = new Date(dateStr + 'T12:00:00'); // Add time to avoid timezone issues
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

export function StudentProgressPage() {
  const { relId } = useParams<{ relId: string }>();
  const { user } = useAuth();

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  const progressQuery = useQuery({
    queryKey: ['studentDailyProgress', relId],
    queryFn: () => getStudentDailyProgress(relId!),
    enabled: !!relId,
  });

  if (relationshipQuery.isLoading || progressQuery.isLoading) {
    return <Loading />;
  }

  if (relationshipQuery.error) {
    return <ErrorMessage message="Connection not found" />;
  }

  if (progressQuery.error) {
    const msg = progressQuery.error instanceof Error ? progressQuery.error.message : 'Failed to load progress';
    return <ErrorMessage message={msg} />;
  }

  const relationship = relationshipQuery.data!;
  const myRole = getMyRoleInRelationship(relationship, user!.id);

  // Only tutors can view student progress
  if (myRole !== 'tutor') {
    return <ErrorMessage message="Only tutors can view student progress" />;
  }

  const progress = progressQuery.data!;
  const { student, summary, days } = progress;

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="progress-header">
          <Link to={`/connections/${relId}`} className="back-link">← Back</Link>
          <div className="progress-user">
            {student.picture_url ? (
              <img src={student.picture_url} alt="" className="progress-avatar" />
            ) : (
              <div className="progress-avatar placeholder">
                {(student.name || student.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <h1>{student.name || 'Unknown'}'s Progress</h1>
              <span className="progress-email">{student.email}</span>
            </div>
          </div>
        </div>

        {/* 30-Day Summary */}
        <div className="summary-section">
          <h2>30-Day Summary</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{summary.total_reviews_30d}</div>
              <div className="stat-label">Reviews</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.total_days_active}</div>
              <div className="stat-label">Days Active</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.average_accuracy}%</div>
              <div className="stat-label">Accuracy</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatTime(summary.total_time_ms)}</div>
              <div className="stat-label">Study Time</div>
            </div>
          </div>
        </div>

        {/* Daily Activity */}
        <div className="progress-section">
          <h2>Daily Activity</h2>
          {days.length === 0 ? (
            <EmptyState
              icon="📅"
              title="No activity yet"
              description="Your student hasn't studied in the last 30 days"
            />
          ) : (
            <div className="daily-list">
              {days.map((day) => {
                const { day: dayLabel, full } = formatDate(day.date);
                return (
                  <Link
                    key={day.date}
                    to={`/connections/${relId}/progress/day/${day.date}`}
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
      </div>
    </div>
  );
}
