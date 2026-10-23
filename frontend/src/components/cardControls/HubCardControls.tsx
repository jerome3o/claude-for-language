import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { ForgetSheet } from './ForgetSheet';
import { LeechPill } from './LeechPill';
import { undoForget, type ForgetOutcome } from '../../services/cardForgets';
import { UndoToast } from '../upNext/UpNextBoard';
import { cardTypeLabel, holdStatusLabel, holdTag } from '@shared/decks';
import { localDateKey, releaseCards, useCardHolds } from '../../services/cardHolds';
import { CardControlSheet, type CardControlMode, type CardControlTarget } from './CardControlSheet';
import { Toast, useToast } from '../Toast';
import './cardControls.css';

/**
 * The card hub's controls (the owner's own card): each card type with its hold — ⏸️ Suspended /
 * 💤 Snoozed · 29 Oct and Unsuspend / Wake now — or 💤 Snooze… / ⏸️ Suspend… (the same sheet as the
 * study card's ⋯ menu, docs/STUDY_SESSION.md "Suspend & snooze"), ↺ Forget… (back to New, with Undo)
 * and, on a leech, the "⚠️ Missed 8×" pill.
 */
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];

export function HubCardControls({ cards, hanzi }: { cards: CardControlTarget[]; hanzi: string }) {
  const holds = useCardHolds();
  const [sheet, setSheet] = useState<{ mode: CardControlMode; card: CardControlTarget } | null>(null);
  const [toast, showToast] = useToast();
  const [forget, setForget] = useState<CardControlTarget | null>(null);
  const [forgotten, setForgotten] = useState<ForgetOutcome | null>(null);
  const lapses = useLiveQuery(async () => {
    const rows = await db.cards.bulkGet(cards.map((c) => c.id));
    return new Map(rows.filter((r): r is NonNullable<typeof r> => !!r).map((r) => [r.id, r.lapses ?? 0]));
  }, [cards.map((c) => c.id).join(',')]);
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
            <LeechPill
              cardId={c.id}
              cardType={c.card_type}
              lapses={lapses?.get(c.id)}
              actions={{
                onSnooze: hold ? undefined : () => setSheet({ mode: 'snooze', card: c }),
                onSuspend: hold ? undefined : () => setSheet({ mode: 'suspend', card: c }),
                onForget: () => setForget(c),
              }}
            />
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
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForget(c)} data-testid="hub-forget">
                ↺ Forget…
              </button>
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
      {forget && (
        <ForgetSheet
          card={forget}
          siblings={cards}
          hanzi={hanzi}
          source="card_hub"
          onDone={(outcome) => setForgotten(outcome)}
          onClose={() => setForget(null)}
        />
      )}
      {forgotten && (
        <UndoToast
          text={forgotten.message}
          onUndo={() => {
            const ids = forgotten.ids;
            setForgotten(null);
            void undoForget(ids, 'card_hub').then(showToast);
          }}
          onDone={() => setForgotten(null)}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}
