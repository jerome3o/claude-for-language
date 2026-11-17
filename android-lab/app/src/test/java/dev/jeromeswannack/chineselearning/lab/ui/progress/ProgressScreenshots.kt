package dev.jeromeswannack.chineselearning.lab.ui.progress

import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import org.junit.Test
import org.robolectric.annotation.Config

class ProgressScreenshots : LabScreenshotTest() {
    private val s = ProgressSamples

    @Test fun tab() = shootInShell("progress-01-tab", active = TabId.PROGRESS) { ProgressScreen(s.ui, ProgressActions(), zone = s.zone) }

    @Test fun tabDark() = shoot("progress-02-tab-dark", dark = true) { ProgressScreen(s.ui, ProgressActions()) }

    @Test fun barSelected() = shoot("progress-03-bar-selected") { ProgressScreen(s.ui, ProgressActions(), initialSelected = 27) }

    @Test fun empty() = shootInShell("progress-04-empty", active = TabId.PROGRESS) {
        ProgressScreen(ProgressUi(loaded = true, snapshot = s.snapshot.copy(totalReviews = 0, overall = dev.jeromeswannack.chineselearning.lab.core.Mastery.progress(emptyList()))), ProgressActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("progress-05-unfolded") { ProgressScreen(s.ui, ProgressActions()) }

    @Test fun knownScrub() = shoot("progress-09-known-scrub") { ProgressScreen(s.ui, ProgressActions(), zone = s.zone, knownScrub = 40) }

    @Test fun knownExplain() = shoot("progress-10-known-explain") { ProgressScreen(s.ui, ProgressActions(), zone = s.zone, knownExplain = true) }

    @Test fun knownRate() = shoot("progress-12-known-per-week") {
        ProgressScreen(s.ui, ProgressActions(), zone = s.zone, knownMode = dev.jeromeswannack.chineselearning.lab.core.KnownChartMode.Rate)
    }

    @Test fun knownRateDark() = shoot("progress-13-known-per-week-dark", dark = true) {
        ProgressScreen(s.ui, ProgressActions(), zone = s.zone, knownMode = dev.jeromeswannack.chineselearning.lab.core.KnownChartMode.Rate)
    }

    @Test fun knownRateScrub() = shoot("progress-14-known-per-week-scrub") {
        ProgressScreen(s.ui, ProgressActions(), zone = s.zone, knownMode = dev.jeromeswannack.chineselearning.lab.core.KnownChartMode.Rate, knownRateScrub = 40)
    }

    @Test fun knownTotalDark() = shoot("progress-15-known-total-dark", dark = true) {
        ProgressScreen(s.ui, ProgressActions(), zone = s.zone, knownMode = dev.jeromeswannack.chineselearning.lab.core.KnownChartMode.Total)
    }

    /** Words known by reading vs by ear, with the hint while the ear lags (the card alone, as on the tab). */
    @Test fun knownByEar() = shoot("progress-16-known-by-ear") {
        androidx.compose.foundation.layout.Column(
            androidx.compose.ui.Modifier.background(dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.background).padding(16.dp),
        ) { KnownCard(s.known, s.zone) }
    }

    @Test fun knownComputing() = shoot("progress-11-known-computing") { ProgressScreen(s.ui.copy(known = null), ProgressActions(), zone = s.zone) }

    @Test fun day() = shoot("progress-06-day") { DayScreen(s.day.date, s.day, onBack = {}, openCard = {}) }

    @Test fun cardDay() = shoot("progress-07-card-day") {
        CardDayScreen("2026-09-20", CardDayState.Loaded(s.cardDay), recordings = mapOf("e1" to "recordings/e1.webm"), playing = null, actions = CardDayActions(), zone = s.zone)
    }
}
