import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import {
  cardTypeLabel,
  HOLD_EXPLANATION,
  HOLD_SCOPE_OPTIONS,
  shortDate,
  SNOOZE_OPTIONS,
  snoozeUntil,
  type HoldScope,
  type SnoozeLength,
} from '@shared/decks';
import { holdCards, localDateKey, type HoldSource } from '../../services/cardHolds';
import './cardControls.css';

export type CardControlMode = 'suspend' | 'snooze';

const TYPE_ORDER = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const cardOrder = (t: string) => (TYPE_ORDER.indexOf(t) + 4) % 4;

export interface CardControlTarget {
  id: string;
  note_id: string;
  card_type: string;
}

/**
 * Anki's card controls with clearer words (docs/STUDY_SESSION.md "Suspend & snooze"): a bottom
 * sheet from the card's ⋯ menu / the card hub. One toggle — this card only, or every card type of
 * the word — then:
 *   - Snooze: Until tomorrow · For a week · For a month (a tap applies it);
 *   - Suspend: an explanation and ⏸ Suspend.
 * Nothing here writes a review event or touches the card's schedule.
 */
export function CardControlSheet({
  mode,
  card,
  siblings,
  hanzi,
  source,
  onDone,
  onClose,
}: {
  mode: CardControlMode;
  card: CardControlTarget;
  /** Every card of the word (this one included) — for "All card types of this word"; default: from IndexedDB. */
  siblings?: CardControlTarget[];
  hanzi: string;
  source: HoldSource;
  /** After the hold is written locally: the cards it covers and the toast line. */
  onDone: (cardIds: string[], message: string) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<HoldScope>('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localDateKey();
  const local = useLiveQuery(
    async (): Promise<CardControlTarget[] | null> => (siblings ? null : await db.cards.where('note_id').equals(card.note_id).toArray()),
    [card.note_id, !!siblings]
  );
  const all: CardControlTarget[] = siblings ?? local ?? [card];
  const word = all.filter((c) => c.note_id === card.note_id).sort((a, b) => cardOrder(a.card_type) - cardOrder(b.card_type));
  const targets = scope === 'word' && word.length > 1 ? word : [card];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = async (length?: SnoozeLength) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const ids = targets.map((c) => c.id);
      const r = await holdCards(ids, mode, { length, scope: targets.length > 1 ? 'word' : 'card', source });
      onDone(ids, r.message);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
      setBusy(false);
    }
  };

  const title = mode === 'suspend' ? 'Suspend' : 'Snooze — not today';
  return (
    <>
      <div className="cc-backdrop" onClick={onClose} role="presentation" />
      <div className="cc-sheet" role="dialog" aria-label={`${title}: ${hanzi}`} data-testid={`card-${mode}-sheet`}>
        <div className="cc-grip" aria-hidden="true" />
        <div className="cc-title">
          <span aria-hidden="true">{mode === 'suspend' ? '⏸' : '💤'}</span> {title}{' '}
          <span className="cc-hanzi" lang="zh-CN">{hanzi}</span>
        </div>
        <p className="cc-explain">{HOLD_EXPLANATION[mode]}</p>

        {word.length > 1 && (
          <div className="cc-scope" role="radiogroup" aria-label="Which cards">
            {HOLD_SCOPE_OPTIONS.map((o) => (
              <button
                key={o.scope}
                type="button"
                role="radio"
                aria-checked={scope === o.scope}
                className={`cc-scope-option${scope === o.scope ? ' is-on' : ''}`}
                onClick={() => setScope(o.scope)}
                data-testid={`cc-scope-${o.scope}`}
              >
                <span className="cc-radio" aria-hidden="true">{scope === o.scope ? '◉' : '○'}</span>
                <span className="cc-scope-text">
                  <span>{o.label}</span>
                  <span className="cc-scope-sub">
                    {o.scope === 'card' ? cardTypeLabel(card.card_type) : `${word.length} cards: ${word.map((c) => cardTypeLabel(c.card_type)).join(' · ')}`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {mode === 'snooze' ? (
          <div className="cc-options">
            {SNOOZE_OPTIONS.map((o) => (
              <button
                key={o.length}
                type="button"
                className="cc-option"
                disabled={busy}
                onClick={() => void apply(o.length)}
                data-testid={`cc-snooze-${o.length}`}
              >
                <span className="cc-option-label">{o.label}</span>
                <span className="cc-option-sub">back {o.length === 'tomorrow' ? 'tomorrow' : shortDate(snoozeUntil(today, o.length), today)}</span>
              </button>
            ))}
          </div>
        ) : null}

        {error && <div className="inline-error" role="alert">{error}</div>}

        <div className="cc-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {mode === 'suspend' && (
            <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={busy} data-testid="cc-suspend-confirm">
              ⏸ Suspend {targets.length > 1 ? `${targets.length} cards` : 'card'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
