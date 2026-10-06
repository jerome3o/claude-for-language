package dev.jeromeswannack.chineselearning.lab.core

import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * The Lab-only "today split" model: counts come from the parity-tested selectors
 * (dueLessons, pickTodaysReader), in their order; done states; the new-lesson slots per day.
 */
class TodayPlanTest {
    private val zone = ZoneId.of("UTC")
    private val now = Js.parseDate("2026-09-27T12:00:00.000Z")
    private val cutoff = StudyCutoff(Js.parseDate("2026-09-27T23:59:59.999Z"))

    /** NEW, or scheduled (any other queue) to come back at [due]. */
    private fun item(id: String, queue: Int, due: Long? = null, @Suppress("UNUSED_PARAMETER") next: String? = null, created: String = "2026-09-01T00:00:00Z") =
        ScheduledItem(id, created, if (queue == CardQueue.NEW) RevisitState.INITIAL else RevisitState(RevisitState.SCHEDULED, due ?: 0L, 14.0, null, 1))

    /** A lesson replayed from its events, like LessonStore does. */
    private fun replayed(id: String, events: List<ItemEvent>, created: String = "2026-09-01T00:00:00Z") =
        ScheduledItem(id, created, ItemSchedule.state(events))

    @Test fun lessonsToDoAreDueLessonsInTheirOrder() {
        val lessons = listOf(
            item("new2", CardQueue.NEW, created = "2026-09-02T00:00:00Z"),
            item("new1", CardQueue.NEW, created = "2026-09-01T00:00:00Z"),
            item("new3", CardQueue.NEW, created = "2026-09-03T00:00:00Z"),
            item("learning", CardQueue.REVIEW, due = now - 60_000),
            item("review", CardQueue.REVIEW, due = now, next = "2026-09-27T09:00:00.000Z"),
            item("later", CardQueue.REVIEW, due = now + 5 * 86_400_000L, next = "2026-10-02T09:00:00.000Z"),
            item("homework", CardQueue.NEW, created = "2026-08-01T00:00:00Z"),
        )
        val plan = TodayPlan.lessons(lessons, emptyList(), setOf("homework"), cutoff, now, zone)
        val selector = LessonSchedule.dueLessons(lessons, setOf("homework"), cutoff)
        assertEquals(selector.map { it.id }, plan.toDo.map { it.id }) // nothing started today: exactly the selector
        assertEquals(listOf("learning", "review", "new1", "new2"), plan.toDo.map { it.id })
        assertEquals(emptyList(), plan.done)
        assertFalse(plan.isDone)
    }

    @Test fun aNewLessonStartedTodayTakesOneOfTheDaysSlots() {
        // new1 was done this morning and rated Easy → REVIEW in a few days: done, not due.
        val ev = listOf(ItemEvent("e1", "new1", Rating.EASY, "2026-09-27T08:00:00.000Z"))
        val lessons = listOf(
            replayed("new1", ev),
            item("new2", CardQueue.NEW, created = "2026-09-02T00:00:00Z"),
            item("new3", CardQueue.NEW, created = "2026-09-03T00:00:00Z"),
        )
        val plan = TodayPlan.lessons(lessons, ev, emptySet(), cutoff, now, zone)
        // The selector alone would offer new2 AND new3; the day has one slot left.
        assertEquals(listOf("new2", "new3"), LessonSchedule.dueLessons(lessons, emptySet(), cutoff).map { it.id })
        assertEquals(listOf("new2"), plan.toDo.map { it.id })
        assertEquals(listOf("new1"), plan.done)
        assertEquals(2, plan.total)
    }

    @Test fun bothSlotsUsedMeansLessonsAreDoneForToday() {
        val ev = listOf(
            ItemEvent("e1", "a", Rating.EASY, "2026-09-27T08:00:00.000Z"),
            ItemEvent("e2", "b", Rating.EASY, "2026-09-27T09:00:00.000Z"),
        )
        val lessons = listOf(replayed("a", ev.take(1)), replayed("b", ev.drop(1)), item("c", CardQueue.NEW))
        val plan = TodayPlan.lessons(lessons, ev, emptySet(), cutoff, now, zone)
        assertEquals(emptyList(), plan.toDo)
        assertEquals(listOf("a", "b"), plan.done)
        assertTrue(plan.isDone)
    }

    @Test fun aLessonRatedAgainIsDoneForTodayAndBackTomorrow() {
        // "Revisit later": even Again brings it back tomorrow at the soonest, never the same day.
        val ev = listOf(ItemEvent("e1", "a", Rating.AGAIN, "2026-09-27T11:55:00.000Z"))
        val lessons = listOf(replayed("a", ev), item("b", CardQueue.NEW))
        val plan = TodayPlan.lessons(lessons, ev, emptySet(), cutoff, now, zone)
        assertEquals(listOf("b"), plan.toDo.map { it.id })
        assertEquals(listOf("a"), plan.done)
    }

    @Test fun overdueRevisitsComeBackTwoADay() {
        val ev = listOf(
            ItemEvent("o1", "r1", Rating.GOOD, "2026-08-01T08:00:00.000Z"),
            ItemEvent("o2", "r2", Rating.GOOD, "2026-08-02T08:00:00.000Z"),
            ItemEvent("o3", "r3", Rating.GOOD, "2026-08-03T08:00:00.000Z"),
            ItemEvent("o4", "r4", Rating.GOOD, "2026-08-10T08:00:00.000Z"),
            ItemEvent("t4", "r4", Rating.GOOD, "2026-09-27T08:00:00.000Z"), // revisited this morning
        )
        val lessons = listOf("r1", "r2", "r3", "r4").map { id -> replayed(id, ev.filter { it.itemId == id }) }
        val plan = TodayPlan.lessons(lessons, ev, emptySet(), cutoff, now, zone)
        assertEquals(listOf("r1"), plan.toDo.map { it.id }) // one slot left, most overdue first
        assertEquals(listOf("r4"), plan.done)
    }

    @Test fun anOldLessonReviewedTodayDoesNotUseANewSlot() {
        val ev = listOf(
            ItemEvent("old", "r", Rating.GOOD, "2026-09-01T08:00:00.000Z"),
            ItemEvent("today", "r", Rating.EASY, "2026-09-27T08:00:00.000Z"),
        )
        val lessons = listOf(replayed("r", ev), item("n1", CardQueue.NEW), item("n2", CardQueue.NEW, created = "2026-09-02T00:00:00Z"))
        val plan = TodayPlan.lessons(lessons, ev, emptySet(), cutoff, now, zone)
        assertEquals(listOf("n1", "n2"), plan.toDo.map { it.id })
        assertEquals(listOf("r"), plan.done)
    }

    @Test fun homeworkOnlyLessonsNeverCount() {
        val ev = listOf(ItemEvent("e1", "hw", Rating.EASY, "2026-09-27T08:00:00.000Z"))
        val lessons = listOf(replayed("hw", ev), item("n1", CardQueue.NEW), item("n2", CardQueue.NEW, created = "2026-09-02T00:00:00Z"))
        val plan = TodayPlan.lessons(lessons, ev, setOf("hw"), cutoff, now, zone)
        assertEquals(listOf("n1", "n2"), plan.toDo.map { it.id }) // no slot taken
        assertEquals(emptyList(), plan.done)
    }

    @Test fun readerStatesFollowThePick() {
        val story = item("s", CardQueue.NEW)
        assertIs<TodayPlan.Reader.ToDo>(TodayPlan.reader(ReaderSchedule.pickTodays(listOf(story), emptySet(), cutoff), readToday = false))
        // Read today: pickTodays offers nothing more today → Done.
        val read = replayed("s", listOf(ItemEvent("r1", "s", Rating.EASY, "2026-09-27T08:00:00.000Z")))
        val readToday = ReaderSchedule.readToday(listOf(ItemEvent("r1", "s", Rating.EASY, "2026-09-27T08:00:00.000Z")), now, zone)
        val picked = ReaderSchedule.pickTodays(listOf(read, item("other", CardQueue.NEW)), readToday, cutoff)
        assertEquals(TodayPlan.Reader.Done, TodayPlan.reader(picked, readToday.isNotEmpty()))
        assertEquals(TodayPlan.Reader.None, TodayPlan.reader(null, readToday = false))
    }

    @Test fun todayCountsAndKinds() {
        val lessons = TodayPlan.Lessons(listOf(item("a", CardQueue.NEW), item("b", CardQueue.NEW)), listOf("c"))
        val t = TodayPlan.Today(cardsDue = 24, cardsReviewed = 10, lessons = lessons, reader = TodayPlan.Reader.ToDo(item("s", CardQueue.NEW)))
        assertEquals(3, t.extrasLeft)
        assertEquals(3, t.kinds)
        assertEquals(0, t.kindsDone)
        assertFalse(t.allClear)
        val cleared = TodayPlan.Today(0, 40, TodayPlan.Lessons(emptyList(), listOf("a", "b")), TodayPlan.Reader.Done)
        assertTrue(cleared.allClear)
        assertEquals(3, cleared.kindsDone)
        val noExtras = TodayPlan.Today(0, 12, TodayPlan.Lessons(emptyList(), emptyList()), TodayPlan.Reader.None)
        assertEquals(1, noExtras.kinds)
        assertTrue(noExtras.allClear)
    }

    @Test fun phrasesAndChip() {
        assertEquals("2 mini lessons and today's story", TodayPlan.extrasPhrase(2, true))
        assertEquals("1 mini lesson", TodayPlan.extrasPhrase(1, false))
        assertEquals("today's story", TodayPlan.extrasPhrase(0, true))
        assertEquals("", TodayPlan.extrasPhrase(0, false))
        assertEquals("📘2 📖1", TodayPlan.chip(2, true))
        assertEquals("📖1", TodayPlan.chip(0, true))
        assertEquals("", TodayPlan.chip(0, false))
        assertEquals(8, TodayPlan.minutes(24))
        assertEquals(1, TodayPlan.minutes(1))
    }
}
