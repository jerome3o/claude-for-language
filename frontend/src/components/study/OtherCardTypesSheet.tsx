import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  defaultOtherCardPicks,
  normalizeBumpCardTypes,
  otherCardTypeRows,
  otherCardsAddedMessage,
  otherCardsButtonLabel,
  otherCardTypesProp,
  type OtherCardTypeRow,
} from '@shared/decks';
import { db, getStudyCutoff, queueInput } from '../../db/database';
import { bumpCardTypes, useBumps } from '../../services/studyBumps';
import { track, trackError } from '../../services/analytics';

/**
 * ⋯ → "Practise this word other ways…" (shared/decks/other-card-types.ts; docs/STUDY_SESSION.md
 * "Other card types"). The note's card types with their state; a NEW sibling can be added to
 * today ("⚡ Add to today", the first one ticked), a started one not due yet reviewed early.
 * Adding is a card-level ⚡ bump (services/studyBumps.ts bumpCardTypes): offline-first, outside
 * the daily budget, and the cards join this session at once (`onAdded` → useStudySession
 * addBumpedCards) a few cards later.
 */
export function OtherCardTypesSheet({
  noteId,
  hanzi,
  currentCardId,
  currentCardType,
  inToday,
  onAdded,
  onClose,
}: {
  noteId: string;
  hanzi: string;
  currentCardId: string;
  currentCardType: string;
  /** This session's ⚡ pocket cards (already in today's study). */
  inToday: ReadonlySet<string>;
  onAdded: (cardIds: string[]) => void;
  onClose: () => void;
}) {
  const cards = useLiveQuery(() => db.cards.where('note_id').equals(noteId).toArray(), [noteId]);
  const bumps = useBumps();
  const bump = bumps.get(noteId);
  // A whole-note bump still open today (some of its cards in this session's pocket) covers the word.
  const wholeNoteBumped = !!bump && !normalizeBumpCardTypes(bump.card_types) && !!cards?.some((c) => inToday.has(c.id));
  const rows: OtherCardTypeRow[] = useMemo(
    () => (cards ? otherCardTypeRows(cards.map(queueInput), currentCardId, getStudyCutoff().ts, inToday, wholeNoteBumped) : []),
    [cards, currentCardId, inToday, wholeNoteBumped]
  );
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The first NEW sibling is ticked when the sheet opens (once the cards have loaded).
  useEffect(() => {
    if (picked === null && cards) setPicked(new Set(defaultOtherCardPicks(rows)));
  }, [cards, rows, picked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const chosen = rows.filter((r) => r.action && picked?.has(r.card_id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function add() {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const types = chosen.map((r) => r.card_type);
      await bumpCardTypes(noteId, types, 'study_card');
      track('study.other_card_types', {
        types: otherCardTypesProp(types),
        from_type: currentCardType,
        count: chosen.length,
        early: chosen.filter((r) => r.action === 'early').length,
      });
      onAdded(chosen.map((r) => r.card_id));
      setDone(otherCardsAddedMessage(chosen.map((r) => r.label)));
    } catch (err) {
      trackError('study_other_card_types', err);
      setError(err instanceof Error ? err.message : 'Could not add the card');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="study-sheet-backdrop" onClick={busy ? undefined : onClose} role="presentation" />
      <div className="study-sheet study-other-sheet" role="dialog" aria-label="Practise this word other ways" data-testid="other-card-types-sheet">
        <div className="study-sheet-grip" aria-hidden="true" />
        <div className="study-other-title">
          Practise <span className="study-other-hanzi">{hanzi}</span> other ways
        </div>
        <p className="study-other-help">
          Added cards come up in a few cards, on top of today’s new cards, then on their own schedule.
        </p>
        {done ? (
          <div className="study-other-done" role="status" data-testid="other-card-types-done">{done}</div>
        ) : (
          <ul className="study-other-list">
            {rows.map((r) => {
              const on = !!r.action && !!picked?.has(r.card_id);
              const body = (
                <>
                  <span className="study-other-text">
                    <span className="study-other-label">{r.label}</span>
                    <span className={`study-other-status${r.is_current ? ' is-current' : ''}`}>{r.status}</span>
                  </span>
                  {r.action && (
                    <span className={`study-other-action${on ? ' is-on' : ''}`}>
                      {r.action === 'add' ? '⚡ Add to today' : 'Review it early today'}
                    </span>
                  )}
                </>
              );
              return (
                <li key={r.card_id}>
                  {r.action ? (
                    <label className={`study-other-row is-actionable${on ? ' is-on' : ''}`} data-testid={`other-card-row-${r.card_type}`}>
                      <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(r.card_id)} aria-label={`${r.label}: ${r.action === 'add' ? 'add to today' : 'review it early today'}`} />
                      {body}
                    </label>
                  ) : (
                    <div className="study-other-row" data-testid={`other-card-row-${r.card_type}`}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && <div className="study-inline-error" role="alert">{error}</div>}
        {!done && (
          <div className="sheet-footer study-other-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void add()}
              disabled={busy || chosen.length === 0}
              data-testid="other-card-types-add"
            >
              {otherCardsButtonLabel(chosen.length)}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
