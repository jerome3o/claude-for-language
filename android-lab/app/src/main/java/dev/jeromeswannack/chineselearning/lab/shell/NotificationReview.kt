package dev.jeromeswannack.chineselearning.lab.shell

import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.Repository

/**
 * Answering a card from its notification is an ordinary review: the SAME
 * `Repository.recordReview` the study session calls — the event is appended locally, the card
 * is recomputed from its events, and sync / the upload worker send it (the hybrid app posted
 * straight to `/api/reviews` and lost the answer when offline).
 */
object NotificationReview {
    data class Rated(val eventId: String, val hanzi: String?, val nextIn: String?)

    suspend fun rate(repo: Repository, cardId: String, rating: Int, nowMs: Long = System.currentTimeMillis()): Rated {
        val (eventId, card) = repo.recordReview(cardId, rating, timeSpentMs = null, userAnswer = null, nowMs = nowMs)
        val hanzi = card?.let { repo.dao.note(it.noteId)?.hanzi }
        val nextIn = card?.state()?.dueTimestamp?.let { due -> CardScheduler.formatInterval(maxOf(0L, due - nowMs) / 60_000.0) }
        return Rated(eventId, hanzi, nextIn)
    }

    /** The card's text for the notification, or null when it is gone (deleted since). */
    suspend fun content(dao: LabDao, cardId: String): NotifyContent? {
        val card = dao.card(cardId) ?: return null
        val note = dao.note(card.noteId) ?: return null
        return NotifyContent.of(cardId, note)
    }

    /** The intervals the rating actions show ("Good · 4d"), exactly the session's rating-bar labels. */
    suspend fun previews(dao: LabDao, cardId: String, nowMs: Long = System.currentTimeMillis()): List<IntervalPreview> =
        dao.card(cardId)?.let { CardScheduler.intervalPreviews(it.state(), nowMs) }.orEmpty()
}
