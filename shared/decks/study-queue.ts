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
 *     with the notes' hanzi given, the account's "Order new cards by"
 *     (new-card-order.ts): the budget's brand-new words go FIRST, in ANY deck
 *     (each deck within its cap), to words that bring never-seen characters,
 *     then never-met words, then (sentences last) every word before a sentence
 *     — the most common first inside each tier — and the rest deck by deck.
 * The home screen's numbers are the counts of exactly this queue.
 *
 * A learner's per-word "long-term review" choice (long-term.ts, notes.long_term)
 * decides which NEW cards enter a deck's pool: opted-out words never do, and a
 * deck out of daily review (caps 0 + 0) holds only its opted-in words, at the
 * new-deck default caps.
 *
 * Bumped notes ("⚡ Study it today", bumps.ts) come FIRST: their pocket cards head
 * the queue, NEW ones outside the budget (they never take from or wait for it).
 *
 * "Up next" (up-next.ts): the account's ordered list of chosen notes takes the
 * budget BEFORE the deck queue and "Order new cards by" — one blue card per
 * unstarted note, the started notes' NEW cards from the purple budget — ignoring
 * deck caps but counting against them for the rest of the deck's words.
 *
 * "Introduced today" is derived from review events (a card counts on the day of
 * its first-ever review; secondary when a sibling card of the same note had
 * been reviewed before it) — never from a counter that can drift.
 */

import { allocateNewCards, newBudgetLeft, primaryCapLeft, respreadPrimary, sortDecksForQueue, type DeckAllocation, type DeckNewPool, type StudyBudget } from './budget';
import { DEFAULT_NEW_CARD_ORDER, orderWithinDeck, pickNewCardsByOrder, studiedFrom, type NewCardOrder, type StudiedIndex } from './new-card-order';
import type { FrequencyIndex } from './frequency';
import { admitsNewCards, deckInDailyReview, longTermCaps, type LongTermPref } from './long-term';
import { bumpPocket, type QueueBumps } from './bumps';
import { takeUpNext, upNextSlots } from './up-next';
import { isLeadCard, knownCharacterNotes, knownCharactersFrom, knownNoteIdsFrom, KNOWN_CHARACTERS_LEAD_CARD_TYPE } from './lead-card';

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
  /**
   * The card's FSRS stability (days), when the caller has it: a Review card above 21 days is
   * known (lead-card.ts), so its note's characters are known.
   */
  stability?: number | null;
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
 * The notes' text, for "Order new cards by" (new-card-order.ts). Without it new
 * cards keep the plain tier / id order.
 */
export interface QueueNoteText {
  /** note id → hanzi: the candidate notes in scope and every reviewed note (all decks). */
  hanzi: ReadonlyMap<string, string>;
  /**
   * Notes with a card past NEW across ALL decks — their characters and words are
   * "studied". Defaults to the ones in `cards` (pass it when `cards` is one deck's).
   */
  reviewedNoteIds?: Iterable<string>;
  /** The account's "Order new cards by" (default: every switch on). */
  order?: NewCardOrder | null;
  /** Word frequency for "Most common first" (frequency.ts); without it that switch does nothing. */
  frequency?: FrequencyIndex | null;
  /**
   * Notes with a KNOWN card (mature, lead-card.ts) across ALL decks — their characters are known.
   * Defaults to the ones in `cards` (from their `stability`; pass it when `cards` is one deck's).
   */
  knownNoteIds?: Iterable<string>;
}

export interface StudyQueueResult<C extends QueueCardInput> {
  /** Bumped cards, then new cards (deck queue order, best tier first), then learning / review cards (input order). */
  due: C[];
  /** Notes with any card past NEW. */
  reviewedNoteIds: Set<string>;
  /** More new cards exist in scope than today's budget admits ("Study 10 more"). */
  hasMoreNew: boolean;
  /** The per-deck pools fed to the allocator (decks in scope). */
  pools: DeckNewPool[];
  /** What the budget gave each deck in scope. */
  allocation: Map<string, DeckAllocation>;
  /** The bump pocket's cards ("⚡ Study it today", bumps.ts) — also the head of `due`. */
  bumped: C[];
  /** Bumped notes with cards in the pocket (in scope). */
  bumpedNoteIds: string[];
  /** The Up next cards today's budget takes (up-next.ts), list order: blue ones, then purple ones. */
  upNext: C[];
  /** Up next notes that hold cards in scope today (taken or still waiting for budget), list order. */
  upNextNoteIds: string[];
  /**
   * Unseen notes that lead with meaning_to_hanzi ("Words made of characters I know: start with
   * English → Chinese", lead-card.ts) — the session shows that card first for them.
   */
  knownCharacterNoteIds: Set<string>;
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

/**
 * The unseen notes among `newCards` that lead with meaning_to_hanzi (lead-card.ts): every Han
 * character known (in a note with a known card), the switch on (a missing switch = on, its
 * default). Empty without the notes' text.
 */
export function knownCharacterNotesInQueue(
  newCards: Iterable<QueueCardInput>,
  reviewed: ReadonlySet<string>,
  /** Every card (all decks) — read only when `noteText.knownNoteIds` is absent. */
  cards: Iterable<{ note_id: string; queue: number; stability?: number | null }>,
  noteText: QueueNoteText | null | undefined
): Set<string> {
  if (!noteText || noteText.order?.known_characters_english_first === false) return new Set();
  const knownIds = noteText.knownNoteIds ?? knownNoteIdsFrom(cards);
  const known = knownCharactersFrom([...knownIds].map(id => noteText.hanzi.get(id) ?? ''));
  if (known.size === 0) return new Set();
  const unseen: QueueCardInput[] = [];
  for (const c of newCards) if (!reviewed.has(c.note_id)) unseen.push(c);
  return knownCharacterNotes(unseen, id => noteText.hanzi.get(id) ?? '', known);
}

/** Best first: unseen notes before started ones; the lead card (lead-card.ts) / hanzi_to_meaning first. */
const tierOf = (card: QueueCardInput, reviewed: ReadonlySet<string>, lead: ReadonlySet<string>) =>
  reviewed.has(card.note_id)
    ? 2 + (card.card_type === 'hanzi_to_meaning' ? 0 : 1)
    : isLeadCard(card, lead) ? 0 : 1;

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
  longTerm?: ReadonlyMap<string, LongTermPref> | null,
  /** The active bumps ("⚡ Study it today") with their cards' review times. */
  bumps?: QueueBumps | null,
  /** The account's "Up next" list: note ids in order (up-next.ts). */
  upNext?: ReadonlyArray<string> | null
): StudyQueueResult<C> {
  const reviewed = collectReviewedNoteIds(cards);
  const inScope = deckId ? decks.filter(d => d.id === deckId) : decks;
  const scopeIds = new Set(inScope.map(d => d.id));
  const inReview = new Map(inScope.map(d => [d.id, deckInDailyReview(d.cap_primary, d.cap_secondary)]));
  const pocket = bumpPocket(cards.filter(c => scopeIds.has(c.deck_id)), bumps, cutoffMs);
  const pocketIds = new Set(pocket.cards.map(c => c.id));
  // Up next: its notes never feed the regular pools; it takes the budget first.
  const slots = upNextSlots(cards.filter(c => scopeIds.has(c.deck_id)), upNext, reviewed, pocketIds, longTerm);

  const newByDeck = new Map<string, C[]>();
  for (const c of cards) {
    if (c.queue !== QUEUE_NEW || !scopeIds.has(c.deck_id) || pocketIds.has(c.id) || slots.noteIds.has(c.note_id)) continue;
    if (!admitsNewCards(longTerm?.get(c.note_id) ?? null, inReview.get(c.deck_id)!, reviewed.has(c.note_id))) continue;
    const list = newByDeck.get(c.deck_id);
    if (list) list.push(c);
    else newByDeck.set(c.deck_id, [c]);
  }

  let pools: DeckNewPool[] = inScope.map(d => {
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
  const studiedAll = { primary: 0, secondary: 0 };
  for (const [id, v] of introduced) {
    studiedAll.primary += v.primary;
    studiedAll.secondary += v.secondary;
    if (scopeIds.has(id)) continue;
    spent.primary += v.primary;
    spent.secondary += v.secondary;
  }
  // Which card each unseen note leads with (hanzi_to_meaning, or meaning_to_hanzi for a word of
  // known characters, lead-card.ts) — the pools' notes and Up next's alike.
  const scopeNew = cards.filter(c => c.queue === QUEUE_NEW && scopeIds.has(c.deck_id) && !pocketIds.has(c.id));
  const lead = knownCharacterNotesInQueue(scopeNew, reviewed, cards, noteText);
  const taken = takeUpNext({ primary: slots.primary.length, secondary: slots.secondary.length }, newBudgetLeft(budget, bonus, studiedAll));
  const upPrimary = withLeadCards(slots.primary.slice(0, taken.primary), scopeNew, lead);
  const upSecondary = slots.secondary.slice(0, taken.secondary);
  // What Up next takes counts as introduced today in its deck (caps) and in the budget.
  pools = withUpNextPicks(pools, upPrimary.map(c => c.deck_id), upSecondary.map(c => c.deck_id));
  let allocation = allocateNewCards(pools, budget, bonus, spent);

  const due: C[] = [...pocket.cards, ...upPrimary, ...upSecondary];
  // What has been studied (characters + word pieces), built once; every global pick adds to it.
  const hanziOf = (c: C) => noteText?.hanzi.get(c.note_id) ?? '';
  const order = noteText ? noteText.order ?? DEFAULT_NEW_CARD_ORDER : null;
  const frequency = noteText?.frequency ?? null;
  const tiered = !!order && (order.new_characters_first || order.new_words_first || order.sentences_last);
  const studied = noteText && tiered
    ? studiedFrom([...(noteText.reviewedNoteIds ?? reviewed)].map(id => noteText.hanzi.get(id) ?? ''), order!.new_words_first)
    : null;
  // "Order new cards by": the budget's primary picks go first, in ANY deck in scope (each
  // deck within its cap), to the tiers (new characters, new words, words before sentences);
  // the rest is filled deck by deck.
  const globalPicks = new Set<string>();
  let pickedIn = new Map<string, number>();
  if (studied && order) {
    let total = 0;
    for (const a of allocation.values()) total += a.primary;
    const picked = pickNewCardsFirst(pools, newByDeck, reviewed, total, hanziOf, studied, order, frequency, lead);
    if (picked.length > 0) {
      for (const c of picked) globalPicks.add(c.id);
      pickedIn = picksPerDeck(picked.map(c => c.deck_id));
      allocation = respreadPrimary(pools, allocation, pickedIn);
      due.push(...picked);
    }
  }
  // New cards: deck queue order (the allocation's order); within a deck the
  // primary cards (best tier first; the lead cards sentences-last /
  // most-common-first when ordering), then the secondary ones (best tier first, then id).
  const byTierThenId = (x: C, y: C) => tierOf(x, reviewed, lead) - tierOf(y, reviewed, lead) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  for (const [id, a] of allocation) {
    const all = newByDeck.get(id) ?? [];
    const take = a.primary - (pickedIn.get(id) ?? 0);
    if (take > 0) {
      const primaryList = all.filter(c => !reviewed.has(c.note_id) && !globalPicks.has(c.id)).sort(byTierThenId);
      if (order) {
        const first = orderWithinDeck(primaryList.filter(c => isLeadCard(c, lead)), hanziOf, order, frequency).slice(0, take);
        const others = primaryList.filter(c => !isLeadCard(c, lead)).slice(0, take - first.length);
        due.push(...first, ...others);
      } else {
        due.push(...primaryList.slice(0, take));
      }
    }
    if (a.secondary > 0) due.push(...all.filter(c => reviewed.has(c.note_id)).sort(byTierThenId).slice(0, a.secondary));
  }
  for (const c of cards) {
    if (scopeIds.has(c.deck_id) && isDueByCutoff(c, cutoffMs) && !pocketIds.has(c.id)) due.push(c);
  }

  const hasMoreNew =
    slots.primary.length > taken.primary ||
    slots.secondary.length > taken.secondary ||
    pools.some(p => {
      const a = allocation.get(p.deckId) ?? { primary: 0, secondary: 0 };
      return p.totalNew + p.totalSecondaryNew > a.primary + a.secondary;
    });
  return {
    due,
    reviewedNoteIds: reviewed,
    hasMoreNew,
    pools,
    allocation,
    bumped: pocket.cards,
    bumpedNoteIds: pocket.activeNoteIds,
    upNext: [...upPrimary, ...upSecondary],
    upNextNoteIds: [...slots.noteIds],
    knownCharacterNoteIds: lead,
  };
}

/**
 * Up next's blue card per unstarted note (its first card by type, up-next.ts) swapped for the
 * note's meaning_to_hanzi card when the note leads with it (`lead`, lead-card.ts). `candidates`:
 * the NEW cards in scope (the first meaning_to_hanzi card of a note wins).
 */
export function withLeadCards<C extends QueueCardInput>(primary: C[], candidates: Iterable<C>, lead: ReadonlySet<string>): C[] {
  if (lead.size === 0 || primary.length === 0) return primary;
  const english = new Map<string, C>();
  for (const c of candidates) {
    if (c.card_type === KNOWN_CHARACTERS_LEAD_CARD_TYPE && lead.has(c.note_id) && !english.has(c.note_id)) english.set(c.note_id, c);
  }
  return primary.map(c => english.get(c.note_id) ?? c);
}

/**
 * The pools with Up next's picks counted as introduced today in their decks (one deck id
 * per picked card): the deck's caps then hold for the rest of its words exactly as they
 * will once those cards are reviewed. Other pools are returned as they are.
 */
export function withUpNextPicks(pools: DeckNewPool[], primaryDeckIds: Iterable<string>, secondaryDeckIds: Iterable<string>): DeckNewPool[] {
  const p = picksPerDeck(primaryDeckIds);
  const s = picksPerDeck(secondaryDeckIds);
  if (p.size === 0 && s.size === 0) return pools;
  return pools.map(pool =>
    p.has(pool.deckId) || s.has(pool.deckId)
      ? { ...pool, studiedPrimary: pool.studiedPrimary + (p.get(pool.deckId) ?? 0), studiedSecondary: pool.studiedSecondary + (s.get(pool.deckId) ?? 0) }
      : pool
  );
}

/**
 * "Order new cards by" across all decks (new-card-order.ts `pickNewCardsByOrder`): the
 * first `take` primary (blue) picks — the lead cards of unseen notes (hanzi_to_meaning, or
 * meaning_to_hanzi for the notes in `knownCharacterNoteIds`, lead-card.ts), in ANY deck
 * of `pools`, that fall in one of the account's tiers — each deck within min(its unseen
 * cards, what is left of its cap). Ties: deck queue position, shorter, card id. Greedy,
 * so the first N of a longer run are the run with take = N. Mutates `studied`.
 */
export function pickNewCardsFirst<C extends QueueCardInput>(
  pools: readonly DeckNewPool[],
  newByDeck: ReadonlyMap<string, readonly C[]>,
  reviewed: ReadonlySet<string>,
  take: number,
  hanziOf: (card: C) => string,
  studied: StudiedIndex,
  order: NewCardOrder = DEFAULT_NEW_CARD_ORDER,
  frequency?: FrequencyIndex | null,
  knownCharacterNoteIds?: ReadonlySet<string> | null
): C[] {
  if (take <= 0) return [];
  const position = new Map(sortDecksForQueue([...pools]).map((p, i) => [p.deckId, i]));
  const room = new Map(pools.map(p => [p.deckId, Math.min(p.totalNew, primaryCapLeft(p))]));
  const candidates: C[] = [];
  for (const [deckId, list] of newByDeck) {
    if ((room.get(deckId) ?? 0) <= 0) continue;
    for (const c of list) if (isLeadCard(c, knownCharacterNoteIds) && !reviewed.has(c.note_id)) candidates.push(c);
  }
  return pickNewCardsByOrder(
    candidates, take, hanziOf, c => c.deck_id, id => position.get(id) ?? 0, room, c => c.id, order, studied, frequency
  );
}

/** deck id → how many of `deckIds` (one per pick) it holds. */
export function picksPerDeck(deckIds: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of deckIds) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
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
