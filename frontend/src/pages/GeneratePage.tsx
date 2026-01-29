import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateDeck, API_BASE } from '../api/client';
import { useNoteAudio } from '../hooks/useAudio';
import { syncService } from '../services/sync';
import { NoteWithCards } from '../types';

export function GeneratePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { play: playAudio, isPlaying } = useNoteAudio();

  const [prompt, setPrompt] = useState('');
  const [deckName, setDeckName] = useState('');
  const [generatedDeck, setGeneratedDeck] = useState<{
    deck: { id: string; name: string };
    notes: NoteWithCards[];
  } | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => generateDeck(prompt, deckName || undefined),
    onSuccess: async (result) => {
      setGeneratedDeck(result);
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      // Sync to IndexedDB so the new deck is available for offline study
      await syncService.incrementalSync();
    },
  });

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    generateMutation.mutate();
  };

  // Show generated results
  if (generatedDeck) {
    return (
      <div className="page">
        <div className="container">
          <div className="card mb-4">
            <div className="flex justify-between items-center">
              <div>
                <h1>Deck Generated!</h1>
                <p className="text-light">
                  Created "{generatedDeck.deck.name}" with {generatedDeck.notes.length} notes
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setGeneratedDeck(null);
                    setPrompt('');
                    setDeckName('');
                  }}
                >
                  Generate Another
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => navigate(`/decks/${generatedDeck.deck.id}`)}
                >
                  View Deck
                </button>
              </div>
            </div>
          </div>

          {/* Preview generated notes */}
          <div className="card">
            <h2 className="mb-3">Generated Notes</h2>
            <div className="flex flex-col gap-2">
              {generatedDeck.notes.map((note) => (
                <div key={note.id} className="note-card">
                  <div className="note-card-content">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="note-card-hanzi">{note.hanzi}</span>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => playAudio(note.audio_url || null, note.hanzi, API_BASE)}
                        disabled={isPlaying}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        {isPlaying ? '...' : '🔊'}
                      </button>
                    </div>
                    <div className="note-card-details">
                      <span className="pinyin">{note.pinyin}</span>
                      <span> - </span>
                      <span>{note.english}</span>
                    </div>
                    {note.fun_facts && (
                      <p className="text-light mt-1" style={{ fontSize: '0.875rem' }}>
                        {note.fun_facts}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '600px' }}>
        <h1 className="mb-2">AI Deck Generation</h1>
        <p className="text-light mb-4">
          Describe what you want to learn and Claude will generate a deck of vocabulary cards for
          you.
        </p>

        <div className="card">
          <form onSubmit={handleGenerate}>
            <div className="form-group">
              <label className="form-label">What do you want to learn?</label>
              <textarea
                className="form-textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., Vocabulary for ordering food at a Chinese restaurant, or Common phrases for traveling in China, or Animals you might see at a zoo"
                required
                rows={4}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Deck Name (optional)</label>
              <input
                type="text"
                className="form-input"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="Leave blank to auto-generate"
              />
            </div>

            {generateMutation.error && (
              <div
                className="mb-3"
                style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  color: '#b91c1c',
                }}
              >
                {generateMutation.error.message || 'Failed to generate deck. Please try again.'}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              disabled={!prompt.trim() || generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <>
                  <span className="spinner" style={{ width: '20px', height: '20px' }} />
                  Generating...
                </>
              ) : (
                'Generate Deck with AI'
              )}
            </button>
          </form>
        </div>

        {/* Examples */}
        <div className="card mt-4">
          <h3 className="mb-2">Example Prompts</h3>
          <div className="flex flex-col gap-2">
            {[
              'Common greetings and polite expressions',
              'Food and drinks vocabulary for restaurants',
              'Numbers, dates, and time expressions',
              'Transportation and directions',
              'Shopping and bargaining phrases',
              'Weather and seasons vocabulary',
            ].map((example) => (
              <button
                key={example}
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => setPrompt(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
