package dev.jeromeswannack.chineselearning.lab.data.readers

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

/** `getDueNoteIds`: the notes of today's all-decks study queue (the words a story can weave in). */
object DueWords {
    suspend fun noteIds(app: LabApp, zone: ZoneId = ZoneId.systemDefault()): List<String> = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val dao = app.repo.dao
        val cards = dao.cards().map { it.toQueueCard() }
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(now, zone))
        val bonus = app.prefs.bonus("all", LocalDate.now(zone).toString())
        val built = StudyQueue.build(dao.decks().map { it.toQueueDeck() }, cards, app.prefs.budget, bonus, introduced, StudyQueue.cutoff(now, zone), null)
        built.dueCards.map { it.noteId }.distinct()
    }
}
