package dev.jeromeswannack.chineselearning.lab.data.progress

import dev.jeromeswannack.chineselearning.lab.core.Budget
import dev.jeromeswannack.chineselearning.lab.core.Completion
import dev.jeromeswannack.chineselearning.lab.core.DailyProgress
import dev.jeromeswannack.chineselearning.lab.core.DayCards
import dev.jeromeswannack.chineselearning.lab.core.Mastery
import dev.jeromeswannack.chineselearning.lab.core.MasteryCard
import dev.jeromeswannack.chineselearning.lab.core.MasteryCounts
import dev.jeromeswannack.chineselearning.lab.core.MasteryProgress
import dev.jeromeswannack.chineselearning.lab.core.Progress
import dev.jeromeswannack.chineselearning.lab.core.ProgressCardInfo
import dev.jeromeswannack.chineselearning.lab.core.ProgressEvent
import dev.jeromeswannack.chineselearning.lab.core.Streak
import dev.jeromeswannack.chineselearning.lab.core.StudyStreak
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

/** One deck's row on the Progress tab: how far through it the learner is. */
data class DeckProgressRow(val id: String, val name: String, val completion: Completion, val counts: MasteryCounts)

/** Everything the Progress tab shows, computed from the phone's own data (works offline). */
data class ProgressSnapshot(
    val daily: DailyProgress,
    val streak: StudyStreak,
    val overall: MasteryProgress,
    /** In deck-queue order (what gets studied first on top). */
    val decks: List<DeckProgressRow>,
    /** Every review ever on this phone (the all-time headline). */
    val totalReviews: Int,
)

/** A review of one card on one day, for the card-on-a-day screen. */
data class CardDayReview(val id: String, val reviewedAt: String, val rating: Int, val timeSpentMs: Long?, val userAnswer: String?)

data class CardDay(val card: ProgressCardInfo, val audioUrl: String?, val reviews: List<CardDayReview>)

/**
 * Reads the Room mirror for the Progress screens with plain SQL over the synced tables
 * (read-only; no schema of its own). The numbers are core's `Progress` / `Streak` /
 * `Mastery` — ports of shared/progress, parity-tested against the TypeScript.
 */
class ProgressStore(private val db: LabDatabase) {
    private val dao = db.dao()

    suspend fun snapshot(nowMs: Long, zone: ZoneId): ProgressSnapshot = withContext(Dispatchers.IO) {
        // A day before both windows (the 30-day SQL window and the streak's local-midnight one).
        val since = Progress.windowStart(nowMs, days = 33).take(10)
        val events = events("SELECT cardId, rating, reviewedAt, timeSpentMs, userAnswer FROM review_events WHERE reviewedAt >= ?", arrayOf(since))
        val total = db.openHelper.readableDatabase.query("SELECT COUNT(*) FROM review_events").use { if (it.moveToFirst()) it.getInt(0) else 0 }
        val cards = dao.cards()
        val decks = dao.decks()
        val byDeck = cards.groupBy { it.deckId }
        val rows = decks.map { d ->
            val p = Mastery.progress(byDeck[d.id].orEmpty().map { MasteryCard(it.cardType, it.queue, it.stability) })
            DeckProgressRow(d.id, d.name, p.completion, p.counts)
        }
        val deckById = decks.associateBy { it.id }
        val ordered = Budget.sortForQueue(rows, { r -> deckById.getValue(r.id).studyPriority }, { r -> deckById.getValue(r.id).createdAt })
        ProgressSnapshot(
            daily = Progress.dailyProgress(events, nowMs),
            streak = Streak.studyStreak(events, nowMs, zone),
            overall = Mastery.progress(cards.map { MasteryCard(it.cardType, it.queue, it.stability) }),
            decks = ordered,
            totalReviews = total,
        )
    }

    /** `/progress/day/:date` from the phone: events of that UTC date joined with their cards and notes. */
    suspend fun day(date: String): DayCards = withContext(Dispatchers.IO) {
        val (from, to) = around(date)
        val events = events("SELECT cardId, rating, reviewedAt, timeSpentMs, userAnswer FROM review_events WHERE reviewedAt >= ? AND reviewedAt < ?", arrayOf(from, to))
        val cardIds = events.map { it.cardId }.distinct()
        val cards = cardIds.chunked(500).flatMap { dao.cardsByIds(it) }
        val notes = cards.map { it.noteId }.distinct().chunked(500).flatMap { dao.notes(it) }.associateBy { it.id }
        val infos = cards.mapNotNull { c -> notes[c.noteId]?.let { info(c.id, c.cardType, it) } }
        Progress.dayCards(events, infos, date)
    }

    /** `/progress/day/:date/card/:cardId` from the phone. Null when the card is gone. */
    suspend fun cardDay(date: String, cardId: String): CardDay? = withContext(Dispatchers.IO) {
        val card = dao.card(cardId) ?: return@withContext null
        val note = dao.note(card.noteId) ?: return@withContext null
        val reviews = dao.eventsForCard(cardId)
            .filter { Progress.utcDate(it.reviewedAt) == date }
            .map { CardDayReview(it.id, it.reviewedAt, it.rating, it.timeSpentMs, it.userAnswer) }
        CardDay(info(card.id, card.cardType, note), note.audioUrl, reviews)
    }

    private fun info(cardId: String, type: String, n: NoteEntity) = ProgressCardInfo(cardId, type, n.id, n.hanzi, n.pinyin, n.english)

    /** String bounds wide enough for any offset a timestamp can carry; core filters by the exact UTC date. */
    private fun around(date: String): Pair<String, String> {
        val d = LocalDate.parse(date)
        return d.minusDays(1).toString() to d.plusDays(2).toString()
    }

    private fun events(sql: String, args: Array<Any?>): List<ProgressEvent> =
        db.openHelper.readableDatabase.query(sql, args).use { c ->
            val out = ArrayList<ProgressEvent>(c.count.coerceAtLeast(0))
            while (c.moveToNext()) {
                out += ProgressEvent(
                    cardId = c.getString(0),
                    rating = c.getInt(1),
                    reviewedAt = c.getString(2),
                    timeSpentMs = if (c.isNull(3)) null else c.getLong(3),
                    userAnswer = if (c.isNull(4)) null else c.getString(4),
                )
            }
            out
        }
}
