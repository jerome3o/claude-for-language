package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeQuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.PillsDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyStatusDto
import dev.jeromeswannack.chineselearning.lab.data.api.TodayStatsDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Pure logic of the tutor screens: the format.ts port, thread grouping, status lines, sheet copy. */
class TeachingLogicTest {
    private val nz = ZoneId.of("Pacific/Auckland")
    private val now = Instant.parse("2026-09-27T09:30:00Z") // 22:30 in Auckland

    @Test fun relativeTimeMatchesTheWeb() {
        assertEquals("never", TeachingFormat.relativeTime(null, now, nz))
        assertEquals("just now", TeachingFormat.relativeTime("2026-09-27T09:29:40Z", now, nz))
        assertEquals("5 min ago", TeachingFormat.relativeTime("2026-09-27 09:25:00", now, nz)) // SQLite shape = UTC
        assertEquals("1 hour ago", TeachingFormat.relativeTime("2026-09-27T08:20:00Z", now, nz))
        assertEquals("3 days ago", TeachingFormat.relativeTime("2026-09-24T09:30:00Z", now, nz))
        assertEquals("3 weeks ago", TeachingFormat.relativeTime("2026-09-06T09:30:00Z", now, nz))
        assertEquals("Jun 1", TeachingFormat.relativeTime("2026-06-01T09:30:00Z", now, nz))
    }

    @Test fun relativeDayUsesTheViewersCalendar() {
        // Auckland: now is 22:30 on the 27th (NZDT); 01:00Z is 14:00 the same day.
        assertEquals("today", TeachingFormat.relativeDay("2026-09-27T01:00:00Z", now, nz))
        assertEquals("yesterday", TeachingFormat.relativeDay("2026-09-26T09:00:00Z", now, nz))
        assertEquals("yesterday", TeachingFormat.relativeDay("2026-09-26T11:30:00Z", now, nz)) // 23:30 on the 26th (NZST, before the DST switch)
    }

    @Test fun shortDatesAndDayLabels() {
        assertEquals("Sep 3", TeachingFormat.shortDate("2026-09-03T09:00:00Z", now, nz))
        assertEquals("Dec 30, 2025", TeachingFormat.shortDate("2025-12-30T09:00:00Z", now, nz))
        assertEquals("Today", TeachingFormat.dayLabel("2026-09-27", LocalDate.parse("2026-09-27")))
        assertEquals("Yesterday", TeachingFormat.dayLabel("2026-09-26", LocalDate.parse("2026-09-27")))
        assertEquals("Tue, Sep 15", TeachingFormat.dayLabel("2026-09-15", LocalDate.parse("2026-09-27")))
        assertEquals("86%", TeachingFormat.percent(0.855))
        assertEquals("—", TeachingFormat.percent(null))
        assertEquals("<1 min", TeachingFormat.minutes(20_000))
        assertEquals("0 min", TeachingFormat.minutes(0))
        assertEquals("11 min", TeachingFormat.minutes(11 * 60_000L))
        assertEquals("1 word", TeachingFormat.plural(1, "word"))
        assertEquals("J", TeachingFormat.initial("jerome", null))
        assertEquals("?", TeachingFormat.initial(null, ""))
    }

    private fun q(id: String, note: String, at: String) = ClaudeQuestionDto(id, note, "q$id", "a$id", at)

    @Test fun questionsGroupIntoThreadsLikeSharedChats() {
        val rows = listOf(
            q("1", "n1", "2026-09-26T10:00:00Z"),
            q("2", "n1", "2026-09-26T10:20:00Z"), // 20 min later → same thread
            q("3", "n1", "2026-09-26T11:00:00Z"), // 40 min after the last → new thread
            q("4", "n2", "2026-09-26T10:05:00Z"),
        )
        val threads = groupQuestionThreads(rows.shuffled(java.util.Random(4)))
        assertEquals(listOf("3", "1", "4"), threads.map { it.id })
        assertEquals(listOf("1", "2"), threads[1].questions.map { it.id })
        assertEquals("2026-09-26T10:20:00Z", threads[1].lastAt)
    }

    @Test fun statusLines() {
        val base = TeachingSamples.jeromeOverview
        assertEquals("Studied today · 🔥 12 days · 86% today", studyStatusLine(base, now))
        val lapsed = base.copy(status = StudyStatusDto("2026-09-24T08:00:00Z", studied_today = false, streak_days = 1, active_days_30 = 3, today = TodayStatsDto()))
        assertEquals("Last studied 3 days ago · 🔥 1 day", studyStatusLine(lapsed, now))
        assertEquals("Hasn't studied yet", studyStatusLine(base.copy(status = StudyStatusDto(), pills = PillsDto()), now))
    }

    @Test fun sendSentenceMatchesTheWeb() {
        val o = SendOptions(HomeworkMode.FSRS, "2026-09-29", 1, "core", true)
        assertEquals("at the top of their queue, so their new words come from it next", sendHow("deck", o))
        assertEquals("at the bottom of their queue, after everything they already have", sendHow("deck", o.copy(priority = "non_urgent")))
        assertEquals("as one-off homework over 3 days from Tue 29 Sep, then in long-term review", sendHow("deck", o.copy(mode = HomeworkMode.BOTH, splitDays = 3)))
        assertEquals("as one-off homework by Tue 29 Sep", sendHow("lesson", o.copy(mode = HomeworkMode.ONE_OFF, splitDays = 3)))
    }

    @Test fun historyGroupsByWordLikeTheWeb() {
        val groups = groupByWord(TutorPagesSamples.history)
        assertEquals(listOf("打算", "换乘", "地铁站"), groups.map { it.note.hanzi })
        assertEquals(2, groups[0].forgot)
        assertEquals(listOf("大算", "打算了"), groups[0].wrong)
        assertEquals(listOf("换成"), groups[1].wrong) // 换乘 typed correctly is not a wrong answer
    }

    @Test fun recordingsSortUnlistenedFirst() {
        val sorted = sortRecordings(TutorPagesSamples.report.recordings)
        assertEquals(listOf("e7", "e2", "e8", "e9"), sorted.map { it.event_id })
        assertEquals(listOf("e8"), filterRecordings(sorted, RecordingFilter.NEEDS_WORK).map { it.event_id })
        assertEquals(listOf("e7", "e2"), filterRecordings(sorted, RecordingFilter.UNLISTENED).map { it.event_id })
    }

    @Test fun answerDiffMatchesTutorShared() {
        assertTrue(TutorPageFormat.answersMatch("我 学了，两年了。", "我学了两年了"))
        val (user, expected) = TutorPageFormat.answerDiff("大算", "打算")
        assertEquals(listOf(TutorPageFormat.DiffKind.WRONG, TutorPageFormat.DiffKind.CORRECT), user.map { it.second })
        assertEquals(listOf('打' to TutorPageFormat.DiffKind.EXPECTED, '算' to TutorPageFormat.DiffKind.CORRECT), expected)
        assertEquals(null, TutorPageFormat.answerDiff("打算。", "打算").second)
        assertEquals("4.2s", TutorPageFormat.seconds(4200))
        assertEquals("12s", TutorPageFormat.seconds(12400))
        assertEquals("1h 13m", TutorPageFormat.duration(73 * 60_000L))
        assertEquals("<1m", TutorPageFormat.duration(10_000))
    }

    @Test fun insightsPresetsQuery() {
        val today = LocalDate.parse("2026-09-27")
        assertEquals(null to null, InsightsRange(InsightsPreset.LESSON).query(today))
        assertEquals("2026-09-20" to null, InsightsRange(InsightsPreset.D7).query(today))
        assertEquals("2026-09-13" to "2026-09-27", InsightsRange(InsightsPreset.CUSTOM).query(today))
    }
}
