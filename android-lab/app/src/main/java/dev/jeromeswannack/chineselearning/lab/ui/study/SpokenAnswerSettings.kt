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
 * Settings → Study → "Skip the review — submit spoken answers as soon as I stop" (the web's
 * `SpokenAnswerSection` in SettingsPage.tsx; stateless for screenshots). Off by default.
 */
@Composable
fun SpokenAnswerSection(on: Boolean, onChange: (Boolean) -> Unit) {
    SettingsSection(
        "Study",
        if (on) "On the typing cards, 🎤 checks what you said as soon as you stop."
        else "On the typing cards, 🎤 shows what you said first — Retry, Edit or Submit it.",
    ) {
        ToggleRow("🎤", SKIP_REVIEW_LABEL, on, onChange = onChange)
    }
}

const val SKIP_REVIEW_LABEL = "Skip the review — submit spoken answers as soon as I stop"

/** Per device (StudyPrefs.spokenSkipReview), like the web's localStorage switch. */
@Composable
fun SpokenAnswerSettings(app: LabApp) {
    val prefs = remember { StudyPrefs.get(app) }
    var on by remember { mutableStateOf(prefs.spokenSkipReview) }
    SpokenAnswerSection(on) { next ->
        on = next
        prefs.spokenSkipReview = next
        app.analytics.track("settings.change", mapOf("setting" to "spoken_auto_submit", "value" to if (next) "on" else "off"))
    }
}
