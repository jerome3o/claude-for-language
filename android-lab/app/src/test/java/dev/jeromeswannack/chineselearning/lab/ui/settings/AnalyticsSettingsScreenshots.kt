package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** Settings → Advanced → "Share usage data" (data/analytics/). */
class AnalyticsSettingsScreenshots : LabScreenshotTest() {
    @Test
    fun settingsRow() = shoot("analytics-01-settings") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ShareUsageSection(on = true, error = null) {}
        }
    }

    @Test
    fun offWithSaveError() = shoot("analytics-02-off-error") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ShareUsageSection(on = false, error = "Couldn't save: No connection — try again when you're online.") {}
        }
    }
}
