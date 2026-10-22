import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { cardTypeLabel, HOLD_SCOPE_OPTIONS, type HoldScope } from '@shared/decks';
import { forgetButton, forgetTitle, forgetWarning } from '@shared/cards/leech';
import { forgetCards, type ForgetOutcome, type ForgetSource } from '../../services/cardForgets';
import type { CardControlTarget } from './CardControlSheet';
import './cardControls.css';

const TYPE_ORDER = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const cardOrder = (t: string) => (TYPE_ORDER.indexOf(t) + 4) % 4;

/**
 * "Forget this card…" (docs/STUDY_SESSION.md "Forget"): the warning comes FIRST — what happens,
 * that the history is kept, that only Undo right now takes it back — then This card only / All
 * card types of this word and ↺ Forget. Writes a forget event (never a review); the card is NEW
 * from then on.
 */
export function ForgetSheet({
  card,
  siblings,
  hanzi,
  source,
  onDone,
  onClose,
}: {
  card: CardControlTarget;
  siblings?: CardControlTarget[];
  hanzi: string;
  source: ForgetSource;
  /** After the forget is written locally (the toast offers Undo with `outcome.ids`). */
  onDone: (outcome: ForgetOutcome) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<HoldScope>('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await forgetCards(targets.map((c) => c.id), { scope: targets.length > 1 ? 'note' : 'card', source });
      onDone(outcome);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset that card');
      setBusy(false);
    }
  };

  return (
    <>
      <div className="cc-backdrop" onClick={onClose} role="presentation" />
      <div className="cc-sheet" role="dialog" aria-label={`${forgetTitle(targets.length > 1 ? 'note' : 'card', targets.length)} ${hanzi}`} data-testid="card-forget-sheet">
        <div className="cc-grip" aria-hidden="true" />
        <div className="cc-title">
          <span aria-hidden="true">↺</span> {forgetTitle(targets.length > 1 ? 'note' : 'card', targets.length)}{' '}
          <span className="cc-hanzi" lang="zh-CN">{hanzi}</span>
        </div>
        <div className="cc-warning" role="note" data-testid="forget-warning">
          <span className="cc-warning-icon" aria-hidden="true">⚠️</span>
          <span>{forgetWarning(targets.length)}</span>
        </div>

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
                data-testid={`forget-scope-${o.scope}`}
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

        {error && <div className="inline-error" role="alert">{error}</div>}

        <div className="cc-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn cc-danger" onClick={() => void apply()} disabled={busy} data-testid="forget-confirm">
            {forgetButton(targets.length)}
          </button>
        </div>
      </div>
    </>
  );
}
