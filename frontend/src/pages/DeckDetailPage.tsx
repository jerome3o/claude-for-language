import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { getDeck, createNote, updateNote, deleteNote, deleteDeck, getDeckStats } from '../api/client';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { Note } from '../types';

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
}: {
  note: Note;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="note-card">
      <div className="note-card-content">
        <div className="note-card-hanzi">{note.hanzi}</div>
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
        <div className="flex justify-between items-center mb-2">
          <div>
            <Link to="/decks" className="text-light">
              &larr; Back to Decks
            </Link>
            <h1 className="mt-1">{deck.name}</h1>
            {deck.description && <p className="text-light">{deck.description}</p>}
          </div>
          <div className="flex gap-2">
            {stats && stats.cards_due > 0 && (
              <Link to={`/study?deck=${id}`} className="btn btn-primary">
                Study ({stats.cards_due} due)
              </Link>
            )}
            <button
              className="btn btn-error btn-secondary"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Deck
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
                  onDelete={() => {
                    if (confirm(`Delete "${note.hanzi}"?`)) {
                      deleteNoteMutation.mutate(note.id);
                    }
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
      </div>
    </div>
  );
}
