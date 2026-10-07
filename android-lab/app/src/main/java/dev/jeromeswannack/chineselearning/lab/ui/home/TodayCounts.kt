package dev.jeromeswannack.chineselearning.lab.ui.home

import dev.jeromeswannack.chineselearning.lab.data.noteLongTerm
import dev.jeromeswannack.chineselearning.lab.data.noteHanzi
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.BuiltQueue
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import java.time.ZoneId

/** Everything due today across all decks (the Study button's number, the web's `useDueCount`). Call off the main thread. */
object TodayCounts {
    suspend fun compute(app: LabApp, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): QueueCounts =
        compute(app.repo.dao, app.prefs, nowMs, zone)

    suspend fun compute(dao: LabDao, prefs: Prefs, nowMs: Long, zone: ZoneId): QueueCounts {
        val queue = allDecksQueue(dao, prefs, nowMs, zone) ?: return QueueCounts(0, 0, 0, 0)
        return StudyQueue.counts(queue.dueCards, queue.reviewedNoteIds)
    }

    /** The all-decks queue a session would get (null without cards) — also used by the widget and notifications (shell/). */
    suspend fun allDecksQueue(dao: LabDao, prefs: Prefs, nowMs: Long, zone: ZoneId): BuiltQueue? {
        val cards = dao.cards().map { it.toQueueCard() }
        if (cards.isEmpty()) return null
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(nowMs, zone))
        return StudyQueue.build(
            dao.decks().map { it.toQueueDeck() }, cards, prefs.budget,
            prefs.bonus("all", java.time.Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().toString()), introduced, StudyQueue.cutoff(nowMs, zone), null, dao.noteHanzi(), longTerm = dao.noteLongTerm(),
            bumps = dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.queueBumps(dao),
            order = prefs.newCardOrder, frequency = dev.jeromeswannack.chineselearning.lab.core.WordFrequency.shipped,
        )
    }
}
