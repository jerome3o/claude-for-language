package dev.jeromeswannack.chineselearning.lab.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/*
 * The Progress tab's numbers, computed from the review events on the phone so the tab
 * works offline. Port of shared/progress (daily.ts, streak.ts, mastery.ts) — the same
 * definitions the web's server SQL follows (worker test my-progress-parity.test.ts) —
 * parity-tested in ProgressParityTest against vectors from the TypeScript.
 */

/** One review event, as the Progress numbers read it. */
data class ProgressEvent(
    val cardId: String,
    val rating: Int,
    /** ISO string as stored. */
    val reviewedAt: String,
    val timeSpentMs: Long? = null,
    val userAnswer: String? = null,
)

data class ProgressDay(
    /** UTC date, yyyy-MM-dd. */
    val date: String,
    val reviewsCount: Int,
    val uniqueCards: Int,
    val accuracy: Int,
    val timeSpentMs: Long,
)

data class ProgressSummary(val totalReviews30d: Int, val totalDaysActive: Int, val averageAccuracy: Int, val totalTimeMs: Long)

data class DailyProgress(val summary: ProgressSummary, val days: List<ProgressDay>)

data class ProgressCardInfo(
    val cardId: String,
    val cardType: String,
    val noteId: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
)

data class DayCard(
    val card: ProgressCardInfo,
    val reviewCount: Int,
    /** In the order the reviews happened. */
    val ratings: List<Int>,
    val averageRating: Double,
    val totalTimeMs: Long,
    val hasAnswers: Boolean,
)

data class DaySummary(val totalReviews: Int, val uniqueCards: Int, val accuracy: Int, val timeSpentMs: Long)

data class DayCards(val date: String, val summary: DaySummary, val cards: List<DayCard>)

object Progress {
    private const val DAY_MS = 86_400_000L
    private val SQL_DATETIME: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneOffset.UTC)

    /** Port of windowStart(): SQLite `datetime('now', '-30 days')` as "yyyy-MM-dd HH:mm:ss" (UTC). */
    fun windowStart(nowMs: Long, days: Int = 30): String = SQL_DATETIME.format(Instant.ofEpochMilli(nowMs - days * DAY_MS))

    /** Port of utcDate(): SQLite `date(reviewed_at)` — the UTC date. */
    fun utcDate(reviewedAt: String): String =
        runCatching { Js.toIsoString(Js.parseDate(reviewedAt)).substring(0, 10) }.getOrElse { reviewedAt.take(10) }

    /** Port of dailyProgress(): the `/api/progress/daily` SQL over the events on the phone. */
    fun dailyProgress(events: List<ProgressEvent>, nowMs: Long): DailyProgress {
        val start = windowStart(nowMs)
        class Acc { var count = 0; val cards = HashSet<String>(); var correct = 0; var time = 0L }
        val byDate = HashMap<String, Acc>()
        for (e in events) {
            if (e.reviewedAt < start) continue
            val day = byDate.getOrPut(utcDate(e.reviewedAt)) { Acc() }
            day.count++
            day.cards += e.cardId
            if (e.rating >= 2) day.correct++
            day.time += e.timeSpentMs ?: 0
        }
        val rows = byDate.entries.sortedByDescending { it.key }.map { (date, d) ->
            Triple(date, d, (d.correct.toDouble() / d.count) * 100)
        }
        val average = if (rows.isNotEmpty()) Js.round(rows.fold(0.0) { s, r -> s + r.third } / rows.size).toInt() else 0
        return DailyProgress(
            ProgressSummary(rows.sumOf { it.second.count }, rows.size, average, rows.sumOf { it.second.time }),
            rows.map { (date, d, acc) -> ProgressDay(date, d.count, d.cards.size, Js.round(acc).toInt(), d.time) },
        )
    }

    /** Port of dayCards(): `/api/progress/day/:date` — cards reviewed on one UTC date, most difficult first. */
    fun dayCards(events: List<ProgressEvent>, cards: List<ProgressCardInfo>, date: String): DayCards {
        val info = cards.associateBy { it.cardId }
        val dayEvents = events.filter { it.cardId in info && utcDate(it.reviewedAt) == date }.sortedBy { it.reviewedAt }
        class Acc(val first: String) { val ratings = ArrayList<Int>(); var time = 0L; var answers = false }
        val byCard = LinkedHashMap<String, Acc>()
        for (e in dayEvents) {
            val c = byCard.getOrPut(e.cardId) { Acc(e.reviewedAt) }
            c.ratings += e.rating
            c.time += e.timeSpentMs ?: 0
            if (!e.userAnswer.isNullOrEmpty()) c.answers = true
        }
        val rows = byCard.map { (id, c) ->
            c.first to DayCard(info.getValue(id), c.ratings.size, c.ratings, c.ratings.fold(0.0) { s, r -> s + r } / c.ratings.size, c.time, c.answers)
        }.sortedWith(
            compareByDescending<Pair<String, DayCard>> { it.second.reviewCount }
                .thenBy { it.second.averageRating }
                .thenBy { it.first }
                .thenBy { it.second.card.cardId },
        ).map { it.second }
        val all = rows.flatMap { it.ratings }
        return DayCards(
            date,
            DaySummary(
                totalReviews = rows.sumOf { it.reviewCount },
                uniqueCards = rows.size,
                accuracy = if (all.isNotEmpty()) Js.round(all.count { it >= 2 }.toDouble() / all.size * 100).toInt() else 0,
                timeSpentMs = rows.sumOf { it.totalTimeMs },
            ),
            rows,
        )
    }

    /** Port of formatStudyTime() (the web's stat-tile `formatTime`). */
    fun formatStudyTime(ms: Long): String {
        if (ms <= 0) return "0 min"
        if (ms < 60_000) return "< 1 min"
        val minutes = maxOf(1L, Js.roundToLong(ms / 60_000.0))
        if (minutes < 60) return "$minutes min"
        val hours = minutes / 60
        val rest = minutes % 60
        return if (rest > 0) "${hours}h ${rest}m" else "${hours}h"
    }

    /** Port of formatStreakTime(): whole minutes, floored ("12m", "1h 5m"). */
    fun formatStreakTime(ms: Long): String {
        val minutes = Math.floorDiv(ms, 60_000L)
        if (minutes < 60) return "${minutes}m"
        val hours = minutes / 60
        val rest = minutes % 60
        return if (rest > 0) "${hours}h ${rest}m" else "${hours}h"
    }
}

// ---------------- streak ----------------

data class HeatDay(val date: String, val count: Int)

data class TodayStats(val reviews: Int, val accuracy: Int, val timeMs: Long)

data class StudyStreak(val streak: Int, val today: TodayStats, val heatmap: List<HeatDay>, val maxCount: Int)

object Streak {
    /**
     * Port of studyStreak() (the web Home's streak card). Event dates are the first 10
     * characters of reviewed_at; a day's date is the UTC date of LOCAL midnight N days ago
     * (`toISOString()` of a local Date) — east of UTC that is the previous UTC date, as on the web.
     */
    fun studyStreak(events: List<ProgressEvent>, nowMs: Long, zone: ZoneId): StudyStreak {
        val midnight = ZonedDateTime.ofInstant(Instant.ofEpochMilli(nowMs), zone).toLocalDate()
        fun dateString(daysAgo: Int): String =
            midnight.minusDays(daysAgo.toLong()).atStartOfDay(zone).toInstant().atOffset(ZoneOffset.UTC).toLocalDate().toString()
        val thirtyDaysAgo = dateString(30)
        val byDate = HashMap<String, MutableList<ProgressEvent>>()
        for (e in events) {
            if (e.reviewedAt < thirtyDaysAgo) continue
            byDate.getOrPut(e.reviewedAt.take(10)) { ArrayList() } += e
        }
        var streak = 0
        for (i in 0..30) {
            if (dateString(i) in byDate) streak++
            else if (i == 0) continue
            else break
        }
        val today = byDate[dateString(0)].orEmpty()
        val correct = today.count { it.rating == 2 || it.rating == 3 }
        val heatmap = (29 downTo 0).map { i -> dateString(i).let { HeatDay(it, byDate[it]?.size ?: 0) } }
        return StudyStreak(
            streak,
            TodayStats(
                today.size,
                if (today.isNotEmpty()) Js.round(correct.toDouble() / today.size * 100).toInt() else 0,
                today.sumOf { it.timeSpentMs ?: 0 },
            ),
            heatmap,
            maxOf(1, heatmap.maxOfOrNull { it.count } ?: 0),
        )
    }

    /** The local date "today" of the streak (for labels). */
    fun localToday(nowMs: Long, zone: ZoneId): LocalDate = ZonedDateTime.ofInstant(Instant.ofEpochMilli(nowMs), zone).toLocalDate()
}

// ---------------- mastery ----------------

enum class MasteryLevel { New, Learning, Familiar, Mastered }

data class MasteryCounts(val total: Int = 0, val new: Int = 0, val learning: Int = 0, val familiar: Int = 0, val mastered: Int = 0) {
    operator fun plus(level: MasteryLevel) = when (level) {
        MasteryLevel.New -> copy(total = total + 1, new = new + 1)
        MasteryLevel.Learning -> copy(total = total + 1, learning = learning + 1)
        MasteryLevel.Familiar -> copy(total = total + 1, familiar = familiar + 1)
        MasteryLevel.Mastered -> copy(total = total + 1, mastered = mastered + 1)
    }
}

data class Completion(val totalCards: Int, val cardsSeen: Int, val cardsMastered: Int, val percentSeen: Int, val percentMastered: Int)

data class MasteryProgress(val completion: Completion, val counts: MasteryCounts, val breakdown: Map<String, MasteryCounts>)

/** A card's state as the mastery numbers read it. */
data class MasteryCard(val cardType: String, val queue: Int, val stability: Double)

object Mastery {
    val CARD_TYPES = listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi")

    /** Port of masteryLevel(). */
    fun level(queue: Int, stability: Double): MasteryLevel = when {
        queue == 0 -> MasteryLevel.New
        queue == 1 || queue == 3 -> MasteryLevel.Learning
        stability <= 7 -> MasteryLevel.Learning
        stability <= 21 -> MasteryLevel.Familiar
        else -> MasteryLevel.Mastered
    }

    /** Port of masteryProgress(). */
    fun progress(cards: List<MasteryCard>): MasteryProgress {
        var counts = MasteryCounts()
        val breakdown = CARD_TYPES.associateWith { MasteryCounts() }.toMutableMap()
        for (c in cards) {
            val l = level(c.queue, c.stability)
            counts += l
            breakdown[c.cardType]?.let { breakdown[c.cardType] = it + l }
        }
        val seen = counts.total - counts.new
        fun pct(n: Int) = if (counts.total > 0) Js.round(n.toDouble() / counts.total * 100).toInt() else 0
        return MasteryProgress(Completion(counts.total, seen, counts.mastered, pct(seen), pct(counts.mastered)), counts, breakdown)
    }
}
