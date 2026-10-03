package dev.jeromeswannack.chineselearning.lab.ui.settings

import dev.jeromeswannack.chineselearning.lab.core.DupNote
import dev.jeromeswannack.chineselearning.lab.core.Duplicates
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.SyncPhase
import dev.jeromeswannack.chineselearning.lab.data.SyncRun
import dev.jeromeswannack.chineselearning.lab.data.api.AudioQualityCounts
import dev.jeromeswannack.chineselearning.lab.data.api.AudioQualityDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageCards
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageDeck
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageError
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageJobs
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageNotes
import dev.jeromeswannack.chineselearning.lab.data.api.CoverageSentences
import dev.jeromeswannack.chineselearning.lab.data.api.FeatureRequestCommentDto
import dev.jeromeswannack.chineselearning.lab.data.api.FeatureRequestDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.FeatureRequestDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceCoverageDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.more.DebugReportRow
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config

class SettingsScreenshots : LabScreenshotTest() {
    private val now = 1_790_000_000_000L
    private val iso = { minsAgo: Long -> dev.jeromeswannack.chineselearning.lab.core.Js.toIsoString(now - minsAgo * 60_000) }

    private val ui = SettingsUi(
        budget = StudyBudget(3, 6),
        budgetDraft = StudyBudget(5, 6),
        landing = null,
        lastExportAt = now - 3 * 86_400_000L,
        lastExportSize = 2_431_000,
        audioQuality = AudioQualityDto(AudioQualityCounts(1804, 12, 40), AudioQualityCounts(900, 3, 0), AudioQualityCounts(4210, 25, 110)),
        requests = listOf(
            FeatureRequestDto("f1", "Could the Lab app show my streak on the home screen too?", "Lab app (Android) · Settings", null, "in_progress", 2, iso(3 * 60)),
            FeatureRequestDto("f2", "Audio on 周末 cuts off the last syllable when the phone is on silent.", "/study", null, "done", 1, iso(3 * 24 * 60)),
        ),
    )

    private fun env(role: NavRole = NavRole(loaded = true)) = SettingsEnv(
        role = role,
        sync = Samples.sync(now).copy(
            lastRun = SyncRun(false, now - 4 * 60_000, 1840, true, listOf(SyncPhase("Profile", 210), SyncPhase("Changes", 380, "3 notes"), SyncPhase("Reviews", 690, "41 events"), SyncPhase("Card states", 160), SyncPhase("Sentences", 250), SyncPhase("Features", 150))),
        ),
        nowMs = now,
    )

    @Test fun settings() = shoot("settings-01-main", settleMs = 1_000) { SettingsScreen(ui, env(), SettingsActions(onBack = {})) }

    @Test fun advanced() = shoot("settings-02-advanced", settleMs = 1_000) {
        SettingsScreen(ui, env(), SettingsActions(onBack = {}), startAdvanced = true, debugRow = { DebugReportRow(null, false) {} }, listState = androidx.compose.foundation.lazy.rememberLazyListState(8))
    }

    @Test fun offlineForcedBudgetError() = shoot("settings-03-offline-error", settleMs = 1_000) {
        SettingsScreen(
            ui.copy(budgetBusy = Busy(error = "new_cards_per_day must be between 0 and 200")),
            env().copy(online = false, forcedOffline = true),
            SettingsActions(onBack = {}),
            listState = androidx.compose.foundation.lazy.rememberLazyListState(2),
        )
    }

    @Test fun tutorOnly() = shoot("settings-04-tutor", settleMs = 1_000) {
        SettingsScreen(ui.copy(landing = "students"), env(NavRole(hasStudents = true, isTutorOnly = true, loaded = true)), SettingsActions(onBack = {}))
    }

    @Test fun darkMain() = shoot("settings-05-dark", dark = true, settleMs = 1_000) { SettingsScreen(ui, env(), SettingsActions(onBack = {})) }

    @Test fun featureRequest() = shoot("settings-06-feature-request") {
        androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().background(Lab.colors.card).padding(top = 16.dp)) {
            run {
                FeatureRequestBody(
                    FeatureRequestDetailDto(
                        ui.requests!![0],
                        listOf(
                            FeatureRequestCommentDto("c1", "Claude", "On it — the streak card is being ported with the Progress tab.", iso(2 * 60)),
                            FeatureRequestCommentDto("c2", "Jerome", "Nice, the heatmap too please!", iso(90)),
                        ),
                    ),
                    Busy(), "Also a haptic when the streak goes up?", {}, title = "Feature Request",
                ) {}
            }
        }
    }

    private val coverage = SentenceCoverageDto(
        notes = CoverageNotes(3012, 2890, 2701, 3004, 2410, 2302),
        sentences = CoverageSentences(14980, 14720, 3120),
        cards = CoverageCards(9036, 3100, 240, 5600, 96),
        jobs = CoverageJobs(queued = 18, done = 2410, error = 4, stale_queued = 1, exhausted = 2),
        recent_errors = listOf(CoverageError("n1", "一边…一边", 3, "Claude returned no tool call (max_tokens)", iso(40)), CoverageError("n2", "打交道", 1, "529 overloaded", iso(12))),
        decks = listOf(CoverageDeck("d1", "HSK 3 · Plans & time", 360, 355, 300), CoverageDeck("d2", "Homework — 周末的活动", 72, 72, 72), CoverageDeck("d3", "Food & ordering", 174, 160, 90)),
    )

    @Test fun sentenceCoverage() = shoot("settings-07-sentence-coverage") {
        SentenceCoverageScreen(
            CoverageUi(coverage, loading = false, local = LocalSentences(2380, 14212, now - 5 * 60_000), status = "Queued 20 words. 582 still without a set. Generating in the background — this page updates as they land."),
            online = true, CoverageActions(), nowMs = now,
        )
    }

    @Test fun sentenceCoverageOffline() = shoot("settings-08-sentence-coverage-offline") {
        SentenceCoverageScreen(CoverageUi(null, loading = false, error = "Couldn't load the overview — you're offline."), online = false, CoverageActions(), nowMs = now)
    }

    @Test fun duplicates() = shoot("settings-09-duplicates") {
        val notes = listOf(
            DupNote("a", "d1", "打算", "dǎsuàn", "to plan"), DupNote("b", "d2", "打算", "dǎsuàn", "to plan; to intend"),
            DupNote("c", "d1", "周末", "zhōumò", "weekend"), DupNote("d", "d3", "周末", "zhōumò", "weekend"), DupNote("e", "d4", "周末", "zhōu mò", "the weekend"),
        )
        DuplicateFinderScreen(
            DuplicatesUi(
                loading = false, scanned = true,
                groups = Duplicates.find(notes, mapOf("a" to 41, "b" to 3, "c" to 18, "d" to 18, "e" to 0), mapOf("c" to 9, "d" to 4)),
                deckNames = mapOf("d1" to "HSK 3 · Plans & time", "d2" to "Homework — 周末的活动", "d3" to "Food & ordering", "d4" to "Starter Chinese"),
                deleting = setOf("e"),
            ),
            online = true, DuplicateActions(),
        )
    }

    @Test fun duplicatesNone() = shoot("settings-10-duplicates-none") {
        DuplicateFinderScreen(DuplicatesUi(loading = false, scanned = true), online = true, DuplicateActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("settings-11-unfolded", settleMs = 1_000) { SettingsScreen(ui, env(), SettingsActions(onBack = {})) }
}
