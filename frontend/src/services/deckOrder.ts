/**
 * The deck queue on the device: order helpers plus the two moves, each
 * written to IndexedDB at once (so the list re-sorts instantly, offline too)
 * and to the server, whose updated_at bump carries it to other devices.
 */
import { sortDecksForQueue } from '@shared/decks';
import { db, type LocalDeck } from '../db/database';
import { moveDeck as apiMoveDeck, reorderDecks as apiReorderDecks } from '../api/client';

export function orderDecksForQueue<T extends Pick<LocalDeck, 'study_priority' | 'created_at'>>(decks: T[]): T[] {
  return sortDecksForQueue(decks.map(d => ({ d, priority: d.study_priority ?? 0, createdAt: d.created_at }))).map(x => x.d);
}

/** Move one deck to the top or bottom of the queue. */
export async function moveDeckInQueue(deckId: string, to: 'top' | 'bottom'): Promise<void> {
  const all = await db.decks.toArray();
  const priorities = all.map(d => d.study_priority ?? 0);
  const next = to === 'top' ? Math.max(0, ...priorities) + 1 : Math.min(0, ...priorities) - 1;
  await db.decks.update(deckId, { study_priority: next });
  await apiMoveDeck(deckId, to);
}

/** Set the whole order: first id is studied first. */
export async function reorderQueue(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.decks, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.decks.update(orderedIds[i], { study_priority: orderedIds.length - i });
    }
  });
  await apiReorderDecks(orderedIds);
}

/** Nudge one deck a step up or down within the current order. */
export async function nudgeDeckInQueue(decks: LocalDeck[], deckId: string, direction: 'up' | 'down'): Promise<void> {
  const ordered = orderDecksForQueue(decks).map(d => d.id);
  const i = ordered.indexOf(deckId);
  if (i < 0) return;
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ordered.length) return;
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  await reorderQueue(ordered);
}
