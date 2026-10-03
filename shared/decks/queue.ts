/**
 * Moving one deck within a queue order — the one definition used by the
 * student's own Decks tab, the tutor's move on a homework packet and the
 * worker route behind both.
 */
import { sortDecksForQueue } from './budget';

export type QueueMove = 'top' | 'up' | 'down' | 'bottom';

export const QUEUE_MOVES: readonly QueueMove[] = ['top', 'up', 'down', 'bottom'];

export function isQueueMove(value: unknown): value is QueueMove {
  return typeof value === 'string' && (QUEUE_MOVES as readonly string[]).includes(value);
}

/**
 * Pure: the order after moving `id`. The first id is studied first. Returns
 * the input array itself when nothing changes (id missing, already at the
 * edge), so callers can skip a write.
 */
export function moveInOrder(orderedIds: readonly string[], id: string, to: QueueMove): string[] {
  const i = orderedIds.indexOf(id);
  if (i < 0) return orderedIds as string[];
  const target = to === 'top' ? 0 : to === 'bottom' ? orderedIds.length - 1 : to === 'up' ? i - 1 : i + 1;
  if (target === i || target < 0 || target >= orderedIds.length) return orderedIds as string[];
  const next = orderedIds.filter((x) => x !== id);
  next.splice(target, 0, id);
  return next;
}

// ---- press-and-hold drag reorder (the Decks tab; frontend/src/services/dragReorder.ts, the Lab app) ----

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pure: which card the pointer is over — the one containing the point, else
 * the nearest by centre. -1 for an empty list.
 */
export function indexUnderPointer(rects: readonly RectLike[], x: number, y: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return i;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Pure: the order with `id` moved to `index`; the same array when nothing changes. */
export function moveToIndex(ids: readonly string[], id: string, index: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || index < 0 || index >= ids.length || from === index) return ids as string[];
  const next = ids.filter((x) => x !== id);
  next.splice(index, 0, id);
  return next;
}

// ---- add-card deck pickers (chat word sheet, Save as flashcard, Make flashcards, …) ----

/** What a deck picker needs to know about a deck. */
export interface PickerDeck {
  id: string;
  study_priority?: number | null;
  created_at?: string | null;
}

/**
 * Pure: decks for an add-card picker in study-queue order — the deck at the top
 * of the queue first (`sortDecksForQueue`: priority high → low, ties newest first).
 */
export function decksInQueueOrder<T extends PickerDeck>(decks: readonly T[]): T[] {
  return sortDecksForQueue(decks.map((d) => ({ d, priority: d.study_priority ?? 0, createdAt: d.created_at ?? '' }))).map((x) => x.d);
}

/**
 * Pure: the deck an add-card picker starts on — `preferred` when it is one of
 * the decks (a sheet opened for one deck, e.g. the study card's own), else the
 * top of the queue; '' when there are no decks (the picker offers a new deck).
 * Nothing is remembered between sheets, so the top deck is always the default.
 */
export function defaultPickerDeckId(decks: readonly PickerDeck[], preferred?: string | null): string {
  if (preferred && decks.some((d) => d.id === preferred)) return preferred;
  return decksInQueueOrder(decks)[0]?.id ?? '';
}
