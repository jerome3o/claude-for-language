import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { API_BASE } from '../api/client';
import { useNoteAudio } from '../hooks/useAudio';
import './DeckTryPage.css';

type Mode = 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'hanzi_to_meaning', label: '汉字 → EN' },
  { id: 'meaning_to_hanzi', label: 'EN → 汉字' },
  { id: 'audio_to_hanzi', label: '🔊 → 汉字' },
];

/**
 * "Try it" for a deck: flip through it card by card in any of the three card
 * types, as a student would see them. Purely a viewer over IndexedDB — no
 * review events, no scheduling, no streak, works offline. Made for tutor
 * accounts checking the homework they send.
 */
export function DeckTryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const deck = useLiveQuery(() => (id ? db.decks.get(id) : undefined), [id]);
  const notes = useLiveQuery(
    async () => (id ? (await db.notes.where('deck_id').equals(id).toArray()).sort((a, b) => a.created_at.localeCompare(b.created_at)) : []),
    [id]
  );
  const [mode, setMode] = useState<Mode>('hanzi_to_meaning');
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const { play, isPlaying } = useNoteAudio('try-deck');

  const note = useMemo(() => (notes && notes.length ? notes[Math.min(index, notes.length - 1)] : null), [notes, index]);
  const close = () => navigate(id ? `/decks/${id}` : '/decks');

  // The audio card starts by playing the word, as in study.
  useEffect(() => {
    if (note && mode === 'audio_to_hanzi' && !revealed) play(note.audio_url, note.hanzi, API_BASE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, mode]);

  const go = (delta: number) => {
    if (!notes?.length) return;
    setIndex((i) => Math.max(0, Math.min(notes.length - 1, i + delta)));
    setRevealed(false);
  };

  return (
    <div className="deck-try">
      <header className="deck-try-top">
        <div className="deck-try-title">
          <span className="deck-try-badge">Preview · nothing is recorded</span>
          <strong>{deck?.name ?? 'Deck'}</strong>
        </div>
        <button type="button" className="study-close-btn deck-try-close" onClick={close} aria-label="Close preview">✕</button>
      </header>

      <div className="deck-try-modes" role="tablist" aria-label="Card type">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={`deck-try-mode${mode === m.id ? ' selected' : ''}`}
            onClick={() => { setMode(m.id); setRevealed(false); }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {notes === undefined ? (
        <p className="deck-try-empty">Loading…</p>
      ) : !note ? (
        <p className="deck-try-empty">This deck has no words on this device yet.</p>
      ) : (
        <>
          <div className="deck-try-count">{index + 1} / {notes.length}</div>
          <div className="deck-try-card" onClick={() => !revealed && setRevealed(true)}>
            {!revealed ? (
              <div className="deck-try-front">
                {mode === 'hanzi_to_meaning' && <div className="deck-try-hanzi">{note.hanzi}</div>}
                {mode === 'meaning_to_hanzi' && <div className="deck-try-english-big">{note.english}</div>}
                {mode === 'audio_to_hanzi' && (
                  <button
                    type="button"
                    className="deck-try-play-big"
                    onClick={(e) => { e.stopPropagation(); play(note.audio_url, note.hanzi, API_BASE); }}
                    aria-label="Play the word"
                  >
                    {isPlaying ? '🔊' : '▶'}
                  </button>
                )}
                <p className="deck-try-prompt">
                  {mode === 'hanzi_to_meaning' ? 'The student says the meaning aloud' : 'The student types the characters'}
                </p>
              </div>
            ) : (
              <div className="deck-try-back">
                <div className="deck-try-hanzi">{note.hanzi}</div>
                <div className="deck-try-pinyin">{note.pinyin}</div>
                <div className="deck-try-english">{note.english}</div>
                <button
                  type="button"
                  className="btn btn-secondary deck-try-play"
                  onClick={(e) => { e.stopPropagation(); play(note.audio_url, note.hanzi, API_BASE); }}
                >
                  {isPlaying ? '🔊 Playing…' : '▶ Play'}
                </button>
                {note.sentence_clue && (
                  <div className="deck-try-sentence">
                    <div>{note.sentence_clue}</div>
                    {note.sentence_clue_pinyin && <div className="deck-try-muted">{note.sentence_clue_pinyin}</div>}
                    {note.sentence_clue_translation && <div className="deck-try-muted">{note.sentence_clue_translation}</div>}
                  </div>
                )}
                {note.fun_facts && <p className="deck-try-facts">{note.fun_facts}</p>}
              </div>
            )}
          </div>

          <div className="deck-try-footer">
            <button type="button" className="btn btn-secondary" onClick={() => go(-1)} disabled={index === 0}>‹ Back</button>
            {!revealed ? (
              <button type="button" className="btn btn-primary" onClick={() => setRevealed(true)}>Show answer</button>
            ) : index < notes.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => go(1)}>Next ›</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={close}>Done</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
