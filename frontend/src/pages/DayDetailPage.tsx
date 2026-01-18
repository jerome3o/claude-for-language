import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStudentDayCards, getRelationship } from '../api/client';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { getMyRoleInRelationship, CardType, RATING_INFO } from '../types';
import './DayDetailPage.css';

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const CARD_TYPE_LABELS: Record<CardType, string> = {
  hanzi_to_meaning: 'Hanzi → Meaning',
  meaning_to_hanzi: 'Meaning → Hanzi',
  audio_to_hanzi: 'Audio → Hanzi',
};

function RatingDots({ ratings }: { ratings: number[] }) {
  // Show last 5 ratings
  const displayRatings = ratings.slice(-5);
  return (
    <span className="rating-dots">
      {displayRatings.map((r, i) => (
        <span
          key={i}
          className={`dot ${r >= 2 ? 'correct' : 'incorrect'}`}
          title={RATING_INFO[r as keyof typeof RATING_INFO]?.label || `Rating ${r}`}
        >
          ●
        </span>
      ))}
    </span>
  );
}

export function DayDetailPage() {
  const { relId, date } = useParams<{ relId: string; date: string }>();
  const { user } = useAuth();

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  const dayCardsQuery = useQuery({
    queryKey: ['studentDayCards', relId, date],
    queryFn: () => getStudentDayCards(relId!, date!),
    enabled: !!relId && !!date,
  });

  if (relationshipQuery.isLoading || dayCardsQuery.isLoading) {
    return <Loading />;
  }

  if (relationshipQuery.error) {
    return <ErrorMessage message="Connection not found" />;
  }

  if (dayCardsQuery.error) {
    const msg = dayCardsQuery.error instanceof Error ? dayCardsQuery.error.message : 'Failed to load day details';
    return <ErrorMessage message={msg} />;
  }

  const relationship = relationshipQuery.data!;
  const myRole = getMyRoleInRelationship(relationship, user!.id);

  if (myRole !== 'tutor') {
    return <ErrorMessage message="Only tutors can view student progress" />;
  }

  const dayData = dayCardsQuery.data!;
  const { summary, cards } = dayData;

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="day-header">
          <Link to={`/connections/${relId}/progress`} className="back-link">← Back to Progress</Link>
          <h1>{formatDateFull(date!)}</h1>
        </div>

        {/* Day Summary */}
        <div className="day-summary">
          <span>{summary.total_reviews} reviews</span>
          <span className="stat-separator">•</span>
          <span>{summary.unique_cards} cards</span>
          <span className="stat-separator">•</span>
          <span>{summary.accuracy}%</span>
          <span className="stat-separator">•</span>
          <span>{formatTime(summary.time_spent_ms)}</span>
        </div>

        {/* Cards List */}
        <div className="cards-section">
          <h2>Cards Reviewed <span className="subtitle">(most difficult first)</span></h2>
          {cards.length === 0 ? (
            <EmptyState
              icon="📚"
              title="No cards"
              description="No cards were reviewed on this day"
            />
          ) : (
            <div className="cards-list">
              {cards.map((card) => (
                <Link
                  key={card.card_id}
                  to={`/connections/${relId}/progress/day/${date}/card/${card.card_id}`}
                  className="card-item"
                >
                  <div className="card-item-main">
                    <div className="card-hanzi">{card.note.hanzi}</div>
                    <div className="card-pinyin">{card.note.pinyin}</div>
                    <div className="card-english">{card.note.english}</div>
                  </div>
                  <div className="card-item-meta">
                    <div className="card-type-badge">
                      {CARD_TYPE_LABELS[card.card_type]}
                    </div>
                    <div className="card-stats">
                      <span className="review-count">{card.review_count} review{card.review_count !== 1 ? 's' : ''}</span>
                      <RatingDots ratings={card.ratings} />
                    </div>
                    {(card.has_answers || card.has_recordings) && (
                      <div className="card-indicators">
                        {card.has_answers && <span className="indicator" title="Has typed answers">📝</span>}
                        {card.has_recordings && <span className="indicator" title="Has recordings">🎤</span>}
                      </div>
                    )}
                  </div>
                  <span className="card-arrow">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
