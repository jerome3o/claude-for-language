package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/** Settings → Homework e-mails (docs/HOMEWORK.md §12). */
class HomeworkEmailsScreenshots : LabScreenshotTest() {
    @Test fun on() = shoot("settings-homework-emails-on") { Box(Modifier.padding(16.dp)) { HomeworkEmailsSection(on = true, note = null, onChange = {}) } }

    @Test fun offDark() = shoot("settings-homework-emails-off", dark = true) { Box(Modifier.padding(16.dp)) { HomeworkEmailsSection(on = false, note = null, onChange = {}) } }
}
