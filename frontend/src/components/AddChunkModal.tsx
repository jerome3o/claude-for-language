import { useEffect, useState } from 'react';
import { getDecks, createNote } from '../api/client';
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

  useEffect(() => {
    getDecks()
      .then((d) => {
        setDecks(d.map((x) => ({ id: x.id, name: x.name })));
        if (d[0]) setDeckId(d[0].id);
      })
      .catch(() => {});
  }, []);

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
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          className="rp-input"
          style={{ minHeight: 'auto', marginTop: '0.75rem' }}
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="exercise-actions" style={{ marginTop: '0.75rem' }}>
          <button className="rp-finish" onClick={onClose}>
            Cancel
          </button>
          <button className="rp-send" onClick={add} disabled={busy || !deckId}>
            {done ? '✓ Added' : busy ? 'Adding…' : 'Add to deck'}
          </button>
        </div>
      </div>
    </div>
  );
}
