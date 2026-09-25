import { useState, useEffect, useMemo, useRef } from 'react';
import { QueuePositionMenu } from '../components/QueuePositionMenu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getDecks, createDeck, getDeckStats } from '../api/client';
import { Loading, EmptyState } from '../components/Loading';
import { NoteSearchResults } from '../components/NoteSearchResults';
import { Deck, DeckStats, QueueCounts } from '../types';
import { useRawQueueCounts, useOfflineDecks } from '../hooks/useOfflineData';
import { allocateQueueCounts, EMPTY_QUEUE_COUNTS, DeckQueueCounts } from '../db/database';
import { readBonus, writeBonus } from '../utils/bonusNewCards';
import { orderDecksForQueue, moveDeckInQueue, nudgeDeckInQueue } from '../services/deckOrder';
import { readStudyBudget } from '../services/studyBudget';
import type { LocalDeck } from '../db/database';

// Queue counts display component
function QueueCountsBadge({ counts }: { counts: QueueCounts }) {
  return (
    <div className="queue-counts" style={{ fontSize: '0.875rem' }}>
      <span style={{ color: '#3b82f6', fontWeight: 600 }}>{counts.new}</span>
      <span style={{ color: '#9ca3af' }}>+</span>
      <span style={{ color: '#8b5cf6', fontWeight: 600 }}>{counts.secondaryNew ?? 0}</span>
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
  position,
  total,
  onMove,
}: {
  deck: Deck;
  counts: DeckQueueCounts;
  onAddMore: () => void;
  /** 1-based place in the queue. */
  position: number;
  total: number;
  onMove: (to: 'top' | 'up' | 'down' | 'bottom') => void;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const statsQuery = useQuery({
    queryKey: ['deckStats', deck.id],
    queryFn: () => getDeckStats(deck.id),
    retry: false,
    staleTime: 60000,
  });

  const stats = statsQuery.data;
  const totalDue = counts.new + (counts.secondaryNew ?? 0) + counts.learning + counts.review;

  const handleStudy = () => navigate(`/study?deck=${deck.id}&autostart=true`);

  return (
    <div className="deck-card" data-testid="deck-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', position: 'relative', zIndex: menuOpen ? 20 : undefined }}>
      {/* Queue position + reorder menu (the card is lifted above its siblings while the menu is open) */}
      <div style={{ position: 'absolute', top: '0.25rem', right: '0.25rem' }}>
        <QueuePositionMenu position={position} total={total} onMove={onMove} onOpenChange={setMenuOpen} />
      </div>

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

/**
 * The Decks tab: every deck in queue order (new words come from the top down), New / Generate / Analyze, and a
 * search field at the top that searches every card on the device (this
 * absorbed the old Search page; `?q=` deep-links into a search).
 */
export function DecksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // ---- Search (URL-backed so /decks?q=… is shareable and /search redirects here) ----
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery === urlQuery) return;
    setSearchParams(debouncedQuery ? { q: debouncedQuery } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  // A deep link that arrives with a query: focus the field so typing continues.
  useEffect(() => {
    if (urlQuery) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const budget = readStudyBudget();

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
    // Don't show loading/error states - offline data is primary
    staleTime: 30000,
    retry: false,
  });

  // OFFLINE-FIRST: IndexedDB is the source of truth; the API list only serves
  // to detect decks that are missing locally (which triggers a sync).
  const { decks: offlineDecks, isLoading: offlineLoading, isSyncing } = useOfflineDecks(decksQuery.data);
  const decks = offlineDecks;

  const handleMove = async (deckId: string, to: 'top' | 'up' | 'down' | 'bottom') => {
    try {
      if (to === 'top' || to === 'bottom') await moveDeckInQueue(deckId, to);
      else await nudgeDeckInQueue(decks as LocalDeck[], deckId, to);
    } catch (err) {
      console.error('[Decks] reorder failed', err);
    }
  };


  // ---- Bonus tracking ("+10 more" buttons) ----
  const deckIdsKey = decks.map(d => d.id).join(',');
  const [deckBonuses, setDeckBonuses] = useState<Record<string, number>>(() =>
    Object.fromEntries(decks.map(d => [d.id, readBonus(d.id)]))
  );
  useEffect(() => {
    setDeckBonuses(Object.fromEntries(decks.map(d => [d.id, readBonus(d.id)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckIdsKey]);

  const bumpBonus = (deckId: string) => {
    const next = readBonus(deckId) + 10;
    writeBonus(deckId, next);
    setDeckBonuses(b => ({ ...b, [deckId]: next }));
  };

  // ---- Queue counts: ONE live query, bonuses applied in-memory ----
  const { byDeck: rawByDeck } = useRawQueueCounts();
  // The budget is global, so every deck's "+10 more" adds to the same pool.
  const perDeck = useMemo<Map<string, DeckQueueCounts>>(() => {
    const bonus = Object.values(deckBonuses).reduce((s, b) => s + (b || 0), 0);
    return allocateQueueCounts(rawByDeck, bonus);
  }, [rawByDeck, deckBonuses]);

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

  if (offlineLoading) {
    return <Loading />;
  }

  const searching = debouncedQuery.trim().length > 0;

  return (
    <div className="page">
      <div className="container decks-page">
        <div className="search-input-container decks-search">
          <input
            ref={inputRef}
            type="search"
            className="search-input"
            placeholder="Search your cards… (hanzi, pinyin, english)"
            lang="zh-CN"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search cards"
            data-testid="decks-search"
            enterKeyHint="search"
          />
        </div>

        {searching ? (
          <NoteSearchResults query={debouncedQuery} />
        ) : (
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
            const ordered = orderDecksForQueue(decks as LocalDeck[]);
            return (
              <>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-light)' }} data-testid="queue-caption">
                  Studied in this order: {budget.new_cards_per_day} new {budget.new_cards_per_day === 1 ? 'word' : 'words'} a day come from the top deck down
                  {' '}(<Link to="/settings" style={{ color: 'inherit' }}>change</Link>). Tap a deck's number to move it.
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {ordered.map((deck, i) => (
                    <DeckCard
                      key={deck.id}
                      deck={deck}
                      counts={perDeck.get(deck.id) ?? EMPTY_QUEUE_COUNTS}
                      onAddMore={() => bumpBonus(deck.id)}
                      position={i + 1}
                      total={ordered.length}
                      onMove={(to) => handleMove(deck.id, to)}
                    />
                  ))}
                </div>

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
        )}

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
