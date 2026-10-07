/**
 * Settings → New cards → "Order new cards by" (shared/decks/new-card-order.ts): which
 * brand-new words the daily budget introduces first — new characters, new words, the most
 * common, sentences last — before the deck order decides. Each switch saves at once
 * (PUT /api/profile/new-card-order) and is mirrored on the device so the study queue
 * follows it offline (services/newCardOrder.ts). Homework passes are not affected.
 */
import { useEffect, useState } from 'react';
import {
  DEFAULT_NEW_CARD_ORDER,
  isDefaultNewCardOrder,
  NEW_CARD_ORDER_OPTIONS,
  type NewCardOrder,
  type NewCardOrderKey,
} from '@shared/decks';
import { NEW_CARD_ORDER_CHANGED, readNewCardOrder, saveNewCardOrder } from '../../services/newCardOrder';
import { track } from '../../services/analytics';
import './NewCardOrderSection.css';

export function NewCardOrderSection() {
  const [order, setOrder] = useState<NewCardOrder>(() => readNewCardOrder());
  const [saving, setSaving] = useState<NewCardOrderKey | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A sync or /auth/me brought the account's order (another device changed it).
  useEffect(() => {
    const onChange = () => setOrder(readNewCardOrder());
    window.addEventListener(NEW_CARD_ORDER_CHANGED, onChange);
    return () => window.removeEventListener(NEW_CARD_ORDER_CHANGED, onChange);
  }, []);

  const save = async (next: NewCardOrder, what: NewCardOrderKey | 'reset') => {
    const before = order;
    setOrder(next);
    setSaving(what);
    setError(null);
    try {
      const saved = await saveNewCardOrder(what === 'reset' ? { reset: true } : { [what]: next[what] });
      setOrder(saved);
      track('settings.new_card_order', {
        field: what === 'reset' ? undefined : what,
        reset: what === 'reset',
        new_characters_first: saved.new_characters_first,
        new_words_first: saved.new_words_first,
        most_common_first: saved.most_common_first,
        sentences_last: saved.sentences_last,
      });
    } catch (err) {
      setOrder(before);
      setError(navigator.onLine && err instanceof Error ? err.message : 'You are offline — try again when you have a connection.');
    } finally {
      setSaving(null);
    }
  };

  const isDefault = isDefaultNewCardOrder(order);
  let step = 0;

  return (
    <div className="settings-section new-card-order" data-testid="new-card-order">
      <h2>Order new cards by</h2>
      <p className="settings-section-desc">
        Which new words come first each day. Your daily budget decides how many; these decide which.
      </p>
      <ol className="nco-list">
        {NEW_CARD_ORDER_OPTIONS.map(opt => {
          const on = order[opt.key];
          if (on) step++;
          return (
            <li key={opt.key} className={`nco-row${on ? ' is-on' : ''}`}>
              <label className="nco-label" data-testid={`nco-${opt.key}`}>
                <span className="nco-step" aria-hidden="true">{on ? step : '–'}</span>
                <span className="nco-text">
                  <span className="nco-title">{opt.label}</span>
                  <span className="nco-hint">{opt.hint}</span>
                </span>
                <span className="nco-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={on}
                    disabled={saving !== null}
                    onChange={e => void save({ ...order, [opt.key]: e.target.checked }, opt.key)}
                    aria-label={opt.label}
                    data-testid={`nco-switch-${opt.key}`}
                  />
                  <span className="nco-track" aria-hidden="true"><span className="nco-thumb" /></span>
                </span>
              </label>
            </li>
          );
        })}
        <li className="nco-row nco-row--then">
          <span className="nco-step" aria-hidden="true">↓</span>
          <span className="nco-text">
            <span className="nco-title">Then your deck order</span>
            <span className="nco-hint">The rest come deck by deck, top of your deck list first.</span>
          </span>
        </li>
      </ol>
      <p className="nco-note">
        ⚡ Bumped words, your decks&apos; daily limits and homework from your tutor work as before.
      </p>
      {!isDefault && (
        <button
          type="button"
          className="btn btn-secondary nco-reset"
          onClick={() => void save({ ...DEFAULT_NEW_CARD_ORDER }, 'reset')}
          disabled={saving !== null}
          data-testid="nco-reset"
        >
          {saving === 'reset' ? 'Resetting…' : 'Reset to default'}
        </button>
      )}
      {error && <div className="export-error" role="alert">{error}</div>}
    </div>
  );
}
