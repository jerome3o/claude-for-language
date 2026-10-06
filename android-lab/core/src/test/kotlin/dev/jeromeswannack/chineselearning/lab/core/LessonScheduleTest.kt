package dev.jeromeswannack.chineselearning.lab.core

import java.time.ZoneId
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** getDueCustomLessons on the "revisit later" schedule, the lesson / reader half of selectNextItem, replay. */
class LessonScheduleTest {
    private val now = Js.parseDate("2026-09-27T12:00:00.000Z")
    private val cutoff = StudyCutoff(Js.parseDate("2026-09-27T23:59:59.999Z"))
    private val day = 86_400_000L

    private fun fresh(id: String, created: String = "2026-09-01T00:00:00Z") = ScheduledItem(id, created, RevisitState.INITIAL)
    private fun due(id: String, dueMs: Long) = ScheduledItem(id, "2026-09-01T00:00:00Z", RevisitState(RevisitState.SCHEDULED, dueMs, 14.0, dueMs - 14 * day, 1))
    private fun retired(id: String) = ScheduledItem(id, "2026-09-01T00:00:00Z", RevisitState(RevisitState.RETIRED, null, 14.0, null, 1))

    private fun card(id: String, queue: Int, due: Long? = null) =
        QueueCard(id, "n$id", "d", CardTypes.HANZI_TO_MEANING, CardScheduler.initialCardState().copy(queue = queue, dueTimestamp = due))

    @Test fun dueLessonsMostOverdueFirstCappedThenNew() {
        val lessons = listOf(
            fresh("new3", "2026-09-03T00:00:00Z"),
            fresh("new1", "2026-09-01T00:00:00Z"),
            fresh("new2", "2026-09-02T00:00:00Z"),
            due("dueToday", now + 3_600_000),
            due("overdue", now - 10 * day),
            due("lessOverdue", now - 2 * day),
            due("tomorrow", cutoff.ts + 1),
            retired("doneForGood"),
            fresh("homework", "2026-08-01T00:00:00Z"),
        )
        val due = LessonSchedule.dueLessons(lessons, oneOffOnly = setOf("homework"), cutoff = cutoff)
        // Two revisits a day (most overdue first), then two new ones; retired and homework never.
        assertEquals(listOf("overdue", "lessOverdue", "new1", "new2"), due.map { it.id })
        // One revisit already done today: one more.
        assertEquals(listOf("overdue", "new1", "new2"), LessonSchedule.dueLessons(lessons, setOf("homework"), cutoff, revisitedToday = 1).map { it.id })
        assertEquals(listOf("new1", "new2"), LessonSchedule.dueLessons(lessons, setOf("homework"), cutoff, revisitedToday = 5).map { it.id })
    }

    @Test fun completionsReplayOnTheRevisitSchedule() {
        val events = listOf(
            ItemEvent("b", "l", Rating.GOOD, "2026-09-20T10:00:00.000Z"),
            ItemEvent("a", "l", null, "2026-09-19T10:00:00.000Z"), // legacy: Good
        )
        val st = ItemSchedule.state(events)
        assertEquals(RevisitState.SCHEDULED, st.status)
        assertEquals(28.0, st.gapDays) // 14, then ×2
        assertEquals(Js.parseDate("2026-10-18T10:00:00.000Z"), st.dueMs)
        assertEquals(RevisitState.INITIAL, ItemSchedule.state(emptyList()))
        // Done for good, then Bring back: due at the restore, the grown gap kept.
        val marks = listOf(
            RevisitMark("r1", "lesson", "l", "retire", "2026-09-21T10:00:00.000Z"),
            RevisitMark("r2", "lesson", "l", "restore", "2026-09-22T10:00:00.000Z"),
        )
        assertEquals(RevisitState.RETIRED, ItemSchedule.state(events, marks.take(1)).status)
        val back = ItemSchedule.state(events, marks)
        assertEquals(Js.parseDate("2026-09-22T10:00:00.000Z"), back.dueMs)
        assertEquals(28.0, back.gapDays)
        // Custom gaps from Settings.
        val custom = RevisitSettings(hardDays = 1.0, goodDays = 7.0, easyDays = 21.0, growth = 1.5, capDays = 90.0)
        assertEquals(10.5, ItemSchedule.state(events, settings = custom).gapDays)
        assertEquals(listOf("1 day", "5 wk", "8 wk", "8 wk"), ItemSchedule.previews(st).map { it.intervalText })
    }

    @Test fun revisitsTodayCountsOnlyRepeatFinishesOnTheLocalDate() {
        val zone = ZoneId.of("UTC")
        val events = listOf(
            ItemEvent("1", "a", 2, "2026-09-10T10:00:00.000Z"),
            ItemEvent("2", "a", 2, "2026-09-27T08:00:00.000Z"), // a revisit today
            ItemEvent("3", "b", 2, "2026-09-27T09:00:00.000Z"), // b's first finish: not a revisit
            ItemEvent("4", "c", 2, "2026-09-01T09:00:00.000Z"),
            ItemEvent("5", "c", 2, "2026-09-27T07:00:00.000Z"),
            ItemEvent("6", "c", 2, "2026-09-27T11:00:00.000Z"),
        )
        assertEquals(2, LessonSchedule.revisitsToday(events, now, zone))
    }

    @Test fun upNext() {
        assertTrue(LessonSchedule.isUpNext(RevisitState.INITIAL, cutoff))
        assertTrue(LessonSchedule.isUpNext(due("d", now).state, cutoff))
        assertEquals(false, LessonSchedule.isUpNext(due("d", cutoff.ts + 1).state, cutoff))
        assertEquals(false, LessonSchedule.isUpNext(retired("r").state, cutoff))
    }

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

    @Test fun readerPickIsOneADayNeverRetired() {
        val newer = fresh("newer", "2026-09-20T00:00:00Z")
        val older = fresh("older", "2026-09-10T00:00:00Z")
        assertEquals("newer", ReaderSchedule.pickTodays(listOf(older, newer), emptySet(), cutoff)?.id)
        assertEquals("overdue", ReaderSchedule.pickTodays(listOf(newer, due("soon", now), due("overdue", now - 3 * day)), emptySet(), cutoff)?.id)
        assertNull(ReaderSchedule.pickTodays(listOf(retired("r")), emptySet(), cutoff))
        // Read today (even rated Again): nothing more today.
        assertNull(ReaderSchedule.pickTodays(listOf(newer, due("overdue", now - day)), setOf("x"), cutoff))
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
