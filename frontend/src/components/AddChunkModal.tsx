import { useEffect, useState } from 'react';
import { decksInQueueOrder, defaultPickerDeckId } from '@shared/decks/queue';
import type { BumpSource } from '@shared/decks';
import { getDecks, createNote } from '../api/client';
import { db, type LocalNote } from '../db/database';
import { trackError } from '../services/analytics';
import { bumpNotes, findExistingNotes, useBumps } from '../services/studyBumps';
import './bumps/bumps.css';
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
 *
 * A word the learner ALREADY has (any deck, punctuation ignored) gets
 * "You already have 银行 in HSK 2" and "⚡ Study it today" as the primary action
 * (shared/decks/bumps.ts: its cards come first in today's session), "Add anyway" second.
 */
export function AddChunkModal(props: {
  chunk: Chunk;
  onClose: () => void;
  source?: BumpSource;
  /** When given, a word they already have offers "Open card →" (the card hub). */
  onOpenCard?: (noteId: string) => void;
  /** Called once the new card is saved. */
  onAdded?: () => void;
}) {
  const { chunk, onClose } = props;
  const source = props.source ?? 'other';
  const [existing, setExisting] = useState<Array<{ note: LocalNote; deckName: string }>>([]);
  const [bumpedMsg, setBumpedMsg] = useState<string | null>(null);
  const bumps = useBumps();
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
    findExistingNotes(chunk.hanzi).then(setExisting).catch(() => setExisting([]));
  }, [chunk.hanzi]);

  const existingIds = existing.map((e) => e.note.id);
  const alreadyBumped = existingIds.length > 0 && existingIds.every((id) => bumps.has(id));

  async function bump() {
    setBusy(true);
    setErr(null);
    try {
      const out = await bumpNotes(existingIds, source, new Map(existing.map((e) => [e.note.id, e.note.hanzi])));
      setBumpedMsg(out.message);
      setTimeout(onClose, 1100);
    } catch (e) {
      trackError('bump_card', e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
      props.onAdded?.();
      setTimeout(onClose, 800);
    } catch (e) {
      trackError('add_card', e);
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
          {existing.length > 0 ? (
            <div className="add-chunk-duplicate add-chunk-notice" data-testid="already-have">
              You already have {chunk.hanzi} in {[...new Set(existing.map((e) => e.deckName))].join(', ')}.
              {alreadyBumped ? ' It comes first in today’s study ⚡' : ' Study it today instead of adding it again?'}
              {props.onOpenCard && (
                <>
                  {' '}
                  <button type="button" className="add-chunk-open-card" onClick={() => props.onOpenCard!(existing[0].note.id)}>
                    Open card →
                  </button>
                </>
              )}
            </div>
          ) : isDuplicate && <div className="add-chunk-duplicate add-chunk-notice">This word is already in the selected deck.</div>}
          {bumpedMsg && <div className="bump-hint" role="status">{bumpedMsg}</div>}
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
        {existing.length > 0 ? (
          <div className="add-chunk-foot add-chunk-foot--bump">
            <button className="rp-finish add-chunk-cancel" onClick={onClose}>
              Cancel
            </button>
            <button className="rp-finish" onClick={add} disabled={busy || !deckId}>
              {done ? '✓ Added' : 'Add anyway'}
            </button>
            <button className={`bump-btn${alreadyBumped || bumpedMsg ? ' bump-btn--on' : ''}`} onClick={bump} disabled={busy || alreadyBumped || !!bumpedMsg}>
              {bumpedMsg ? '✓ Bumped' : alreadyBumped ? '⚡ Today ✓' : '⚡ Study it today'}
            </button>
          </div>
        ) : (
          <div className="add-chunk-foot">
            <button className="rp-finish" onClick={onClose}>
              Cancel
            </button>
            <button className="rp-send" onClick={add} disabled={busy || !deckId}>
              {done ? '✓ Added' : busy ? 'Adding…' : isDuplicate ? 'Add anyway' : 'Add to deck'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
