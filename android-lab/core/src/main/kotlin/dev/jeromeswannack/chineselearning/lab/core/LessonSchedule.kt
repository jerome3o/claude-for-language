package dev.jeromeswannack.chineselearning.lab.core

import java.time.Instant
import java.time.ZoneId
import kotlin.random.Random

/**
 * Mini lessons and graded readers in the study session — ports of
 * frontend/src/services/custom-lesson-study.ts (getDueCustomLessons),
 * services/reader-study.ts (pickTodaysReader, readersReadToday) and the lesson / reader
 * branches of selectNextItem in hooks/useStudySession.ts.
 *
 * Both are scheduled like cards: FSRS state is replayed from their completion / review
 * events with the card scheduler ("the lesson is the card").
 */

/** A lesson completion or reader review, as the scheduler sees it. Null rating = Good (legacy). */
data class ItemEvent(val id: String, val itemId: String, val rating: Int?, val at: String)

/** A lesson or reader with its replayed state. */
data class ScheduledItem(
    val id: String,
    val createdAt: String,
    val state: ComputedCardState,
    /** Readers only: generation finished ('ready') and it has pages. */
    val studyable: Boolean = true,
) {
    val queue: Int get() = state.queue
}

object ItemSchedule {
    /** `computeLessonState` / `computeReaderState`: replay the events sorted by time. */
    fun state(events: List<ItemEvent>): ComputedCardState {
        if (events.isEmpty()) return CardScheduler.initialCardState()
        val sorted = events.sortedBy { it.at }
        return CardScheduler.computeCardState(sorted.map { ReviewEventInput(it.id, it.itemId, it.rating ?: Rating.GOOD, it.at) })
    }

    /** A rating recorded now (`applyReview` on the replayed state). */
    fun afterRating(events: List<ItemEvent>, rating: Int, at: String): ComputedCardState = CardScheduler.applyReview(state(events), rating, at)
}

object LessonSchedule {
    /** `MAX_NEW_LESSONS_PER_SESSION`. */
    const val MAX_NEW_PER_SESSION = 2

    /** `LESSON_MIX_INTERVAL`: a lesson is offered after this many card reviews. */
    const val MIX_INTERVAL = 8

    /**
     * `getDueCustomLessons`: learning / review lessons due by the cutoff (learning-due first,
     * by due time), then NEW lessons oldest first, at most [MAX_NEW_PER_SESSION]. Lessons
     * assigned one-off only (homework) never join the rotation.
     */
    fun dueLessons(lessons: List<ScheduledItem>, oneOffOnly: Set<String>, cutoff: StudyCutoff): List<ScheduledItem> {
        val cutoffIso = Js.toIsoString(cutoff.ts)
        val due = ArrayList<ScheduledItem>()
        val fresh = ArrayList<ScheduledItem>()
        for (lesson in lessons) {
            if (lesson.id in oneOffOnly) continue
            when (lesson.queue) {
                CardQueue.NEW -> fresh += lesson
                CardQueue.LEARNING, CardQueue.RELEARNING -> if (lesson.state.dueTimestamp.let { it == null || it == 0L || it <= cutoff.ts }) due += lesson
                CardQueue.REVIEW -> if (lesson.state.nextReviewAt.let { it.isNullOrEmpty() || it <= cutoffIso }) due += lesson
            }
        }
        return due.sortedBy { it.state.dueTimestamp ?: 0L } + fresh.sortedBy { it.createdAt }.take(MAX_NEW_PER_SESSION)
    }

    /** Mini Lessons page: new / learning / due by the cutoff = "Up next", else "Scheduled". */
    fun isUpNext(state: ComputedCardState, cutoff: StudyCutoff): Boolean {
        if (state.queue != CardQueue.REVIEW) return true
        val next = state.nextReviewAt
        return next.isNullOrEmpty() || next <= Js.toIsoString(cutoff.ts)
    }
}

object ReaderSchedule {
    /** `READERS_PER_DAY`: one graded reader a day. */
    const val READERS_PER_DAY = 1

    /** `readersReadToday`: readers with a review on today's LOCAL date. */
    fun readToday(events: List<ItemEvent>, nowMs: Long, zone: ZoneId): Set<String> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return events.filter { Instant.ofEpochMilli(Js.parseDate(it.at)).atZone(zone).toLocalDate() == today }.mapTo(HashSet()) { it.itemId }
    }

    private fun learningDueBy(r: ScheduledItem, cutoffTs: Long) =
        CardQueue.isLearning(r.queue) && r.state.dueTimestamp.let { it == null || it == 0L || it <= cutoffTs }

    /**
     * `pickTodaysReader`: a reader read today owns the day (offered again only while it is a
     * learning repeat due by the cutoff); otherwise the earliest learning repeat, else the
     * most overdue review, else the newest unread story.
     */
    fun pickTodays(readers: List<ScheduledItem>, readToday: Set<String>, cutoff: StudyCutoff): ScheduledItem? {
        val studyable = readers.filter { it.studyable }
        if (readToday.isNotEmpty()) {
            return studyable.filter { it.id in readToday && learningDueBy(it, cutoff.ts) }.sortedBy { it.state.dueTimestamp ?: 0L }.firstOrNull()
        }
        studyable.filter { learningDueBy(it, cutoff.ts) }.sortedBy { it.state.dueTimestamp ?: 0L }.firstOrNull()?.let { return it }
        val cutoffIso = Js.toIsoString(cutoff.ts)
        studyable.filter { it.queue == CardQueue.REVIEW && it.state.nextReviewAt.let { n -> n.isNullOrEmpty() || n <= cutoffIso } }
            .sortedBy { it.state.nextReviewAt ?: "" }.firstOrNull()?.let { return it }
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
        val learningDue = readers.filter { CardQueue.isLearning(it.queue) && it.state.dueTimestamp.let { d -> d != null && d != 0L && d <= nowMs } }
        if (learningDue.isNotEmpty()) return learningDue.firstOrNull { it.id != lastRatedReaderId } ?: learningDue[0]
        val fresh = readers.filter { it.queue == CardQueue.NEW || it.queue == CardQueue.REVIEW }
        if (fresh.isNotEmpty()) return fresh[random.nextInt(fresh.size)]
        val cooldown = readers.filter { CardQueue.isLearning(it.queue) && it.state.dueTimestamp.let { d -> d == null || d == 0L || d <= cutoff.ts } }
            .sortedBy { it.state.dueTimestamp ?: 0L }
        if (cooldown.isNotEmpty()) return cooldown.firstOrNull { it.id != lastRatedReaderId } ?: cooldown[0]
        return null
    }
}
