import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { getSession, getAudioUrl } from '../api/client';
import { Loading, ErrorMessage } from '../components/Loading';
import { RATING_INFO, CARD_TYPE_INFO } from '../types';
import { useAudioPlayer, useTTS } from '../hooks/useAudio';

export function SessionReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { speak, isSpeaking } = useTTS();

  const sessionQuery = useQuery({
    queryKey: ['session', id],
    queryFn: () => getSession(id!),
    enabled: !!id,
  });

  if (sessionQuery.isLoading) {
    return <Loading />;
  }

  if (sessionQuery.error || !sessionQuery.data) {
    return <ErrorMessage message="Failed to load session" />;
  }

  const session = sessionQuery.data;
  const reviews = session.reviews || [];

  // Calculate stats
  const totalTime = reviews.reduce((sum, r) => sum + (r.time_spent_ms || 0), 0);
  const avgTime = reviews.length > 0 ? totalTime / reviews.length : 0;
  const ratingCounts = reviews.reduce(
    (acc, r) => {
      acc[r.rating] = (acc[r.rating] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  return (
    <div className="page">
      <div className="container">
        <div className="mb-4">
          <Link to="/study" className="text-light">
            &larr; Back to Study
          </Link>
          <h1 className="mt-1">Session Review</h1>
          <p className="text-light">
            {new Date(session.started_at).toLocaleDateString()} at{' '}
            {new Date(session.started_at).toLocaleTimeString()}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 mb-4">
          <div className="card stats-card">
            <div className="stats-value">{reviews.length}</div>
            <div className="stats-label">Cards Reviewed</div>
          </div>
          <div className="card stats-card">
            <div className="stats-value">{Math.round(avgTime / 1000)}s</div>
            <div className="stats-label">Avg. Time per Card</div>
          </div>
          <div className="card stats-card">
            <div className="stats-value">{Math.round(totalTime / 1000 / 60)}m</div>
            <div className="stats-label">Total Time</div>
          </div>
        </div>

        {/* Rating breakdown */}
        <div className="card mb-4">
          <h2 className="mb-3">Rating Breakdown</h2>
          <div className="flex gap-3">
            {([0, 1, 2, 3] as const).map((rating) => (
              <div key={rating} className="text-center" style={{ flex: 1 }}>
                <div
                  style={{
                    height: '60px',
                    backgroundColor: RATING_INFO[rating].color + '20',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    padding: '4px',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      backgroundColor: RATING_INFO[rating].color,
                      borderRadius: '4px',
                      height: `${Math.min(100, ((ratingCounts[rating] || 0) / reviews.length) * 100)}%`,
                      minHeight: ratingCounts[rating] ? '4px' : '0',
                    }}
                  />
                </div>
                <div className="mt-1" style={{ fontSize: '0.875rem' }}>
                  <strong>{ratingCounts[rating] || 0}</strong> {RATING_INFO[rating].label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Individual reviews */}
        <div className="card">
          <h2 className="mb-3">Cards Reviewed</h2>
          <div className="flex flex-col gap-2">
            {reviews.map((review) => (
              <div
                key={review.id}
                className="note-card"
                style={{
                  borderLeftWidth: '4px',
                  borderLeftColor: RATING_INFO[review.rating as 0 | 1 | 2 | 3].color,
                }}
              >
                <div className="note-card-content">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="note-card-hanzi">{review.card.note.hanzi}</span>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => speak(review.card.note.hanzi)}
                      disabled={isSpeaking}
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                    >
                      {isSpeaking ? '...' : '🔊'}
                    </button>
                  </div>
                  <div className="note-card-details">
                    <span className="pinyin">{review.card.note.pinyin}</span>
                    <span> - </span>
                    <span>{review.card.note.english}</span>
                  </div>
                  <div className="mt-1" style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    <span>
                      {CARD_TYPE_INFO[review.card.card_type].prompt.split(' ').slice(0, 3).join(' ')}
                      ...
                    </span>
                    {review.user_answer && (
                      <span>
                        {' '}
                        | Your answer: <strong>{review.user_answer}</strong>
                      </span>
                    )}
                    {review.time_spent_ms && (
                      <span> | {Math.round(review.time_spent_ms / 1000)}s</span>
                    )}
                  </div>
                  {review.recording_url && (
                    <div className="mt-2">
                      <RecordingPlayer url={getAudioUrl(review.recording_url)} />
                    </div>
                  )}
                </div>
                <div
                  style={{
                    backgroundColor: RATING_INFO[review.rating as 0 | 1 | 2 | 3].color + '20',
                    color: RATING_INFO[review.rating as 0 | 1 | 2 | 3].color,
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  {RATING_INFO[review.rating as 0 | 1 | 2 | 3].label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordingPlayer({ url }: { url: string }) {
  const { isPlaying, play, stop } = useAudioPlayer(url);

  return (
    <button
      className="btn btn-sm btn-secondary"
      onClick={() => (isPlaying ? stop() : play())}
      style={{ fontSize: '0.75rem' }}
    >
      {isPlaying ? 'Stop' : 'Play Recording'}
    </button>
  );
}
