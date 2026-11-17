package dev.jeromeswannack.chineselearning.lab.ui.progress

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Mastery
import dev.jeromeswannack.chineselearning.lab.core.Progress
import dev.jeromeswannack.chineselearning.lab.core.ProgressEvent
import dev.jeromeswannack.chineselearning.lab.core.Streak
import dev.jeromeswannack.chineselearning.lab.core.StudyDay
import dev.jeromeswannack.chineselearning.lab.data.progress.ProgressSnapshot
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.assertEquals

/**
 * The Progress tab's 30 bars follow "New day starts at" (17 Nov 2026: at 00:44 with a 4 am rollover
 * the chart ended on an empty bar for the UTC date — tomorrow — and tonight's reviews sat one bar to
 * its left). The rows are keyed by study day (ProgressStore's shift = offset − rollover), so the
 * last bar must be today's STUDY day.
 */
class ProgressBarsStudyDayTest {
    private val london: ZoneId = ZoneId.of("Europe/London")

    private fun at(iso: String) = Js.parseDate(iso)

    private fun snapshotAt(now: Long, zone: ZoneId, rollover: Int, events: List<ProgressEvent>): ProgressSnapshot {
        val shift = StudyDay.shiftMinutes(StudyDay.utcOffsetMinutes(now, zone), rollover)
        return ProgressSnapshot(
            daily = Progress.dailyProgress(events, now, shift),
            streak = Streak.studyStreak(events, now, zone, rollover),
            overall = Mastery.progress(emptyList()),
            decks = emptyList(),
            totalReviews = events.size,
        )
    }

    private fun ev(card: String, iso: String) = ProgressEvent(card, 2, iso, 5_000L, null)

    @Test
    fun afterMidnightBeforeTheRollover_lastBarIsYesterdaysStudyDay() {
        val now = at("2026-11-17T00:44:00.000Z") // 00:44 GMT
        val events = listOf(
            ev("a", "2026-11-16T18:00:00.000Z"), // 18:00 yesterday evening: today's study day
            ev("b", "2026-11-16T23:30:00.000Z"),
            ev("b", "2026-11-17T00:40:00.000Z"),
            ev("c", "2026-11-16T03:59:00.000Z"), // before the 4 am rollover: the day before
        )
        val today = StudyDay.date(now, 4, london)
        assertEquals(LocalDate.parse("2026-11-16"), today)
        val bars = barsFor(snapshotAt(now, london, 4, events), today)
        assertEquals(30, bars.size)
        assertEquals("2026-11-16", bars.last().date)
        assertEquals(3, bars.last().reviews)
        assertEquals("2026-11-15", bars[28].date)
        assertEquals(1, bars[28].reviews)
        // The streak's "today" agrees (core Streak, the same study day).
        assertEquals(3, snapshotAt(now, london, 4, events).streak.today.reviews)
    }

    @Test
    fun afterTheRollover_aNewDay() {
        val now = at("2026-11-17T04:01:00.000Z")
        val events = listOf(ev("a", "2026-11-16T18:00:00.000Z"), ev("a", "2026-11-17T04:00:30.000Z"))
        val today = StudyDay.date(now, 4, london)
        assertEquals(LocalDate.parse("2026-11-17"), today)
        val bars = barsFor(snapshotAt(now, london, 4, events), today)
        assertEquals("2026-11-17", bars.last().date)
        assertEquals(1, bars.last().reviews)
        assertEquals(1, bars[28].reviews)
    }

    @Test
    fun fallBackNight_theStudyDayIs25Hours() {
        // 25 Oct 2026: BST ends at 02:00 BST (01:00 UTC). 01:30 UTC = 01:30 GMT, still the 24th's study day
        // (24 Oct 04:00 BST → 25 Oct 04:00 GMT). The rows use the offset NOW (fixed, like the server's SQL),
        // so events are kept clear of the hour that moved.
        val now = at("2026-10-25T01:30:00.000Z")
        val events = listOf(
            ev("a", "2026-10-24T12:00:00.000Z"), // midday on the 24th: in
            ev("b", "2026-10-24T01:00:00.000Z"), // 02:00 BST on the 24th: the 23rd's study day
            ev("c", "2026-10-25T00:30:00.000Z"), // 01:30 BST (the first one): in
        )
        assertEquals(at("2026-10-24T03:00:00.000Z"), StudyDay.at(now, 4, london).startMs)
        assertEquals(at("2026-10-25T04:00:00.000Z"), StudyDay.at(now, 4, london).endMs)
        val today = StudyDay.date(now, 4, london)
        assertEquals(LocalDate.parse("2026-10-24"), today)
        val bars = barsFor(snapshotAt(now, london, 4, events), today)
        assertEquals("2026-10-24", bars.last().date)
        assertEquals(2, bars.last().reviews)
        assertEquals(1, bars[28].reviews)
    }
}
