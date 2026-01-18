import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStudentProgress, getRelationship } from '../api/client';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { getMyRoleInRelationship } from '../types';
import './StudentProgressPage.css';

export function StudentProgressPage() {
  const { relId } = useParams<{ relId: string }>();
  const { user } = useAuth();

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  const progressQuery = useQuery({
    queryKey: ['studentProgress', relId],
    queryFn: () => getStudentProgress(relId!),
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
  const { stats, decks } = progress;

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="progress-header">
          <Link to={`/connections/${relId}`} className="back-link">← Back</Link>
          <div className="progress-user">
            {progress.user.picture_url ? (
              <img src={progress.user.picture_url} alt="" className="progress-avatar" />
            ) : (
              <div className="progress-avatar placeholder">
                {(progress.user.name || progress.user.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <h1>{progress.user.name || 'Unknown'}'s Progress</h1>
              <span className="progress-email">{progress.user.email}</span>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.cards_studied_today}</div>
            <div className="stat-label">Studied Today</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.cards_due_today}</div>
            <div className="stat-label">Due Today</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.cards_studied_this_week}</div>
            <div className="stat-label">This Week</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.average_accuracy}%</div>
            <div className="stat-label">Accuracy</div>
          </div>
        </div>

        {/* Total Stats */}
        <div className="total-stats">
          <span className="total-stat">
            <strong>{stats.total_cards}</strong> total cards
          </span>
        </div>

        {/* Decks */}
        <div className="progress-section">
          <h2>Decks</h2>
          {decks.length === 0 ? (
            <EmptyState
              icon="📚"
              title="No decks yet"
              description="Your student hasn't created any decks"
            />
          ) : (
            <div className="deck-progress-list">
              {decks.map((deck) => {
                const masteredPercent = deck.total_notes > 0
                  ? Math.round((deck.cards_mastered / (deck.total_notes * 3)) * 100)
                  : 0;
                return (
                  <div key={deck.id} className="deck-progress-card">
                    <div className="deck-progress-header">
                      <span className="deck-progress-name">{deck.name}</span>
                      <span className="deck-progress-notes">{deck.total_notes} notes</span>
                    </div>
                    <div className="deck-progress-bar">
                      <div
                        className="deck-progress-fill"
                        style={{ width: `${masteredPercent}%` }}
                      />
                    </div>
                    <div className="deck-progress-stats">
                      <span>{deck.cards_due} due</span>
                      <span>{deck.cards_mastered} mastered ({masteredPercent}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
