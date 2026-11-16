/**
 * Home's numbers right after a study session (Jerome, Nov 2026: "When I finish my flashcards …
 * it takes me back to the home screen. The home screen still shows the previous cached values
 * before I started the study session. And then after a little bit of loading, it shows the zeros").
 *
 * Home works its counts out from the device's store, and that takes a moment (every card, the
 * budget, "Order new cards by"). Meanwhile it used to paint the last numbers it had shown —
 * from BEFORE the session. The session already knows what is left: its queue IS today's queue
 * (shared/decks/study-queue.ts), so it publishes a {@link SessionCounts} snapshot whenever its
 * numbers change, and Home paints the NEWEST of the two:
 *
 * - the session's snapshot while it is newer than Home's last worked-out counts (same study day),
 * - Home's own counts once a computation that started after the session's last change finishes.
 *
 * So Home shows 0 the moment "All done" → Done brings it back, and the exact recount only refines
 * it afterwards — never an older snapshot over a newer one. Lab port: core `HomeCounts.kt`
 * (parity-tested, parity/fixtures/home-counts.ts). docs/STUDY_SESSION.md "Back on Home".
 */

/** One set of queue counts (the colours of the Study button / a deck row). */
export interface StudyCounts {
  new: number;
  secondaryNew: number;
  learning: number;
  review: number;
}

export const NO_STUDY_COUNTS: StudyCounts = Object.freeze({ new: 0, secondaryNew: 0, learning: 0, review: 0 });

/** What a study session still has to show, published as it changes. */
export interface SessionCounts {
  /** The study day (studyDayKey) the session's queue was built for. */
  day: string;
  /** When these numbers last changed (epoch ms). */
  at: number;
  /** The deck the session studies; null = all decks. */
  deckId: string | null;
  /** The session's own numbers (its top bar). */
  remaining: StudyCounts;
  /** Its cards still to show, per deck. */
  byDeck: Record<string, StudyCounts>;
  /** "⚡ Study it today": notes with a bumped card still to show. */
  bumpedNotes: number;
}

/** When Home's own counts were worked out: the moment the computation read the data, and that study day. */
export interface ComputedStamp {
  at: number;
  day: string;
}

/**
 * Whether Home should paint the session's numbers: they are today's and newer than its own
 * (or it has none for today yet). A tie goes to Home's own counts — they are exact.
 */
export function sessionCountsNewer(session: SessionCounts | null | undefined, computed: ComputedStamp | null | undefined, today: string): boolean {
  if (!session || session.day !== today) return false;
  if (!computed || computed.day !== today) return true;
  return session.at > computed.at;
}

const nonNegative = (n: number) => (n > 0 ? n : 0);

/**
 * One deck row after a newer session: its learning / review cards are exactly the ones the session
 * still holds of that deck; its new cards are never more than the row said before nor more than the
 * session has left. A deck outside a one-deck session keeps its row.
 */
export function deckCountsAfterSession(row: StudyCounts | null | undefined, session: SessionCounts, deckId: string): StudyCounts {
  if (session.deckId !== null && session.deckId !== deckId) return row ?? NO_STUDY_COUNTS;
  const left = session.byDeck[deckId] ?? NO_STUDY_COUNTS;
  const before = row ?? left;
  return {
    new: nonNegative(Math.min(before.new, session.remaining.new)),
    secondaryNew: nonNegative(Math.min(before.secondaryNew, session.remaining.secondaryNew)),
    learning: nonNegative(left.learning),
    review: nonNegative(left.review),
  };
}

/**
 * Home's total after a newer session: an all-decks session's own numbers; a one-deck session
 * replaces that deck's part of Home's total (its row before → after).
 */
export function totalAfterSession(
  total: StudyCounts | null | undefined,
  rows: Record<string, StudyCounts>,
  session: SessionCounts,
): StudyCounts {
  if (session.deckId === null || !total) return { ...session.remaining };
  const before = rows[session.deckId] ?? NO_STUDY_COUNTS;
  const after = deckCountsAfterSession(before, session, session.deckId);
  return {
    new: nonNegative(total.new - before.new + after.new),
    secondaryNew: nonNegative(total.secondaryNew - before.secondaryNew + after.secondaryNew),
    learning: nonNegative(total.learning - before.learning + after.learning),
    review: nonNegative(total.review - before.review + after.review),
  };
}

/** The ⚡ line after a newer session: an all-decks session knows its pocket; a one-deck session leaves Home's. */
export function bumpedAfterSession(bumped: number, session: SessionCounts): number {
  return session.deckId === null ? session.bumpedNotes : bumped;
}

/** Counts of a list of cards by queue (the session's top bar rule): NEW of a started note = secondary. */
export function countSessionCards(
  cards: Iterable<{ deck_id: string; note_id: string; queue: number }>,
  reviewedNoteIds: ReadonlySet<string>,
): { total: StudyCounts; byDeck: Record<string, StudyCounts> } {
  const total = { ...NO_STUDY_COUNTS };
  const byDeck: Record<string, StudyCounts> = {};
  for (const c of cards) {
    const row = (byDeck[c.deck_id] ??= { ...NO_STUDY_COUNTS });
    const key: keyof StudyCounts = c.queue === 0
      ? (reviewedNoteIds.has(c.note_id) ? 'secondaryNew' : 'new')
      : c.queue === 2 ? 'review' : 'learning';
    row[key]++;
    total[key]++;
  }
  return { total, byDeck };
}
