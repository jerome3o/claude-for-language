import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStudentCardReviews, getRelationship, getAudioUrl, API_BASE } from '../api/client';
import { Loading, ErrorMessage } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { useAudioPlayer, useNoteAudio } from '../hooks/useAudio';
import { getMyRoleInRelationship, CardType, RATING_INFO } from '../types';
import './CardReviewDetailPage.css';

function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds} sec`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  return `${minutes}m ${remainingSecs}s`;
}

const CARD_TYPE_LABELS: Record<CardType, string> = {
  hanzi_to_meaning: 'Hanzi → Meaning',
  meaning_to_hanzi: 'Meaning → Hanzi',
  audio_to_hanzi: 'Audio → Hanzi',
};

function RatingBadge({ rating }: { rating: number }) {
  const info = RATING_INFO[rating as keyof typeof RATING_INFO];
  return (
    <span
      className="rating-badge"
      style={{ backgroundColor: info?.color || '#888' }}
    >
      {info?.label || `Rating ${rating}`}
    </span>
  );
}

function RecordingPlayer({ url }: { url: string }) {
  const fullUrl = getAudioUrl(url);
  const { isPlaying, play, stop } = useAudioPlayer(fullUrl);

  return (
    <button
      className={`play-recording-btn ${isPlaying ? 'playing' : ''}`}
      onClick={() => isPlaying ? stop() : play()}
    >
      {isPlaying ? '⏹ Stop' : '▶ Play Recording'}
    </button>
  );
}

export function CardReviewDetailPage() {
  const { relId, date, cardId } = useParams<{ relId: string; date: string; cardId: string }>();
  const { user } = useAuth();
  const noteAudio = useNoteAudio();

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  const cardReviewsQuery = useQuery({
    queryKey: ['studentCardReviews', relId, date, cardId],
    queryFn: () => getStudentCardReviews(relId!, date!, cardId!),
    enabled: !!relId && !!date && !!cardId,
  });

  if (relationshipQuery.isLoading || cardReviewsQuery.isLoading) {
    return <Loading />;
  }

  if (relationshipQuery.error) {
    return <ErrorMessage message="Connection not found" />;
  }

  if (cardReviewsQuery.error) {
    const msg = cardReviewsQuery.error instanceof Error ? cardReviewsQuery.error.message : 'Failed to load card reviews';
    return <ErrorMessage message={msg} />;
  }

  const relationship = relationshipQuery.data!;
  const myRole = getMyRoleInRelationship(relationship, user!.id);

  if (myRole !== 'tutor') {
    return <ErrorMessage message="Only tutors can view student progress" />;
  }

  const cardData = cardReviewsQuery.data!;
  const { card, reviews } = cardData;

  const handlePlayAudio = () => {
    noteAudio.play(card.note.audio_url, card.note.hanzi, API_BASE);
  };

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="review-detail-header">
          <Link to={`/connections/${relId}/progress/day/${date}`} className="back-link">← Back to Day</Link>
          <span className="review-date">{formatDateFull(date!)}</span>
        </div>

        {/* Card Info */}
        <div className="card-info-box">
          <div className="card-info-hanzi">{card.note.hanzi}</div>
          <div className="card-info-pinyin">{card.note.pinyin}</div>
          <div className="card-info-english">{card.note.english}</div>
          <button
            className={`play-audio-btn ${noteAudio.isPlaying ? 'playing' : ''}`}
            onClick={handlePlayAudio}
          >
            {noteAudio.isPlaying ? '⏹ Stop' : '▶ Play Audio'}
          </button>
          <div className="card-info-type">
            Card type: {CARD_TYPE_LABELS[card.card_type]}
          </div>
        </div>

        {/* Reviews */}
        <div className="reviews-section">
          <h2>Reviews on this day ({reviews.length})</h2>
          <div className="reviews-list">
            {reviews.map((review) => (
              <div key={review.id} className="review-item">
                <div className="review-header">
                  <span className="review-time">{formatTime(review.reviewed_at)}</span>
                  <RatingBadge rating={review.rating} />
                  <span className="review-duration">{formatDuration(review.time_spent_ms)}</span>
                </div>

                {review.user_answer && (
                  <div className="review-answer">
                    <span className="answer-label">Answer:</span>
                    <span className="answer-text">{review.user_answer}</span>
                    {review.user_answer === card.note.hanzi ? (
                      <span className="answer-correct">✓</span>
                    ) : (
                      <span className="answer-incorrect">✗</span>
                    )}
                  </div>
                )}

                {review.recording_url && (
                  <div className="review-recording">
                    <RecordingPlayer url={review.recording_url} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
