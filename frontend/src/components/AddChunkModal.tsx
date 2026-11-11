import { useEffect, useRef, useState } from 'react';
import type { BumpSource } from '@shared/decks';
import { sourceDeckForBump, sourceDeckName, type SourceDeckKey } from '@shared/decks/source-decks';
import { type LocalNote } from '../db/database';
import { trackError } from '../services/analytics';
import { bumpNotes, findExistingNotes, useBumps } from '../services/studyBumps';
import { addCardToSourceDeck, type AddedToDeck } from '../services/sourceDecks';
import { AddedToDeckLine } from './sourceDecks/AddedToDeckLine';
import './bumps/bumps.css';
import '../pages/RoleplayPage.css';
import './AddChunkModal.css';

/** What "+ Add as card" made: the new note (online — the server has it) and its deck. */
export interface AddedCard {
  noteId: string;
  hanzi: string;
  deckId: string;
  deckName: string;
}

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
 * "+ Add as card" for a word or sentence (chat Explain / Save as flashcard, the study card's
 * sentences, picture hunts, idioms, clips, calls…). NO deck picker (docs/STUDY_SESSION.md "Source
 * decks"): the card goes straight into the deck of its source — "From example sentences", "From
 * chats", … (shared/decks/source-decks.ts; `deckSource`, else from `source`) — as soon as the sheet
 * knows the word is new, and the sheet says "✓ Added to From chats · Change" (Change moves it).
 *
 * A word the learner ALREADY has (any deck, punctuation ignored) is never added by itself: "You
 * already have 银行 in HSK 2" and "⚡ Study it today" as the primary action (shared/decks/bumps.ts:
 * its cards come first in today's session), "Add anyway" second (into the source deck).
 */
export function AddChunkModal(props: {
  chunk: Chunk;
  onClose: () => void;
  source?: BumpSource;
  /** The source deck it goes to; default: the bump source's (sourceDeckForBump). */
  deckSource?: SourceDeckKey;
  /** When given, a word they already have offers "Open card →" (the card hub). */
  onOpenCard?: (noteId: string) => void;
  /**
   * Called once the new card is saved, with the new note and its deck — so the caller can offer
   * "⚡ Study it today" at once (the note reaches this device's store with the next sync).
   */
  onAdded?: (added: AddedCard) => void;
}) {
  const { chunk, onClose } = props;
  const source = props.source ?? 'other';
  const deckKey: SourceDeckKey = props.deckSource ?? sourceDeckForBump(source);
  // null = still reading this device's notes (never add before knowing the word is new).
  const [existing, setExisting] = useState<Array<{ note: LocalNote; deckName: string }> | null>(null);
  const [bumpedMsg, setBumpedMsg] = useState<string | null>(null);
  const bumps = useBumps();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<AddedToDeck | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    findExistingNotes(chunk.hanzi).then(setExisting).catch(() => setExisting([]));
  }, [chunk.hanzi]);

  const existingIds = (existing ?? []).map((e) => e.note.id);
  const alreadyBumped = existingIds.length > 0 && existingIds.every((id) => bumps.has(id));

  async function bump() {
    setBusy(true);
    setErr(null);
    try {
      const out = await bumpNotes(existingIds, source, new Map((existing ?? []).map((e) => [e.note.id, e.note.hanzi])));
      setBumpedMsg(out.message);
      setTimeout(onClose, 1100);
    } catch (e) {
      trackError('bump_card', e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      const out = await addCardToSourceDeck(deckKey, chunk, 'add_chunk');
      setAdded(out);
      props.onAdded?.({ noteId: out.noteId, hanzi: chunk.hanzi, deckId: out.deckId, deckName: out.deckName });
    } catch (e) {
      trackError('add_card', e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // One tap: the sheet opened from "+ Add as card" saves at once when the word is new.
  useEffect(() => {
    if (existing === null || existing.length > 0 || started.current) return;
    started.current = true;
    void add();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  const has = existing !== null && existing.length > 0;
  return (
    <div className="rp-modal-backdrop add-chunk-backdrop" onClick={onClose}>
      <div className="rp-modal add-chunk-modal" role="dialog" aria-label={`Add ${chunk.hanzi} as a card`} onClick={(e) => e.stopPropagation()} data-testid="add-chunk-modal">
        <div className="add-chunk-head">
          <div className="rp-modal-hanzi">{chunk.hanzi}</div>
          <div className="rp-pinyin">{chunk.pinyin}</div>
          <div className="rp-english">{chunk.english}</div>
          {err && <div className="rp-error add-chunk-notice">{err}</div>}
          {has && !added && (
            <div className="add-chunk-duplicate add-chunk-notice" data-testid="already-have">
              You already have {chunk.hanzi} in {[...new Set(existing!.map((e) => e.deckName))].join(', ')}.
              {alreadyBumped ? ' It comes first in today’s study ⚡' : ' Study it today instead of adding it again?'}
              {props.onOpenCard && (
                <>
                  {' '}
                  <button type="button" className="add-chunk-open-card" onClick={() => props.onOpenCard!(existing![0].note.id)}>
                    Open card →
                  </button>
                </>
              )}
            </div>
          )}
          {bumpedMsg && <div className="bump-hint" role="status">{bumpedMsg}</div>}
          {added ? (
            <AddedToDeckLine added={added} surface="add_chunk" className="add-chunk-notice" />
          ) : (
            !has && !err && (
              <div className="add-chunk-label add-chunk-adding" role="status" data-testid="add-chunk-adding">
                Adding to {sourceDeckName(deckKey)}…
              </div>
            )
          )}
        </div>
        {has && !added ? (
          <div className="add-chunk-foot add-chunk-foot--bump">
            <button className="rp-finish add-chunk-cancel" onClick={onClose}>
              Cancel
            </button>
            <button className="rp-finish" onClick={() => void add()} disabled={busy} data-testid="add-chunk-add-anyway">
              {busy ? 'Adding…' : 'Add anyway'}
            </button>
            <button className={`bump-btn${alreadyBumped || bumpedMsg ? ' bump-btn--on' : ''}`} onClick={bump} disabled={busy || alreadyBumped || !!bumpedMsg}>
              {bumpedMsg ? '✓ Bumped' : alreadyBumped ? '⚡ Today ✓' : '⚡ Study it today'}
            </button>
          </div>
        ) : (
          <div className="add-chunk-foot">
            {err && !added ? (
              <>
                <button className="rp-finish" onClick={onClose}>
                  Cancel
                </button>
                <button className="rp-send" onClick={() => void add()} disabled={busy} data-testid="add-chunk-retry">
                  {busy ? 'Adding…' : 'Try again'}
                </button>
              </>
            ) : (
              <button className="rp-send" onClick={onClose} disabled={!added} data-testid="add-chunk-done">
                {added ? 'Done' : 'Adding…'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
