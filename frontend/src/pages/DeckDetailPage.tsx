import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { getDeck, createNote, updateNote, deleteNote, deleteDeck, getDeckStats, getNoteHistory, getNoteQuestions, generateNoteAudio, getAudioUrl, updateDeckSettings, updateDeck, exportDeck, API_BASE } from '../api/client';
import { useNoteAudio } from '../hooks/useAudio';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { Note, Deck, Card, CardQueue, NoteWithCards } from '../types';

const RATING_LABELS = ['Again', 'Hard', 'Good', 'Easy'];
const CARD_TYPE_LABELS: Record<string, string> = {
  hanzi_to_meaning: 'Hanzi → Meaning',
  meaning_to_hanzi: 'Meaning → Hanzi',
  audio_to_hanzi: 'Audio → Hanzi',
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTime(ms: number | null): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatInterval(days: number): string {
  if (days === 0) return 'New';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

// Short card type labels for the status display
const CARD_TYPE_SHORT: Record<string, string> = {
  hanzi_to_meaning: 'H→M',
  meaning_to_hanzi: 'M→H',
  audio_to_hanzi: 'A→H',
};

function getCardStatus(card: Card): { label: string; color: string; priority: number } {
  const now = new Date();

  if (card.queue === CardQueue.NEW) {
    return { label: 'New', color: '#3b82f6', priority: 3 }; // blue
  }

  if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
    // Check if due now
    if (card.due_timestamp && card.due_timestamp <= Date.now()) {
      return { label: 'Due', color: '#ef4444', priority: 0 }; // red
    }
    // Still learning but not due yet
    const dueIn = card.due_timestamp ? Math.ceil((card.due_timestamp - Date.now()) / 60000) : 0;
    return { label: dueIn > 0 ? `${dueIn}m` : 'Learning', color: '#f97316', priority: 1 }; // orange
  }

  if (card.queue === CardQueue.REVIEW) {
    const nextReview = card.next_review_at ? new Date(card.next_review_at) : null;
    if (!nextReview || nextReview <= now) {
      return { label: 'Due', color: '#22c55e', priority: 0 }; // green
    }
    // Calculate days until due
    const daysUntil = Math.ceil((nextReview.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil === 1) {
      return { label: '1d', color: '#22c55e', priority: 2 };
    }
    if (daysUntil < 7) {
      return { label: `${daysUntil}d`, color: '#22c55e', priority: 2 };
    }
    if (daysUntil < 30) {
      return { label: `${Math.round(daysUntil / 7)}w`, color: '#22c55e', priority: 2 };
    }
    if (daysUntil < 365) {
      return { label: `${Math.round(daysUntil / 30)}mo`, color: '#22c55e', priority: 2 };
    }
    return { label: `${(daysUntil / 365).toFixed(1)}y`, color: '#22c55e', priority: 2 };
  }

  return { label: '?', color: '#9ca3af', priority: 4 };
}

function getNoteLearningStatus(cards: Card[]): {
  nextDue: string | null;
  isDue: boolean;
  allNew: boolean;
  avgInterval: number;
  avgEase: number;
  totalReps: number;
} {
  const now = new Date();
  let earliestDue: Date | null = null;
  let isDue = false;
  let allNew = true;
  let totalInterval = 0;
  let totalEase = 0;
  let totalReps = 0;

  for (const card of cards) {
    if (card.queue !== CardQueue.NEW) {
      allNew = false;
    }

    totalInterval += card.interval;
    totalEase += card.ease_factor;
    totalReps += card.repetitions;

    // Check if due
    if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
      if (card.due_timestamp && card.due_timestamp <= Date.now()) {
        isDue = true;
      }
    } else if (card.queue === CardQueue.REVIEW && card.next_review_at) {
      const nextReview = new Date(card.next_review_at);
      if (nextReview <= now) {
        isDue = true;
      }
      if (!earliestDue || nextReview < earliestDue) {
        earliestDue = nextReview;
      }
    } else if (card.queue === CardQueue.NEW) {
      isDue = true;
    }
  }

  let nextDue: string | null = null;
  if (earliestDue && earliestDue > now) {
    const daysUntil = Math.ceil((earliestDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil === 0) {
      nextDue = 'Today';
    } else if (daysUntil === 1) {
      nextDue = 'Tomorrow';
    } else if (daysUntil < 7) {
      nextDue = `${daysUntil} days`;
    } else {
      nextDue = earliestDue.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
  }

  return {
    nextDue,
    isDue,
    allNew,
    avgInterval: cards.length > 0 ? Math.round(totalInterval / cards.length) : 0,
    avgEase: cards.length > 0 ? totalEase / cards.length : 2.5,
    totalReps,
  };
}

function NoteHistoryModal({
  note,
  onClose,
}: {
  note: Note;
  onClose: () => void;
}) {
  const historyQuery = useQuery({
    queryKey: ['noteHistory', note.id],
    queryFn: () => getNoteHistory(note.id),
  });

  const questionsQuery = useQuery({
    queryKey: ['noteQuestions', note.id],
    queryFn: () => getNoteQuestions(note.id),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <h2 className="modal-title">History: {note.hanzi}</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {(historyQuery.isLoading || questionsQuery.isLoading) && <Loading />}
        {(historyQuery.error || questionsQuery.error) && <ErrorMessage message="Failed to load history" />}

        {historyQuery.data && historyQuery.data.length === 0 && questionsQuery.data && questionsQuery.data.length === 0 && (
          <p className="text-light">No history yet. Study this card to see history.</p>
        )}

        {historyQuery.data && historyQuery.data.length > 0 && (
          <div className="flex flex-col gap-4">
            {historyQuery.data.map((cardHistory) => (
              <div key={cardHistory.card_type}>
                <div className="flex justify-between items-center" style={{ marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1rem', margin: 0 }}>
                    {CARD_TYPE_LABELS[cardHistory.card_type] || cardHistory.card_type}
                  </h3>
                  <div className="flex gap-2" style={{ fontSize: '0.75rem' }}>
                    <span className="text-light">
                      Interval: <strong>{formatInterval(cardHistory.card_stats.interval)}</strong>
                    </span>
                    <span className="text-light">
                      Ease: <strong>{(cardHistory.card_stats.ease_factor * 100).toFixed(0)}%</strong>
                    </span>
                    <span className="text-light">
                      Reps: <strong>{cardHistory.card_stats.repetitions}</strong>
                    </span>
                  </div>
                </div>
                {cardHistory.reviews.length === 0 ? (
                  <p className="text-light" style={{ fontSize: '0.875rem', fontStyle: 'italic' }}>
                    Not yet reviewed
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {cardHistory.reviews.map((review) => (
                      <div
                        key={review.id}
                        className="card"
                        style={{ padding: '0.75rem', background: 'var(--bg-elevated)' }}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="text-light">{formatDate(review.reviewed_at)}</span>
                            {review.time_spent_ms && (
                              <span className="text-light" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                                ({formatTime(review.time_spent_ms)})
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              padding: '0.125rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.875rem',
                              background: review.rating >= 2 ? 'var(--success)' : 'var(--error)',
                              color: 'white',
                            }}
                          >
                            {RATING_LABELS[review.rating]}
                          </span>
                        </div>
                        {review.user_answer && (
                          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                            Answer: <span className="hanzi">{review.user_answer}</span>
                          </p>
                        )}
                        {review.recording_url && (
                          <audio
                            controls
                            src={getAudioUrl(review.recording_url)}
                            style={{ marginTop: '0.5rem', width: '100%', height: '32px' }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Questions & Answers */}
        {questionsQuery.data && questionsQuery.data.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
              Questions Asked ({questionsQuery.data.length})
            </h3>
            <div className="flex flex-col gap-3">
              {questionsQuery.data.map((qa) => (
                <div
                  key={qa.id}
                  className="card"
                  style={{ padding: '0.75rem', background: 'var(--bg-elevated)' }}
                >
                  <div className="text-light" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                    {formatDate(qa.asked_at)}
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: 'white',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      marginBottom: '0.5rem',
                      fontSize: '0.875rem',
                    }}
                  >
                    {qa.question}
                  </div>
                  <div
                    style={{
                      backgroundColor: 'white',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                      whiteSpace: 'pre-wrap',
                      border: '1px solid #e5e7eb',
                    }}
                  >
                    {qa.answer}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DeckSettingsModal({
  deck,
  onClose,
  onSave,
}: {
  deck: Deck;
  onClose: () => void;
  onSave: () => void;
}) {
  const queryClient = useQueryClient();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Deck info
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description || '');

  // Basic settings
  const [newCardsPerDay, setNewCardsPerDay] = useState(deck.new_cards_per_day?.toString() || '20');
  const [learningSteps, setLearningSteps] = useState(deck.learning_steps || '1 10');
  const [graduatingInterval, setGraduatingInterval] = useState(deck.graduating_interval?.toString() || '1');
  const [easyInterval, setEasyInterval] = useState(deck.easy_interval?.toString() || '4');
  const [relearningSteps, setRelearningSteps] = useState(deck.relearning_steps || '10');

  // Advanced settings (stored as percentages in DB)
  const [startingEase, setStartingEase] = useState(((deck.starting_ease || 250) / 100).toString());
  const [minimumEase, setMinimumEase] = useState(((deck.minimum_ease || 130) / 100).toString());
  const [maximumEase, setMaximumEase] = useState(((deck.maximum_ease || 300) / 100).toString());
  const [intervalModifier, setIntervalModifier] = useState(((deck.interval_modifier || 100) / 100).toString());
  const [hardMultiplier, setHardMultiplier] = useState(((deck.hard_multiplier || 120) / 100).toString());
  const [easyBonus, setEasyBonus] = useState(((deck.easy_bonus || 130) / 100).toString());

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Update deck name and description
      await updateDeck(deck.id, { name, description: description || undefined });
      // Update SRS settings
      await updateDeckSettings(deck.id, {
        new_cards_per_day: parseInt(newCardsPerDay, 10) || 20,
        learning_steps: learningSteps,
        graduating_interval: parseInt(graduatingInterval, 10) || 1,
        easy_interval: parseInt(easyInterval, 10) || 4,
        relearning_steps: relearningSteps,
        starting_ease: Math.round(parseFloat(startingEase) * 100) || 250,
        minimum_ease: Math.round(parseFloat(minimumEase) * 100) || 130,
        maximum_ease: Math.round(parseFloat(maximumEase) * 100) || 300,
        interval_modifier: Math.round(parseFloat(intervalModifier) * 100) || 100,
        hard_multiplier: Math.round(parseFloat(hardMultiplier) * 100) || 120,
        easy_bonus: Math.round(parseFloat(easyBonus) * 100) || 130,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', deck.id] });
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      onSave();
      onClose();
    },
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Deck Settings</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          style={{ maxHeight: '70vh', overflowY: 'auto' }}
        >
          {/* Deck Info Section */}
          <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Deck Info</h3>

          <div className="form-group">
            <label className="form-label">Deck Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter deck name"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description (optional)</label>
            <textarea
              className="form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter deck description"
              rows={2}
            />
          </div>

          {/* How SRS Works Section */}
          <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <strong>How Spaced Repetition Works:</strong>
            <ul style={{ margin: '0.5rem 0 0 1rem', paddingLeft: '0.5rem' }}>
              <li><strong>New cards</strong> go through learning steps (1min → 10min → graduate)</li>
              <li><strong>Good</strong> advances to next step or graduates the card</li>
              <li><strong>Again</strong> resets to the first learning step</li>
              <li><strong>Graduated cards</strong> use the ease factor to calculate intervals</li>
              <li><strong>Ease factor</strong> adjusts based on your answers (harder = lower ease)</li>
            </ul>
          </div>

          <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Learning</h3>

          <div className="form-group">
            <label className="form-label">New cards per day</label>
            <input
              type="number"
              className="form-input"
              value={newCardsPerDay}
              onChange={(e) => setNewCardsPerDay(e.target.value)}
              min="0"
              max="1000"
            />
            <p className="text-light mt-1" style={{ fontSize: '0.8rem' }}>
              Maximum new cards introduced each day. Set to 0 to only review.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Learning steps (minutes)</label>
            <input
              type="text"
              className="form-input"
              value={learningSteps}
              onChange={(e) => setLearningSteps(e.target.value)}
              placeholder="1 10"
            />
            <p className="text-light mt-1" style={{ fontSize: '0.8rem' }}>
              Steps for new cards before graduating. "1 10" = see again in 1 min, then 10 min, then graduate.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Relearning steps (minutes)</label>
            <input
              type="text"
              className="form-input"
              value={relearningSteps}
              onChange={(e) => setRelearningSteps(e.target.value)}
              placeholder="10"
            />
            <p className="text-light mt-1" style={{ fontSize: '0.8rem' }}>
              Steps when you press "Again" on a review card. After completing, returns to review.
            </p>
          </div>

          <div className="grid grid-cols-2">
            <div className="form-group">
              <label className="form-label">Graduating interval</label>
              <input
                type="number"
                className="form-input"
                value={graduatingInterval}
                onChange={(e) => setGraduatingInterval(e.target.value)}
                min="1"
                max="365"
              />
              <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                Days after graduating (Good)
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Easy interval</label>
              <input
                type="number"
                className="form-input"
                value={easyInterval}
                onChange={(e) => setEasyInterval(e.target.value)}
                min="1"
                max="365"
              />
              <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                Days when pressing Easy on new card
              </p>
            </div>
          </div>

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              cursor: 'pointer',
              padding: '0.5rem 0',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            {showAdvanced ? '▼' : '▶'} Advanced Settings
          </button>

          {showAdvanced && (
            <>
              <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <strong>Ease Factor Explained:</strong>
                <p style={{ margin: '0.5rem 0 0 0' }}>
                  Each card has an "ease factor" (default 2.5). When you review:
                </p>
                <ul style={{ margin: '0.25rem 0 0 1rem', paddingLeft: '0.5rem' }}>
                  <li><strong>Good:</strong> next interval = current × ease (e.g., 10d × 2.5 = 25d)</li>
                  <li><strong>Hard:</strong> ease drops 15%, interval × hard multiplier</li>
                  <li><strong>Easy:</strong> ease rises 15%, interval × ease × easy bonus</li>
                  <li><strong>Again:</strong> ease drops 20%, card enters relearning</li>
                </ul>
              </div>

              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Ease Settings</h3>

              <div className="grid grid-cols-3">
                <div className="form-group">
                  <label className="form-label">Starting ease</label>
                  <input
                    type="number"
                    className="form-input"
                    value={startingEase}
                    onChange={(e) => setStartingEase(e.target.value)}
                    min="1.0"
                    max="5.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 2.5
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Minimum ease</label>
                  <input
                    type="number"
                    className="form-input"
                    value={minimumEase}
                    onChange={(e) => setMinimumEase(e.target.value)}
                    min="1.0"
                    max="5.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 1.3
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Maximum ease</label>
                  <input
                    type="number"
                    className="form-input"
                    value={maximumEase}
                    onChange={(e) => setMaximumEase(e.target.value)}
                    min="1.0"
                    max="5.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 3.0
                  </p>
                </div>
              </div>

              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Interval Multipliers</h3>

              <div className="grid grid-cols-3">
                <div className="form-group">
                  <label className="form-label">Interval modifier</label>
                  <input
                    type="number"
                    className="form-input"
                    value={intervalModifier}
                    onChange={(e) => setIntervalModifier(e.target.value)}
                    min="0.5"
                    max="2.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Multiplies all intervals
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Hard multiplier</label>
                  <input
                    type="number"
                    className="form-input"
                    value={hardMultiplier}
                    onChange={(e) => setHardMultiplier(e.target.value)}
                    min="1.0"
                    max="2.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 1.2
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Easy bonus</label>
                  <input
                    type="number"
                    className="form-input"
                    value={easyBonus}
                    onChange={(e) => setEasyBonus(e.target.value)}
                    min="1.0"
                    max="2.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 1.3
                  </p>
                </div>
              </div>

              <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem', borderRadius: '8px', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                <strong>Example:</strong> Card at 10 days, ease 2.5, interval modifier 1.0:
                <ul style={{ margin: '0.25rem 0 0 1rem', paddingLeft: '0.5rem' }}>
                  <li>Good: 10 × 2.5 × 1.0 = 25 days</li>
                  <li>Hard: 10 × 1.2 × 1.0 = 12 days (ease → 2.35)</li>
                  <li>Easy: 10 × 2.5 × 1.3 × 1.0 = 33 days (ease → 2.65)</li>
                </ul>
              </div>
            </>
          )}

          <div className="modal-actions" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saveMutation.isPending || !name.trim()}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface NoteFormData {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts: string;
}

function NoteForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  initial?: NoteFormData;
  onSubmit: (data: NoteFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [hanzi, setHanzi] = useState(initial?.hanzi || '');
  const [pinyin, setPinyin] = useState(initial?.pinyin || '');
  const [english, setEnglish] = useState(initial?.english || '');
  const [funFacts, setFunFacts] = useState(initial?.fun_facts || '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ hanzi, pinyin, english, fun_facts: funFacts });
      }}
    >
      <div className="grid grid-cols-2">
        <div className="form-group">
          <label className="form-label">Hanzi (Chinese Characters)</label>
          <input
            type="text"
            className="form-input hanzi"
            value={hanzi}
            onChange={(e) => setHanzi(e.target.value)}
            placeholder="你好"
            required
            style={{ fontSize: '1.5rem' }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Pinyin</label>
          <input
            type="text"
            className="form-input"
            value={pinyin}
            onChange={(e) => setPinyin(e.target.value)}
            placeholder="ni3 hao3"
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">English Meaning</label>
        <input
          type="text"
          className="form-input"
          value={english}
          onChange={(e) => setEnglish(e.target.value)}
          placeholder="Hello"
          required
        />
      </div>

      <div className="form-group">
        <label className="form-label">Fun Facts / Notes (optional)</label>
        <textarea
          className="form-textarea"
          value={funFacts}
          onChange={(e) => setFunFacts(e.target.value)}
          placeholder="Cultural context, usage notes, memory aids..."
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!hanzi.trim() || !pinyin.trim() || !english.trim() || isSubmitting}
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function NoteCard({
  note,
  onEdit,
  onDelete,
  onHistory,
  onAudioGenerated,
}: {
  note: NoteWithCards;
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onAudioGenerated: () => void;
}) {
  const { isPlaying, play } = useNoteAudio();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateAudio = async () => {
    setIsGenerating(true);
    try {
      await generateNoteAudio(note.id);
      onAudioGenerated();
    } catch (error) {
      console.error('Failed to generate audio:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Get learning status for all cards
  const learningStatus = getNoteLearningStatus(note.cards || []);

  // Sort cards by card_type for consistent display order
  const sortedCards = [...(note.cards || [])].sort((a, b) => {
    const order = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
    return order.indexOf(a.card_type) - order.indexOf(b.card_type);
  });

  return (
    <div className="note-card">
      <div className="note-card-content">
        <div className="flex items-center gap-2">
          {note.audio_url ? (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => play(note.audio_url || null, note.hanzi, API_BASE)}
              disabled={isPlaying}
              style={{ padding: '0.25rem 0.5rem', minWidth: 'auto' }}
            >
              {isPlaying ? '...' : '▶'}
            </button>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              onClick={handleGenerateAudio}
              disabled={isGenerating}
              style={{ padding: '0.25rem 0.5rem', minWidth: 'auto', fontSize: '0.7rem' }}
              title="Generate audio"
            >
              {isGenerating ? '...' : '🔊+'}
            </button>
          )}
          <div className="note-card-hanzi">{note.hanzi}</div>
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

        {/* Learning Status */}
        {sortedCards.length > 0 && (
          <div className="note-learning-status">
            <div className="card-status-row">
              {sortedCards.map((card) => {
                const status = getCardStatus(card);
                return (
                  <div
                    key={card.id}
                    className="card-status-item"
                    title={`${CARD_TYPE_LABELS[card.card_type]}: ${status.label}${card.interval > 0 ? ` (${formatInterval(card.interval)} interval)` : ''}`}
                  >
                    <span className="card-type-label">{CARD_TYPE_SHORT[card.card_type]}</span>
                    <span
                      className="card-status-badge"
                      style={{ backgroundColor: status.color }}
                    >
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Summary row */}
            <div className="note-status-summary">
              {learningStatus.allNew ? (
                <span className="text-light">Not started</span>
              ) : (
                <>
                  <span className="text-light">
                    {learningStatus.totalReps} reviews
                  </span>
                  <span className="text-light">
                    {Math.round(learningStatus.avgEase * 100)}% ease
                  </span>
                  {learningStatus.avgInterval > 0 && (
                    <span className="text-light">
                      ~{formatInterval(learningStatus.avgInterval)}
                    </span>
                  )}
                  {learningStatus.nextDue && !learningStatus.isDue && (
                    <span className="text-light">
                      Next: {learningStatus.nextDue}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="note-card-actions">
        <button className="btn btn-sm btn-secondary" onClick={onHistory}>
          History
        </button>
        <button className="btn btn-sm btn-secondary" onClick={onEdit}>
          Edit
        </button>
        <button className="btn btn-sm btn-error" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

export function DeckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingNote, setEditingNote] = useState<NoteWithCards | null>(null);
  const [historyNote, setHistoryNote] = useState<NoteWithCards | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isGeneratingAllAudio, setIsGeneratingAllAudio] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [audioGenerationProgress, setAudioGenerationProgress] = useState({ done: 0, total: 0 });

  const deckQuery = useQuery({
    queryKey: ['deck', id],
    queryFn: () => getDeck(id!),
    enabled: !!id,
  });

  const statsQuery = useQuery({
    queryKey: ['deckStats', id],
    queryFn: () => getDeckStats(id!),
    enabled: !!id,
  });

  const createNoteMutation = useMutation({
    mutationFn: (data: NoteFormData) => createNote(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', id] });
      queryClient.invalidateQueries({ queryKey: ['deckStats', id] });
      setShowAddModal(false);
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ noteId, data }: { noteId: string; data: NoteFormData }) =>
      updateNote(noteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', id] });
      setEditingNote(null);
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', id] });
      queryClient.invalidateQueries({ queryKey: ['deckStats', id] });
    },
  });

  const deleteDeckMutation = useMutation({
    mutationFn: () => deleteDeck(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      navigate('/decks');
    },
  });

  const handleExport = async () => {
    if (!id) return;
    setIsExporting(true);
    try {
      const data = await exportDeck(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deck?.name || 'deck'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const generateAllMissingAudio = async () => {
    if (!deckQuery.data) return;

    const notesWithoutAudio = deckQuery.data.notes.filter(note => !note.audio_url);
    if (notesWithoutAudio.length === 0) return;

    setIsGeneratingAllAudio(true);
    setAudioGenerationProgress({ done: 0, total: notesWithoutAudio.length });

    for (let i = 0; i < notesWithoutAudio.length; i++) {
      try {
        await generateNoteAudio(notesWithoutAudio[i].id);
        setAudioGenerationProgress({ done: i + 1, total: notesWithoutAudio.length });
      } catch (error) {
        console.error(`Failed to generate audio for ${notesWithoutAudio[i].hanzi}:`, error);
      }
    }

    setIsGeneratingAllAudio(false);
    queryClient.invalidateQueries({ queryKey: ['deck', id] });
  };

  if (deckQuery.isLoading) {
    return <Loading />;
  }

  if (deckQuery.error || !deckQuery.data) {
    return <ErrorMessage message="Failed to load deck" />;
  }

  const deck = deckQuery.data;
  const stats = statsQuery.data;

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="mb-4">
          <Link to="/decks" className="text-light">
            &larr; Back to Decks
          </Link>
          <h1 className="mt-1">{deck.name}</h1>
          {deck.description && <p className="text-light mt-1">{deck.description}</p>}
          <div className="flex gap-2 mt-3 flex-wrap">
            {stats && stats.cards_due > 0 && (
              <Link to={`/study?deck=${id}`} className="btn btn-primary">
                Study ({stats.cards_due} due)
              </Link>
            )}
            {deck.notes.filter(n => !n.audio_url).length > 0 && (
              <button
                className="btn btn-secondary"
                onClick={generateAllMissingAudio}
                disabled={isGeneratingAllAudio}
              >
                {isGeneratingAllAudio
                  ? `Generating Audio (${audioGenerationProgress.done}/${audioGenerationProgress.total})`
                  : `Generate All Audio (${deck.notes.filter(n => !n.audio_url).length})`}
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => setShowSettings(true)}
            >
              Settings
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleExport}
              disabled={isExporting}
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 mb-4">
            <div className="card stats-card">
              <div className="stats-value">{stats.total_notes}</div>
              <div className="stats-label">Notes</div>
            </div>
            <div className="card stats-card">
              <div className="stats-value">{stats.cards_due}</div>
              <div className="stats-label">Cards Due</div>
            </div>
            <div className="card stats-card">
              <div className="stats-value">{stats.cards_mastered}</div>
              <div className="stats-label">Mastered</div>
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <h2>Notes ({deck.notes.length})</h2>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              Add Note
            </button>
          </div>

          {deck.notes.length === 0 ? (
            <EmptyState
              icon="📝"
              title="No notes yet"
              description="Add vocabulary to this deck"
              action={
                <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                  Add Note
                </button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {deck.notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onEdit={() => setEditingNote(note)}
                  onHistory={() => setHistoryNote(note)}
                  onDelete={() => {
                    if (confirm(`Delete "${note.hanzi}"?`)) {
                      deleteNoteMutation.mutate(note.id);
                    }
                  }}
                  onAudioGenerated={() => {
                    queryClient.invalidateQueries({ queryKey: ['deck', id] });
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Add Note Modal */}
        {showAddModal && (
          <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Add Note</h2>
                <button className="modal-close" onClick={() => setShowAddModal(false)}>
                  &times;
                </button>
              </div>
              <NoteForm
                onSubmit={(data) => createNoteMutation.mutate(data)}
                onCancel={() => setShowAddModal(false)}
                isSubmitting={createNoteMutation.isPending}
              />
            </div>
          </div>
        )}

        {/* Edit Note Modal */}
        {editingNote && (
          <div className="modal-overlay" onClick={() => setEditingNote(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Edit Note</h2>
                <button className="modal-close" onClick={() => setEditingNote(null)}>
                  &times;
                </button>
              </div>
              <NoteForm
                initial={{
                  hanzi: editingNote.hanzi,
                  pinyin: editingNote.pinyin,
                  english: editingNote.english,
                  fun_facts: editingNote.fun_facts || '',
                }}
                onSubmit={(data) =>
                  updateNoteMutation.mutate({ noteId: editingNote.id, data })
                }
                onCancel={() => setEditingNote(null)}
                isSubmitting={updateNoteMutation.isPending}
              />
            </div>
          </div>
        )}

        {/* Note History Modal */}
        {historyNote && (
          <NoteHistoryModal note={historyNote} onClose={() => setHistoryNote(null)} />
        )}

        {/* Delete Deck Confirmation */}
        {showDeleteConfirm && (
          <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Delete Deck?</h2>
                <button className="modal-close" onClick={() => setShowDeleteConfirm(false)}>
                  &times;
                </button>
              </div>
              <p>
                Are you sure you want to delete "{deck.name}"? This will delete all{' '}
                {deck.notes.length} notes and their cards. This action cannot be undone.
              </p>
              <div className="modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-error"
                  onClick={() => deleteDeckMutation.mutate()}
                  disabled={deleteDeckMutation.isPending}
                >
                  {deleteDeckMutation.isPending ? 'Deleting...' : 'Delete Deck'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Deck Settings Modal */}
        {showSettings && (
          <DeckSettingsModal
            deck={deck}
            onClose={() => setShowSettings(false)}
            onSave={() => {
              queryClient.invalidateQueries({ queryKey: ['deck', id] });
            }}
          />
        )}
      </div>
    </div>
  );
}
