/**
 * "Up next" — a per-account ORDERED list of notes the learner (or their tutor)
 * chose to be introduced next, ahead of the normal new-card order (table
 * `up_next`, services/up-next.ts; docs/STUDY_SESSION.md "Up next").
 *
 * Shared by the web (study-queue.ts → frontend/src/db/database.ts, the Up next page)
 * and the Lab app (android-lab/core UpNext.kt, parity-tested through
 * android-lab/parity/fixtures/up-next.ts). Pure: callers feed it rows.
 *
 * The rule (selectStudyQueue):
 *   - INSIDE the daily new-card budget (budget.ts): an Up next note takes the budget
 *     FIRST, in list order, before the deck queue and "Order new cards by".
 *       · a note with no card reviewed yet takes ONE primary (blue) card — its best NEW
 *         card (hanzi_to_meaning, then meaning_to_hanzi, then audio_to_hanzi — or
 *         meaning_to_hanzi for a word made only of known characters, lead-card.ts, swapped in
 *         by study-queue.ts `withLeadCards`); its other NEW cards wait (they are secondary once that card has been reviewed);
 *       · a started note offers each of its NEW cards to the SECONDARY (purple) budget,
 *         in card-type order. Up next never spills primary budget into purple cards.
 *   - Per-deck caps do not limit it (the person chose these words), one-off 0 + 0 copies
 *     included; what it takes still counts against its deck's caps for the rest of the
 *     deck's words (as if already introduced today — exactly what introducedToday says
 *     once the card is reviewed, so Home and the session agree all day).
 *   - A word left out of long-term review (notes.long_term = 0) and never started is
 *     skipped: that is an explicit "no" on the word, and Up next does not override it.
 *   - Notes in the bump pocket ("⚡ Study it today", bumps.ts) are the pocket's: their
 *     NEW cards are already over the budget.
 *   - A note on the list never feeds the regular pools (no double introduction).
 * A note LEAVES the list when every card of it has been reviewed at least once
 * (`upNextStatus` 'done'); removing by hand never deletes anything.
 */
import type { QueueCardInput } from './study-queue';
import type { LongTermPref } from './long-term';

/** At most this many notes on one account's list. */
export const UP_NEXT_MAX = 500;
/** At most this many notes in one add request. */
export const MAX_UP_NEXT_PER_REQUEST = 100;

/** Card types in the order the list introduces them. */
export const UP_NEXT_CARD_TYPE_ORDER = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

/** Where an add came from (analytics + the API's `source`). */
export const UP_NEXT_SOURCES = ['up_next_page', 'search', 'deck', 'card_hub', 'explorer', 'mcp', 'tutor', 'other'] as const;
export type UpNextSource = (typeof UP_NEXT_SOURCES)[number];

export function normalizeUpNextSource(s: unknown): UpNextSource {
  return typeof s === 'string' && (UP_NEXT_SOURCES as readonly string[]).includes(s) ? (s as UpNextSource) : 'other';
}

/**
 * Where a note stands: 'new' (no card reviewed — one blue card when its turn comes),
 * 'started' (some cards reviewed, NEW ones left — purple cards), 'done' (no NEW card
 * left: it leaves the list), 'missing' (no card on the device / server).
 */
export type UpNextStatus = 'new' | 'started' | 'done' | 'missing';

export function upNextStatus(noteCards: ReadonlyArray<Pick<QueueCardInput, 'queue'>>): UpNextStatus {
  if (noteCards.length === 0) return 'missing';
  let fresh = 0;
  for (const c of noteCards) if (c.queue === 0) fresh++;
  if (fresh === 0) return 'done';
  return fresh === noteCards.length ? 'new' : 'started';
}

/** Whether a note can usefully go on the list: it still has a NEW card. */
export function canAddToUpNext(noteCards: ReadonlyArray<Pick<QueueCardInput, 'queue'>>): boolean {
  const s = upNextStatus(noteCards);
  return s === 'new' || s === 'started';
}

const typeRank = (t: string) => {
  const i = (UP_NEXT_CARD_TYPE_ORDER as readonly string[]).indexOf(t);
  return i < 0 ? UP_NEXT_CARD_TYPE_ORDER.length : i;
};
const byType = (a: QueueCardInput, b: QueueCardInput) =>
  typeRank(a.card_type) - typeRank(b.card_type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface UpNextSlots<C extends QueueCardInput> {
  /** One card per never-started note (its best NEW card), list order. */
  primary: C[];
  /** Every NEW card of the started notes, list order (card-type order within a note). */
  secondary: C[];
  /** Notes the list holds today (they never feed the regular pools). */
  noteIds: Set<string>;
}

/**
 * The list's candidate cards over `cards` (the cards in scope). A note with no card in
 * `cards`, opted out of long-term review while unstarted, or with every NEW card in
 * `skipCardIds` (the bump pocket) offers nothing and stays out of `noteIds`. A note listed
 * twice counts once (its first place).
 */
export function upNextSlots<C extends QueueCardInput>(
  cards: ReadonlyArray<C>,
  upNext: ReadonlyArray<string> | null | undefined,
  reviewedNoteIds: ReadonlySet<string>,
  skipCardIds?: ReadonlySet<string> | null,
  longTerm?: ReadonlyMap<string, LongTermPref> | null
): UpNextSlots<C> {
  const out: UpNextSlots<C> = { primary: [], secondary: [], noteIds: new Set() };
  if (!upNext || upNext.length === 0) return out;
  const wanted = new Set(upNext);
  const fresh = new Map<string, C[]>();
  for (const c of cards) {
    if (c.queue !== 0 || !wanted.has(c.note_id) || skipCardIds?.has(c.id)) continue;
    const list = fresh.get(c.note_id);
    if (list) list.push(c);
    else fresh.set(c.note_id, [c]);
  }
  for (const noteId of upNext) {
    if (out.noteIds.has(noteId)) continue;
    const list = fresh.get(noteId);
    if (!list || list.length === 0) continue;
    const started = reviewedNoteIds.has(noteId);
    if (!started && longTerm?.get(noteId) === 0) continue;
    out.noteIds.add(noteId);
    const sorted = [...list].sort(byType);
    if (started) out.secondary.push(...sorted);
    else out.primary.push(sorted[0]);
  }
  return out;
}

/**
 * How many of the slots today's budget takes: primary slots from what is left of the
 * primary budget (bonus included), secondary slots from what is left of the secondary
 * budget (budget.ts `newBudgetLeft`). Always the first ones, in list order.
 */
export function takeUpNext(
  slots: { primary: number; secondary: number },
  left: { primary: number; secondary: number }
): { primary: number; secondary: number } {
  return {
    primary: Math.max(0, Math.min(slots.primary, left.primary)),
    secondary: Math.max(0, Math.min(slots.secondary, left.secondary)),
  };
}

// ---- the list itself (the page, the API, MCP) ----

/**
 * Pure: `ids` with `add` placed so the first of them ends up at `index` (0-based, clamped;
 * undefined / null = the bottom). Ids in `add` already in the list are MOVED there;
 * duplicates in `add` count once.
 */
export function insertIntoOrder(ids: readonly string[], add: readonly string[], index?: number | null): string[] {
  const adding = [...new Set(add)];
  const addSet = new Set(adding);
  const rest = ids.filter((x) => !addSet.has(x));
  const at = index === undefined || index === null || !Number.isFinite(index) ? rest.length : Math.max(0, Math.min(rest.length, Math.trunc(index)));
  return [...rest.slice(0, at), ...adding, ...rest.slice(at)];
}

/**
 * Pure: the full order after a reorder request — `requested` (ids on the list, in the
 * order given) first, then every other id in its old relative order. Unknown ids are
 * ignored, so a stale device can never add or drop entries through a reorder.
 */
export function reorderUpNext(current: readonly string[], requested: readonly string[]): string[] {
  const have = new Set(current);
  const seen = new Set<string>();
  const first: string[] = [];
  for (const id of requested) {
    if (!have.has(id) || seen.has(id)) continue;
    seen.add(id);
    first.push(id);
  }
  return [...first, ...current.filter((x) => !seen.has(x))];
}

/** Where to put an add: 'top', 'bottom' or a 0-based index. Anything else = bottom. */
export function upNextIndex(position: unknown, length: number): number {
  if (position === 'top') return 0;
  if (typeof position === 'number' && Number.isFinite(position)) return Math.max(0, Math.min(length, Math.trunc(position)));
  if (typeof position === 'string' && /^\d+$/.test(position.trim())) return Math.min(length, Number(position.trim()));
  return length;
}

/** Home's line: "↑ 4 up next" ('' when none). */
export function upNextLabel(count: number): string {
  return count > 0 ? `↑ ${count} up next` : '';
}

/** Toast / reply after adding. */
export function upNextAddedMessage(hanzi: string[], already = 0, noNewCards = 0): string {
  const n = hanzi.length;
  if (n === 0) {
    if (noNewCards > 0) return 'Already studied — use ⚡ Study it today instead';
    return already > 0 ? 'Already up next' : 'Nothing added';
  }
  const shown = n === 1 ? hanzi[0] : n === 2 ? `${hanzi[0]} and ${hanzi[1]}` : `${hanzi[0]}, ${hanzi[1]} and ${n - 2} more`;
  return `↑ ${shown} ${n === 1 ? 'is' : 'are'} up next`;
}

/** A row's status line on the page: "New · 1 card next", "Started · 2 purple cards left". */
export function upNextStatusLabel(status: UpNextStatus, newCards: number): string {
  if (status === 'new') return 'New word';
  if (status === 'started') return `Started · ${newCards} new ${newCards === 1 ? 'card' : 'cards'} left`;
  if (status === 'done') return 'All cards studied';
  return 'Not on this device';
}
