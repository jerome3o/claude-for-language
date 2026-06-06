import { useState, useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, LocalNote, LocalCard } from '../db/database';
import { deleteNote } from '../api/client';
import { syncService } from '../services/sync';

interface DuplicateGroup {
  hanzi: string;
  notes: Array<{
    note: LocalNote;
    cards: LocalCard[];
    totalReviews: number;
    totalRepetitions: number;
  }>;
}

export function DuplicateFinderPage() {
  const navigate = useNavigate();
  const [scanned, setScanned] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [deleted, setDeleted] = useState<Set<string>>(new Set());

  const allNotes = useLiveQuery(() => db.notes.toArray());
  const allCards = useLiveQuery(() => db.cards.toArray());
  const allReviewEvents = useLiveQuery(() => db.reviewEvents.toArray());
  const allDecks = useLiveQuery(() => db.decks.toArray());

  const deckMap = useMemo(() => {
    const map = new Map<string, string>();
    allDecks?.forEach(d => map.set(d.id, d.name));
    return map;
  }, [allDecks]);

  const reviewCountByNoteId = useMemo(() => {
    if (!allCards || !allReviewEvents) return new Map<string, number>();
    const cardToNote = new Map<string, string>();
    for (const card of allCards) {
      cardToNote.set(card.id, card.note_id);
    }
    const counts = new Map<string, number>();
    for (const event of allReviewEvents) {
      const noteId = cardToNote.get(event.card_id);
      if (noteId) {
        counts.set(noteId, (counts.get(noteId) ?? 0) + 1);
      }
    }
    return counts;
  }, [allCards, allReviewEvents]);

  const cardsByNoteId = useMemo(() => {
    const map = new Map<string, LocalCard[]>();
    allCards?.forEach(c => {
      const existing = map.get(c.note_id) ?? [];
      existing.push(c);
      map.set(c.note_id, existing);
    });
    return map;
  }, [allCards]);

  const duplicateGroups = useMemo((): DuplicateGroup[] => {
    if (!allNotes) return [];
    const byHanzi = new Map<string, LocalNote[]>();
    for (const note of allNotes) {
      if (deleted.has(note.id)) continue;
      const existing = byHanzi.get(note.hanzi) ?? [];
      existing.push(note);
      byHanzi.set(note.hanzi, existing);
    }

    const groups: DuplicateGroup[] = [];
    for (const [hanzi, notes] of byHanzi) {
      if (notes.length < 2) continue;
      const withStats = notes.map(note => {
        const cards = cardsByNoteId.get(note.id) ?? [];
        const totalReviews = reviewCountByNoteId.get(note.id) ?? 0;
        const totalRepetitions = cards.reduce((sum, c) => sum + (c.repetitions ?? 0), 0);
        return { note, cards, totalReviews, totalRepetitions };
      });
      // Sort: keep the most-reviewed first
      withStats.sort((a, b) => b.totalReviews - a.totalReviews || b.totalRepetitions - a.totalRepetitions);
      groups.push({ hanzi, notes: withStats });
    }
    // Sort groups by hanzi
    groups.sort((a, b) => a.hanzi.localeCompare(b.hanzi));
    return groups;
  }, [allNotes, cardsByNoteId, reviewCountByNoteId, deleted]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    setDeleting(prev => new Set(prev).add(noteId));
    try {
      await deleteNote(noteId);
      await db.notes.delete(noteId);
      const cards = cardsByNoteId.get(noteId) ?? [];
      for (const card of cards) {
        await db.cards.delete(card.id);
      }
      setDeleted(prev => new Set(prev).add(noteId));
      syncService.syncEvents().catch(() => {});
    } catch (err) {
      console.error('Failed to delete note:', err);
      alert('Failed to delete note. Please try again.');
    } finally {
      setDeleting(prev => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    }
  }, [cardsByNoteId]);

  const handleDeleteAllDuplicates = useCallback(async () => {
    const toDelete: string[] = [];
    for (const group of duplicateGroups) {
      // Keep the first (most reviewed), delete the rest
      for (let i = 1; i < group.notes.length; i++) {
        toDelete.push(group.notes[i].note.id);
      }
    }
    if (toDelete.length === 0) return;
    if (!confirm(`Delete ${toDelete.length} duplicate note${toDelete.length === 1 ? '' : 's'}? This cannot be undone.`)) return;

    for (const noteId of toDelete) {
      setDeleting(prev => new Set(prev).add(noteId));
      try {
        await deleteNote(noteId);
        await db.notes.delete(noteId);
        const cards = cardsByNoteId.get(noteId) ?? [];
        for (const card of cards) {
          await db.cards.delete(card.id);
        }
        setDeleted(prev => new Set(prev).add(noteId));
      } catch (err) {
        console.error('Failed to delete note:', noteId, err);
      } finally {
        setDeleting(prev => {
          const next = new Set(prev);
          next.delete(noteId);
          return next;
        });
      }
    }
    syncService.syncEvents().catch(() => {});
  }, [duplicateGroups, cardsByNoteId]);

  const isLoading = !allNotes || !allCards || !allReviewEvents;

  const remainingGroups = scanned ? duplicateGroups : [];
  const totalDuplicates = remainingGroups.reduce((sum, g) => sum + g.notes.length - 1, 0);

  return (
    <div className="container" style={{ maxWidth: '800px', paddingTop: '2rem', paddingBottom: '4rem' }}>
      <button
        onClick={() => navigate(-1)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', marginBottom: '1rem', padding: 0, fontSize: '0.875rem' }}
      >
        ← Back
      </button>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Duplicate Finder</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        Scan your vocabulary for notes with the same hanzi. Notes with fewer reviews are shown after the recommended keeper.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={() => setScanned(true)}
          disabled={isLoading}
          style={{ minWidth: '160px' }}
        >
          {isLoading ? 'Loading data...' : '🔍 Scan for Duplicates'}
        </button>
        {scanned && totalDuplicates > 0 && (
          <button
            className="btn btn-error"
            onClick={handleDeleteAllDuplicates}
          >
            🗑️ Delete All Duplicates ({totalDuplicates})
          </button>
        )}
      </div>

      {scanned && (
        <>
          {remainingGroups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-secondary)', background: 'var(--color-surface)', borderRadius: '0.75rem', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
              <p style={{ fontWeight: 600 }}>No duplicates found!</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>All your notes have unique hanzi.</p>
            </div>
          ) : (
            <>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                Found <strong>{remainingGroups.length}</strong> duplicate group{remainingGroups.length !== 1 ? 's' : ''} ({totalDuplicates} extra note{totalDuplicates !== 1 ? 's' : ''} to remove).
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {remainingGroups.map(group => (
                  <DuplicateGroupCard
                    key={group.hanzi}
                    group={group}
                    deckMap={deckMap}
                    deleting={deleting}
                    onDelete={handleDeleteNote}
                    onNavigate={(noteId) => navigate(`/search?note=${noteId}`)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  deckMap: Map<string, string>;
  deleting: Set<string>;
  onDelete: (noteId: string) => void;
  onNavigate: (noteId: string) => void;
}

function DuplicateGroupCard({ group, deckMap, deleting, onDelete }: DuplicateGroupCardProps) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: '0.75rem', overflow: 'hidden', background: 'var(--color-surface)' }}>
      <div style={{ padding: '0.75rem 1rem', background: 'var(--color-surface-elevated, var(--color-surface))', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>{group.hanzi}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', background: 'var(--color-background)', padding: '0.125rem 0.5rem', borderRadius: '999px', border: '1px solid var(--color-border)' }}>
          {group.notes.length} copies
        </span>
      </div>
      <div>
        {group.notes.map((item, idx) => (
          <div
            key={item.note.id}
            style={{
              padding: '0.75rem 1rem',
              borderBottom: idx < group.notes.length - 1 ? '1px solid var(--color-border)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              opacity: deleting.has(item.note.id) ? 0.5 : 1,
            }}
          >
            {idx === 0 && (
              <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 600, background: '#dcfce7', padding: '0.125rem 0.5rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>
                ★ Keep
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)' }}>{item.note.english}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{item.note.pinyin}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.125rem' }}>
                Deck: {deckMap.get(item.note.deck_id) ?? 'Unknown'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem', flexShrink: 0 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                {item.totalReviews} review{item.totalReviews !== 1 ? 's' : ''}
              </span>
              {idx > 0 && (
                <button
                  className="btn btn-error"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem', minHeight: '2rem' }}
                  onClick={() => {
                    if (confirm(`Delete "${item.note.hanzi}" (${item.note.english}) from "${deckMap.get(item.note.deck_id) ?? 'Unknown'}"? This cannot be undone.`)) {
                      onDelete(item.note.id);
                    }
                  }}
                  disabled={deleting.has(item.note.id)}
                >
                  {deleting.has(item.note.id) ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
