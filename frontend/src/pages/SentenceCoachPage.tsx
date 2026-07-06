import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { coachSentence, createNote, getDecks } from '../api/client';
import { SentenceCoachResult, VocabSuggestion } from '../types';
import './SentenceCoachPage.css';

const LAST_DECK_KEY = 'coach-last-deck-id';

const ISSUE_TYPE_LABELS: Record<string, string> = {
  grammar: 'Grammar',
  word_choice: 'Word choice',
  word_order: 'Word order',
  naturalness: 'Naturalness',
  typo: 'Typo',
};

export function SentenceCoachPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sentence, setSentence] = useState(() => searchParams.get('text') ?? '');
  const [result, setResult] = useState<SentenceCoachResult | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string>(
    () => localStorage.getItem(LAST_DECK_KEY) ?? ''
  );
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const autoSubmittedRef = useRef(false);

  const { data: decks } = useQuery({ queryKey: ['decks'], queryFn: getDecks });

  const coachMutation = useMutation({
    mutationFn: (text: string) => coachSentence(text),
    onSuccess: (res) => {
      setResult(res);
      setAddedKeys(new Set());
      setAddError(null);
    },
  });

  // Deep links (widget / text selection) arrive as /coach?text=...
  // Auto-submit once so the user lands straight on their critique.
  useEffect(() => {
    const text = searchParams.get('text');
    if (text && text.trim() && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      setSentence(text);
      coachMutation.mutate(text.trim());
      // Clear the param so refresh/back doesn't re-trigger
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Default the deck picker to the remembered deck, else the first deck
  useEffect(() => {
    if (!decks || decks.length === 0) return;
    if (selectedDeckId && decks.some((d) => d.id === selectedDeckId)) return;
    setSelectedDeckId(decks[0].id);
  }, [decks, selectedDeckId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sentence.trim()) {
      coachMutation.mutate(sentence.trim());
    }
  };

  const handleNewSentence = () => {
    setResult(null);
    setSentence('');
    coachMutation.reset();
  };

  const handleDeckChange = (deckId: string) => {
    setSelectedDeckId(deckId);
    localStorage.setItem(LAST_DECK_KEY, deckId);
  };

  const addToDeck = async (
    key: string,
    note: { hanzi: string; pinyin: string; english: string; fun_facts?: string }
  ) => {
    if (!selectedDeckId) return;
    setAddingKey(key);
    setAddError(null);
    try {
      await createNote(selectedDeckId, note);
      setAddedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add to deck');
    } finally {
      setAddingKey(null);
    }
  };

  const handleAddSentence = () => {
    if (!result) return;
    addToDeck('sentence', {
      hanzi: result.corrected.hanzi,
      pinyin: result.corrected.pinyin,
      english: result.corrected.english,
      fun_facts: result.critique || undefined,
    });
  };

  const handleAddVocab = (vocab: VocabSuggestion, index: number) => {
    addToDeck(`vocab-${index}`, {
      hanzi: vocab.hanzi,
      pinyin: vocab.pinyin,
      english: vocab.english,
      fun_facts: vocab.reason || undefined,
    });
  };

  const renderAddButton = (key: string, onClick: () => void) => {
    const added = addedKeys.has(key);
    return (
      <button
        type="button"
        className={`btn ${added ? 'btn-secondary' : 'btn-primary'}`}
        onClick={onClick}
        disabled={added || addingKey !== null || !selectedDeckId}
      >
        {added ? 'Added ✓' : addingKey === key ? 'Adding...' : '+ Add'}
      </button>
    );
  };

  // Result view
  if (result) {
    return (
      <div className="page">
        <div className="container">
          <div className="mb-3">
            <button className="btn btn-secondary" onClick={handleNewSentence}>
              Coach Another Sentence
            </button>
          </div>

          <div className="card">
            <span
              className={`coach-badge ${result.isCorrect ? 'coach-badge-correct' : 'coach-badge-needs-work'}`}
            >
              {result.isCorrect ? '✓ Looks good!' : 'Needs a little work'}
            </span>
            <p className="text-light mb-2" style={{ fontSize: '0.875rem' }}>
              You wrote: {result.originalInput}
            </p>
            <div className="coach-corrected-hanzi">{result.corrected.hanzi}</div>
            <div className="coach-corrected-pinyin">{result.corrected.pinyin}</div>
            <div className="coach-corrected-english">{result.corrected.english}</div>
          </div>

          {result.critique && (
            <div className="card mt-3">
              <h3 className="mb-2">Feedback</h3>
              <p>{result.critique}</p>
            </div>
          )}

          {result.issues.length > 0 && (
            <div className="card mt-3">
              <h3 className="mb-2">What to fix</h3>
              {result.issues.map((issue, i) => (
                <div key={i} className="coach-issue">
                  <span className="coach-issue-type">
                    {ISSUE_TYPE_LABELS[issue.type] ?? issue.type}
                  </span>
                  <div className="coach-issue-change">
                    <span className="coach-issue-original">{issue.original}</span>
                    {' → '}
                    <span className="coach-issue-suggestion">{issue.suggestion}</span>
                  </div>
                  <div className="coach-issue-explanation">{issue.explanation}</div>
                </div>
              ))}
            </div>
          )}

          {result.alternatives.length > 0 && (
            <div className="card mt-3">
              <h3 className="mb-2">Other ways to say it</h3>
              {result.alternatives.map((alt, i) => (
                <div key={i} className="coach-alternative">
                  <div className="coach-vocab-hanzi">{alt.hanzi}</div>
                  <div className="coach-vocab-detail">
                    {alt.pinyin} — {alt.english}
                  </div>
                  {alt.note && <div className="coach-vocab-reason">{alt.note}</div>}
                </div>
              ))}
            </div>
          )}

          <div className="card mt-3">
            <h3 className="mb-2">Add to a deck</h3>
            {decks && decks.length > 0 ? (
              <>
                <select
                  className="coach-deck-select"
                  value={selectedDeckId}
                  onChange={(e) => handleDeckChange(e.target.value)}
                >
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))}
                </select>

                {addError && <div className="coach-error mb-3">{addError}</div>}

                <div className="coach-vocab-item">
                  <div style={{ minWidth: 0 }}>
                    <div className="coach-vocab-hanzi">{result.corrected.hanzi}</div>
                    <div className="coach-vocab-detail">Full sentence</div>
                  </div>
                  {renderAddButton('sentence', handleAddSentence)}
                </div>

                {result.vocabSuggestions.map((vocab, i) => (
                  <div key={i} className="coach-vocab-item">
                    <div style={{ minWidth: 0 }}>
                      <div className="coach-vocab-hanzi">{vocab.hanzi}</div>
                      <div className="coach-vocab-detail">
                        {vocab.pinyin} — {vocab.english}
                      </div>
                      {vocab.reason && <div className="coach-vocab-reason">{vocab.reason}</div>}
                    </div>
                    {renderAddButton(`vocab-${i}`, () => handleAddVocab(vocab, i))}
                  </div>
                ))}
              </>
            ) : (
              <p className="text-light">Create a deck first to save words from your sentences.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Input view
  return (
    <div className="page">
      <div className="container">
        <h1 className="mb-2">Sentence Coach</h1>
        <p className="text-light mb-4">
          Write a Chinese sentence and get it corrected and critiqued. You can then add the
          sentence or new words to one of your decks.
        </p>

        <div className="card">
          <form onSubmit={handleSubmit} className="sentence-input-form">
            <div className="form-group">
              <label className="form-label">Your sentence</label>
              <textarea
                className="form-textarea"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                placeholder="e.g., 我昨天去了商店买苹果"
                required
                rows={3}
              />
            </div>

            {coachMutation.error && (
              <div className="coach-error mb-3">
                Couldn't reach the coach. Check your connection and try again.
              </div>
            )}

            <div className="sentence-input-actions">
              <button
                type="submit"
                className="btn btn-primary flex-1"
                disabled={!sentence.trim() || coachMutation.isPending}
              >
                {coachMutation.isPending ? (
                  <>
                    <span className="spinner" style={{ width: '20px', height: '20px' }} />
                    Checking...
                  </>
                ) : (
                  'Check My Sentence'
                )}
              </button>
            </div>
          </form>
        </div>

        {coachMutation.isPending && (
          <div className="card mt-4">
            <div className="sentence-loading">
              <div className="sentence-loading-spinner" />
              <p>Correcting and critiquing your sentence...</p>
            </div>
          </div>
        )}

        <div className="card mt-4">
          <h3 className="mb-2">How it works</h3>
          <ul style={{ paddingLeft: '1.25rem', color: 'var(--color-text-light)' }}>
            <li>Write any Chinese sentence you're unsure about</li>
            <li>Get a corrected, natural version with pinyin and translation</li>
            <li>See exactly what was wrong and why</li>
            <li>Add the sentence or suggested vocabulary straight to a deck</li>
            <li>Tip: select text anywhere on your phone and choose "Sentence Coach" (Android app)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default SentenceCoachPage;
