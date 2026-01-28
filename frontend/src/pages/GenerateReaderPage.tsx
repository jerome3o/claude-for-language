import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getDecks, generateGradedReader } from '../api/client';
import { Loading } from '../components/Loading';
import { DifficultyLevel } from '../types';

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string; description: string }[] = [
  { value: 'beginner', label: 'Beginner', description: 'Very simple sentences, basic grammar' },
  { value: 'elementary', label: 'Elementary', description: 'Simple sentences with connectors' },
  { value: 'intermediate', label: 'Intermediate', description: 'More complex sentences' },
  { value: 'advanced', label: 'Advanced', description: 'Natural flowing prose' },
];

export function GenerateReaderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('beginner');

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
  });

  const generateMutation = useMutation({
    mutationFn: () => generateGradedReader(selectedDeckIds, topic || undefined, difficulty),
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
          {/* Deck Selection */}
          <div className="card mb-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Select Decks</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={selectAllDecks}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={clearSelection}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      border: '1px solid',
                      borderColor: selectedDeckIds.includes(deck.id) ? '#3b82f6' : '#e5e7eb',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      backgroundColor: selectedDeckIds.includes(deck.id) ? '#eff6ff' : 'white',
                      transition: 'all 0.15s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDeckIds.includes(deck.id)}
                      onChange={() => toggleDeck(deck.id)}
                      style={{ width: '1.25rem', height: '1.25rem', accentColor: '#3b82f6' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{deck.name}</div>
                      {deck.description && (
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          {deck.description}
                        </div>
                      )}
                    </div>
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
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem',
                    border: '1px solid',
                    borderColor: difficulty === option.value ? '#3b82f6' : '#e5e7eb',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: difficulty === option.value ? '#eff6ff' : 'white',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="difficulty"
                    value={option.value}
                    checked={difficulty === option.value}
                    onChange={() => setDifficulty(option.value)}
                    style={{ width: '1.25rem', height: '1.25rem', accentColor: '#3b82f6' }}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>{option.label}</div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                      {option.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {generateMutation.error && (
            <div
              className="mb-4"
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                padding: '0.75rem',
                color: '#b91c1c',
              }}
            >
              {(generateMutation.error as Error).message || 'Failed to generate story. Please try again.'}
            </div>
          )}

          {/* Generate Button */}
          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={selectedDeckIds.length === 0 || generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <>
                <span className="spinner" style={{ width: '20px', height: '20px' }} />
                Generating Story...
              </>
            ) : (
              'Generate Story'
            )}
          </button>

          {selectedDeckIds.length === 0 && (
            <p className="text-light text-center mt-2" style={{ fontSize: '0.875rem' }}>
              Select at least one deck to continue
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
