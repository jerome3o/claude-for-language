import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { getDecks, createDeck, getDeckStats } from '../api/client';
import { Loading, EmptyState } from '../components/Loading';
import { Deck, QueueCounts } from '../types';
import { useOfflineQueueCounts, useOfflineDecks, useHasMoreNewCards } from '../hooks/useOfflineData';

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
  const navigate = useNavigate();
  // Stats are optional - don't block on this, queue counts work offline
  const statsQuery = useQuery({
    queryKey: ['deckStats', deck.id],
    queryFn: () => getDeckStats(deck.id),
    retry: false,
    staleTime: 60000, // Cache for 1 minute
  });

  // Track bonus for this specific deck
  const getTodayKey = () =>
    `bonusNewCards_${deck.id}_${new Date().toISOString().slice(0, 10)}`;

  const getStoredBonus = (): number => {
    try {
      const stored = localStorage.getItem(getTodayKey());
      return stored ? parseInt(stored, 10) || 0 : 0;
    } catch {
      return 0;
    }
  };

  const [bonus, setBonus] = useState(() => getStoredBonus());

  // Get offline queue counts for this specific deck
  const { counts: offlineCounts } = useOfflineQueueCounts(deck.id, bonus);
  const hasMoreNewCards = useHasMoreNewCards(deck.id, bonus);

  const stats = statsQuery.data;
  const totalDue = offlineCounts.new + offlineCounts.learning + offlineCounts.review;

  const handleStudy = () => {
    // Navigate directly to study with autostart
    navigate(`/study?deck=${deck.id}&autostart=true`);
  };

  const handleAddMore = () => {
    const currentBonus = parseInt(localStorage.getItem(getTodayKey()) || '0', 10);
    const newBonus = currentBonus + 10;
    localStorage.setItem(getTodayKey(), String(newBonus));
    setBonus(newBonus);
  };

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
        {totalDue > 0 ? (
          <button
            onClick={handleStudy}
            className="btn btn-primary btn-sm"
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
          >
            Study ({totalDue})
          </button>
        ) : hasMoreNewCards ? (
          <button
            onClick={handleAddMore}
            className="btn btn-secondary btn-sm"
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
          >
            +10 More
          </button>
        ) : (
          <span className="text-light" style={{ fontSize: '0.75rem' }}>All done</span>
        )}
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

  // OFFLINE-FIRST: Use IndexedDB as primary data source
  // This renders immediately with cached data, even when offline
  const { decks: offlineDecks, isLoading: offlineLoading, isSyncing, triggerSync } = useOfflineDecks();

  // Background API calls - these refresh data when online but don't block rendering
  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
    // Don't show loading/error states - offline data is primary
    staleTime: 30000,
    retry: false,
  });

  // Trigger sync when API returns data (to update IndexedDB if needed)
  React.useEffect(() => {
    if (decksQuery.data && navigator.onLine) {
      // If API returned decks, trigger sync to ensure IndexedDB is up to date
      triggerSync();
    }
  }, [decksQuery.data, triggerSync]);

  // Use offline decks as the source of truth
  const decks = offlineDecks;

  // Track bonus new cards - read from localStorage, update state to trigger re-render
  const getTodayKey = (forDeckId?: string) =>
    `bonusNewCards_${forDeckId || 'all'}_${new Date().toISOString().slice(0, 10)}`;

  const getStoredBonus = (forDeckId?: string): number => {
    try {
      const stored = localStorage.getItem(getTodayKey(forDeckId));
      return stored ? parseInt(stored, 10) || 0 : 0;
    } catch {
      return 0;
    }
  };

  const [bonusAll, setBonusAll] = useState(() => getStoredBonus());

  // Get total queue counts across all decks for the "Study All" button
  const { counts: totalCounts } = useOfflineQueueCounts(undefined, bonusAll);
  const hasMoreNewCardsAll = useHasMoreNewCards(undefined, bonusAll);
  const totalDue = totalCounts.new + totalCounts.learning + totalCounts.review;

  // Handle "+10 More" button click for "All Decks" - add bonus cards and update state
  const handleAddMoreAll = () => {
    const todayKey = getTodayKey();
    const currentBonus = parseInt(localStorage.getItem(todayKey) || '0', 10);
    const newBonus = currentBonus + 10;
    localStorage.setItem(todayKey, String(newBonus));
    setBonusAll(newBonus);
  };

  const handleStudyAll = () => {
    navigate('/study?autostart=true');
  };

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

  // OFFLINE-FIRST: Only show loading on initial load when IndexedDB hasn't loaded yet
  // This is a brief moment on first app launch - after that, cached data renders instantly
  if (offlineLoading) {
    return <Loading />;
  }

  // No error state needed - we use cached offline data as primary source
  // If offline and no cached data, show empty state (user can still navigate)

  return (
    <div className="page">
      <div className="container">
        <h1 className="mb-4">Welcome to 汉语学习</h1>

        {/* Study All Button */}
        <div className="card mb-4">
          {totalDue > 0 ? (
            <button onClick={handleStudyAll} className="btn btn-primary btn-lg btn-block" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
              <span>Study All</span>
              <QueueCountsBadge counts={totalCounts} />
            </button>
          ) : hasMoreNewCardsAll ? (
            <button onClick={handleAddMoreAll} className="btn btn-secondary btn-lg btn-block">
              +10 More New Cards
            </button>
          ) : (
            <div className="text-center text-light" style={{ padding: '0.5rem' }}>
              All caught up!
            </div>
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
                <div className="flex gap-2 justify-center flex-wrap">
                  <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                    Create Deck
                  </button>
                  <Link to="/generate" className="btn btn-secondary">
                    Generate
                  </Link>
                  <Link to="/analyze" className="btn btn-secondary">
                    Analyze
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
              <div className="flex gap-2 justify-center flex-wrap" style={{ paddingTop: '1rem', borderTop: '1px solid #e5e7eb' }}>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                  New Deck
                </button>
                <Link to="/generate" className="btn btn-secondary">
                  Generate
                </Link>
                <Link to="/analyze" className="btn btn-secondary">
                  Analyze
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
