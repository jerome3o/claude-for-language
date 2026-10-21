package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/decks/review-load.ts — "Pause new cards on heavy days": on a day whose review
 * load is OVER the account's limit, today's new-card budget is 0 new words + 0 extra cards
 * (only the reviews); otherwise the configured budget. Parity-tested
 * (parity/fixtures/review-load.ts → ReviewLoadParityTest).
 *
 * Today's review load = cards past NEW due by the cutoff + cards already reviewed today, never
 * a card whose first-ever review is today (a new card's learning steps) — so it does not fall
 * as the learner works through the day. ⚡ bumps, homework passes, lessons / readers and the
 * new cards already introduced today are unaffected; Up next waits; "Study 10 more" still adds.
 */
data class ReviewLoadCard(val id: String, val queue: Int, val dueMs: Long?)

data class ReviewLoadState(
    /** Today's review load. */
    val load: Int,
    /** The account's limit (pause_new_when_reviews_over); null = off. */
    val threshold: Int?,
    /** load > threshold: today's budget is 0 + 0. */
    val paused: Boolean,
)

object ReviewLoad {
    const val CAP_MIN = 10
    const val CAP_MAX = 1000
    /** What the field offers when the switch goes on. */
    const val CAP_SUGGESTED = 100

    /** `PAUSED_NEW_CARDS_DETAIL`: the line under Home's paused line. */
    const val PAUSED_DETAIL = "Up next waits too. ⚡ bumps and homework still come; Study 10 more adds new cards anyway."

    /** Port of `reviewLoadToday`. [firstReviewAt] is read only for the cards in [reviewedToday]. */
    fun reviewLoadToday(
        cards: Iterable<ReviewLoadCard>,
        reviewedToday: Set<String>,
        firstReviewAt: Map<String, Long>,
        dayStartMs: Long,
        cutoffMs: Long,
    ): Int {
        var load = 0
        for (c in cards) {
            if (c.queue == CardQueue.NEW) continue
            if (c.id in reviewedToday) {
                val first = firstReviewAt[c.id]
                if (first != null && first >= dayStartMs) continue
                load++
            } else if (c.dueMs == null || c.dueMs <= cutoffMs) {
                load++
            }
        }
        return load
    }

    /** [reviewLoadToday] over the study queue's cards (learning / review due = the state's due timestamp). */
    fun loadOf(cards: Collection<QueueCard>, reviewedToday: Set<String>, firstReviewAt: Map<String, Long>, dayStartMs: Long, cutoffMs: Long): Int =
        reviewLoadToday(cards.map { ReviewLoadCard(it.id, it.queue, it.state.dueTimestamp) }, reviewedToday, firstReviewAt, dayStartMs, cutoffMs)

    /** Port of `reviewLoadState`: paused only when the limit is on and the load is over it. */
    fun state(load: Int, threshold: Int?): ReviewLoadState = ReviewLoadState(load, threshold, threshold != null && load > threshold)

    /** Port of `budgetForToday`: 0 + 0 while paused. */
    fun budgetForToday(budget: StudyBudget, state: ReviewLoadState?): StudyBudget =
        if (state?.paused == true) StudyBudget(0, 0) else budget

    private fun reviews(n: Int) = "$n ${if (n == 1) "review" else "reviews"}"

    /** Port of `pausedNewCardsLabel`: "New cards paused — 124 reviews due today (limit 100)"; null otherwise. */
    fun pausedLabel(state: ReviewLoadState?): String? {
        if (state == null || !state.paused || state.threshold == null) return null
        return "New cards paused — ${reviews(state.load)} due today (limit ${state.threshold})"
    }

    /** Port of `upNextPausedLabel`: the Up next page while paused; null otherwise. */
    fun upNextPausedLabel(state: ReviewLoadState?): String? {
        if (state == null || !state.paused || state.threshold == null) return null
        return "Up next waits — new cards are paused today (${reviews(state.load)} due, limit ${state.threshold})."
    }

    /** Port of `reviewLoadCapSummary`: "Pauses new cards on days with more than 100 reviews due"; null = off. */
    fun capSummary(threshold: Int?): String? = threshold?.let { "Pauses new cards on days with more than $it reviews due" }

    /** Port of `tutorPausedLabel`: "⏸ New cards paused today · 124 reviews due"; null otherwise. */
    fun tutorPausedLabel(state: ReviewLoadState?): String? =
        if (state?.paused == true) "⏸ New cards paused today · ${reviews(state.load)} due" else null

    /** The field's value can be saved: off, or a whole number [CAP_MIN]–[CAP_MAX] (`pickReviewLoadCap`). */
    fun isValid(v: Int?): Boolean = v == null || v in CAP_MIN..CAP_MAX
}
