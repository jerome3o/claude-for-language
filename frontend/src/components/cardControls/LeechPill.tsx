import { useEffect, useState } from 'react';
import { LEECH_EXPLANATION, leechHeadline, leechInfo, leechPill, ratingTag, type LeechInfo } from '@shared/cards/leech';
import { getCardReplayEvents } from '../../db/database';
import { track } from '../../services/analytics';
import './cardControls.css';

export interface LeechActions {
  onEdit?: () => void;
  onMemoryHook?: () => void;
  onSuspend?: () => void;
  onSnooze?: () => void;
  onForget?: () => void;
}

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/**
 * "⚠️ Missed 8×" on the answer side of a leech (docs/STUDY_SESSION.md "Leeches"): a card forgotten
 * 8+ times after it was learned (Anki's lapses). Never suspends anything by itself — the sheet
 * shows how it went and offers what helps.
 */
export function LeechPill({ cardId, cardType, lapses, actions }: { cardId: string; cardType: string; lapses: number | null | undefined; actions: LeechActions }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [cardId]);
  const pill = leechPill(lapses);
  if (!pill) return null;
  return (
    <>
      <div className="leech-pill-row">
        <button
          type="button"
          className="leech-pill"
          data-testid="leech-pill"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
            track('card.leech_open', { lapses: lapses ?? 0, card_type: cardType });
          }}
        >
          <span aria-hidden="true">{pill.icon}</span>
          <span>{pill.text}</span>
        </button>
      </div>
      {open && <LeechSheet cardId={cardId} lapses={lapses ?? 0} actions={actions} onClose={() => setOpen(false)} />}
    </>
  );
}

export function LeechSheet({ cardId, lapses, actions, onClose }: { cardId: string; lapses: number; actions: LeechActions; onClose: () => void }) {
  const [info, setInfo] = useState<LeechInfo | null>(null);
  useEffect(() => {
    let live = true;
    void getCardReplayEvents(cardId).then((events) => {
      if (live) setInfo(leechInfo(events));
    });
    return () => {
      live = false;
    };
  }, [cardId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The device's events are the source; the card's cached count is the fallback while they load.
  const missed = info?.lapses ?? lapses;
  const last = info?.lapse_dates[info.lapse_dates.length - 1];
  const act = (fn?: () => void) => () => {
    onClose();
    fn?.();
  };
  return (
    <>
      <div className="cc-backdrop" onClick={onClose} role="presentation" />
      <div className="cc-sheet" role="dialog" aria-label="A card you keep missing" data-testid="leech-sheet">
        <div className="cc-grip" aria-hidden="true" />
        <div className="cc-title">
          <span aria-hidden="true">⚠️</span> {leechHeadline(missed)}
        </div>
        <p className="cc-explain">{LEECH_EXPLANATION}</p>

        <div className="leech-stats">
          <div className="leech-stat">
            <div className="leech-stat-value">{missed}×</div>
            <div className="leech-stat-label">missed after learning it</div>
          </div>
          <div className="leech-stat">
            <div className="leech-stat-value">{last ? dateLabel(last) : '—'}</div>
            <div className="leech-stat-label">last missed</div>
          </div>
        </div>

        <div className="leech-section-title">What helps</div>
        <div className="leech-actions">
          {actions.onEdit && (
            <button type="button" className="btn btn-secondary" onClick={act(actions.onEdit)} data-testid="leech-edit">✏️ Edit card</button>
          )}
          {actions.onMemoryHook && (
            <button type="button" className="btn btn-secondary" onClick={act(actions.onMemoryHook)} data-testid="leech-hook">💡 Ask Claude for a memory hook</button>
          )}
          {actions.onSnooze && (
            <button type="button" className="btn btn-secondary" onClick={act(actions.onSnooze)} data-testid="leech-snooze">💤 Snooze…</button>
          )}
          {actions.onSuspend && (
            <button type="button" className="btn btn-secondary" onClick={act(actions.onSuspend)} data-testid="leech-suspend">⏸️ Suspend…</button>
          )}
          {actions.onForget && (
            <button type="button" className="btn btn-secondary" onClick={act(actions.onForget)} data-testid="leech-forget">↺ Forget this card…</button>
          )}
        </div>

        {info && info.recent.length > 0 && (
          <>
            <div className="leech-section-title">Recent ratings</div>
            <ul className="leech-recent" data-testid="leech-recent">
              {info.recent.map((r, i) => (
                <li key={`${r.reviewed_at}-${i}`}>
                  <span className={r.lapse ? 'leech-lapse' : undefined}>
                    {ratingTag(r.rating)}
                    {r.lapse ? ' — missed' : ''}
                  </span>
                  <span className="text-light">{dateLabel(r.reviewed_at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="cc-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  );
}
