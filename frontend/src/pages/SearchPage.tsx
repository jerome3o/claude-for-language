import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db, LocalNote, LocalCard } from '../db/database';
import { useLiveQuery } from 'dexie-react-hooks';
import CardEditModal from '../components/CardEditModal';
import { CardWithNote } from '../types';

function stripTones(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [editCard, setEditCard] = useState<CardWithNote | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Autofocus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const decks = useLiveQuery(() => db.decks.toArray());
  const allNotes = useLiveQuery(() => db.notes.toArray());
  const allCards = useLiveQuery(() => db.cards.toArray());

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

      <div className="search-results-list">
        {results.map(note => (
          <div
            key={note.id}
            className="search-result-item"
            onClick={() => handleNoteClick(note)}
          >
            <span className="search-result-hanzi">{note.hanzi}</span>
            <div className="search-result-details">
              <div className="search-result-pinyin">{note.pinyin}</div>
              <div className="search-result-english">{note.english}</div>
            </div>
            <span className="search-result-deck">
              {deckMap.get(note.deck_id) || ''}
            </span>
          </div>
        ))}
      </div>

      {editCard && (
        <CardEditModal
          card={editCard}
          onClose={() => setEditCard(null)}
          onSave={() => setEditCard(null)}
        />
      )}
    </div>
  );
}
