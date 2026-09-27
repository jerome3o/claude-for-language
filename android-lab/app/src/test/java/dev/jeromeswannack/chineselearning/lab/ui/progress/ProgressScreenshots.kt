package dev.jeromeswannack.chineselearning.lab.ui.progress

import dev.jeromeswannack.chineselearning.lab.data.api.SessionReviewCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionReviewCardNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionReviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudySessionDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import org.junit.Test
import org.robolectric.annotation.Config

class ProgressScreenshots : LabScreenshotTest() {
    private val s = ProgressSamples

    @Test fun tab() = shootInShell("progress-01-tab", active = TabId.PROGRESS) { ProgressScreen(s.ui, ProgressActions()) }

    @Test fun tabDark() = shoot("progress-02-tab-dark", dark = true) { ProgressScreen(s.ui, ProgressActions()) }

    @Test fun barSelected() = shoot("progress-03-bar-selected") { ProgressScreen(s.ui, ProgressActions(), initialSelected = 27) }

    @Test fun empty() = shootInShell("progress-04-empty", active = TabId.PROGRESS) {
        ProgressScreen(ProgressUi(loaded = true, snapshot = s.snapshot.copy(totalReviews = 0, overall = dev.jeromeswannack.chineselearning.lab.core.Mastery.progress(emptyList()))), ProgressActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("progress-05-unfolded") { ProgressScreen(s.ui, ProgressActions()) }

    @Test fun day() = shoot("progress-06-day") { DayScreen(s.day.date, s.day, onBack = {}, openCard = {}) }

    @Test fun cardDay() = shoot("progress-07-card-day") {
        CardDayScreen("2026-09-20", CardDayState.Loaded(s.cardDay), recordings = mapOf("e1" to "recordings/e1.webm"), playing = null, actions = CardDayActions(), zone = s.zone)
    }

    @Test fun session() = shoot("progress-08-session-review") {
        val note = { h: String, p: String, e: String -> SessionReviewCardDto("meaning_to_hanzi", SessionReviewCardNoteDto(h, p, e)) }
        SessionReviewScreen(
            Loadable(
                StudySessionDto(
                    "s1", "2026-09-20T08:15:00.000Z",
                    listOf(
                        SessionReviewDto("r1", 2, 6_000, "打算", null, note("打算", "dǎsuàn", "to plan")),
                        SessionReviewDto("r2", 0, 14_000, "担必", "recordings/r2.webm", note("担心", "dānxīn", "to worry")),
                        SessionReviewDto("r3", 3, 3_000, null, null, SessionReviewCardDto("hanzi_to_meaning", SessionReviewCardNoteDto("附近", "fùjìn", "nearby"))),
                        SessionReviewDto("r4", 1, 11_000, "决定", null, note("决定", "juédìng", "to decide")),
                    ),
                ),
            ),
            SessionReviewActions(), zone = s.zone,
        )
    }
}
