package dev.jeromeswannack.chineselearning.lab.core

import java.time.ZoneId
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/** getDueCustomLessons, the lesson / reader half of selectNextItem, completion replay. */
class LessonScheduleTest {
    private val now = Js.parseDate("2026-09-27T12:00:00.000Z")
    private val cutoff = StudyCutoff(Js.parseDate("2026-09-27T23:59:59.999Z"))

    private fun item(id: String, queue: Int, due: Long? = null, next: String? = null, created: String = "2026-09-01T00:00:00Z") =
        ScheduledItem(id, created, CardScheduler.initialCardState().copy(queue = queue, dueTimestamp = due, nextReviewAt = next))

    private fun card(id: String, queue: Int, due: Long? = null) =
        QueueCard(id, "n$id", "d", CardTypes.HANZI_TO_MEANING, CardScheduler.initialCardState().copy(queue = queue, dueTimestamp = due))

    @Test fun dueLessonsOrderAndNewCap() {
        val lessons = listOf(
            item("new3", CardQueue.NEW, created = "2026-09-03T00:00:00Z"),
            item("new1", CardQueue.NEW, created = "2026-09-01T00:00:00Z"),
            item("new2", CardQueue.NEW, created = "2026-09-02T00:00:00Z"),
            item("learnLater", CardQueue.LEARNING, due = now + 3_600_000),
            item("learnSoon", CardQueue.LEARNING, due = now - 60_000),
            item("learnTomorrow", CardQueue.LEARNING, due = cutoff.ts + 1),
            item("reviewDue", CardQueue.REVIEW, due = now, next = "2026-09-27T09:00:00.000Z"),
            item("reviewLater", CardQueue.REVIEW, due = now + 5 * 86_400_000L, next = "2026-10-02T09:00:00.000Z"),
            item("homework", CardQueue.NEW, created = "2026-08-01T00:00:00Z"),
        )
        val due = LessonSchedule.dueLessons(lessons, oneOffOnly = setOf("homework"), cutoff = cutoff)
        assertEquals(listOf("learnSoon", "reviewDue", "learnLater", "new1", "new2"), due.map { it.id })
    }

    @Test fun completionsReplayLikeCards() {
        val events = listOf(
            ItemEvent("b", "l", Rating.GOOD, "2026-09-20T10:00:00.000Z"),
            ItemEvent("a", "l", null, "2026-09-19T10:00:00.000Z"), // legacy: Good
        )
        val direct = CardScheduler.computeCardState(listOf(
            ReviewEventInput("a", "l", Rating.GOOD, "2026-09-19T10:00:00.000Z"),
            ReviewEventInput("b", "l", Rating.GOOD, "2026-09-20T10:00:00.000Z"),
        ))
        assertEquals(direct, ItemSchedule.state(events))
        assertEquals(CardQueue.NEW, ItemSchedule.state(emptyList()).queue)
    }

    @Test fun lessonBreakWaitsForLearningCardsDueNow() {
        val lesson = item("L", CardQueue.NEW)
        val due = SessionMix.next(listOf(card("c", CardQueue.LEARNING, now - 1)), listOf(lesson), emptyList(), true, emptySet(), emptyList(), null, null, now, cutoff, Random(1))
        assertIs<SessionItem.Card>(due)
        val brk = SessionMix.next(listOf(card("c", CardQueue.REVIEW)), listOf(lesson), emptyList(), true, emptySet(), emptyList(), null, null, now, cutoff, Random(1))
        assertEquals(SessionItem.Lesson(lesson), brk)
        val noBreak = SessionMix.next(listOf(card("c", CardQueue.REVIEW)), listOf(lesson), emptyList(), false, emptySet(), emptyList(), null, null, now, cutoff, Random(1))
        assertIs<SessionItem.Card>(noBreak)
    }

    @Test fun leftoverLessonsBeforeReadersAtTheEnd() {
        val lesson = item("L", CardQueue.NEW)
        val reader = item("R", CardQueue.NEW)
        assertEquals(SessionItem.Lesson(lesson), SessionMix.next(emptyList(), listOf(lesson), listOf(reader), false, emptySet(), emptyList(), null, null, now, cutoff, Random(1)))
        assertEquals(SessionItem.Reader(reader), SessionMix.next(emptyList(), emptyList(), listOf(reader), false, emptySet(), emptyList(), null, null, now, cutoff, Random(1)))
        assertNull(SessionMix.next(emptyList(), emptyList(), emptyList(), true, emptySet(), emptyList(), null, null, now, cutoff, Random(1)))
    }

    @Test fun readerCooldownPrefersAnotherStory() {
        val a = item("a", CardQueue.LEARNING, due = now + 60_000)
        val b = item("b", CardQueue.LEARNING, due = now + 120_000)
        assertEquals("b", SessionMix.nextReader(listOf(a, b), "a", now, cutoff, Random(1))?.id)
        assertEquals("a", SessionMix.nextReader(listOf(a), "a", now, cutoff, Random(1))?.id)
    }

    @Test fun readTodayUsesTheLocalDate() {
        val zone = ZoneId.of("Pacific/Auckland") // UTC+12/13: 2026-09-27T12:00Z is 28 Sep locally
        val events = listOf(
            ItemEvent("1", "yesterdayLocal", 2, "2026-09-27T10:00:00.000Z"), // 23:00 on 27 Sep in NZ (UTC+13 after the DST switch)
            ItemEvent("2", "todayLocal", 2, "2026-09-27T11:30:00.000Z"), // 00:30 on 28 Sep
            ItemEvent("3", "old", 2, "2026-09-20T11:30:00.000Z"),
        )
        val today = ReaderSchedule.readToday(events, now, zone)
        assertEquals(setOf("todayLocal"), today)
    }
}
