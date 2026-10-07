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
 * Lessons come back on the "revisit later" schedule ([Revisit], shared/study/revisit.ts): the
 * rating after finishing sets the gap (Again 1 day · Hard 2 · Good 14 · Easy 42, growing each
 * later visit), "Done for good" retires one; NEW lessons are paced per local DAY ("New lessons a
 * day", default 1). Graded readers are read ONCE ([DailyReader], shared/study/daily-reader.ts):
 * one unread story a day, never a repeat. State is replayed from the events — never stored.
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
    /** `LESSON_MIX_INTERVAL`: a lesson is offered after this many card reviews. */
    const val MIX_INTERVAL = 8

    /**
     * `getDueCustomLessons`: revisits due by the cutoff, most overdue first, at most
     * [Revisit.MAX_LESSON_REVISITS_PER_DAY] a day minus [revisitedToday] (`pickRevisitsForToday`;
     * they never count against the new-lesson budget), then NEW lessons oldest first
     * (`pickNewLessonsForToday`): [newPerDay] ("New lessons a day", default 1) minus the lessons
     * [introducedToday] (first-ever finish today — [introducedToday]). Done-for-good lessons and
     * lessons assigned one-off only (homework) never join the rotation.
     */
    fun dueLessons(
        lessons: List<ScheduledItem>,
        oneOffOnly: Set<String>,
        cutoff: StudyCutoff,
        revisitedToday: Int = 0,
        introducedToday: Int = 0,
        newPerDay: Int = Revisit.DEFAULT.newLessonsPerDayInt,
    ): List<ScheduledItem> {
        val pool = lessons.filter { it.id !in oneOffOnly && !it.retired }
        val fresh = Revisit.pickNewForToday(pool.filter { it.queue == CardQueue.NEW }, { it.id }, { it.createdAt }, introducedToday, newPerDay)
        val due = Revisit.pickForToday(pool.filter { it.queue != CardQueue.NEW }.map { it to it.state }, cutoff.ts, revisitedToday)
        return due + fresh
    }

    /** `newLessonsToday`: lessons first finished on today's LOCAL date (one-off homework left out). */
    fun introducedToday(events: List<ItemEvent>, nowMs: Long, zone: ZoneId, exclude: Set<String> = emptySet()): Int {
        val dayStart = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()
        return Revisit.newLessonsIntroducedToday(events.map { it.itemId to it.at }, dayStart, exclude)
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
    const val READERS_PER_DAY = DailyReader.READERS_PER_DAY

    /** `readersReadToday`: readers with a review on today's LOCAL date. */
    fun readToday(events: List<ItemEvent>, nowMs: Long, zone: ZoneId): Set<String> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return events.filter { runCatching { Instant.ofEpochMilli(Js.parseDate(it.at)).atZone(zone).toLocalDate() }.getOrNull() == today }.mapTo(HashSet()) { it.itemId }
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

    private fun offer(r: ScheduledItem) = ReaderOffer(r.id, r.createdAt, r.studyable, !r.state.isNew)

    /** `pickTodaysReader`: a reader read today owns the day; otherwise the newest UNREAD story. A read one never. */
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
