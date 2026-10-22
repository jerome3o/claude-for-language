package dev.jeromeswannack.chineselearning.lab.core

import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * The Lab-only "today split" model: today's reader from the parity-tested selector
 * (pickTodaysReader); the hero's phrases and the study chip.
 */
class TodayPlanTest {
    private val zone = ZoneId.of("UTC")
    private val now = Js.parseDate("2026-09-27T12:00:00.000Z")
    private val cutoff = StudyCutoff(Js.parseDate("2026-09-27T23:59:59.999Z"))

    /** NEW, or scheduled (any other queue) to come back at [due]. */
    private fun item(id: String, queue: Int, due: Long? = null, @Suppress("UNUSED_PARAMETER") next: String? = null, created: String = "2026-09-01T00:00:00Z") =
        ScheduledItem(id, created, if (queue == CardQueue.NEW) RevisitState.INITIAL else RevisitState(RevisitState.SCHEDULED, due ?: 0L, 14.0, null, 1))


    @Test fun readerStatesFollowThePick() {
        val story = item("s", CardQueue.NEW)
        assertIs<TodayPlan.Reader.ToDo>(TodayPlan.reader(ReaderSchedule.pickTodays(listOf(story), emptySet()), readToday = false))
        // Read today: pickTodays offers nothing more today → Done.
        val readEvents = listOf(ItemEvent("r1", "s", Rating.GOOD, "2026-09-27T08:00:00.000Z"))
        val read = ScheduledItem("s", "2026-09-01T00:00:00Z", ReaderSchedule.state(readEvents))
        val readToday = ReaderSchedule.readToday(readEvents, now, zone)
        val picked = ReaderSchedule.pickTodays(listOf(read, item("other", CardQueue.NEW)), readToday)
        assertEquals(TodayPlan.Reader.Done, TodayPlan.reader(picked, readToday.isNotEmpty()))
        assertEquals(TodayPlan.Reader.None, TodayPlan.reader(null, readToday = false))
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
