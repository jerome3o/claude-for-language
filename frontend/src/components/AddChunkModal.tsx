import { useEffect, useState } from 'react';
import { getDecks, createNote } from '../api/client';
import { db } from '../db/database';
import { usePinnedDecks } from '../hooks/usePinnedDecks';
import '../pages/RoleplayPage.css';

export interface Chunk {
  hanzi: string;
  pinyin: string;
  english: string;
}

export function AddChunkModal(props: { chunk: Chunk; onClose: () => void }) {
  const { chunk, onClose } = props;
  const [decks, setDecks] = useState<Array<{ id: string; name: string }>>([]);
  const [deckId, setDeckId] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const { isPinned, togglePin, sortWithPinnedFirst } = usePinnedDecks();

  useEffect(() => {
    getDecks()
      .then((d) => {
        const sorted = sortWithPinnedFirst(d.map((x) => ({ id: x.id, name: x.name })));
        setDecks(sorted);
        if (sorted[0]) setDeckId(sorted[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!deckId) {
      setIsDuplicate(false);
      return;
    }
    db.notes
      .where('deck_id').equals(deckId)
      .filter((n) => n.hanzi === chunk.hanzi)
      .count()
      .then((count) => setIsDuplicate(count > 0))
      .catch(() => setIsDuplicate(false));
  }, [deckId, chunk.hanzi]);

  async function add() {
    if (!deckId) return;
    setBusy(true);
    setErr(null);
    try {
      await createNote(deckId, {
        hanzi: chunk.hanzi,
        pinyin: chunk.pinyin,
        english: chunk.english,
      });
      setDone(true);
      setTimeout(onClose, 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rp-modal-backdrop" onClick={onClose}>
      <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rp-modal-hanzi">{chunk.hanzi}</div>
        <div className="rp-pinyin">{chunk.pinyin}</div>
        <div className="rp-english">{chunk.english}</div>
        {err && <div className="rp-error" style={{ marginTop: '0.5rem' }}>{err}</div>}
        {isDuplicate && (
          <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#fff3cd', color: '#856404', borderRadius: '6px', fontSize: '0.85rem' }}>
            This word is already in the selected deck.
          </div>
        )}
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.35rem' }}>Save to deck:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '200px', overflowY: 'auto' }}>
            {decks.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <button
                  onClick={() => setDeckId(d.id)}
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid',
                    borderColor: deckId === d.id ? '#3b82f6' : '#d1d5db',
                    background: deckId === d.id ? '#eff6ff' : '#fff',
                    color: deckId === d.id ? '#1d4ed8' : '#374151',
                    fontWeight: deckId === d.id ? 600 : 400,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  {isPinned(d.id) && <span style={{ marginRight: '0.3rem' }}>📌</span>}
                  {d.name}
                </button>
                <button
                  onClick={() => togglePin(d.id)}
                  title={isPinned(d.id) ? 'Unpin deck' : 'Pin deck to top'}
                  style={{
                    padding: '0.4rem',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb',
                    background: isPinned(d.id) ? '#fef3c7' : '#f9fafb',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    lineHeight: 1,
                    opacity: isPinned(d.id) ? 1 : 0.5,
                  }}
                >
                  📌
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="exercise-actions" style={{ marginTop: '0.75rem' }}>
          <button className="rp-finish" onClick={onClose}>
            Cancel
          </button>
          <button className="rp-send" onClick={add} disabled={busy || !deckId}>
            {done ? '✓ Added' : busy ? 'Adding…' : isDuplicate ? 'Add anyway' : 'Add to deck'}
          </button>
        </div>
      </div>
    </div>
  );
}
