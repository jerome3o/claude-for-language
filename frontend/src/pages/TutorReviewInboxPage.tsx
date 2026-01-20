import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getTutorReviewInbox,
  getStudentSentRequests,
} from '../api/client';
import {
  TutorReviewRequestWithDetails,
  TutorReviewRequestStatus,
  RATING_INFO,
  Rating,
} from '../types';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import './TutorReviewInboxPage.css';

type ViewMode = 'inbox' | 'sent';

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d ago`;
  return date.toLocaleDateString();
}

function RequestCard({ request, viewMode }: { request: TutorReviewRequestWithDetails; viewMode: ViewMode }) {
  const otherUser = viewMode === 'inbox' ? request.student : request.tutor;
  const statusColors: Record<TutorReviewRequestStatus, string> = {
    pending: '#f59e0b',
    reviewed: '#22c55e',
    archived: '#6b7280',
  };

  return (
    <Link
      to={`/tutor-reviews/${request.id}`}
      className="review-request-card"
    >
      <div className="review-request-header">
        <div className="review-request-user">
          {otherUser.picture_url ? (
            <img src={otherUser.picture_url} alt="" className="review-request-avatar" />
          ) : (
            <div className="review-request-avatar review-request-avatar-placeholder">
              {(otherUser.name || otherUser.email || '?')[0].toUpperCase()}
            </div>
          )}
          <div className="review-request-user-info">
            <span className="review-request-name">
              {viewMode === 'inbox' ? 'From: ' : 'To: '}
              {otherUser.name || otherUser.email || 'Unknown'}
            </span>
            <span className="review-request-time">{formatTimeAgo(request.created_at)}</span>
          </div>
        </div>
        <span
          className="review-request-status"
          style={{ backgroundColor: statusColors[request.status] }}
        >
          {request.status}
        </span>
      </div>

      <div className="review-request-card-preview">
        <div className="review-request-hanzi">{request.note.hanzi}</div>
        <div className="review-request-details">
          <span className="review-request-pinyin">{request.note.pinyin}</span>
          <span className="review-request-english">{request.note.english}</span>
        </div>
      </div>

      <div className="review-request-message">
        "{request.message}"
      </div>

      {request.review_event && (
        <div className="review-request-rating">
          Rated: <span style={{
            backgroundColor: RATING_INFO[request.review_event.rating as Rating].color,
            color: 'white',
            padding: '0.125rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
          }}>
            {RATING_INFO[request.review_event.rating as Rating].label}
          </span>
          {request.review_event.user_answer && (
            <span className="review-request-answer">
              Answer: "{request.review_event.user_answer}"
            </span>
          )}
        </div>
      )}

      {request.status === 'reviewed' && request.tutor_response && (
        <div className="review-request-response">
          <strong>Response:</strong> "{request.tutor_response}"
        </div>
      )}

      <span className="review-request-arrow">→</span>
    </Link>
  );
}

export function TutorReviewInboxPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('inbox');
  const [statusFilter, setStatusFilter] = useState<TutorReviewRequestStatus | 'all'>('all');

  const inboxQuery = useQuery({
    queryKey: ['tutor-review-inbox', statusFilter === 'all' ? undefined : statusFilter],
    queryFn: () => getTutorReviewInbox(statusFilter === 'all' ? undefined : statusFilter),
    enabled: viewMode === 'inbox',
  });

  const sentQuery = useQuery({
    queryKey: ['tutor-review-sent', statusFilter === 'all' ? undefined : statusFilter],
    queryFn: () => getStudentSentRequests(statusFilter === 'all' ? undefined : statusFilter),
    enabled: viewMode === 'sent',
  });

  const isLoading = viewMode === 'inbox' ? inboxQuery.isLoading : sentQuery.isLoading;
  const error = viewMode === 'inbox' ? inboxQuery.error : sentQuery.error;
  const requests = viewMode === 'inbox' ? inboxQuery.data : sentQuery.data;

  if (isLoading) {
    return <Loading />;
  }

  if (error) {
    return <ErrorMessage message="Failed to load review requests" />;
  }

  const pendingCount = (requests || []).filter(r => r.status === 'pending').length;

  return (
    <div className="page">
      <div className="container">
        <div className="review-inbox-header">
          <h1>Review Requests</h1>
        </div>

        {/* View toggle */}
        <div className="review-inbox-tabs">
          <button
            className={`review-inbox-tab ${viewMode === 'inbox' ? 'active' : ''}`}
            onClick={() => setViewMode('inbox')}
          >
            Inbox
            {viewMode === 'inbox' && pendingCount > 0 && (
              <span className="review-inbox-badge">{pendingCount}</span>
            )}
          </button>
          <button
            className={`review-inbox-tab ${viewMode === 'sent' ? 'active' : ''}`}
            onClick={() => setViewMode('sent')}
          >
            Sent
          </button>
        </div>

        {/* Status filter */}
        <div className="review-inbox-filters">
          <select
            className="form-input form-input-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TutorReviewRequestStatus | 'all')}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Request list */}
        {!requests || requests.length === 0 ? (
          <EmptyState
            icon={viewMode === 'inbox' ? '📥' : '📤'}
            title={viewMode === 'inbox' ? 'No review requests' : 'No sent requests'}
            description={
              viewMode === 'inbox'
                ? 'When students flag cards for your review, they will appear here.'
                : 'When you flag cards for your tutor to review, they will appear here.'
            }
          />
        ) : (
          <div className="review-request-list">
            {requests.map((request) => (
              <RequestCard key={request.id} request={request} viewMode={viewMode} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
