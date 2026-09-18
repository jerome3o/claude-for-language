import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDecks, generateGradedReader } from '../api/client';
import { getDueNoteIds } from '../db/database';
import { Loading } from '../components/Loading';
import { InlineError } from '../components/Toast';
import { DifficultyLevel } from '../types';
import './GenerateReaderPage.css';

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string; description: string }[] = [
  { value: 'beginner', label: 'Beginner', description: 'Very simple sentences, basic grammar' },
  { value: 'elementary', label: 'Elementary', description: 'Simple sentences with connectors' },
  { value: 'intermediate', label: 'Intermediate', description: 'More complex sentences' },
  { value: 'advanced', label: 'Advanced', description: 'Natural flowing prose' },
];

type ReaderSource = 'decks' | 'due_cards';

export function GenerateReaderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [source, setSource] = useState<ReaderSource>('decks');
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('beginner');

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
  });

  // Words due today, from the same offline queue logic the study session uses
  const dueNoteIds = useLiveQuery(() => getDueNoteIds(), []);
  const dueWordCount = dueNoteIds?.length ?? null;

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (source === 'due_cards') {
        const noteIds = await getDueNoteIds();
        return generateGradedReader({
          source: 'due_cards',
          noteIds,
          topic: topic || undefined,
          difficulty,
        });
      }
      return generateGradedReader({
        deckIds: selectedDeckIds,
        topic: topic || undefined,
        difficulty,
      });
    },
    onSuccess: () => {
      // Invalidate readers query to show the new generating reader
      queryClient.invalidateQueries({ queryKey: ['readers'] });
      // Navigate immediately to readers list
      navigate('/readers');
    },
  });

  const toggleDeck = (deckId: string) => {
    setSelectedDeckIds((prev) =>
      prev.includes(deckId)
        ? prev.filter((id) => id !== deckId)
        : [...prev, deckId]
    );
  };

  const selectAllDecks = () => {
    if (decksQuery.data) {
      setSelectedDeckIds(decksQuery.data.map((d) => d.id));
    }
  };

  const clearSelection = () => {
    setSelectedDeckIds([]);
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    generateMutation.mutate();
  };

  if (decksQuery.isLoading) {
    return <Loading />;
  }

  const decks = decksQuery.data || [];

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '600px' }}>
        <h1 className="mb-2">Generate Graded Reader</h1>
        <p className="text-light mb-4">
          Create an AI-generated story using vocabulary from your decks. The story will only use
          words you've already learned.
        </p>

        <form onSubmit={handleGenerate}>
          {/* Source Selection */}
          <div className="card mb-4">
            <h3 style={{ margin: '0 0 0.75rem 0' }}>Story Source</h3>
            <div className="flex flex-col gap-2">
              {([
                {
                  value: 'decks' as ReaderSource,
                  label: 'From decks',
                  description: "Uses only words you've already learned from the selected decks",
                },
                {
                  value: 'due_cards' as ReaderSource,
                  label: "From today's due cards",
                  description: dueWordCount === null
                    ? 'Weaves the words due for review today into a natural story'
                    : `Weaves your ${dueWordCount} due word${dueWordCount === 1 ? '' : 's'} into a natural story (best effort — realism over coverage)`,
                },
              ]).map((option) => (
                <label
                  key={option.value}
                  className={`gen-option${source === option.value ? ' selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="source"
                    value={option.value}
                    checked={source === option.value}
                    onChange={() => setSource(option.value)}
                    className="gen-option-input"
                  />
                  <span className="gen-option-mark" aria-hidden="true" />
                  <span className="gen-option-text">
                    <span className="gen-option-label">{option.label}</span>
                    <span className="gen-option-desc">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Deck Selection */}
          {source === 'decks' && (
          <div className="card mb-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Select Decks</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={selectAllDecks}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={clearSelection}
                >
                  Clear
                </button>
              </div>
            </div>

            {decks.length === 0 ? (
              <p className="text-light">No decks available. Create a deck first.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {decks.map((deck) => (
                  <label
                    key={deck.id}
                    className={`gen-option gen-option-check${selectedDeckIds.includes(deck.id) ? ' selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDeckIds.includes(deck.id)}
                      onChange={() => toggleDeck(deck.id)}
                      className="gen-option-input"
                    />
                    <span className="gen-option-mark" aria-hidden="true" />
                    <span className="gen-option-text">
                      <span className="gen-option-label">{deck.name}</span>
                      {deck.description && (
                        <span className="gen-option-desc">{deck.description}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {selectedDeckIds.length > 0 && (
              <p className="text-light mt-2" style={{ fontSize: '0.875rem' }}>
                {selectedDeckIds.length} deck{selectedDeckIds.length > 1 ? 's' : ''} selected
              </p>
            )}
          </div>
          )}

          {/* Topic (Optional) */}
          <div className="card mb-4">
            <h3 style={{ margin: '0 0 0.75rem 0' }}>Topic (Optional)</h3>
            <input
              type="text"
              className="form-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., A day at the park, Shopping adventure..."
              style={{ marginBottom: '0.5rem' }}
            />
            <p className="text-light" style={{ fontSize: '0.75rem', margin: 0 }}>
              Leave blank to let AI choose a topic based on your vocabulary
            </p>
          </div>

          {/* Difficulty Selection */}
          <div className="card mb-4">
            <h3 style={{ margin: '0 0 0.75rem 0' }}>Difficulty Level</h3>
            <div className="flex flex-col gap-2">
              {DIFFICULTY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`gen-option${difficulty === option.value ? ' selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="difficulty"
                    value={option.value}
                    checked={difficulty === option.value}
                    onChange={() => setDifficulty(option.value)}
                    className="gen-option-input"
                  />
                  <span className="gen-option-mark" aria-hidden="true" />
                  <span className="gen-option-text">
                    <span className="gen-option-label">{option.label}</span>
                    <span className="gen-option-desc">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {generateMutation.error && (
            <InlineError
              message={(generateMutation.error as Error).message || "Couldn't start the story. Please try again."}
            />
          )}

          {/* Generate Button */}
          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={
              generateMutation.isPending ||
              (source === 'decks' ? selectedDeckIds.length === 0 : !dueWordCount)
            }
          >
            {generateMutation.isPending ? (
              <>
                <span className="spinner" style={{ width: '20px', height: '20px' }} />
                Generating Story...
              </>
            ) : source === 'due_cards' ? (
              `Generate from Today's Due Cards${dueWordCount ? ` (${dueWordCount})` : ''}`
            ) : (
              'Generate Story'
            )}
          </button>

          {source === 'decks' && selectedDeckIds.length === 0 && (
            <p className="text-light text-center mt-2" style={{ fontSize: '0.875rem' }}>
              Select at least one deck to continue
            </p>
          )}
          {source === 'due_cards' && dueWordCount === 0 && (
            <p className="text-light text-center mt-2" style={{ fontSize: '0.875rem' }}>
              No cards due right now — nothing to build a story from
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
