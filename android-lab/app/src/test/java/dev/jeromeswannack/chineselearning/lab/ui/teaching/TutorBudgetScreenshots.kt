package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyBudgetInfo
import dev.jeromeswannack.chineselearning.lab.data.api.BudgetTopDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentStudyBudgetDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetInfoDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsActions
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsEnv
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsScreen
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S
import org.junit.Test
import org.robolectric.annotation.Config

/** A tutor sets the student's daily new-card budget: the row, the sheet, and the learner's Settings line. */
class TutorBudgetScreenshots : LabScreenshotTest() {
    private val byMinghui = StudyBudgetInfoDto(5, 10, is_default = false, set_by_id = "tutor-1", set_by_name = "Minghui Wang", set_by_tutor = true, set_at = "2026-10-03T10:00:00Z")
    private val defaultBudget = StudyBudgetInfoDto(3, 6, is_default = true)

    @Config(qualifiers = TeachingScreenshots.TALL)
    @Test fun row() = shoot("tutor-budget-01-row") {
        StudentPageScreen(
            S.studentPage(S.jeromeOverview.copy(study_budget = defaultBudget)).copy(
                dailyBudget = { DailyBudgetRow(defaultBudget.toInfo(), null, onEdit = {}, onRetry = {}) },
            ),
            StudentPageActions(), S.now,
        )
    }

    @Test fun sheet() = shoot("tutor-budget-02-sheet") {
        Box(Modifier.fillMaxSize().background(Lab.colors.card).padding(20.dp)) {
            Column {
                Text("Daily new cards", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.padding(bottom = 16.dp))
                var draft by remember { mutableStateOf(StudyBudget(5, 10)) }
                DailyBudgetForm(
                    StudentStudyBudgetDto(budget = defaultBudget, top_deck = BudgetTopDeckDto("d1", "Lesson vocab – 2 Oct", 41)),
                    draft, { draft = it }, busy = false, error = null, online = true, onReset = {}, onSave = {},
                )
            }
        }
    }

    @Test fun settings() = shoot("tutor-budget-03-settings", settleMs = 1_000) {
        val info: StudyBudgetInfo = byMinghui.toInfo()
        SettingsScreen(
            SettingsUi(budget = info.budget, budgetDraft = info.budget, budgetInfo = info),
            SettingsEnv(role = NavRole(loaded = true), sync = Samples.sync(1_790_000_000_000L), nowMs = 1_790_000_000_000L),
            SettingsActions(onBack = {}),
            listState = rememberLazyListState(),
        )
    }

    @Test fun dashboardChip() = shoot("tutor-budget-04-dashboard-chip") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(20.dp)) {
            StudentCard(S.jeromeOverview.copy(study_budget = byMinghui), DashboardActions(), S.now)
        }
    }
}
