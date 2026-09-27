package dev.jeromeswannack.chineselearning.lab.ui.home

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import java.time.LocalDate
import java.time.ZoneId

/** Everything due today across all decks (the Study button's number, the web's `useDueCount`). Call off the main thread. */
object TodayCounts {
    suspend fun compute(app: LabApp, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): QueueCounts {
        val dao = app.repo.dao
        val cards = dao.cards().map { it.toQueueCard() }
        if (cards.isEmpty()) return QueueCounts(0, 0, 0, 0)
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(nowMs, zone))
        val queue = StudyQueue.build(
            dao.decks().map { it.toQueueDeck() }, cards, app.prefs.budget,
            app.prefs.bonus("all", LocalDate.now(zone).toString()), introduced, StudyQueue.cutoff(nowMs, zone), null,
        )
        return StudyQueue.counts(queue.dueCards, queue.reviewedNoteIds)
    }
}
