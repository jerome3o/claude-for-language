import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import { getDecks, createDeck, getDeckStats, importDeck, DeckExport } from '../api/client';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { Deck } from '../types';

function DeckCard({ deck }: { deck: Deck }) {
  const statsQuery = useQuery({
    queryKey: ['deckStats', deck.id],
    queryFn: () => getDeckStats(deck.id),
  });

  const stats = statsQuery.data;

  return (
    <Link to={`/decks/${deck.id}`} className="deck-card">
      <div className="deck-card-title">{deck.name}</div>
      {deck.description && (
        <p className="text-light mb-2" style={{ fontSize: '0.875rem' }}>
          {deck.description}
        </p>
      )}
      {stats && (
        <div className="deck-card-stats">
          <span>{stats.total_notes} notes</span>
          <span>{stats.cards_due} due</span>
          {stats.cards_mastered > 0 && <span>{stats.cards_mastered} mastered</span>}
        </div>
      )}
    </Link>
  );
}

export function DecksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
  });

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

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportError(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text) as DeckExport;

      // Basic validation
      if (!data.version || !data.deck || !data.notes) {
        throw new Error('Invalid file format');
      }

      const result = await importDeck(data);
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      navigate(`/decks/${result.deck_id}`);
    } catch (err) {
      console.error('Import error:', err);
      setImportError(err instanceof Error ? err.message : 'Failed to import deck');
    } finally {
      setIsImporting(false);
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (decksQuery.isLoading) {
    return <Loading />;
  }

  if (decksQuery.error) {
    return <ErrorMessage message="Failed to load decks" />;
  }

  const decks = decksQuery.data || [];

  return (
    <div className="page">
      <div className="container">
        <div className="flex justify-between items-center mb-4">
          <h1>Your Decks</h1>
          <div className="flex gap-2">
            <button
              className="btn btn-secondary"
              onClick={handleImportClick}
              disabled={isImporting}
            >
              {isImporting ? 'Importing...' : 'Import'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              New Deck
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>

        {importError && (
          <div className="error-banner mb-4" style={{ padding: '0.75rem', background: 'var(--error-light)', color: 'var(--error)', borderRadius: '0.5rem' }}>
            Import failed: {importError}
            <button
              onClick={() => setImportError(null)}
              style={{ marginLeft: '0.5rem', fontWeight: 'bold' }}
            >
              &times;
            </button>
          </div>
        )}

        {decks.length === 0 ? (
          <EmptyState
            icon="📚"
            title="No decks yet"
            description="Create your first deck to start learning"
            action={
              <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                Create Deck
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-2">
            {decks.map((deck) => (
              <DeckCard key={deck.id} deck={deck} />
            ))}
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

export function NewDeckPage() {
  const navigate = useNavigate();

  // Redirect to decks page, the modal will handle creation
  navigate('/decks');
  return null;
}
