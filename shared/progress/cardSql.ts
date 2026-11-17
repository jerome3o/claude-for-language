/**
 * The card predicates every server query uses, as SQL — ONE definition per word, equal to the
 * shared rules the apps use on the device:
 *
 * - **mastered / known / mature** = Review with stability > 21 days — `masteryLevel(queue, stability)
 *   === 'mastered'` (progress/mastery.ts), the deck page's "mastered", the Progress page's "known",
 *   lead-card.ts's "known card". Never `interval > 21` (the scheduled interval is fuzzed and
 *   capped, and a relearning card keeps it).
 * - **reviews due** = a learning / relearning / review card due by the study day's cutoff
 *   (study-queue.ts `isDueByCutoff`: learning = due_timestamp, review = next_review_at, none =
 *   due now). Never a NEW card: how many new cards are due today is the budget's call — the server
 *   asks the shared queue for that (worker services/study-queue.ts).
 *
 * Imported by the worker (db/ + services/) and the MCP server; `card-sql.test.ts` and the worker's
 * guard test keep `interval > 21` and "every NEW card is due" out of the SQL.
 */

/** Days of stability above which a Review card counts as mastered (progress/mastery.ts). */
export const MASTERED_STABILITY_DAYS = 21;

/** `alias` is mastered: Review with stability > 21 days. */
export function masteredCardSql(alias = 'c'): string {
  return `(${alias}.queue = 2 AND COALESCE(${alias}.stability, 0) > ${MASTERED_STABILITY_DAYS})`;
}

/** The mastered predicate on cards aliased `c`. */
export const MASTERED_CARD_SQL = masteredCardSql('c');

/**
 * `alias` is a learning / review card due by the cutoff: binds ONE parameter, the cutoff as epoch
 * ms (study-queue.ts `isDueByCutoff` — learning cards by due_timestamp, else next_review_at).
 */
export function reviewDueSql(alias = 'c'): string {
  const due = `COALESCE(CASE WHEN ${alias}.queue IN (1, 3) THEN ${alias}.due_timestamp END, CAST((julianday(${alias}.next_review_at) - 2440587.5) * 86400000 AS INTEGER))`;
  return `(COALESCE(${alias}.queue, 0) != 0 AND (${due} IS NULL OR ${due} <= ?))`;
}

/** A card held out of study today (suspended / snoozed — shared/decks/holds.ts): binds ONE parameter, today's study-day key. */
export function heldCardSql(alias = 'c'): string {
  return `EXISTS (SELECT 1 FROM card_holds h WHERE h.card_id = ${alias}.id AND h.cleared_at IS NULL AND (h.kind = 'suspend' OR h.until > ?))`;
}
