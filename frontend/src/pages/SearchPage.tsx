import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, LocalNote, LocalCard } from '../db/database';
import { useLiveQuery } from 'dexie-react-hooks';
import { deleteNote } from '../api/client';
import CardEditModal from '../components/CardEditModal';
import { CardWithNote } from '../types';
import { useQueryClient } from '@tanstack/react-query';
import { syncService } from '../services/sync';

function stripTones(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const RATING_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6'];
const CARD_TYPE_SHORT: Record<string, string> = {
  hanzi_to_meaning: '字→义',
  meaning_to_hanzi: '义→字',
  audio_to_hanzi: '听→字',
};

function getMasteryPercent(cards: LocalCard[]): number {
  if (cards.length === 0) return 0;
  const totalStability = cards.reduce((sum, c) => sum + (c.stability || 0), 0);
  const avg = totalStability / cards.length;
  return Math.min(100, Math.round((avg / 30) * 100));
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [editCard, setEditCard] = useState<CardWithNote | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const decks = useLiveQuery(() => db.decks.toArray());
  const allNotes = useLiveQuery(() => db.notes.toArray());
  const allCards = useLiveQuery(() => db.cards.toArray());
  const allReviewEvents = useLiveQuery(() => db.reviewEvents.toArray());

  const deckMap = useMemo(() => {
    const map = new Map<string, string>();
    decks?.forEach(d => map.set(d.id, d.name));
    return map;
  }, [decks]);

  const cardsByNoteId = useMemo(() => {
    const map = new Map<string, LocalCard[]>();
    allCards?.forEach(c => {
      const existing = map.get(c.note_id) || [];
      existing.push(c);
      map.set(c.note_id, existing);
    });
    return map;
  }, [allCards]);

  // Build card_id -> (note_id, card_type) lookup and recent ratings by note
  const ratingsByNoteId = useMemo(() => {
    if (!allCards || !allReviewEvents) return new Map<string, Record<string, number[]>>();
    const cardInfo = new Map<string, { note_id: string; card_type: string }>();
    for (const card of allCards) {
      cardInfo.set(card.id, { note_id: card.note_id, card_type: card.card_type });
    }

    const map = new Map<string, Record<string, number[]>>();
    // Sort events by date descending so we get most recent first
    const sorted = [...allReviewEvents].sort((a, b) =>
      b.reviewed_at.localeCompare(a.reviewed_at)
    );
    for (const event of sorted) {
      const info = cardInfo.get(event.card_id);
      if (!info) continue;
      let noteRatings = map.get(info.note_id);
      if (!noteRatings) {
        noteRatings = { hanzi_to_meaning: [], meaning_to_hanzi: [], audio_to_hanzi: [] };
        map.set(info.note_id, noteRatings);
      }
      const typeRatings = noteRatings[info.card_type];
      if (typeRatings && typeRatings.length < 8) {
        typeRatings.push(event.rating);
      }
    }
    return map;
  }, [allCards, allReviewEvents]);

  const results = useMemo(() => {
    if (!debouncedQuery.trim() || !allNotes) return [];
    const q = debouncedQuery.trim().toLowerCase();
    const qStripped = stripTones(q);

    return allNotes.filter(note => {
      if (note.hanzi.toLowerCase().includes(q)) return true;
      if (note.english.toLowerCase().includes(q)) return true;
      if (note.pinyin.toLowerCase().includes(q)) return true;
      if (stripTones(note.pinyin).includes(qStripped)) return true;
      return false;
    });
  }, [debouncedQuery, allNotes]);

  const handleNoteClick = useCallback((note: LocalNote) => {
    const cards = cardsByNoteId.get(note.id) || [];
    const card = cards[0];
    if (!card) return;

    const cardWithNote: CardWithNote = {
      ...card,
      note: {
        id: note.id,
        deck_id: note.deck_id,
        hanzi: note.hanzi,
        pinyin: note.pinyin,
        english: note.english,
        audio_url: note.audio_url,
        audio_provider: note.audio_provider,
        fun_facts: note.fun_facts,
        context: note.context,
        created_at: note.created_at,
        updated_at: note.updated_at,
      },
    };
    setEditCard(cardWithNote);
  }, [cardsByNoteId]);

  const handleDelete = useCallback(async (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingNoteId === noteId) {
      try {
        await deleteNote(noteId);
        // Remove from local DB
        await db.notes.delete(noteId);
        const cardIds = (cardsByNoteId.get(noteId) || []).map(c => c.id);
        if (cardIds.length > 0) {
          await db.cards.bulkDelete(cardIds);
        }
        queryClient.invalidateQueries({ queryKey: ['deck'] });
        setDeletingNoteId(null);
      } catch (err) {
        console.error('Failed to delete note:', err);
        setDeletingNoteId(null);
      }
    } else {
      setDeletingNoteId(noteId);
      // Auto-cancel confirm after 3 seconds
      setTimeout(() => setDeletingNoteId(prev => prev === noteId ? null : prev), 3000);
    }
  }, [deletingNoteId, cardsByNoteId, queryClient]);

  return (
    <div className="container search-page">
      <div className="search-input-container">
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search cards... (hanzi, pinyin, english)"
          lang="zh-CN"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {debouncedQuery.trim() && (
        <div className="search-results-count">
          {results.length} result{results.length !== 1 ? 's' : ''}
        </div>
      )}

      {debouncedQuery.trim() && results.length === 0 && (
        <div className="search-empty">
          No cards found matching "{debouncedQuery}"
        </div>
      )}

      {results.length > 0 && (
        <div className="search-legend">
          <span className="legend-dot" style={{ backgroundColor: '#ef4444' }} />
          <span className="legend-text">Again</span>
          <span className="legend-dot" style={{ backgroundColor: '#f97316' }} />
          <span className="legend-text">Hard</span>
          <span className="legend-dot" style={{ backgroundColor: '#22c55e' }} />
          <span className="legend-text">Good</span>
          <span className="legend-dot" style={{ backgroundColor: '#3b82f6' }} />
          <span className="legend-text">Easy</span>
        </div>
      )}

      <div className="search-results-list">
        {results.map(note => {
          const cards = cardsByNoteId.get(note.id) || [];
          const mastery = getMasteryPercent(cards);
          const ratings = ratingsByNoteId.get(note.id);
          const hasRatings = ratings && (
            ratings.hanzi_to_meaning.length > 0 ||
            ratings.meaning_to_hanzi.length > 0 ||
            ratings.audio_to_hanzi.length > 0
          );

          return (
            <div
              key={note.id}
              className="search-result-item"
              onClick={() => handleNoteClick(note)}
            >
              <div className="search-result-info">
                <span className="search-result-hanzi">{note.hanzi}</span>
                <span className="search-result-pinyin">{note.pinyin}</span>
                <span className="search-result-english">{note.english}</span>
              </div>

              <div className="search-result-ratings">
                {hasRatings ? (
                  <div className="search-ratings-grid">
                    {(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const).map(type => {
                      const typeRatings = ratings![type];
                      if (typeRatings.length === 0) return null;
                      return (
                        <div key={type} className="search-rating-row">
                          <span className="search-rating-label">{CARD_TYPE_SHORT[type]}</span>
                          <span className="rating-dots">
                            {[...typeRatings].reverse().map((r, i) => (
                              <span
                                key={i}
                                className="rating-dot"
                                style={{ backgroundColor: RATING_COLORS[r] || '#9ca3af' }}
                              />
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <span className="search-no-reviews">—</span>
                )}
              </div>

              <span className="search-result-mastery">{mastery}%</span>

              <div className="search-result-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="search-action-btn"
                  title="Go to deck"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/decks/${note.deck_id}`);
                  }}
                >
                  <span className="search-deck-badge">{deckMap.get(note.deck_id) || 'Deck'}</span>
                </button>
                <button
                  className="search-action-btn search-action-edit"
                  title="Edit card"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNoteClick(note);
                  }}
                >
                  &#9998;
                </button>
                <button
                  className={`search-action-btn search-action-delete${deletingNoteId === note.id ? ' confirm' : ''}`}
                  title={deletingNoteId === note.id ? 'Click again to confirm' : 'Delete card'}
                  onClick={(e) => handleDelete(note.id, e)}
                >
                  {deletingNoteId === note.id ? '?' : '×'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editCard && (
        <CardEditModal
          card={editCard}
          onClose={() => setEditCard(null)}
          onSave={() => {
            setEditCard(null);
            syncService.incrementalSync();
          }}
          onDeleteCard={() => {
            setEditCard(null);
            queryClient.invalidateQueries({ queryKey: ['deck'] });
          }}
        />
      )}
    </div>
  );
}
