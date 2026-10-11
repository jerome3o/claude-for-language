package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/**
 * The voice-first box (`./gradlew :app:recordRoborazziDebug` → app/screenshots/voice-input-*.png):
 * idle (✏️ Type · 🎤 Say it), listening with the words streaming in, the review, typing with the 🎤,
 * a take that couldn't be transcribed, offline.
 */
class VoiceTextFieldScreenshots : LabScreenshotTest() {
    @Composable
    private fun Frame(ui: VoiceDictationUi, value: String = "") {
        Column(
            Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Translate into Chinese", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
            Text("I'd like a cup of coffee, please.", style = MaterialTheme.typography.headlineSmall, color = Lab.colors.ink)
            VoiceTextFieldContent(ui, value, {}, VoiceTextFieldActions(), submitLabel = "Check", placeholder = "Type in Chinese…")
        }
    }

    @Test fun idle() = shoot("voice-input-01-idle") { Frame(VoiceDictationUi()) }
    @Test fun listening() = shoot("voice-input-02-listening") { Frame(VoiceDictationUi(phase = "listening", finalText = "我想要一杯", partialText = "咖啡")) }
    @Test fun review() = shoot("voice-input-03-review") { Frame(VoiceDictationUi(phase = "review", finalText = "我想要一杯咖啡")) }
    @Test fun typing() = shoot("voice-input-04-typing") { Frame(VoiceDictationUi(mode = "type"), value = "我想要一杯咖啡") }
    @Test fun failed() = shoot("voice-input-05-failed") { Frame(VoiceDictationUi(phase = "failed", failure = "failed")) }
    @Test fun offline() = shoot("voice-input-06-offline") { Frame(VoiceDictationUi(blocked = "offline")) }
    @Test fun reviewDark() = shoot("voice-input-07-review-dark", dark = true) { Frame(VoiceDictationUi(phase = "review", finalText = "我想要一杯咖啡")) }
}
