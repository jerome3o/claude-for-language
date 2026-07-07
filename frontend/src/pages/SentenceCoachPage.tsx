import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { coachSentence, explainSentence, createNote, getDecks } from '../api/client';
import { SentenceCoachResult, SentenceExplanation, VocabSuggestion, ExplainedWord } from '../types';
import './SentenceCoachPage.css';

type CoachMode = 'check' | 'explain';

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
  const [mode, setMode] = useState<CoachMode>(
    () => (searchParams.get('mode') === 'explain' ? 'explain' : 'check')
  );
  const [result, setResult] = useState<SentenceCoachResult | null>(null);
  const [explanation, setExplanation] = useState<SentenceExplanation | null>(null);
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

  const explainMutation = useMutation({
    mutationFn: (text: string) => explainSentence(text),
    onSuccess: (res) => {
      setExplanation(res);
      setAddedKeys(new Set());
      setAddError(null);
    },
  });

  // Deep links (widget / text selection) arrive as /coach?text=...&mode=...
  // Auto-submit once so the user lands straight on the result.
  useEffect(() => {
    const text = searchParams.get('text');
    if (text && text.trim() && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      setSentence(text);
      if (searchParams.get('mode') === 'explain') {
        explainMutation.mutate(text.trim());
      } else {
        coachMutation.mutate(text.trim());
      }
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
    if (!sentence.trim()) return;
    if (mode === 'explain') {
      explainMutation.mutate(sentence.trim());
    } else {
      coachMutation.mutate(sentence.trim());
    }
  };

  const handleNewSentence = () => {
    setResult(null);
    setExplanation(null);
    setSentence('');
    coachMutation.reset();
    explainMutation.reset();
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

  const handleAddWord = (word: ExplainedWord, index: number) => {
    addToDeck(`word-${index}`, {
      hanzi: word.hanzi,
      pinyin: word.pinyin,
      english: word.english,
      fun_facts: word.notes || undefined,
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

  // Explanation result view
  if (explanation) {
    return (
      <div className="page">
        <div className="container">
          <div className="mb-3">
            <button className="btn btn-secondary" onClick={handleNewSentence}>
              Explain Another Sentence
            </button>
          </div>

          <div className="card">
            <div className="coach-corrected-hanzi">{explanation.hanzi}</div>
            <div className="coach-corrected-pinyin">{explanation.pinyin}</div>
            <div className="coach-corrected-english">{explanation.english}</div>
          </div>

          <div className="card mt-3">
            <h3 className="mb-2">Overview</h3>
            <p>{explanation.overview}</p>
          </div>

          {explanation.words.length > 0 && (
            <div className="card mt-3">
              <h3 className="mb-2">Word by word</h3>
              {explanation.words.map((word, i) => (
                <div key={i} className="coach-vocab-item">
                  <div style={{ minWidth: 0 }}>
                    <div className="coach-vocab-hanzi">
                      {word.hanzi}
                      {word.role && <span className="coach-word-role">{word.role}</span>}
                    </div>
                    <div className="coach-vocab-detail">
                      {word.pinyin} — {word.english}
                    </div>
                    {word.notes && <div className="coach-vocab-reason">{word.notes}</div>}
                  </div>
                  {decks && decks.length > 0 &&
                    renderAddButton(`word-${i}`, () => handleAddWord(word, i))}
                </div>
              ))}
              {decks && decks.length > 0 && (
                <select
                  className="coach-deck-select"
                  style={{ marginTop: '0.75rem', marginBottom: 0 }}
                  value={selectedDeckId}
                  onChange={(e) => handleDeckChange(e.target.value)}
                >
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      Add words to: {deck.name}
                    </option>
                  ))}
                </select>
              )}
              {addError && <div className="coach-error mt-3">{addError}</div>}
            </div>
          )}

          {explanation.grammar_points.length > 0 && (
            <div className="card mt-3">
              <h3 className="mb-2">Grammar</h3>
              {explanation.grammar_points.map((point, i) => (
                <div key={i} className="coach-issue coach-grammar-point">
                  <span className="coach-issue-type">{point.pattern}</span>
                  <div className="coach-issue-explanation">{point.explanation}</div>
                  {point.example && (
                    <div className="coach-vocab-reason" style={{ marginTop: '0.25rem' }}>
                      e.g. {point.example}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {explanation.nuance && (
            <div className="card mt-3">
              <h3 className="mb-2">Nuance &amp; usage</h3>
              <p>{explanation.nuance}</p>
            </div>
          )}

          {explanation.similar_examples.length > 0 && (
            <div className="card mt-3">
              <h3 className="mb-2">Similar sentences</h3>
              {explanation.similar_examples.map((ex, i) => (
                <div key={i} className="coach-alternative">
                  <div className="coach-vocab-hanzi">{ex.hanzi}</div>
                  <div className="coach-vocab-detail">
                    {ex.pinyin} — {ex.english}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

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
          {mode === 'check'
            ? 'Write a Chinese sentence and get it corrected and critiqued. You can then add the sentence or new words to one of your decks.'
            : 'Paste any Chinese sentence and get a thorough explanation: word by word, grammar patterns, and nuance.'}
        </p>

        <div className="coach-mode-toggle">
          <button
            type="button"
            className={`coach-mode-button ${mode === 'check' ? 'coach-mode-active' : ''}`}
            onClick={() => setMode('check')}
          >
            ✏️ Check my sentence
          </button>
          <button
            type="button"
            className={`coach-mode-button ${mode === 'explain' ? 'coach-mode-active' : ''}`}
            onClick={() => setMode('explain')}
          >
            🔬 Explain a sentence
          </button>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="sentence-input-form">
            <div className="form-group">
              <label className="form-label">
                {mode === 'check' ? 'Your sentence' : 'Sentence to explain'}
              </label>
              <textarea
                className="form-textarea"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                placeholder={mode === 'check' ? 'e.g., 我昨天去了商店买苹果' : 'e.g., 他把书放在桌子上了'}
                required
                rows={3}
              />
            </div>

            {(coachMutation.error || explainMutation.error) && (
              <div className="coach-error mb-3">
                Couldn't reach the coach. Check your connection and try again.
              </div>
            )}

            <div className="sentence-input-actions">
              <button
                type="submit"
                className="btn btn-primary flex-1"
                disabled={!sentence.trim() || coachMutation.isPending || explainMutation.isPending}
              >
                {coachMutation.isPending || explainMutation.isPending ? (
                  <>
                    <span className="spinner" style={{ width: '20px', height: '20px' }} />
                    {mode === 'check' ? 'Checking...' : 'Explaining...'}
                  </>
                ) : (
                  mode === 'check' ? 'Check My Sentence' : 'Explain Sentence'
                )}
              </button>
            </div>
          </form>
        </div>

        {(coachMutation.isPending || explainMutation.isPending) && (
          <div className="card mt-4">
            <div className="sentence-loading">
              <div className="sentence-loading-spinner" />
              <p>
                {mode === 'check'
                  ? 'Correcting and critiquing your sentence...'
                  : 'Breaking down the sentence in detail...'}
              </p>
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
