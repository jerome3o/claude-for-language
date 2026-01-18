import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getOverviewStats, getDecks } from '../api/client';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';

export function HomePage() {
  const statsQuery = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: getOverviewStats,
  });

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
  });

  if (statsQuery.isLoading || decksQuery.isLoading) {
    return <Loading />;
  }

  if (statsQuery.error) {
    return <ErrorMessage message="Failed to load statistics" />;
  }

  const stats = statsQuery.data;
  const decks = decksQuery.data || [];

  return (
    <div className="page">
      <div className="container">
        <h1 className="mb-4">Welcome to 汉语学习</h1>

        {/* Stats Overview */}
        <div className="grid grid-cols-3 mb-4">
          <div className="card stats-card">
            <div className="stats-value">{stats?.cards_due_today || 0}</div>
            <div className="stats-label">Cards Due Today</div>
          </div>
          <div className="card stats-card">
            <div className="stats-value">{stats?.cards_studied_today || 0}</div>
            <div className="stats-label">Studied Today</div>
          </div>
          <div className="card stats-card">
            <div className="stats-value">{stats?.total_cards || 0}</div>
            <div className="stats-label">Total Cards</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card mb-4">
          <h2 className="mb-3">Quick Actions</h2>
          <div className="quick-links">
            {(stats?.cards_due_today || 0) > 0 ? (
              <Link to="/study" className="btn btn-primary btn-lg btn-block">
                Study Now ({stats?.cards_due_today} due)
              </Link>
            ) : (
              <Link to="/study" className="btn btn-secondary btn-lg btn-block">
                Study (no cards due)
              </Link>
            )}
            <Link to="/generate" className="btn btn-secondary btn-lg btn-block">
              Generate with AI
            </Link>
            <Link to="/decks" className="btn btn-secondary btn-lg btn-block">
              View Decks
            </Link>
          </div>
        </div>

        {/* Recent Decks */}
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <h2>Your Decks</h2>
            <Link to="/decks" className="btn btn-sm btn-secondary">
              View All
            </Link>
          </div>

          {decks.length === 0 ? (
            <EmptyState
              icon="📖"
              title="No decks yet"
              description="Create your first deck or use AI to generate one"
              action={
                <div className="flex gap-2 justify-center">
                  <Link to="/decks/new" className="btn btn-primary">
                    Create Deck
                  </Link>
                  <Link to="/generate" className="btn btn-secondary">
                    AI Generate
                  </Link>
                </div>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {decks.slice(0, 4).map((deck) => (
                <Link key={deck.id} to={`/decks/${deck.id}`} className="deck-card">
                  <div className="deck-card-title">{deck.name}</div>
                  {deck.description && (
                    <p className="text-light" style={{ fontSize: '0.875rem' }}>
                      {deck.description}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
