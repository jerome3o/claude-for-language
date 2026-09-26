import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, LocalNote, LocalCard, removeNotesLocally } from '../db/database';
import { useLiveQuery } from 'dexie-react-hooks';
import { deleteNote, searchNotesOnServer } from '../api/client';
import CardEditModal from './CardEditModal';
import { CardWithNote } from '../types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { syncService } from '../services/sync';
import { useNetwork } from '../contexts/NetworkContext';
import { noteMatches, stripTones } from '../services/noteSearch';

/** Render at most this many matches (a one-character query can match thousands). */
const MAX_RESULTS = 200;

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

/**
 * Search across every note on the device (hanzi, pinyin with or without
 * tones, English, card sentence) with recent ratings per card type, mastery,
 * edit and delete. Lives at the top of the Decks tab; formerly the Search page.
 * Fully local — reads IndexedDB.
 */
export function NoteSearchResults({ query }: { query: string }) {
  const [editCard, setEditCard] = useState<CardWithNote | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { isOnline } = useNetwork();
  const decks = useLiveQuery(() => db.decks.toArray());
  const allNotes = useLiveQuery(() => db.notes.toArray());

  const deckMap = useMemo(() => {
    const map = new Map<string, string>();
    decks?.forEach(d => map.set(d.id, d.name));
    return map;
  }, [decks]);

  const q = query.trim().toLowerCase();
  const qStripped = stripTones(q);

  const { results, totalMatches } = useMemo(() => {
    if (!q || !allNotes) return { results: [] as LocalNote[], totalMatches: 0 };
    const matches = allNotes.filter(note => noteMatches(note, q, qStripped));
    return { results: matches.slice(0, MAX_RESULTS), totalMatches: matches.length };
  }, [q, qStripped, allNotes]);

  // Cards and recent ratings only for the notes on screen — never the whole
  // review history (tens of thousands of events on a long-running account).
  const resultKey = results.map(n => n.id).join(',');
  const detail = useLiveQuery(async () => {
    if (results.length === 0) return { cardsByNoteId: new Map<string, LocalCard[]>(), ratingsByNoteId: new Map<string, Record<string, number[]>>() };
    const noteIds = results.map(n => n.id);
    const cards = await db.cards.where('note_id').anyOf(noteIds).toArray();
    const cardsByNoteId = new Map<string, LocalCard[]>();
    const cardInfo = new Map<string, { note_id: string; card_type: string }>();
    for (const c of cards) {
      const existing = cardsByNoteId.get(c.note_id) || [];
      existing.push(c);
      cardsByNoteId.set(c.note_id, existing);
      cardInfo.set(c.id, { note_id: c.note_id, card_type: c.card_type });
    }
    const events = await db.reviewEvents.where('card_id').anyOf(cards.map(c => c.id)).toArray();
    // Most recent first, up to 8 per card type
    events.sort((a, b) => (b.reviewed_at || '').localeCompare(a.reviewed_at || ''));
    const ratingsByNoteId = new Map<string, Record<string, number[]>>();
    for (const event of events) {
      const info = cardInfo.get(event.card_id);
      if (!info) continue;
      let noteRatings = ratingsByNoteId.get(info.note_id);
      if (!noteRatings) {
        noteRatings = { hanzi_to_meaning: [], meaning_to_hanzi: [], audio_to_hanzi: [] };
        ratingsByNoteId.set(info.note_id, noteRatings);
      }
      const typeRatings = noteRatings[info.card_type];
      if (typeRatings && typeRatings.length < 8) typeRatings.push(event.rating);
    }
    return { cardsByNoteId, ratingsByNoteId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey]);
  const cardsByNoteId = detail?.cardsByNoteId ?? new Map<string, LocalCard[]>();
  const ratingsByNoteId = detail?.ratingsByNoteId ?? new Map<string, Record<string, number[]>>();

  // Nothing on this device? Ask the server, so a device whose local copy is
  // behind (or empty) still finds the card — and says so.
  const localDone = allNotes !== undefined;
  const serverQuery = useQuery({
    queryKey: ['server-note-search', q],
    queryFn: () => searchNotesOnServer(q, 50),
    enabled: !!q && localDone && results.length === 0 && isOnline,
    staleTime: 30_000,
    retry: false,
  });
  const serverHits = serverQuery.data?.notes ?? [];

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
        sentence_clue: note.sentence_clue || null,
        sentence_clue_pinyin: note.sentence_clue_pinyin || null,
        sentence_clue_translation: note.sentence_clue_translation || null,
        sentence_clue_audio_url: note.sentence_clue_audio_url || null,
        multiple_choice_options: note.multiple_choice_options || null,
        pinyin_only: note.pinyin_only || 0,
        alternatives: note.alternatives || null,
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
        await removeNotesLocally([noteId]);
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
  }, [deletingNoteId, queryClient]);

  if (!query.trim()) return null;

  if (!localDone) {
    return (
      <div className="search-page" style={{ padding: 0 }}>
        <div className="search-results-count">Searching…</div>
      </div>
    );
  }

  return (
    <div className="search-page" style={{ padding: 0 }}>
      <div className="search-results-count" data-testid="search-results-count">
        {totalMatches > MAX_RESULTS ? `First ${MAX_RESULTS} of ${totalMatches} results` : `${totalMatches} result${totalMatches !== 1 ? 's' : ''}`}
      </div>

      {results.length === 0 && (
        <div className="search-empty">
          {serverQuery.isFetching ? (
            <>Nothing on this device — checking the server…</>
          ) : serverHits.length > 0 ? (
            <>
              Not on this device yet, but the server has {serverHits.length}{serverHits.length === 50 ? '+' : ''} match{serverHits.length === 1 ? '' : 'es'} for "{query}"
              {serverQuery.data && allNotes && allNotes.length < serverQuery.data.total_notes
                ? ` (this device has ${allNotes.length} of your ${serverQuery.data.total_notes} cards — Settings → Full Sync brings the rest down)`
                : ''}
              :
            </>
          ) : (
            <>No cards found matching "{query}"{serverQuery.isError ? ' (the server could not be reached)' : ''}</>
          )}
        </div>
      )}

      {results.length === 0 && serverHits.length > 0 && (
        <div className="search-results-list" data-testid="server-search-results">
          {serverHits.map(note => (
            <div key={note.id} className="search-result-item" onClick={() => navigate(`/decks/${note.deck_id}`)}>
              <div className="search-result-info">
                <span className="search-result-hanzi">{note.hanzi}</span>
                <span className="search-result-pinyin">{note.pinyin}</span>
                <span className="search-result-english">{note.english}</span>
                {note.sentence_clue && <span className="search-result-sentence-clue">{note.sentence_clue}</span>}
              </div>
              <div className="search-result-actions" onClick={e => e.stopPropagation()}>
                <button className="search-action-btn" title="Go to deck" onClick={() => navigate(`/decks/${note.deck_id}`)}>
                  <span className="search-deck-badge">{note.deck_name || 'Deck'}</span>
                </button>
              </div>
            </div>
          ))}
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
                {note.sentence_clue && (
                  <span className="search-result-sentence-clue">{note.sentence_clue}</span>
                )}
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
