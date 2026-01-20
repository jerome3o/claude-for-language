import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTutorReviewRequest,
  respondToTutorReviewRequest,
  archiveTutorReviewRequest,
  API_BASE,
} from '../api/client';
import {
  RATING_INFO,
  Rating,
  CARD_TYPE_INFO,
} from '../types';
import { Loading, ErrorMessage } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { useNoteAudio } from '../hooks/useAudio';
import './TutorReviewDetailPage.css';

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

export function TutorReviewDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [response, setResponse] = useState('');
  const { isPlaying, play: playAudio } = useNoteAudio();

  const requestQuery = useQuery({
    queryKey: ['tutor-review-request', requestId],
    queryFn: () => getTutorReviewRequest(requestId!),
    enabled: !!requestId,
  });

  const respondMutation = useMutation({
    mutationFn: (responseText: string) => respondToTutorReviewRequest(requestId!, responseText),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tutor-review-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['tutor-review-inbox'] });
      setResponse('');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveTutorReviewRequest(requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tutor-review-inbox'] });
      navigate('/tutor-reviews');
    },
  });

  if (requestQuery.isLoading) {
    return <Loading />;
  }

  if (requestQuery.error || !requestQuery.data) {
    return <ErrorMessage message="Failed to load review request" />;
  }

  const request = requestQuery.data;
  const isTutor = user?.id === request.tutor_id;
  const isStudent = user?.id === request.student_id;
  const canRespond = isTutor && request.status === 'pending';

  const handleRespond = () => {
    if (!response.trim()) return;
    respondMutation.mutate(response.trim());
  };

  const handleArchive = () => {
    if (confirm('Archive this request? It will be hidden from your inbox.')) {
      archiveMutation.mutate();
    }
  };

  const playRecording = (recordingUrl: string) => {
    const audio = new Audio(`${API_BASE}/api/audio/${recordingUrl}`);
    audio.play();
  };

  return (
    <div className="page">
      <div className="container">
        <Link to="/tutor-reviews" className="back-link">← Back to Review Requests</Link>

        <div className="review-detail-header">
          <h1>Review Request</h1>
          <span
            className="review-detail-status"
            style={{
              backgroundColor:
                request.status === 'pending' ? '#f59e0b' :
                request.status === 'reviewed' ? '#22c55e' : '#6b7280'
            }}
          >
            {request.status}
          </span>
        </div>

        {/* From/To info */}
        <div className="review-detail-section">
          <div className="review-detail-users">
            <div className="review-detail-user">
              <span className="review-detail-user-label">From Student:</span>
              <div className="review-detail-user-info">
                {request.student.picture_url ? (
                  <img src={request.student.picture_url} alt="" className="review-detail-avatar" />
                ) : (
                  <div className="review-detail-avatar review-detail-avatar-placeholder">
                    {(request.student.name || request.student.email || '?')[0].toUpperCase()}
                  </div>
                )}
                <span>{request.student.name || request.student.email}</span>
              </div>
            </div>
            <div className="review-detail-user">
              <span className="review-detail-user-label">To Tutor:</span>
              <div className="review-detail-user-info">
                {request.tutor.picture_url ? (
                  <img src={request.tutor.picture_url} alt="" className="review-detail-avatar" />
                ) : (
                  <div className="review-detail-avatar review-detail-avatar-placeholder">
                    {(request.tutor.name || request.tutor.email || '?')[0].toUpperCase()}
                  </div>
                )}
                <span>{request.tutor.name || request.tutor.email}</span>
              </div>
            </div>
          </div>
          <div className="review-detail-timestamp">
            Sent: {formatDateTime(request.created_at)}
          </div>
        </div>

        {/* Card details */}
        <div className="review-detail-section">
          <h2>Card</h2>
          <div className="review-detail-card">
            <div className="review-detail-card-main">
              <div className="review-detail-hanzi">{request.note.hanzi}</div>
              <div className="review-detail-pinyin">{request.note.pinyin}</div>
              <div className="review-detail-english">{request.note.english}</div>
              {request.note.fun_facts && (
                <div className="review-detail-fun-facts">{request.note.fun_facts}</div>
              )}
            </div>

            <div className="review-detail-card-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => playAudio(request.note.audio_url || null, request.note.hanzi, API_BASE, request.note.updated_at)}
                disabled={isPlaying}
              >
                {isPlaying ? 'Playing...' : 'Play Audio'}
              </button>
              <Link
                to={`/decks/${request.deck.id}`}
                className="btn btn-secondary btn-sm"
              >
                View in Deck: {request.deck.name}
              </Link>
            </div>
          </div>

          <div className="review-detail-card-type">
            Card Type: <strong>{CARD_TYPE_INFO[request.card.card_type].prompt}</strong>
          </div>
        </div>

        {/* Review event details */}
        {request.review_event && (
          <div className="review-detail-section">
            <h2>Review Details</h2>
            <div className="review-detail-review">
              <div className="review-detail-review-row">
                <span className="review-detail-label">Rating:</span>
                <span
                  className="review-detail-rating"
                  style={{ backgroundColor: RATING_INFO[request.review_event.rating as Rating].color }}
                >
                  {RATING_INFO[request.review_event.rating as Rating].label}
                </span>
              </div>

              {request.review_event.user_answer && (
                <div className="review-detail-review-row">
                  <span className="review-detail-label">Student's Answer:</span>
                  <span className="review-detail-answer">"{request.review_event.user_answer}"</span>
                </div>
              )}

              {request.review_event.time_spent_ms && (
                <div className="review-detail-review-row">
                  <span className="review-detail-label">Time Spent:</span>
                  <span>{(request.review_event.time_spent_ms / 1000).toFixed(1)}s</span>
                </div>
              )}

              <div className="review-detail-review-row">
                <span className="review-detail-label">Reviewed At:</span>
                <span>{formatDateTime(request.review_event.reviewed_at)}</span>
              </div>

              {request.review_event.recording_url && (
                <div className="review-detail-review-row">
                  <span className="review-detail-label">Recording:</span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => playRecording(request.review_event!.recording_url!)}
                  >
                    Play Student's Recording
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Student's message */}
        <div className="review-detail-section">
          <h2>Student's Message</h2>
          <div className="review-detail-message">
            "{request.message}"
          </div>
        </div>

        {/* Tutor's response */}
        {request.status === 'reviewed' && request.tutor_response && (
          <div className="review-detail-section">
            <h2>Tutor's Response</h2>
            <div className="review-detail-response">
              "{request.tutor_response}"
              {request.responded_at && (
                <div className="review-detail-response-time">
                  Responded: {formatDateTime(request.responded_at)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Response form (tutor only, pending status) */}
        {canRespond && (
          <div className="review-detail-section">
            <h2>Your Response</h2>
            <div className="review-detail-form">
              <textarea
                className="form-input"
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Write your response to the student..."
                rows={4}
              />
              <button
                className="btn btn-primary"
                onClick={handleRespond}
                disabled={!response.trim() || respondMutation.isPending}
              >
                {respondMutation.isPending ? 'Sending...' : 'Send Response'}
              </button>
            </div>
          </div>
        )}

        {/* Archive button */}
        {(isTutor || isStudent) && request.status !== 'archived' && (
          <div className="review-detail-actions">
            <button
              className="btn btn-secondary"
              onClick={handleArchive}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? 'Archiving...' : 'Archive Request'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
