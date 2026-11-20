package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.SentenceStyle
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/** Settings → Study → "Example sentence style" (SentenceStyleSettings.kt). */
class SentenceStyleScreenshots : LabScreenshotTest() {
    @Test fun setting() = shoot("sentence-style-01-setting") {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SentenceStyleSettingsView(SentenceStyle.DEFAULT) {}
            SentenceStyleSettingsView(SentenceStyle.CASUAL) {}
        }
    }
}
