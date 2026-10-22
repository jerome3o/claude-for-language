package dev.jeromeswannack.chineselearning.lab.data

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.ReviewLoad
import dev.jeromeswannack.chineselearning.lab.core.ReviewLoadState
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import java.time.ZoneId

/**
 * Today's new-card budget as every study queue the app builds should see it — the web's
 * `loadStudyInputs` (frontend/src/db/database.ts): "Pause new cards on heavy days"
 * (core ReviewLoad, shared/decks/review-load.ts) makes it 0 + 0 on a day whose review load is
 * over the account's limit ([Prefs.reviewLoadCap]); otherwise it is [Prefs.budget].
 *
 * The load is account-wide: [cards] must be EVERY card (all decks) and [firstReviewAt] every
 * card's first review, as the queue builders already load them. One extra query: the cards
 * reviewed since local midnight.
 */
object TodaysBudget {
    data class Today(val budget: StudyBudget, val reviewLoad: ReviewLoadState)

    suspend fun state(dao: LabDao, cap: Int?, cards: Collection<QueueCard>, firstReviewAt: Map<String, Long>, nowMs: Long, zone: ZoneId): ReviewLoadState {
        val dayStart = StudyQueue.startOfDay(nowMs, zone)
        val reviewed = dao.cardIdsReviewedSince(Js.toIsoString(dayStart)).toHashSet()
        // Suspended / snoozed cards are no part of today's load (core CardHolds, like the web).
        val held = dev.jeromeswannack.chineselearning.lab.data.holds.HoldStore.heldIds(dao, nowMs, zone)
        val live = if (held.isEmpty()) cards else cards.filter { it.id !in held }
        val load = ReviewLoad.loadOf(live, reviewed, firstReviewAt, dayStart, StudyQueue.cutoff(nowMs, zone).ts)
        return ReviewLoad.state(load, cap)
    }

    suspend fun of(dao: LabDao, budget: StudyBudget, cap: Int?, cards: Collection<QueueCard>, firstReviewAt: Map<String, Long>, nowMs: Long, zone: ZoneId): Today {
        val st = state(dao, cap, cards, firstReviewAt, nowMs, zone)
        return Today(ReviewLoad.budgetForToday(budget, st), st)
    }

    suspend fun of(dao: LabDao, prefs: Prefs, cards: Collection<QueueCard>, firstReviewAt: Map<String, Long>, nowMs: Long, zone: ZoneId): Today =
        of(dao, prefs.budget, prefs.reviewLoadCap, cards, firstReviewAt, nowMs, zone)
}
