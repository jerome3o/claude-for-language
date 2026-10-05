package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetInfoDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * docs/HOMEWORK.md §11 — the homework headline counts ONE-OFF homework only: the dashboard pill
 * (all done green, open blue, overdue red), and the student page's Homework section next to the
 * quieter "Long-term learning" (budget row + long-term decks).
 */
class HomeworkOneOffScreenshots : LabScreenshotTest() {
    @Test fun dashboardPills() = shoot("homework-one-off-01-dashboard-pills") {
        Column(
            Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val o = S.jeromeOverview
            StudentCard(o.copy(pills = o.pills.copy(homework = S.oneOffAllDone, homework_percent = 100)), DashboardActions(), S.now)
            StudentCard(
                o.copy(student = S.lily.copy(name = "Lily Chen"), relationship_id = "rel-lily", pills = o.pills.copy(homework = S.oneOffOpen, homework_percent = 67, struggling_words = 0, flags_open = 0)),
                DashboardActions(), S.now,
            )
            StudentCard(o.copy(student = o.student.copy(name = "Wang Fang"), relationship_id = "rel-wang"), DashboardActions(), S.now)
        }
    }

    /** The student page's work column: Homework (headline + one-off) and Long-term learning below it. */
    @Config(qualifiers = TeachingScreenshots.TALL)
    @Test fun studentPageSections() = shoot("homework-one-off-02-student-page") {
        StudentPageScreen(
            S.studentPage().copy(
                dailyBudget = {
                    DailyBudgetRow(StudyBudgetInfoDto(5, 10, is_default = false, set_by_name = "Minghui Wang", set_by_tutor = true, set_at = "2026-09-20T10:00:00Z").toInfo(), null, onEdit = {}, onRetry = {})
                },
            ),
            StudentPageActions(), S.now,
        )
    }
}
