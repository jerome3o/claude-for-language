package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.Revisit
import dev.jeromeswannack.chineselearning.lab.core.RevisitSettings
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Settings → "Lessons & readers": defaults (one new lesson a day), edited, and a rule broken. */
class RevisitSettingsScreenshots : LabScreenshotTest() {
    private fun frame(ui: RevisitSettingsUi) = shoot(
        when {
            ui.shownProblems.isNotEmpty() -> "revisit-07-settings-problem"
            ui.dirty -> "revisit-06-settings-edited"
            else -> "revisit-05-settings"
        },
    ) {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RevisitSettingsSection(ui, RevisitSettingsActions())
        }
    }

    @Test fun defaults() = frame(RevisitSettingsUi())

    @Test fun edited() {
        val ui = RevisitSettingsUi(draft = revisitDraft(Revisit.DEFAULT) + ("good_days" to "21") + ("growth" to "1.5"))
        assertTrue(ui.dirty)
        assertEquals(mapOf("good_days" to 21.0, "growth" to 1.5), ui.changes)
        assertEquals("3 wk → 5 wk → 7 wk → 2 mo → 4 mo", Revisit.goodChain(ui.preview))
        frame(ui)
    }

    @Test fun newLessonsADay() {
        val ui = RevisitSettingsUi(draft = revisitDraft(Revisit.DEFAULT) + ("new_lessons_per_day" to "2"))
        assertTrue(ui.dirty)
        assertEquals(mapOf("new_lessons_per_day" to 2.0), ui.changes)
        shoot("listen-05-settings-new-lessons") {
            Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                RevisitSettingsSection(ui, RevisitSettingsActions())
            }
        }
        val bad = RevisitSettingsUi(draft = revisitDraft(Revisit.DEFAULT) + ("new_lessons_per_day" to "1.5"))
        assertEquals(listOf("new_lessons_per_day must be a whole number between 0 and 20"), bad.draftProblems)
    }

    @Test fun brokenOrder() {
        val saved = RevisitSettings(hardDays = 3.0, goodDays = 21.0, easyDays = 60.0, growth = 1.5, capDays = 200.0)
        val ui = RevisitSettingsUi(saved = saved, draft = revisitDraft(saved) + ("hard_days" to "30"))
        assertEquals(listOf("the gaps must go up: Hard ≤ Good ≤ Easy"), ui.draftProblems)
        frame(ui)
    }
}
