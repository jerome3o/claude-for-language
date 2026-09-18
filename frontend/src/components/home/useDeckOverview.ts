import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { CardQueue } from '../../types';

export interface DeckOverview {
  notes: number;
  cards: number;
  /** Cards that have been studied at least once. */
  seen: number;
  /** Cards with a review interval over three weeks (matches the server's "mastered"). */
  mastered: number;
}

const MASTERED_INTERVAL_DAYS = 21;

/**
 * Per-deck word counts and a mastery split, straight from IndexedDB, so the
 * deck list never waits on the network (the old per-deck stats request).
 */
export function useDeckOverview(): Map<string, DeckOverview> | undefined {
  return useLiveQuery(async () => {
    const [notes, cards] = await Promise.all([db.notes.toArray(), db.cards.toArray()]);
    const map = new Map<string, DeckOverview>();
    const get = (deckId: string) => {
      let row = map.get(deckId);
      if (!row) {
        row = { notes: 0, cards: 0, seen: 0, mastered: 0 };
        map.set(deckId, row);
      }
      return row;
    };
    for (const note of notes) get(note.deck_id).notes++;
    for (const card of cards) {
      const row = get(card.deck_id);
      row.cards++;
      if (card.queue !== CardQueue.NEW) row.seen++;
      if (card.queue === CardQueue.REVIEW && card.interval > MASTERED_INTERVAL_DAYS) row.mastered++;
    }
    return map;
  }, []);
}
