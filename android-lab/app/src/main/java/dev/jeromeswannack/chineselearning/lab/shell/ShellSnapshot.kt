package dev.jeromeswannack.chineselearning.lab.shell

import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.ui.home.TodayCounts
import java.time.Instant
import java.time.ZoneId

/**
 * What the widget and the notifications know about today, from the local Room mirror alone
 * (works on the train): the Study button's counts — the same all-decks queue the session and
 * Home build (TodayCounts) — the card a notification would ask about, and the due homework.
 */
data class ShellSnapshot(
    val signedIn: Boolean,
    val tutorAccount: Boolean,
    val due: QueueCounts,
    /** Cards a notification may ask about, first = the one it asks ([ShellRules.notificationCandidates]). */
    val candidates: List<QueueCard>,
    val homework: List<ShellRules.HomeworkDue>,
    val today: String,
) {
    val notifyCard: QueueCard? get() = candidates.firstOrNull()
    fun stillDue(cardId: String) = candidates.any { it.id == cardId }
    val widget get() = ShellRules.WidgetModel(signedIn, due, homework, tutorAccount)

    companion object {
        private val NONE = QueueCounts(0, 0, 0, 0)

        /** Call off the main thread. */
        suspend fun load(dao: LabDao, prefs: Prefs, homework: List<ShellRules.HomeworkItem>, nowMs: Long, zone: ZoneId): ShellSnapshot {
            val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
            val signedIn = prefs.sessionToken != null
            val queue = if (signedIn) TodayCounts.allDecksQueue(dao, prefs, nowMs, zone) else null
            return ShellSnapshot(
                signedIn = signedIn,
                tutorAccount = prefs.accountRole == "tutor",
                due = queue?.let { StudyQueue.counts(it.dueCards, it.reviewedNoteIds) } ?: NONE,
                candidates = queue?.let { ShellRules.notificationCandidates(it.dueCards, nowMs) }.orEmpty(),
                homework = if (signedIn) ShellRules.homeworkDueNow(homework, today) else emptyList(),
                today = today.toString(),
            )
        }
    }
}

/** What a card notification shows (hanzi on the front; pinyin, meaning, example on the back). */
data class NotifyContent(
    val cardId: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val sentence: String? = null,
    val sentenceTranslation: String? = null,
) {
    companion object {
        fun of(cardId: String, note: NoteEntity) = NotifyContent(
            cardId, note.hanzi, note.pinyin, note.english,
            note.sentenceClue?.takeIf { it.isNotBlank() }, note.sentenceClueTranslation?.takeIf { it.isNotBlank() },
        )
    }
}
