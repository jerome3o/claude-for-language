import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createDeck, getDecks } from '../../api/client';
import { Loading } from '../Loading';
import { usePinnedDecks } from '../../hooks/usePinnedDecks';
import { InlineNotice, describeError } from './InlineNotice';
import type { Notice } from './InlineNotice';
import { SpinnerButton } from './SpinnerButton';

// Deck selector component
export function DeckSelector({
  onSelect,
  isSaving,
}: {
  onSelect: (deckId: string) => void;
  isSaving: boolean;
}) {
  const { isPinned, togglePin, sortWithPinnedFirst } = usePinnedDecks();
  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: () => getDecks(),
  });

  if (decksQuery.isLoading) {
    return <Loading message="Loading decks..." />;
  }

  const decks = sortWithPinnedFirst(decksQuery.data || []);

  if (decks.length === 0) {
    return (
      <p className="text-light">No decks available. Create a deck first.</p>
    );
  }

  return (
    <div className="deck-selector">
      <label>Save to deck:</label>
      <div className="deck-options">
        {decks.map((deck) => (
          <div key={deck.id} className="deck-option-row">
            <button
              className="deck-option"
              onClick={() => onSelect(deck.id)}
              disabled={isSaving}
            >
              {isPinned(deck.id) && <span className="deck-pin-mark">📌</span>}
              {deck.name}
            </button>
            <button
              onClick={() => togglePin(deck.id)}
              title={isPinned(deck.id) ? 'Unpin deck' : 'Pin deck to top'}
              aria-label={isPinned(deck.id) ? 'Unpin deck' : 'Pin deck to top'}
              disabled={isSaving}
              className={`deck-pin-btn ${isPinned(deck.id) ? 'pinned' : ''}`}
            >
              📌
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Deck selector with create new deck option
export function DeckSelectorWithCreate({
  onSelect,
  isSaving,
  selectedCount,
}: {
  onSelect: (deckId: string) => void;
  isSaving: boolean;
  selectedCount: number;
}) {
  const [showNewDeckInput, setShowNewDeckInput] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [createError, setCreateError] = useState<Notice | null>(null);
  const { isPinned, togglePin, sortWithPinnedFirst } = usePinnedDecks();

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: () => getDecks(),
  });

  const handleCreateAndSelect = async () => {
    if (!newDeckName.trim()) return;
    setIsCreatingDeck(true);
    setCreateError(null);
    try {
      const newDeck = await createDeck(newDeckName.trim());
      // Refresh decks list
      decksQuery.refetch();
      onSelect(newDeck.id);
    } catch (error) {
      console.error('Failed to create deck:', error);
      setCreateError({ kind: 'error', text: describeError(error, "Couldn't create the deck.") });
      setIsCreatingDeck(false);
    }
  };

  if (decksQuery.isLoading) {
    return <Loading message="Loading decks..." />;
  }

  const decks = sortWithPinnedFirst(decksQuery.data || []);

  return (
    <div className="deck-selector">
      <label>Save {selectedCount} card{selectedCount !== 1 ? 's' : ''} to:</label>
      <div className="deck-options">
        {decks.map((deck) => (
          <div key={deck.id} className="deck-option-row">
            <button
              className="deck-option"
              onClick={() => onSelect(deck.id)}
              disabled={isSaving || isCreatingDeck}
            >
              {isPinned(deck.id) && <span className="deck-pin-mark">📌</span>}
              {deck.name}
            </button>
            <button
              onClick={() => togglePin(deck.id)}
              title={isPinned(deck.id) ? 'Unpin deck' : 'Pin deck to top'}
              aria-label={isPinned(deck.id) ? 'Unpin deck' : 'Pin deck to top'}
              disabled={isSaving || isCreatingDeck}
              className={`deck-pin-btn ${isPinned(deck.id) ? 'pinned' : ''}`}
            >
              📌
            </button>
          </div>
        ))}
        {!showNewDeckInput ? (
          <button
            className="deck-option deck-option-new"
            onClick={() => setShowNewDeckInput(true)}
            disabled={isSaving || isCreatingDeck}
          >
            + Create new deck
          </button>
        ) : (
          <div className="new-deck-input-row">
            <input
              type="text"
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              placeholder="Deck name..."
              className="new-deck-input"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newDeckName.trim()) {
                  handleCreateAndSelect();
                } else if (e.key === 'Escape') {
                  setShowNewDeckInput(false);
                  setNewDeckName('');
                }
              }}
            />
            <SpinnerButton
              type="button"
              className="btn btn-primary btn-sm"
              busy={isCreatingDeck}
              onClick={handleCreateAndSelect}
              disabled={!newDeckName.trim()}
            >
              Create & Save
            </SpinnerButton>
          </div>
        )}
        <InlineNotice notice={createError} onDismiss={() => setCreateError(null)} className="chat-modal-notice" />
      </div>
    </div>
  );
}
