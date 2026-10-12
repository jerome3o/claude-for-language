import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { canAddToUpNext, type UpNextSource } from '@shared/decks';
import { db } from '../../db/database';
import { addToUpNext, removeFromUpNext } from '../../services/upNext';
import './upNext.css';

/**
 * "↑ Up next" for a note the learner has (shared/decks/up-next.ts): puts it at the end of
 * the Up next list (introduced first within the daily budget). Shows "↑ #3" once listed —
 * a second tap takes it off when `removable`. Renders nothing for a note with every card
 * studied (⚡ Study it today is the button for that). Offline-first.
 */
export function UpNextButton(props: {
  noteId: string;
  source: UpNextSource;
  compact?: boolean;
  removable?: boolean;
  className?: string;
  onDone?: (message: string) => void;
}) {
  const { noteId, source, compact, removable, className, onDone } = props;
  const state = useLiveQuery(async () => {
    const [row, all, cards] = await Promise.all([
      db.upNext.get(noteId),
      db.upNext.orderBy('position').primaryKeys(),
      db.cards.where('note_id').equals(noteId).toArray(),
    ]);
    return { place: row ? (all as string[]).indexOf(noteId) + 1 : 0, canAdd: canAddToUpNext(cards.map((c) => ({ queue: c.queue }))) };
  }, [noteId]);
  const [busy, setBusy] = useState(false);
  if (!state || (!state.place && !state.canAdd)) return null;
  const on = state.place > 0;

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (on) {
        if (removable) {
          await removeFromUpNext(noteId, source);
          onDone?.('Taken off Up next');
        }
      } else {
        const out = await addToUpNext([noteId], { source });
        onDone?.(out.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`upnext-btn${compact ? ' upnext-btn--compact' : ''}${on ? ' upnext-btn--on' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={busy || (on && !removable)}
      aria-pressed={on}
      title={on ? (removable ? `#${state.place} on Up next — tap to take it off` : `#${state.place} on Up next`) : 'Learn it next: put it on the Up next list'}
      data-testid="upnext-button"
    >
      {on ? `↑ #${state.place}` : compact ? '↑' : '↑ Up next'}
    </button>
  );
}
