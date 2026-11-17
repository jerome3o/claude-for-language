package dev.jeromeswannack.chineselearning.lab.core

import java.time.ZoneId
import kotlin.random.Random

/**
 * Graded readers in the study session — ports of services/reader-study.ts (pickTodaysReader,
 * readersReadToday) and the reader branch of selectNextItem in hooks/useStudySession.ts.
 *
 * Graded readers are read ONCE ([DailyReader], shared/study/daily-reader.ts): one unread story a
 * day, never a repeat. Mini lessons are not part of the session (Oct 2026): they revise until right
 * first time ([LessonRevision]); the old "revisit later" schedule and its settings are gone.
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
    /** Readers only: the place in the reader queue ([ReaderQueue]); null = never placed by hand. */
    val queuePriority: Long? = null,
) {
    /** The row's queue as the web caches it (`revisitRowFields`): NEW until the first finish, then REVIEW. */
    val queue: Int get() = if (state.isNew) CardQueue.NEW else CardQueue.REVIEW
    val retired: Boolean get() = state.isRetired
    /** `rowDueMs`: when it comes back (0 when unknown). */
    val dueMs: Long get() = state.dueMs ?: 0L
}

object ReaderSchedule {
    /** `READERS_PER_DAY`: one graded reader a day. */
    const val READERS_PER_DAY = DailyReader.READERS_PER_DAY

    /** `readersReadToday`: readers with a review on today's LOCAL date. */
    fun readToday(events: List<ItemEvent>, nowMs: Long, zone: ZoneId, rolloverHour: Int = 0): Set<String> {
        // The study day (StudyDay: "New day starts at"; 0 = the calendar day): a story read at
        // 23:50 still owns the night at 00:30 with a 4 am rollover.
        val day = StudyDay.at(nowMs, rolloverHour, zone)
        return events.filter { runCatching { Js.parseDate(it.at) }.getOrNull()?.let { ms -> ms >= day.startMs && ms < day.endMs } == true }.mapTo(HashSet()) { it.itemId }
    }

    /**
     * A reader's state from its reviews: NEW while unread, then "scheduled" with no due date —
     * read, never offered again (`readerReadFields`).
     */
    fun state(events: List<ItemEvent>): RevisitState {
        if (events.isEmpty()) return RevisitState.INITIAL
        val last = events.maxOf { runCatching { Js.parseDate(it.at) }.getOrDefault(0L) }
        return RevisitState(RevisitState.SCHEDULED, null, 0.0, last, events.size)
    }

    private fun offer(r: ScheduledItem) = ReaderOffer(r.id, r.createdAt, r.studyable, !r.state.isNew, r.queuePriority)

    /** `pickTodaysReader`: a reader read today owns the day; otherwise the first UNREAD story in the reader queue. A read one never. */
    fun pickTodays(readers: List<ScheduledItem>, readToday: Set<String>): ScheduledItem? =
        DailyReader.pickTodays(readers, readToday.isNotEmpty(), ::offer)
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
     * ([lessonBreakDue]; the session passes no lessons since Oct 2026) → the cards (StudyQueue.selectNext) →
     * lessons left over → graded readers close out the session. "⚡ Study it today" cards
     * ([bumpedCardIds]) are mixed with the reviews inside StudyQueue.selectNext (Bumps.mixBumpedCard).
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
        /** Which card each unseen note starts with when not hanzi_to_meaning (LeadCard.kt, BuiltQueue.leadCards). */
        leadCards: Map<String, String> = emptyMap(),
        /** "Start new words by ear" (BuiltQueue.newWordsByEar). */
        newWordsByEar: Boolean = false,
        /** New words bumped during this session (core BumpNext): their lead card comes next. */
        nextUpIds: List<String> = emptyList(),
    ): SessionItem? {
        val learningDueNow = queue.any { CardQueue.isLearning(it.queue) && it.state.dueTimestamp.let { d -> d != null && d != 0L && d <= nowMs } }
        if (lessonBreakDue && lessons.isNotEmpty() && !learningDueNow && BumpNext.pickNextUp(queue, nextUpIds) { it.id } == null) return SessionItem.Lesson(lessons[0])
        StudyQueue.selectNext(queue, reviewedNoteIds, recentNoteIds, lastRatedCardId, nowMs, cutoff, random, bumpedCardIds, leadCards, newWordsByEar, nextUpIds)?.let { return SessionItem.Card(it) }
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
