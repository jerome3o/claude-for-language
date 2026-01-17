import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { getDeck, createNote, updateNote, deleteNote, deleteDeck, getDeckStats, getNoteHistory, getNoteQuestions, generateNoteAudio, getAudioUrl, updateDeckSettings, API_BASE } from '../api/client';
import { useNoteAudio } from '../hooks/useAudio';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { Note, Deck } from '../types';

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
  const [newCardsPerDay, setNewCardsPerDay] = useState(deck.new_cards_per_day?.toString() || '20');
  const [learningSteps, setLearningSteps] = useState(deck.learning_steps || '1 10');
  const [graduatingInterval, setGraduatingInterval] = useState(deck.graduating_interval?.toString() || '1');
  const [easyInterval, setEasyInterval] = useState(deck.easy_interval?.toString() || '4');

  const saveMutation = useMutation({
    mutationFn: () => updateDeckSettings(deck.id, {
      new_cards_per_day: parseInt(newCardsPerDay, 10) || 20,
      learning_steps: learningSteps,
      graduating_interval: parseInt(graduatingInterval, 10) || 1,
      easy_interval: parseInt(easyInterval, 10) || 4,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', deck.id] });
      onSave();
      onClose();
    },
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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
        >
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
              Maximum number of new cards to introduce each day
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
              Space-separated minutes. Default: 1 10 (1 min, then 10 min)
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Graduating interval (days)</label>
            <input
              type="number"
              className="form-input"
              value={graduatingInterval}
              onChange={(e) => setGraduatingInterval(e.target.value)}
              min="1"
              max="365"
            />
            <p className="text-light mt-1" style={{ fontSize: '0.8rem' }}>
              Days until next review after completing all learning steps
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Easy interval (days)</label>
            <input
              type="number"
              className="form-input"
              value={easyInterval}
              onChange={(e) => setEasyInterval(e.target.value)}
              min="1"
              max="365"
            />
            <p className="text-light mt-1" style={{ fontSize: '0.8rem' }}>
              Days until next review when pressing Easy on a new card
            </p>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saveMutation.isPending}
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
  note: Note;
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
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [historyNote, setHistoryNote] = useState<Note | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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
          <div className="flex gap-2 mt-3">
            {stats && stats.cards_due > 0 && (
              <Link to={`/study?deck=${id}`} className="btn btn-primary">
                Study ({stats.cards_due} due)
              </Link>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => setShowSettings(true)}
            >
              Settings
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
