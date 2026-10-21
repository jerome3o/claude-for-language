package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.ReviewLoad
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.data.api.BudgetTopDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReviewLoadDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentStudyBudgetDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetInfoDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsActions
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsEnv
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsScreen
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S
import org.junit.Test
import org.robolectric.annotation.Config

/** "Pause new cards on heavy days": the learner's Settings, Home on a paused day, the tutor's row / sheet / dashboard chip. */
class ReviewLoadScreenshots : LabScreenshotTest() {
    private val withCap = StudyBudgetInfoDto(3, 6, is_default = true, set_by_id = "tutor-1", set_by_name = "Minghui Wang", set_by_tutor = true, set_at = "2026-10-21T08:00:00Z", pause_new_when_reviews_over = 100)
    private val paused = ReviewLoadDto(load = 124, threshold = 100, paused = true)

    @Test fun settings() = shoot("review-cap-01-settings", settleMs = 1_000) {
        val info = StudyBudgetInfoDto(3, 6, is_default = true).toInfo()
        SettingsScreen(
            SettingsUi(budget = info.budget, budgetDraft = info.budget, budgetInfo = info, reviewCap = null, reviewCapDraft = 100),
            SettingsEnv(role = NavRole(loaded = true), sync = Samples.sync(1_790_000_000_000L), nowMs = 1_790_000_000_000L),
            SettingsActions(onBack = {}),
            // Scrolled to "New cards a day" (the 5th item).
            listState = rememberLazyListState(initialFirstVisibleItemIndex = 4),
        )
    }

    @Test fun home() = shoot("review-cap-02-home") {
        HomeScreen(
            ui = HomeUi(
                loaded = true, userName = "Jerome Swannack", due = QueueCounts(0, 0, 18, 106), reviewedToday = 0,
                decks = listOf(
                    DeckSummary("d1", "HSK 3 · Plans & time", 120, QueueCounts(0, 0, 10, 61)),
                    DeckSummary("d2", "Homework · 第八课", 24, QueueCounts(0, 0, 8, 45)),
                ),
                reviewLoad = ReviewLoad.state(124, 100),
            ),
            sync = SyncStatus(lastSyncAt = System.currentTimeMillis() - 120_000),
            online = true,
            actions = HomeActions(),
        )
    }

    @Config(qualifiers = TeachingScreenshots.TALL)
    @Test fun tutorRow() = shoot("review-cap-03-tutor-row") {
        StudentPageScreen(
            S.studentPage(S.jeromeOverview.copy(study_budget = withCap, review_load = paused)).copy(
                dailyBudget = { DailyBudgetRow(withCap.toInfo(), null, onEdit = {}, onRetry = {}, reviewLoad = paused.toState()) },
            ),
            StudentPageActions(), S.now,
        )
    }

    @Test fun tutorSheet() = shoot("review-cap-04-tutor-sheet") {
        Box(Modifier.fillMaxSize().background(Lab.colors.card).padding(top = 20.dp)) {
            Column {
                var draft by remember { mutableStateOf(StudyBudget(3, 6)) }
                var cap by remember { mutableStateOf<Int?>(100) }
                DailyBudgetForm(
                    StudentStudyBudgetDto(budget = StudyBudgetInfoDto(3, 6, is_default = true), top_deck = BudgetTopDeckDto("d1", "Lesson vocab – 2 Oct", 41)),
                    draft, { draft = it }, busy = false, error = null, online = true, onReset = {}, onSave = {}, title = "Daily new cards",
                    capDraft = cap, onCapDraft = { cap = it },
                )
            }
        }
    }

    @Test fun dashboardChip() = shoot("review-cap-05-dashboard-chip") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(20.dp)) {
            StudentCard(S.jeromeOverview.copy(study_budget = withCap, review_load = paused), DashboardActions(), S.now)
        }
    }
}
