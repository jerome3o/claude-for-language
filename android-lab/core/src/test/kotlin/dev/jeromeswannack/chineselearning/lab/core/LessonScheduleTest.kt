package dev.jeromeswannack.chineselearning.lab.core

import java.time.ZoneId
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/** The lesson / reader half of selectNextItem, and today's graded reader. */
class LessonScheduleTest {
    private val now = Js.parseDate("2026-09-27T12:00:00.000Z")
    private val cutoff = StudyCutoff(Js.parseDate("2026-09-27T23:59:59.999Z"))

    private fun fresh(id: String, created: String = "2026-09-01T00:00:00Z") = ScheduledItem(id, created, RevisitState.INITIAL)
    private fun read(id: String, created: String = "2026-09-01T00:00:00Z") =
        ScheduledItem(id, created, ReaderSchedule.state(listOf(ItemEvent("e-$id", id, Rating.GOOD, "2026-09-20T10:00:00.000Z"))))

    private fun card(id: String, queue: Int, due: Long? = null) =
        QueueCard(id, "n$id", "d", CardTypes.HANZI_TO_MEANING, CardScheduler.initialCardState().copy(queue = queue, dueTimestamp = due))

    @Test fun lessonBreakWaitsForLearningCardsDueNow() {
        val lesson = fresh("L")
        val due = SessionMix.next(listOf(card("c", CardQueue.LEARNING, now - 1)), listOf(lesson), emptyList(), true, emptySet(), emptyList(), null, null, now, cutoff, Random(1))
        assertIs<SessionItem.Card>(due)
        val brk = SessionMix.next(listOf(card("c", CardQueue.REVIEW)), listOf(lesson), emptyList(), true, emptySet(), emptyList(), null, null, now, cutoff, Random(1))
        assertEquals(SessionItem.Lesson(lesson), brk)
        val noBreak = SessionMix.next(listOf(card("c", CardQueue.REVIEW)), listOf(lesson), emptyList(), false, emptySet(), emptyList(), null, null, now, cutoff, Random(1))
        assertIs<SessionItem.Card>(noBreak)
    }

    @Test fun leftoverLessonsBeforeReadersAtTheEnd() {
        val lesson = fresh("L")
        val reader = fresh("R")
        assertEquals(SessionItem.Lesson(lesson), SessionMix.next(emptyList(), listOf(lesson), listOf(reader), false, emptySet(), emptyList(), null, null, now, cutoff, Random(1)))
        assertEquals(SessionItem.Reader(reader), SessionMix.next(emptyList(), emptyList(), listOf(reader), false, emptySet(), emptyList(), null, null, now, cutoff, Random(1)))
        assertNull(SessionMix.next(emptyList(), emptyList(), emptyList(), true, emptySet(), emptyList(), null, null, now, cutoff, Random(1)))
    }

    @Test fun readerPickIsOneUnreadADayNeverARepeat() {
        val newer = fresh("newer", "2026-09-20T00:00:00Z")
        val older = fresh("older", "2026-09-10T00:00:00Z")
        assertEquals("newer", ReaderSchedule.pickTodays(listOf(older, newer), emptySet())?.id)
        // A story that was read is never offered again.
        assertNull(ReaderSchedule.pickTodays(listOf(read("a"), read("b", "2026-09-30T00:00:00Z")), emptySet()))
        assertEquals("older", ReaderSchedule.pickTodays(listOf(read("newest", "2026-09-30T00:00:00Z"), older), emptySet())?.id)
        // Read today: nothing more today.
        assertNull(ReaderSchedule.pickTodays(listOf(newer), setOf("x")))
        // A reader's state: unread = NEW; read = never due.
        assertEquals(RevisitState.INITIAL, ReaderSchedule.state(emptyList()))
        assertNull(read("r").state.dueMs)
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
