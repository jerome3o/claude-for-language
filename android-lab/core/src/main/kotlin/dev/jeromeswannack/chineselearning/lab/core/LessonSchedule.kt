package dev.jeromeswannack.chineselearning.lab.core

import java.time.Instant
import java.time.ZoneId
import kotlin.random.Random

/**
 * Mini lessons and graded readers in the study session — ports of
 * frontend/src/services/custom-lesson-study.ts (getDueCustomLessons, lessonRevisitsToday),
 * services/reader-study.ts (pickTodaysReader, readersReadToday) and the lesson / reader
 * branches of selectNextItem in hooks/useStudySession.ts.
 *
 * Both come back on the "revisit later" schedule ([Revisit], shared/study/revisit.ts): the
 * rating after finishing sets the gap (Again 1 day · Hard 2 · Good 14 · Easy 42, growing each
 * later visit), "Done for good" retires one. The state is replayed from the completion /
 * reader review events plus the retire / restore marks — never stored on its own.
 */

/** A lesson completion or reader review, as the schedule sees it. Null rating = Good (legacy). */
data class ItemEvent(val id: String, val itemId: String, val rating: Int?, val at: String)

/** "Done for good" / "Bring back" on a lesson or reader (`revisit_events`; kind lesson | reader, action retire | restore). */
data class RevisitMark(val id: String, val itemKind: String, val itemId: String, val action: String, val createdAt: String)

/** A lesson or reader with its replayed state. */
data class ScheduledItem(
    val id: String,
    val createdAt: String,
    val state: RevisitState,
    /** Readers only: generation finished ('ready') and it has pages. */
    val studyable: Boolean = true,
) {
    /** The row's queue as the web caches it (`revisitRowFields`): NEW until the first finish, then REVIEW. */
    val queue: Int get() = if (state.isNew) CardQueue.NEW else CardQueue.REVIEW
    val retired: Boolean get() = state.isRetired
    /** `rowDueMs`: when it comes back (0 when unknown). */
    val dueMs: Long get() = state.dueMs ?: 0L
}

object ItemSchedule {
    /** An item's whole history in the shared shape (`revisitHistory`): finishes + its marks. */
    fun history(events: List<ItemEvent>, marks: List<RevisitMark> = emptyList()): List<RevisitEvent> =
        events.map { RevisitEvent.rating(it.id, it.at, it.rating) } + marks.map { RevisitEvent(it.id, it.createdAt, it.action) }

    /** `computeLessonState` / `computeReaderState`: replay the history with the account's gaps. */
    fun state(events: List<ItemEvent>, marks: List<RevisitMark> = emptyList(), settings: RevisitSettings = Revisit.DEFAULT): RevisitState =
        Revisit.computeState(history(events, marks), settings)

    /** The rating buttons' labels ("1 day", "2 wk", "6 wk") for an item as it stands. */
    fun previews(state: RevisitState, settings: RevisitSettings = Revisit.DEFAULT): List<IntervalPreview> = Revisit.buttonPreviews(state, settings)
}

object LessonSchedule {
    /** `MAX_NEW_LESSONS_PER_SESSION`. */
    const val MAX_NEW_PER_SESSION = 2

    /** `LESSON_MIX_INTERVAL`: a lesson is offered after this many card reviews. */
    const val MIX_INTERVAL = 8

    /**
     * `getDueCustomLessons`: revisits due by the cutoff, most overdue first, at most
     * [Revisit.MAX_LESSON_REVISITS_PER_DAY] a day minus [revisitedToday] (`pickRevisitsForToday`),
     * then NEW lessons oldest first, at most [MAX_NEW_PER_SESSION]. Done-for-good lessons and
     * lessons assigned one-off only (homework) never join the rotation.
     */
    fun dueLessons(lessons: List<ScheduledItem>, oneOffOnly: Set<String>, cutoff: StudyCutoff, revisitedToday: Int = 0): List<ScheduledItem> {
        val pool = lessons.filter { it.id !in oneOffOnly && !it.retired }
        val fresh = pool.filter { it.queue == CardQueue.NEW }.sortedBy { it.createdAt }
        val due = Revisit.pickForToday(pool.filter { it.queue != CardQueue.NEW }.map { it to it.state }, cutoff.ts, revisitedToday)
        return due + fresh.take(MAX_NEW_PER_SESSION)
    }

    /**
     * `lessonRevisitsToday`: how many lessons were REVISITED today — finished on today's LOCAL
     * date after an earlier finish (any lesson: the web counts every completion event).
     */
    fun revisitsToday(events: List<ItemEvent>, nowMs: Long, zone: ZoneId): Int {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val first = HashMap<String, String>()
        for (e in events) {
            val f = first[e.itemId]
            if (f == null || e.at < f) first[e.itemId] = e.at
        }
        val revisited = HashSet<String>()
        for (e in events) {
            val local = runCatching { Instant.ofEpochMilli(Js.parseDate(e.at)).atZone(zone).toLocalDate() }.getOrNull()
            if (local == today && e.at > (first[e.itemId] ?: "")) revisited += e.itemId
        }
        return revisited.size
    }

    /** Mini Lessons page "Up next": new, or due by the cutoff (not retired). */
    fun isUpNext(state: RevisitState, cutoff: StudyCutoff): Boolean =
        state.isNew || (state.isScheduled && (state.dueMs ?: 0L) <= cutoff.ts)
}

object ReaderSchedule {
    /** `READERS_PER_DAY`: one graded reader a day. */
    const val READERS_PER_DAY = 1

    /** `readersReadToday`: readers with a review on today's LOCAL date. */
    fun readToday(events: List<ItemEvent>, nowMs: Long, zone: ZoneId): Set<String> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return events.filter { Instant.ofEpochMilli(Js.parseDate(it.at)).atZone(zone).toLocalDate() == today }.mapTo(HashSet()) { it.itemId }
    }

    /**
     * `pickTodaysReader`: a reader read today owns the day — nothing more is offered (Again
     * brings it back tomorrow, never later the same day). Otherwise the most overdue revisit
     * due by the cutoff, else the newest unread story. Done-for-good readers never.
     */
    fun pickTodays(readers: List<ScheduledItem>, readToday: Set<String>, cutoff: StudyCutoff): ScheduledItem? {
        if (readToday.isNotEmpty()) return null
        val studyable = readers.filter { it.studyable && !it.retired }
        studyable.filter { it.queue != CardQueue.NEW && it.dueMs <= cutoff.ts }.sortedBy { it.dueMs }.firstOrNull()?.let { return it }
        return studyable.filter { it.queue == CardQueue.NEW }.sortedByDescending { it.createdAt }.firstOrNull()
    }
}

/** What the session shows next (the non-card half of `selectNextItem`). */
sealed interface SessionItem {
    data class Card(val card: QueueCard) : SessionItem
    data class Lesson(val lesson: ScheduledItem) : SessionItem
    data class Reader(val reader: ScheduledItem) : SessionItem
}

object SessionMix {
    /**
     * `selectNextItem` with lessons and readers: learning cards due now → a lesson break
     * (every [LessonSchedule.MIX_INTERVAL] reviews) → the cards (StudyQueue.selectNext) →
     * lessons left over → graded readers close out the session. A "⚡ Study it today" card
     * ([bumpedCardIds], StudyQueue.selectNext) comes before all of it, the lesson break included.
     */
    fun next(
        queue: List<QueueCard>,
        lessons: List<ScheduledItem>,
        readers: List<ScheduledItem>,
        lessonBreakDue: Boolean,
        reviewedNoteIds: Set<String>,
        recentNoteIds: List<String>,
        lastRatedCardId: String?,
        lastRatedReaderId: String?,
        nowMs: Long,
        cutoff: StudyCutoff,
        random: Random,
        bumpedCardIds: Set<String> = emptySet(),
    ): SessionItem? {
        if (bumpedCardIds.isNotEmpty()) {
            StudyQueue.selectNext(queue, reviewedNoteIds, recentNoteIds, lastRatedCardId, nowMs, cutoff, random, bumpedCardIds)
                ?.takeIf { it.id in bumpedCardIds }?.let { return SessionItem.Card(it) }
        }
        val learningDueNow = queue.any { CardQueue.isLearning(it.queue) && it.state.dueTimestamp.let { d -> d != null && d != 0L && d <= nowMs } }
        if (lessonBreakDue && lessons.isNotEmpty() && !learningDueNow) return SessionItem.Lesson(lessons[0])
        StudyQueue.selectNext(queue, reviewedNoteIds, recentNoteIds, lastRatedCardId, nowMs, cutoff, random)?.let { return SessionItem.Card(it) }
        if (lessons.isNotEmpty()) return SessionItem.Lesson(lessons[0])
        return nextReader(readers, lastRatedReaderId, nowMs, cutoff, random)?.let { SessionItem.Reader(it) }
    }

    /** Priority 4 of `selectNextItem`: learning readers due now, then new / review, then cooldown. */
    fun nextReader(readers: List<ScheduledItem>, lastRatedReaderId: String?, nowMs: Long, cutoff: StudyCutoff, random: Random): ScheduledItem? {
        val learningDue = readers.filter { CardQueue.isLearning(it.queue) && it.dueMs.let { d -> d != 0L && d <= nowMs } }
        if (learningDue.isNotEmpty()) return learningDue.firstOrNull { it.id != lastRatedReaderId } ?: learningDue[0]
        val fresh = readers.filter { it.queue == CardQueue.NEW || it.queue == CardQueue.REVIEW }
        if (fresh.isNotEmpty()) return fresh[random.nextInt(fresh.size)]
        val cooldown = readers.filter { CardQueue.isLearning(it.queue) && it.dueMs <= cutoff.ts }.sortedBy { it.dueMs }
        if (cooldown.isNotEmpty()) return cooldown.firstOrNull { it.id != lastRatedReaderId } ?: cooldown[0]
        return null
    }
}
