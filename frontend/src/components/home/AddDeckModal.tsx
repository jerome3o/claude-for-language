import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createDeck } from '../../api/client';

/**
 * "+ Add a deck": the existing create form with the Claude option inside it,
 * so the home needs one link instead of New Deck · Generate · Analyze.
 */
export function AddDeckModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createDeck(name, description || undefined),
    onSuccess: (deck) => {
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      onClose();
      navigate(`/decks/${deck.id}`);
    },
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-deck-title">
        <div className="modal-header">
          <h2 className="modal-title" id="add-deck-title">Create New Deck</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <Link to="/generate" className="home-generate-option" onClick={onClose}>
          <span className="home-generate-icon" aria-hidden="true">✨</span>
          <span className="home-generate-text">
            <span className="home-generate-title">Generate with Claude</span>
            <span className="home-generate-desc">Describe a topic and get 8–12 words with audio</span>
          </span>
          <span className="home-deck-chevron" aria-hidden="true">›</span>
        </Link>

        <p className="home-generate-or">or start an empty deck</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="add-deck-name">Deck Name</label>
            <input
              id="add-deck-name"
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
            <label className="form-label" htmlFor="add-deck-description">Description (optional)</label>
            <textarea
              id="add-deck-description"
              className="form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What will you learn in this deck?"
            />
          </div>

          {createMutation.isError && (
            <p className="text-error" style={{ fontSize: '0.875rem' }}>
              Couldn't create the deck. Check your connection and try again.
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Deck'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
