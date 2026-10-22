import { useState } from 'react';
import { cardTypeLabel, holdStatusLabel, holdTag } from '@shared/decks';
import { localDateKey, releaseCards, useCardHolds } from '../../services/cardHolds';
import { CardControlSheet, type CardControlMode, type CardControlTarget } from './CardControlSheet';
import { Toast, useToast } from '../Toast';
import './cardControls.css';

/**
 * The card hub's controls (the owner's own card): each card type with its hold — ⏸️ Suspended /
 * 💤 Snoozed · 29 Oct and Unsuspend / Wake now — or 💤 Snooze… / ⏸️ Suspend… (the same sheet as the
 * study card's ⋯ menu, docs/STUDY_SESSION.md "Suspend & snooze").
 */
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];

export function HubCardControls({ cards, hanzi }: { cards: CardControlTarget[]; hanzi: string }) {
  const holds = useCardHolds();
  const [sheet, setSheet] = useState<{ mode: CardControlMode; card: CardControlTarget } | null>(null);
  const [toast, showToast] = useToast();
  const today = localDateKey();
  return (
    <div className="cc-hub" data-testid="hub-card-controls">
      {[...cards].sort((a, b) => TYPES.indexOf(a.card_type) - TYPES.indexOf(b.card_type)).map((c) => {
        const hold = holds.get(c.id);
        const tag = hold ? holdTag(hold, today) : null;
        return (
          <div key={c.id} className="cc-hub-card" data-testid={`hub-hold-${c.card_type}`}>
            <div className="cc-hub-hold">
              <strong>{cardTypeLabel(c.card_type)}</strong>
              {hold && tag && (
                <span className="cc-tag" title={holdStatusLabel(hold, today)}><span aria-hidden="true">{tag.icon}</span> {tag.text}</span>
              )}
            </div>
            <div className="cc-hub-actions">
              {hold ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={async () => showToast((await releaseCards([c.id], 'card_hub')).message)}
                  data-testid="hub-release"
                >
                  {hold.kind === 'snooze' ? 'Wake now' : 'Unsuspend'}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSheet({ mode: 'snooze', card: c })} data-testid="hub-snooze">
                    💤 Snooze…
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSheet({ mode: 'suspend', card: c })} data-testid="hub-suspend">
                    ⏸️ Suspend…
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {sheet && (
        <CardControlSheet
          mode={sheet.mode}
          card={sheet.card}
          siblings={cards}
          hanzi={hanzi}
          source="card_hub"
          onDone={(_ids, message) => showToast(message)}
          onClose={() => setSheet(null)}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}
