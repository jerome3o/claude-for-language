package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection

/**
 * Settings → Study → "Submit spoken answers automatically" (the web's `SpokenAnswerSection` in
 * SettingsPage.tsx; stateless for screenshots).
 */
@Composable
fun SpokenAnswerSection(on: Boolean, onChange: (Boolean) -> Unit) {
    SettingsSection(
        "Study",
        if (on) "On the typing cards, 🎤 checks what you said as soon as you stop."
        else "On the typing cards, 🎤 fills in what you said — press Check to submit it.",
    ) {
        ToggleRow("🎤", "Submit spoken answers automatically", on, onChange = onChange)
    }
}

/** Per device (StudyPrefs.spokenAutoSubmit), like the web's localStorage switch. */
@Composable
fun SpokenAnswerSettings(app: LabApp) {
    val prefs = remember { StudyPrefs.get(app) }
    var on by remember { mutableStateOf(prefs.spokenAutoSubmit) }
    SpokenAnswerSection(on) { next ->
        on = next
        prefs.spokenAutoSubmit = next
        app.analytics.track("settings.change", mapOf("setting" to "spoken_auto_submit", "value" to if (next) "on" else "off"))
    }
}
