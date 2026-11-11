import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { addedToDeckLine, movedToDeckLine } from '@shared/decks/source-decks';
import { decksInQueueOrder } from '@shared/decks/queue';
import { getDecks } from '../../api/client';
import { db } from '../../db/database';
import { trackError } from '../../services/analytics';
import { moveAddedCards, type AddedToDeck, type SourceDeckSurface } from '../../services/sourceDecks';
import './source-decks.css';

/**
 * "✓ Added to From readers · Change" (docs/STUDY_SESSION.md "Source decks"): where a card added
 * from around the app went, with ONE way to put it somewhere else — Change opens the deck list and
 * moves the just-added note(s) (`POST /api/notes/move`); the line then says "Moved to HSK 2".
 */
export function AddedToDeckLine({
  added,
  surface,
  onMoved,
  className = '',
}: {
  added: AddedToDeck;
  surface: SourceDeckSurface;
  onMoved?: (now: AddedToDeck) => void;
  className?: string;
}) {
  const [now, setNow] = useState(added);
  const [moved, setMoved] = useState(false);
  const [changing, setChanging] = useState(false);
  // A NEW add (other notes) starts over; the caller echoing a move back keeps "Moved to …".
  const addKey = added.noteIds.join(',');
  useEffect(() => {
    setNow((cur) => (cur.noteIds.join(',') === addKey ? { ...added, deckId: cur.deckId, deckName: cur.deckName } : added));
    setMoved((m) => (now.noteIds.join(',') === addKey ? m : false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addKey]);

  const count = now.noteIds.length;
  return (
    <div className={`added-to-deck ${className}`.trim()} role="status" data-testid="added-to-deck" data-deck-id={now.deckId}>
      <span className="added-to-deck-text">
        ✓ {moved ? movedToDeckLine(now.deckName, count) : addedToDeckLine(now.deckName, count)}
      </span>
      {count > 0 && (
        <>
          <span className="added-to-deck-dot" aria-hidden="true">·</span>
          <button type="button" className="added-to-deck-change" onClick={() => setChanging(true)} data-testid="added-to-deck-change">
            Change
          </button>
        </>
      )}
      {changing &&
        createPortal(
          <MoveToDeckSheet
            current={now}
            surface={surface}
            onClose={() => setChanging(false)}
            onMoved={(next) => {
              setNow(next);
              setMoved(true);
              setChanging(false);
              onMoved?.(next);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

/** The deck list (study-queue order) for "Change": tap a deck → the note(s) move there. */
export function MoveToDeckSheet({
  current,
  surface,
  onClose,
  onMoved,
}: {
  current: AddedToDeck;
  surface: SourceDeckSurface;
  onClose: () => void;
  onMoved: (now: AddedToDeck) => void;
}) {
  const [decks, setDecks] = useState<Array<{ id: string; name: string }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // This device's decks and the server's, merged (the server's row wins): a list from either is enough.
    const seen = new Map<string, { id: string; name: string; study_priority?: number | null; created_at?: string | null }>();
    const show = (list: Array<{ id: string; name: string; study_priority?: number | null; created_at?: string | null }>) => {
      if (!live) return;
      for (const d of list) seen.set(d.id, d);
      const ordered = decksInQueueOrder([...seen.values()]).map((d) => ({ id: d.id, name: d.name }));
      // The deck it is in now is always listed (a source deck made a moment ago may not be on the device yet).
      if (current.deckId && !ordered.some((d) => d.id === current.deckId)) ordered.unshift({ id: current.deckId, name: current.deckName });
      setDecks(ordered);
    };
    db.decks.toArray().then(show).catch(() => undefined);
    getDecks().then(show).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [current.deckId, current.deckName]);

  async function pick(deck: { id: string; name: string }) {
    if (deck.id === current.deckId) {
      onClose();
      return;
    }
    setBusy(deck.id);
    setErr(null);
    try {
      onMoved(await moveAddedCards(current, deck.id, deck.name, surface));
    } catch (e) {
      trackError('source_deck_change', e);
      setErr(e instanceof Error ? e.message : "Couldn't move it — try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rp-modal-backdrop add-chunk-backdrop move-to-deck-layer" onClick={onClose}>
      <div className="rp-modal add-chunk-modal" role="dialog" aria-label="Move to another deck" onClick={(e) => e.stopPropagation()} data-testid="move-to-deck">
        <div className="add-chunk-head">
          <div className="move-to-deck-title">Move to another deck</div>
          {err && <div className="rp-error add-chunk-notice">{err}</div>}
        </div>
        <div className="add-chunk-decks" role="radiogroup" aria-label="Deck">
          {decks === null ? (
            <div className="move-to-deck-loading">Loading your decks…</div>
          ) : (
            decks.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={d.id === current.deckId}
                className={`add-chunk-deck${d.id === current.deckId ? ' selected' : ''}`}
                disabled={busy !== null}
                onClick={() => void pick(d)}
              >
                {busy === d.id ? 'Moving…' : d.name}
              </button>
            ))
          )}
        </div>
        <div className="add-chunk-foot">
          <button type="button" className="rp-finish" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
