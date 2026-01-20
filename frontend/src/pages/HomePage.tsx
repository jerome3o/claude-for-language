import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { getOverviewStats, getDecks, createDeck, getDeckStats } from '../api/client';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { Deck, QueueCounts } from '../types';
import { useOfflineQueueCounts, useOfflineDecks } from '../hooks/useOfflineData';

// Queue counts display component
function QueueCountsBadge({ counts }: { counts: QueueCounts }) {
  return (
    <div className="queue-counts" style={{ fontSize: '0.875rem' }}>
      <span style={{ color: '#3b82f6', fontWeight: 600 }}>{counts.new}</span>
      <span style={{ color: '#9ca3af' }}>+</span>
      <span style={{ color: '#f97316', fontWeight: 600 }}>{counts.learning}</span>
      <span style={{ color: '#9ca3af' }}>+</span>
      <span style={{ color: '#22c55e', fontWeight: 600 }}>{counts.review}</span>
    </div>
  );
}

function DeckCard({ deck }: { deck: Deck }) {
  const statsQuery = useQuery({
    queryKey: ['deckStats', deck.id],
    queryFn: () => getDeckStats(deck.id),
  });

  // Get offline queue counts for this specific deck
  const { counts: offlineCounts } = useOfflineQueueCounts(deck.id);

  const stats = statsQuery.data;
  const totalDue = offlineCounts.new + offlineCounts.learning + offlineCounts.review;

  return (
    <div className="deck-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Link to={`/decks/${deck.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="deck-card-title">{deck.name}</div>
        {deck.description && (
          <p className="text-light mb-2" style={{ fontSize: '0.875rem' }}>
            {deck.description}
          </p>
        )}
        {stats && (
          <div className="deck-card-stats">
            <span>{stats.total_notes} notes</span>
            {stats.cards_mastered > 0 && <span>{stats.cards_mastered} mastered</span>}
          </div>
        )}
      </Link>

      {/* Study button with offline queue counts */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
        <QueueCountsBadge counts={offlineCounts} />
        <Link
          to={`/study?deck=${deck.id}`}
          className="btn btn-primary btn-sm"
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
        >
          Study {totalDue > 0 ? `(${totalDue})` : ''}
        </Link>
      </div>
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const statsQuery = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: getOverviewStats,
  });

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
  });

  // Pass API decks to detect mismatch with IndexedDB and auto-sync
  const { isSyncing } = useOfflineDecks(decksQuery.data);

  const createMutation = useMutation({
    mutationFn: () => createDeck(name, description || undefined),
    onSuccess: (deck) => {
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      setShowModal(false);
      setName('');
      setDescription('');
      navigate(`/decks/${deck.id}`);
    },
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

        {/* Study Button */}
        <div className="card mb-4">
          {(stats?.cards_due_today || 0) > 0 ? (
            <Link to="/study" className="btn btn-primary btn-lg btn-block">
              Study Now ({stats?.cards_due_today} due)
            </Link>
          ) : (
            <Link to="/study" className="btn btn-secondary btn-lg btn-block">
              Study (no cards due)
            </Link>
          )}
        </div>

        {/* Your Decks */}
        <div className="card" style={{ position: 'relative' }}>
          <h2 className="mb-3">Your Decks</h2>

          {isSyncing && (
            <div style={{
              position: 'absolute',
              top: '0.5rem',
              right: '0.5rem',
              padding: '0.25rem 0.5rem',
              background: '#dbeafe',
              color: '#1d4ed8',
              borderRadius: '1rem',
              fontSize: '0.6875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              <span style={{
                width: '0.5rem',
                height: '0.5rem',
                border: '1.5px solid #93c5fd',
                borderTopColor: '#3b82f6',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></span>
              Syncing
            </div>
          )}

          {decks.length === 0 ? (
            <EmptyState
              icon="📖"
              title="No decks yet"
              description="Create your first deck or use AI to generate one"
              action={
                <div className="flex gap-2 justify-center">
                  <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                    Create Deck
                  </button>
                  <Link to="/generate" className="btn btn-secondary">
                    Generate
                  </Link>
                </div>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {decks.map((deck) => (
                  <DeckCard key={deck.id} deck={deck} />
                ))}
              </div>

              {/* Action buttons at bottom of deck list */}
              <div className="flex gap-2 justify-center" style={{ paddingTop: '1rem', borderTop: '1px solid #e5e7eb' }}>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                  New Deck
                </button>
                <Link to="/generate" className="btn btn-secondary">
                  Generate
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Create Deck Modal */}
        {showModal && (
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Create New Deck</h2>
                <button className="modal-close" onClick={() => setShowModal(false)}>
                  &times;
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate();
                }}
              >
                <div className="form-group">
                  <label className="form-label">Deck Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Restaurant Vocabulary"
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Description (optional)</label>
                  <textarea
                    className="form-textarea"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What will you learn in this deck?"
                  />
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!name.trim() || createMutation.isPending}
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create Deck'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
