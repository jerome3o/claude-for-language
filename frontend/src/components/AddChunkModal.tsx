import { useEffect, useState } from 'react';
import { decksInQueueOrder, defaultPickerDeckId } from '@shared/decks/queue';
import { getDecks, createNote } from '../api/client';
import { db } from '../db/database';
import '../pages/RoleplayPage.css';
import './AddChunkModal.css';

export interface Chunk {
  hanzi: string;
  pinyin: string;
  english: string;
  /** Optional card-standard fields, sent as they are (picture hunt objects carry them). */
  fun_facts?: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
}

/**
 * "+ Add as card" for a word or sentence (chat Explain / Save as flashcard, the
 * study card's sentences, the Coach, picture hunts). The decks are listed in
 * study-queue order and the top one is preselected — nothing is remembered
 * between sheets. The word stays at the top, the deck list scrolls on its own
 * and Cancel / Add to deck are pinned at the bottom, however many decks there are.
 */
export function AddChunkModal(props: { chunk: Chunk; onClose: () => void }) {
  const { chunk, onClose } = props;
  const [decks, setDecks] = useState<Array<{ id: string; name: string }>>([]);
  const [deckId, setDeckId] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);

  useEffect(() => {
    getDecks()
      .then((d) => {
        setDecks(decksInQueueOrder(d).map((x) => ({ id: x.id, name: x.name })));
        setDeckId(defaultPickerDeckId(d));
      })
      .catch(() => {});
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
        ...(chunk.fun_facts ? { fun_facts: chunk.fun_facts } : {}),
        ...(chunk.sentence_clue ? {
          sentence_clue: chunk.sentence_clue,
          sentence_clue_pinyin: chunk.sentence_clue_pinyin,
          sentence_clue_translation: chunk.sentence_clue_translation,
        } : {}),
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
    <div className="rp-modal-backdrop add-chunk-backdrop" onClick={onClose}>
      <div className="rp-modal add-chunk-modal" role="dialog" aria-label={`Add ${chunk.hanzi} as a card`} onClick={(e) => e.stopPropagation()}>
        <div className="add-chunk-head">
          <div className="rp-modal-hanzi">{chunk.hanzi}</div>
          <div className="rp-pinyin">{chunk.pinyin}</div>
          <div className="rp-english">{chunk.english}</div>
          {err && <div className="rp-error add-chunk-notice">{err}</div>}
          {isDuplicate && <div className="add-chunk-duplicate add-chunk-notice">This word is already in the selected deck.</div>}
          <div className="add-chunk-label">Save to deck:</div>
        </div>
        <div className="add-chunk-decks" role="radiogroup" aria-label="Deck">
          {decks.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={deckId === d.id}
              className={`add-chunk-deck${deckId === d.id ? ' selected' : ''}`}
              onClick={() => setDeckId(d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
        <div className="add-chunk-foot">
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
