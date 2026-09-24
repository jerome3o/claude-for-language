/**
 * The daily new-card budget is one number per learner, not one per deck.
 *
 * Decks form a priority queue: each day the budget is filled from the top of
 * the list down, so a tutor can send as many homework packets as she likes and
 * the learner's daily load stays flat. A deck's own new_cards_per_day /
 * secondary_cards_per_day survive only as CAPS ("take at most N from this deck
 * a day"), never as extra allowance.
 *
 * `allocateNewCards` is the one allocator: the study queue uses it to pick
 * cards, the deck lists use it to show what will actually be introduced, and
 * the tutor dashboard uses the same budget to say "about N days to go".
 */

export interface StudyBudget {
  /** Brand-new words a day (blue), across all decks. */
  new_cards_per_day: number;
  /** Extra NEW cards a day for words already started (purple), across all decks. */
  secondary_cards_per_day: number;
}

export const DEFAULT_STUDY_BUDGET: Readonly<StudyBudget> = Object.freeze({
  new_cards_per_day: 3,
  secondary_cards_per_day: 6,
});

export const STUDY_BUDGET_MAX = 200;

/** Where a homework packet lands in the learner's queue when the tutor sends it. */
export type HomeworkPriority = 'core' | 'non_urgent';

/** A deck's standing in the new-card queue, as the allocator sees it. */
export interface DeckNewPool {
  deckId: string;
  /** Higher goes first. Ties: newer deck first. */
  priority: number;
  createdAt: string;
  /** NEW cards on notes with no reviewed card yet (the primary pool). */
  totalNew: number;
  /** NEW cards on notes that already have a reviewed card (the secondary pool). */
  totalSecondaryNew: number;
  /** The deck's own daily caps. */
  capPrimary: number;
  capSecondary: number;
  /** Introduced from this deck today. */
  studiedPrimary: number;
  studiedSecondary: number;
}

export interface DeckAllocation {
  primary: number;
  secondary: number;
}

/** Decks in queue order: highest priority first, then newest first. */
export function sortDecksForQueue<T extends { priority: number; createdAt: string }>(decks: T[]): T[] {
  return [...decks].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * How many new cards each deck may introduce right now.
 *
 * - The global primary budget (+ bonus) is spent walking decks in queue order;
 *   a deck takes at most its own cap.
 * - Then the global secondary budget, the same way.
 * - Secondary cards studied beyond their budget were funded by the primary
 *   budget (spillover), so they count against it; leftover primary budget can
 *   still admit secondary cards (a learner with no unseen words keeps going).
 */
export function allocateNewCards(
  pools: DeckNewPool[],
  budget: StudyBudget,
  bonus = 0,
  /** Introduced today in decks not in `pools` (a single-deck session still shares the budget). */
  spentElsewhere: { primary: number; secondary: number } = { primary: 0, secondary: 0 }
): Map<string, DeckAllocation> {
  const ordered = sortDecksForQueue(pools);
  const studiedPrimary = pools.reduce((s, p) => s + p.studiedPrimary, 0) + spentElsewhere.primary;
  const studiedSecondary = pools.reduce((s, p) => s + p.studiedSecondary, 0) + spentElsewhere.secondary;
  const overflow = Math.max(0, studiedSecondary - budget.secondary_cards_per_day);
  let primaryLeft = Math.max(0, budget.new_cards_per_day + bonus - studiedPrimary - overflow);
  let secondaryLeft = Math.max(0, budget.secondary_cards_per_day - studiedSecondary);

  const out = new Map<string, DeckAllocation>();
  const capLeft = new Map<string, { primary: number; secondary: number }>();
  for (const p of ordered) {
    out.set(p.deckId, { primary: 0, secondary: 0 });
    // A deck's secondary cards studied beyond its own cap were funded by its
    // primary cap (spill), so they count against it too.
    const deckOverflow = Math.max(0, p.studiedSecondary - p.capSecondary);
    capLeft.set(p.deckId, {
      primary: Math.max(0, p.capPrimary - p.studiedPrimary - deckOverflow),
      secondary: Math.max(0, p.capSecondary - p.studiedSecondary),
    });
  }

  for (const p of ordered) {
    if (primaryLeft <= 0) break;
    const cap = capLeft.get(p.deckId)!;
    const take = Math.min(p.totalNew, cap.primary, primaryLeft);
    if (take > 0) {
      out.get(p.deckId)!.primary += take;
      cap.primary -= take;
      primaryLeft -= take;
    }
  }

  for (const p of ordered) {
    if (secondaryLeft <= 0) break;
    const cap = capLeft.get(p.deckId)!;
    const take = Math.min(p.totalSecondaryNew, cap.secondary, secondaryLeft);
    if (take > 0) {
      out.get(p.deckId)!.secondary += take;
      cap.secondary -= take;
      secondaryLeft -= take;
    }
  }

  // Spill: primary budget nobody used goes to secondary cards, bounded by the
  // deck's remaining primary cap (that is the allowance it was funded from).
  for (const p of ordered) {
    if (primaryLeft <= 0) break;
    const cap = capLeft.get(p.deckId)!;
    const alloc = out.get(p.deckId)!;
    const take = Math.min(p.totalSecondaryNew - alloc.secondary, cap.primary, primaryLeft);
    if (take > 0) {
      alloc.secondary += take;
      cap.primary -= take;
      primaryLeft -= take;
    }
  }

  return out;
}

/** Days until a packet is fully introduced at the learner's primary rate (at least 1 word a day). */
export function daysToIntroduce(wordsLeft: number, budget: Pick<StudyBudget, 'new_cards_per_day'>): number {
  if (wordsLeft <= 0) return 0;
  return Math.ceil(wordsLeft / Math.max(1, budget.new_cards_per_day));
}

/** Validate a budget from an untrusted object; returns the clean budget or the problems. */
export function pickStudyBudget(input: Record<string, unknown> | null | undefined): { budget: Partial<StudyBudget>; problems: string[] } {
  const budget: Partial<StudyBudget> = {};
  const problems: string[] = [];
  for (const key of ['new_cards_per_day', 'secondary_cards_per_day'] as const) {
    const v = input?.[key];
    if (v === undefined || v === null) continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > STUDY_BUDGET_MAX) problems.push(`${key} must be a whole number between 0 and ${STUDY_BUDGET_MAX}`);
    else budget[key] = n;
  }
  return { budget, problems };
}
