package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.core.HomeworkPlan
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
        assertEquals("as one-off homework over 3 days from Tue 29 Sep, then in long-term review (the top of their queue)", sendHow("deck", o.copy(mode = HomeworkMode.BOTH, splitDays = 3)))
        assertEquals("as one-off homework by Tue 29 Sep, then in long-term review (the bottom of their queue)", sendHow("deck", o.copy(mode = HomeworkMode.BOTH, priority = "non_urgent")))
        assertEquals("as one-off homework by Tue 29 Sep, then in long-term review", sendHow("lesson", o.copy(mode = HomeworkMode.BOTH)))
        assertEquals("as one-off homework by Tue 29 Sep", sendHow("lesson", o.copy(mode = HomeworkMode.ONE_OFF, splitDays = 3)))
        assertEquals(" in their homework list, then in their study sessions", lessonWhere(HomeworkMode.BOTH))
    }

    @Test fun sendSheetOpensOnBothDueAtTheNextLesson() {
        // web: sendDefaults() — Both, due in two days without a lesson coming up…
        assertEquals(SendDefaults(HomeworkMode.BOTH, "2026-09-30", null), sendDefaults("2026-09-28"))
        assertEquals(SendDefaults(HomeworkMode.BOTH, "2026-09-30", null), sendDefaults("2026-09-28", listOf("2026-09-22", "2026-10-20")))
        // …else at the earliest logged lesson after today.
        assertEquals(SendDefaults(HomeworkMode.BOTH, "2026-10-01", "2026-10-01"), sendDefaults("2026-09-28", listOf("2026-10-06", "2026-10-01", "2026-09-28", null)))
        assertEquals("2026-10-01", HomeworkPlan.lessonDay("2026-10-01T12:00:00.000Z", java.time.ZoneOffset.UTC))
        assertEquals(null, HomeworkPlan.lessonDay("soon"))
    }

    @Test fun historyGroupsByWordLikeTheWeb() {
        val groups = groupByWord(TutorPagesSamples.history)
        assertEquals(listOf("打算", "换乘", "地铁站"), groups.map { it.note.hanzi })
        assertEquals(2, groups[0].forgot)
        assertEquals(listOf("大算", "打算了"), groups[0].wrong)
        assertEquals(listOf("换成"), groups[1].wrong) // 换乘 typed correctly is not a wrong answer
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

    @Test fun draftRules() {
        assertEquals("Restaurant ordering", entryTitle(DraftSamples.entries[0]))
        assertEquals("Transport: 地铁, 换乘, 出租车…", entryTitle(DraftSamples.entries[1]))
        assertEquals("x".repeat(59) + "…", entryTitle(DraftSamples.entries[3].copy(notes = "\n  " + "x".repeat(80))))
        assertEquals("Lesson", entryTitle(DraftSamples.entries[3].copy(notes = null)))
        assertEquals(2, includedItems(DraftSamples.view).size)
        assertEquals(1, includedItems(DraftSamples.view.copy(kept_count = 0)).size) // a deck with no kept words isn't counted
        assertEquals("words: one-off + long-term · lesson: one-off", assignSummary(includedItems(DraftSamples.view)))
        assertEquals("点菜 · Ordering food", jobTitle(DraftSamples.job.copy(title = null)))
        assertTrue(DraftSamples.job.isDraft)
    }

    @Test fun hubAndProgressRules() {
        val nowMs = now.toEpochMilli() // 2026-09-27T09:30Z
        val cards = ProgressSamples.hub.cards
        assertEquals(listOf("Review", "Learning", "New"), cards.map { queueLabel(it) })
        assertEquals("due in 6 days", nextReview(cards[0], nowMs))
        assertEquals("due now", nextReview(cards[1], nowMs))
        assertEquals("not started", nextReview(cards[2], nowMs))
        assertEquals("地铁站", hubFlags(ProgressSamples.hub).single().hanzi)
        assertEquals("5h 12m", ProgressFormat.time(312 * 60_000L))
        assertEquals("59 min", ProgressFormat.time(59 * 60_000L + 59_000))
        assertEquals("1m 5s", ProgressFormat.duration(65_000))
        assertEquals("-", ProgressFormat.duration(null))
        assertEquals("86%", ProgressFormat.pct(86.0))
        assertEquals("79.5%", ProgressFormat.pct(79.5))
        assertEquals("Today" to "Sep 27", ProgressFormat.dayLabels("2026-09-27", LocalDate.parse("2026-09-27")))
        assertEquals("Thu" to "Sep 24", ProgressFormat.dayLabels("2026-09-24", LocalDate.parse("2026-09-27")))
        assertEquals("< 1 min", ProgressFormat.studyTime(20_000))
        assertEquals("1h 34m", ProgressFormat.studyTime(94 * 60_000L))
    }
}
