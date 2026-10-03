import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { decksInQueueOrder } from '@shared/decks/queue';
import { createDeck, getDecks } from '../../api/client';
import { Loading } from '../Loading';
import { InlineNotice, describeError } from './InlineNotice';
import type { Notice } from './InlineNotice';
import { SpinnerButton } from './SpinnerButton';
import './DeckSelectors.css';

/**
 * "Save N cards to:" — tap a deck to save there (chat: Help me say it, Check
 * result, a word from the translation, Discuss with Claude). Decks are listed in
 * study-queue order, the top deck first; the list scrolls on its own (bounded
 * height) so "+ Create new deck" and the sheet's own buttons stay on screen.
 */
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

  const decks = decksInQueueOrder(decksQuery.data || []);

  return (
    <div className="deck-selector">
      <label>Save {selectedCount} card{selectedCount !== 1 ? 's' : ''} to:</label>
      <div className="deck-options">
        <div className="deck-options-list" data-testid="deck-options-list">
          {decks.map((deck) => (
            <button
              key={deck.id}
              className="deck-option"
              onClick={() => onSelect(deck.id)}
              disabled={isSaving || isCreatingDeck}
            >
              {deck.name}
            </button>
          ))}
        </div>
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
