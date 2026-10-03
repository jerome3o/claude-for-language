/**
 * The study queue, as ONE pure definition shared by the web app
 * (frontend/src/db/database.ts: getStudyQueue, the home / deck counts) and the
 * native Lab app (android-lab/core StudyQueue.kt, parity-tested against this
 * file through android-lab/parity). Both apps feed it rows from their local
 * store; nothing here reads a database or the clock.
 *
 * "Due today" = what a session started now would show:
 *   - learning / relearning cards due by the cutoff,
 *   - review cards due by the cutoff,
 *   - new cards as the ONE daily budget allocates them, deck queue top-down
 *     (budget.ts `allocateNewCards`), highest-value tier first within a deck;
 *     with the notes' hanzi given, a deck's brand-new words are the ones with
 *     the most never-seen characters (novelty.ts, "new characters first").
 * The home screen's numbers are the counts of exactly this queue.
 *
 * A learner's per-word "long-term review" choice (long-term.ts, notes.long_term)
 * decides which NEW cards enter a deck's pool: opted-out words never do, and a
 * deck out of daily review (caps 0 + 0) holds only its opted-in words, at the
 * new-deck default caps.
 *
 * "Introduced today" is derived from review events (a card counts on the day of
 * its first-ever review; secondary when a sibling card of the same note had
 * been reviewed before it) — never from a counter that can drift.
 */

import { allocateNewCards, type DeckAllocation, type DeckNewPool, type StudyBudget } from './budget';
import { markSeen, pickByNovelty, seenFrom } from './novelty';
import { admitsNewCards, deckInDailyReview, longTermCaps, type LongTermPref } from './long-term';

/** CardQueue values (shared/scheduler): NEW 0, LEARNING 1, REVIEW 2, RELEARNING 3. */
export const QUEUE_NEW = 0;
export const QUEUE_LEARNING = 1;
export const QUEUE_REVIEW = 2;
export const QUEUE_RELEARNING = 3;

/** A deck's secondary cap when the row has none (legacy decks). */
export const DEFAULT_SECONDARY_CAP = 10;

export interface QueueCardInput {
  id: string;
  note_id: string;
  deck_id: string;
  card_type: string;
  queue: number;
  /**
   * When the card is due (epoch ms): learning / relearning = due_timestamp,
   * review = next_review_at. null = due now. Ignored for NEW cards.
   */
  due_ms: number | null;
}

export interface QueueDeckInput {
  id: string;
  priority: number;
  created_at: string;
  /** deck.new_cards_per_day — a cap on this deck's share of the budget. */
  cap_primary: number;
  /** deck.secondary_cards_per_day ?? DEFAULT_SECONDARY_CAP. */
  cap_secondary: number;
}

export interface IntroducedToday {
  primary: number;
  secondary: number;
}

export interface QueueCounts {
  new: number;
  secondaryNew: number;
  learning: number;
  review: number;
}

/**
 * The notes' text, for "new characters first" (novelty.ts). Without it new
 * cards keep the plain tier / id order.
 */
export interface QueueNoteText {
  /** note id → hanzi: the candidate notes in scope and every reviewed note (all decks). */
  hanzi: ReadonlyMap<string, string>;
  /**
   * Notes with a card past NEW across ALL decks — their characters are "seen".
   * Defaults to the ones in `cards` (pass it when `cards` is one deck's).
   */
  reviewedNoteIds?: Iterable<string>;
}

export interface StudyQueueResult<C extends QueueCardInput> {
  /** New cards (deck queue order, best tier first) then learning / review cards (input order). */
  due: C[];
  /** Notes with any card past NEW. */
  reviewedNoteIds: Set<string>;
  /** More new cards exist in scope than today's budget admits ("Study 10 more"). */
  hasMoreNew: boolean;
  /** The per-deck pools fed to the allocator (decks in scope). */
  pools: DeckNewPool[];
  /** What the budget gave each deck in scope. */
  allocation: Map<string, DeckAllocation>;
}

export function isLearningQueue(q: number): boolean {
  return q === QUEUE_LEARNING || q === QUEUE_RELEARNING;
}

export function collectReviewedNoteIds(cards: Iterable<QueueCardInput>): Set<string> {
  const ids = new Set<string>();
  for (const c of cards) if (c.queue !== QUEUE_NEW) ids.add(c.note_id);
  return ids;
}

/** A learning / review card that the session will show (due by the cutoff). */
export function isDueByCutoff(card: QueueCardInput, cutoffMs: number): boolean {
  if (card.queue === QUEUE_NEW) return false;
  return card.due_ms === null || card.due_ms <= cutoffMs;
}

/**
 * New cards introduced today per deck. `firstReviewAt` holds each card's
 * first-ever review (epoch ms; absent = never reviewed); `cards` must include
 * every card first reviewed today AND its siblings (the whole card list works).
 * A card is secondary when a sibling's first review is strictly earlier.
 */
export function introducedToday(
  cards: ReadonlyArray<Pick<QueueCardInput, 'id' | 'note_id' | 'deck_id'>>,
  firstReviewAt: ReadonlyMap<string, number>,
  dayStartMs: number
): Map<string, IntroducedToday> {
  const byNote = new Map<string, Array<Pick<QueueCardInput, 'id' | 'note_id' | 'deck_id'>>>();
  for (const c of cards) {
    const list = byNote.get(c.note_id);
    if (list) list.push(c);
    else byNote.set(c.note_id, [c]);
  }
  const out = new Map<string, IntroducedToday>();
  for (const card of cards) {
    const first = firstReviewAt.get(card.id);
    if (first === undefined || first < dayStartMs) continue;
    const isSecondary = (byNote.get(card.note_id) ?? []).some(s => {
      if (s.id === card.id) return false;
      const sf = firstReviewAt.get(s.id);
      return sf !== undefined && sf < first;
    });
    const bucket = out.get(card.deck_id) ?? { primary: 0, secondary: 0 };
    if (isSecondary) bucket.secondary++;
    else bucket.primary++;
    out.set(card.deck_id, bucket);
  }
  return out;
}

const tierOf = (card: QueueCardInput, reviewed: Set<string>) =>
  (reviewed.has(card.note_id) ? 2 : 0) + (card.card_type === 'hanzi_to_meaning' ? 0 : 1);

/**
 * The queue a session gets: `deckId` null / undefined = all decks. `introduced`
 * covers EVERY deck (a one-deck session still spends the global budget other
 * decks used today).
 */
export function selectStudyQueue<C extends QueueCardInput>(
  decks: ReadonlyArray<QueueDeckInput>,
  cards: ReadonlyArray<C>,
  budget: StudyBudget,
  bonus: number,
  introduced: ReadonlyMap<string, IntroducedToday>,
  cutoffMs: number,
  deckId?: string | null,
  noteText?: QueueNoteText | null,
  /** note id → the learner's long-term choice (only notes that have one). */
  longTerm?: ReadonlyMap<string, LongTermPref> | null
): StudyQueueResult<C> {
  const reviewed = collectReviewedNoteIds(cards);
  const inScope = deckId ? decks.filter(d => d.id === deckId) : decks;
  const scopeIds = new Set(inScope.map(d => d.id));
  const inReview = new Map(inScope.map(d => [d.id, deckInDailyReview(d.cap_primary, d.cap_secondary)]));

  const newByDeck = new Map<string, C[]>();
  for (const c of cards) {
    if (c.queue !== QUEUE_NEW || !scopeIds.has(c.deck_id)) continue;
    if (!admitsNewCards(longTerm?.get(c.note_id) ?? null, inReview.get(c.deck_id)!, reviewed.has(c.note_id))) continue;
    const list = newByDeck.get(c.deck_id);
    if (list) list.push(c);
    else newByDeck.set(c.deck_id, [c]);
  }

  const pools: DeckNewPool[] = inScope.map(d => {
    const list = newByDeck.get(d.id) ?? [];
    let secondary = 0;
    for (const c of list) if (reviewed.has(c.note_id)) secondary++;
    const intro = introduced.get(d.id) ?? { primary: 0, secondary: 0 };
    const caps = longTermCaps(d.cap_primary, d.cap_secondary);
    return {
      deckId: d.id,
      priority: d.priority,
      createdAt: d.created_at,
      totalNew: list.length - secondary,
      totalSecondaryNew: secondary,
      capPrimary: caps.capPrimary,
      capSecondary: caps.capSecondary,
      studiedPrimary: intro.primary,
      studiedSecondary: intro.secondary,
    };
  });
  const spent = { primary: 0, secondary: 0 };
  for (const [id, v] of introduced) {
    if (scopeIds.has(id)) continue;
    spent.primary += v.primary;
    spent.secondary += v.secondary;
  }
  const allocation = allocateNewCards(pools, budget, bonus, spent);

  const due: C[] = [];
  // Seen characters / words, built once; every primary pick below adds to it.
  const hanziOf = (c: C) => noteText?.hanzi.get(c.note_id) ?? '';
  const seen = noteText
    ? seenFrom([...(noteText.reviewedNoteIds ?? reviewed)].map(id => noteText.hanzi.get(id) ?? ''))
    : null;
  // New cards: deck queue order (the allocation's order); within a deck the
  // primary cards (best tier first, the hanzi_to_meaning cards by novelty),
  // then the secondary ones (best tier first, then id).
  for (const [id, a] of allocation) {
    const list = [...(newByDeck.get(id) ?? [])].sort(
      (x, y) => tierOf(x, reviewed) - tierOf(y, reviewed) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
    );
    const primaryList = list.filter(c => !reviewed.has(c.note_id));
    if (seen) {
      const first = primaryList.filter(c => c.card_type === 'hanzi_to_meaning');
      const picked = pickByNovelty(first, a.primary, hanziOf, seen);
      const others = primaryList.filter(c => c.card_type !== 'hanzi_to_meaning').slice(0, a.primary - picked.length);
      for (const c of others) markSeen(seen, hanziOf(c));
      due.push(...picked, ...others);
    } else {
      due.push(...primaryList.slice(0, a.primary));
    }
    due.push(...list.filter(c => reviewed.has(c.note_id)).slice(0, a.secondary));
  }
  for (const c of cards) {
    if (scopeIds.has(c.deck_id) && isDueByCutoff(c, cutoffMs)) due.push(c);
  }

  const hasMoreNew = pools.some(p => {
    const a = allocation.get(p.deckId) ?? { primary: 0, secondary: 0 };
    return p.totalNew + p.totalSecondaryNew > a.primary + a.secondary;
  });
  return { due, reviewedNoteIds: reviewed, hasMoreNew, pools, allocation };
}

/** The four numbers a screen shows for a queue. */
export function countQueue(due: Iterable<QueueCardInput>, reviewedNoteIds: ReadonlySet<string>): QueueCounts {
  const c: QueueCounts = { new: 0, secondaryNew: 0, learning: 0, review: 0 };
  for (const card of due) {
    if (card.queue === QUEUE_NEW) {
      if (reviewedNoteIds.has(card.note_id)) c.secondaryNew++;
      else c.new++;
    } else if (card.queue === QUEUE_REVIEW) c.review++;
    else c.learning++;
  }
  return c;
}
