import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { getDecks, createDeck, getDeckStats, getDailyStatus } from '../api/client';
import { Loading, EmptyState } from '../components/Loading';
import { StudyStreak } from '../components/StudyStreak';
import { Deck, DeckStats, QueueCounts } from '../types';
import { useRawQueueCounts, useOfflineDecks } from '../hooks/useOfflineData';
import { applyNewCardBonus, sumQueueCounts, EMPTY_QUEUE_COUNTS, DeckQueueCounts } from '../db/database';
import { readBonus, writeBonus } from '../utils/bonusNewCards';

function DailyButton(props: {
  done: boolean;
  label: string;
  icon: string;
  sub?: string;
  onClick: () => void;
}) {
  const { done, label, icon, sub, onClick } = props;
  return (
    <button
      onClick={onClick}
      className={`btn btn-lg btn-block ${done ? 'btn-secondary' : 'btn-primary'}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.5rem',
        marginTop: '0.5rem',
      }}
    >
      <span>{done ? `✓ ${label} done` : `${icon} ${label}`}</span>
      {sub && (
        <span style={{ fontSize: '0.85rem', opacity: 0.85, fontWeight: 400 }}>{sub}</span>
      )}
    </button>
  );
}

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


function CompactMasteryBar({ stats }: { stats: DeckStats }) {
  const { total_cards, cards_mastered, cards_learning } = stats;
  if (total_cards === 0) return null;
  const masteredPct = (cards_mastered / total_cards) * 100;
  const learningPct = (cards_learning / total_cards) * 100;
  const newPct = 100 - masteredPct - learningPct;
  return (
    <div style={{ flex: 1, height: '4px', background: '#e5e7eb', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
      {masteredPct > 0 && <div style={{ width: `${masteredPct}%`, background: '#22c55e' }} />}
      {learningPct > 0 && <div style={{ width: `${learningPct}%`, background: '#f97316' }} />}
      {newPct > 0 && <div style={{ width: `${newPct}%`, background: '#d1d5db' }} />}
    </div>
  );
}

function DeckCard({
  deck,
  counts,
  onAddMore,
  pinned,
  onTogglePin,
}: {
  deck: Deck;
  counts: DeckQueueCounts;
  onAddMore: () => void;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const navigate = useNavigate();
  const statsQuery = useQuery({
    queryKey: ['deckStats', deck.id],
    queryFn: () => getDeckStats(deck.id),
    retry: false,
    staleTime: 60000,
  });

  const stats = statsQuery.data;
  const totalDue = counts.new + counts.learning + counts.review;

  const handleStudy = () => navigate(`/study?deck=${deck.id}&autostart=true`);

  return (
    <div className="deck-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', position: 'relative' }}>
      {/* Pin button */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin(); }}
        style={{
          position: 'absolute', top: '0.375rem', right: '0.375rem',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '0.125rem', fontSize: '0.8rem',
          opacity: pinned ? 1 : 0.3, lineHeight: 1,
          minHeight: 'unset', minWidth: 'unset',
        }}
        title={pinned ? 'Unpin deck' : 'Pin to top'}
        aria-label={pinned ? 'Unpin deck' : 'Pin to top'}
      >
        📌
      </button>

      <Link to={`/decks/${deck.id}`} style={{ textDecoration: 'none', color: 'inherit', minWidth: 0, paddingRight: '1.25rem' }}>
        <div className="deck-card-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9rem', marginBottom: 0 }}>
          {deck.name}
        </div>
        {stats && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.7rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>{stats.total_notes}n</span>
            {stats.total_cards > 0 && <CompactMasteryBar stats={stats} />}
          </div>
        )}
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem', paddingTop: '0.25rem', borderTop: '1px solid #e5e7eb' }}>
        <QueueCountsBadge counts={counts} />
        {totalDue > 0 ? (
          <button
            onClick={handleStudy}
            className="btn btn-primary btn-sm"
            style={{ padding: '0.25rem 0.625rem', fontSize: '0.8rem' }}
          >
            Study ({totalDue})
          </button>
        ) : counts.hasMoreNew ? (
          <button
            onClick={onAddMore}
            className="btn btn-secondary btn-sm"
            style={{ padding: '0.25rem 0.625rem', fontSize: '0.8rem' }}
          >
            +10 More
          </button>
        ) : (
          <span className="text-light" style={{ fontSize: '0.7rem' }}>Done ✓</span>
        )}
      </div>
    </div>
  );
}

const PINNED_DECKS_KEY = 'pinnedDeckIds';
const UNPINNED_COLLAPSED_KEY = 'unpinnedDecksCollapsed';

export function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [pinnedDeckIds, setPinnedDeckIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(PINNED_DECKS_KEY);
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });

  const [unpinnedCollapsed, setUnpinnedCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(UNPINNED_COLLAPSED_KEY);
      return stored !== null ? JSON.parse(stored) : true;
    } catch { return true; }
  });

  const togglePin = (deckId: string) => {
    setPinnedDeckIds(prev => {
      const next = new Set(prev);
      if (next.has(deckId)) next.delete(deckId);
      else next.add(deckId);
      localStorage.setItem(PINNED_DECKS_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const handleToggleUnpinned = () => {
    setUnpinnedCollapsed(c => {
      const next = !c;
      localStorage.setItem(UNPINNED_COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Background API calls - fetches decks from server when online
  const dailyQuery = useQuery({
    queryKey: ['daily-status'],
    queryFn: getDailyStatus,
    staleTime: 60000,
    retry: false,
  });

  // Invalidate daily status when the local date changes (e.g. crossing midnight).
  // Without this, the "done" indicators stay stale if the app is left open overnight.
  useEffect(() => {
    let lastDate = new Date().toDateString();
    const interval = setInterval(() => {
      const today = new Date().toDateString();
      if (today !== lastDate) {
        lastDate = today;
        queryClient.invalidateQueries({ queryKey: ['daily-status'] });
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
    // Don't show loading/error states - offline data is primary
    staleTime: 30000,
    retry: false,
  });

  // OFFLINE-FIRST: Use IndexedDB as primary data source
  // Pass API decks to enable mismatch detection - if API has decks not in IndexedDB,
  // it automatically triggers a full sync (fixes MCP-created decks not appearing)
  const { decks: offlineDecks, isLoading: offlineLoading, isSyncing } = useOfflineDecks(decksQuery.data);

  // Use offline decks as the source of truth
  const decks = offlineDecks;

  // ---- Bonus tracking ("+10 more" buttons) ----
  const deckIdsKey = decks.map(d => d.id).join(',');
  const [bonusAll, setBonusAll] = useState(() => readBonus(undefined));
  const [deckBonuses, setDeckBonuses] = useState<Record<string, number>>(() =>
    Object.fromEntries(decks.map(d => [d.id, readBonus(d.id)]))
  );
  useEffect(() => {
    setDeckBonuses(Object.fromEntries(decks.map(d => [d.id, readBonus(d.id)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckIdsKey]);

  const bumpBonus = (deckId: string | undefined) => {
    const next = readBonus(deckId) + 10;
    writeBonus(deckId, next);
    if (deckId) setDeckBonuses(b => ({ ...b, [deckId]: next }));
    else setBonusAll(next);
  };

  // ---- Queue counts: ONE live query, bonuses applied in-memory ----
  const { byDeck: rawByDeck, isLoading: countsLoading } = useRawQueueCounts();

  const { perDeck, liveTotal } = useMemo(() => {
    const perDeck = new Map<string, DeckQueueCounts>();
    const headerCounts: DeckQueueCounts[] = [];
    for (const [id, raw] of rawByDeck) {
      perDeck.set(id, applyNewCardBonus(raw, deckBonuses[id] ?? 0));
      headerCounts.push(applyNewCardBonus(raw, bonusAll));
    }
    return { perDeck, liveTotal: sumQueueCounts(headerCounts) };
  }, [rawByDeck, deckBonuses, bonusAll]);

  // Show last-known totals from localStorage while the live query loads.
  const COUNTS_CACHE_KEY = 'lastQueueCounts';
  const cachedCountsRef = useState<QueueCounts | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(COUNTS_CACHE_KEY) || 'null');
    } catch {
      return null;
    }
  })[0];
  useEffect(() => {
    if (!countsLoading) localStorage.setItem(COUNTS_CACHE_KEY, JSON.stringify(liveTotal));
  }, [countsLoading, liveTotal]);

  const totalCounts = countsLoading && cachedCountsRef ? cachedCountsRef : liveTotal;
  const totalDue = totalCounts.new + totalCounts.learning + totalCounts.review;
  const showStudyLoading = countsLoading && !cachedCountsRef;

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

        {/* Study Streak */}
        <StudyStreak />

        {/* Study All Button */}
        <div className="card mb-4">
          {showStudyLoading ? (
            <div className="text-center" style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <div className="spinner" style={{ width: '1rem', height: '1rem' }} />
              <span className="text-light">Loading cards...</span>
            </div>
          ) : totalDue > 0 ? (
            <button onClick={handleStudyAll} className="btn btn-primary btn-lg btn-block" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <span>Study All</span>
              <QueueCountsBadge counts={totalCounts} />
            </button>
          ) : (
            <button onClick={handleStudyAll} className="btn btn-secondary btn-lg btn-block" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <span>✓ Flashcards done</span>
            </button>
          )}
          <DailyButton
            done={dailyQuery.data?.grammar.done_today ?? false}
            label="Grammar"
            icon="🧩"
            sub={dailyQuery.data?.grammar.point?.title}
            onClick={() => navigate('/practice')}
          />
          <DailyButton
            done={dailyQuery.data?.reader_done ?? false}
            label="Reader"
            icon="📖"
            sub={
              dailyQuery.data?.today_reader?.status === 'generating'
                ? `Preparing: ${dailyQuery.data.today_situation.title}…`
                : dailyQuery.data?.today_situation.title
            }
            onClick={() =>
              dailyQuery.data?.today_reader?.status === 'ready'
                ? navigate(`/readers/${dailyQuery.data.today_reader.reader_id}`)
                : navigate('/daily-reader')
            }
          />
          <DailyButton
            done={dailyQuery.data?.roleplay_done ?? false}
            label="Role play"
            icon="💬"
            sub={dailyQuery.data?.today_situation.title}
            onClick={() => navigate('/roleplay')}
          />
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
          ) : (() => {
            const pinnedDecks = decks.filter(d => pinnedDeckIds.has(d.id));
            const unpinnedDecks = decks.filter(d => !pinnedDeckIds.has(d.id));
            // If nothing is pinned, always show all decks expanded so the list isn't empty
            const unpinnedVisible = pinnedDecks.length === 0 || !unpinnedCollapsed;
            return (
              <>
                {/* Pinned decks */}
                {pinnedDecks.length > 0 && (
                  <div className="grid grid-cols-2 gap-1 mb-2">
                    {pinnedDecks.map((deck) => (
                      <DeckCard
                        key={deck.id}
                        deck={deck}
                        counts={perDeck.get(deck.id) ?? EMPTY_QUEUE_COUNTS}
                        onAddMore={() => bumpBonus(deck.id)}
                        pinned={true}
                        onTogglePin={() => togglePin(deck.id)}
                      />
                    ))}
                  </div>
                )}

                {/* Unpinned decks with collapse toggle */}
                {unpinnedDecks.length > 0 && (
                  <div>
                    {pinnedDecks.length > 0 && (
                      <button
                        onClick={handleToggleUnpinned}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.375rem',
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: '0.375rem 0', fontSize: '0.8rem', color: '#6b7280',
                          width: '100%', marginBottom: unpinnedVisible ? '0.5rem' : 0,
                          minHeight: 'unset',
                        }}
                      >
                        <span style={{
                          display: 'inline-block',
                          transform: unpinnedVisible ? 'rotate(0deg)' : 'rotate(-90deg)',
                          transition: 'transform 0.15s',
                          fontSize: '0.7rem',
                        }}>▾</span>
                        {unpinnedVisible
                          ? `Other decks (${unpinnedDecks.length})`
                          : `${unpinnedDecks.length} more deck${unpinnedDecks.length === 1 ? '' : 's'}`}
                      </button>
                    )}
                    {unpinnedVisible && (
                      <div className="grid grid-cols-2 gap-1">
                        {unpinnedDecks.map((deck) => (
                          <DeckCard
                            key={deck.id}
                            deck={deck}
                            counts={perDeck.get(deck.id) ?? EMPTY_QUEUE_COUNTS}
                            onAddMore={() => bumpBonus(deck.id)}
                            pinned={false}
                            onTogglePin={() => togglePin(deck.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 justify-center flex-wrap" style={{ paddingTop: '0.75rem', marginTop: '0.75rem', borderTop: '1px solid #e5e7eb' }}>
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
            );
          })()}
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
