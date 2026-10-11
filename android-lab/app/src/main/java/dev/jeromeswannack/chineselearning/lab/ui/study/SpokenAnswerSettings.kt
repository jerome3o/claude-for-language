package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection

/**
 * Settings → Study → "Skip the review — submit spoken answers as soon as I stop" (the web's
 * `SpokenAnswerSection` in SettingsPage.tsx; stateless for screenshots). Off by default. Plus
 * "Word tags on the answer" (on by default; StudyPrefs.wordTagsOn).
 */
@Composable
fun SpokenAnswerSection(
    on: Boolean,
    /** Settings → Study → "Word tags on the answer" (the web's `WordTagsSetting`); null = not shown. */
    wordTagsOn: Boolean? = null,
    onWordTagsChange: (Boolean) -> Unit = {},
    onChange: (Boolean) -> Unit,
) {
    SettingsSection(
        "Study",
        if (on) "On the typing cards, 🎤 checks what you said as soon as you stop."
        else "On the typing cards, 🎤 shows what you said first — Retry, Edit or Submit it.",
    ) {
        ToggleRow("🎤", SKIP_REVIEW_LABEL, on, onChange = onChange)
        if (wordTagsOn != null) {
            ToggleRow(
                "🏷",
                WORD_TAGS_LABEL,
                wordTagsOn,
                desc = if (wordTagsOn) WORD_TAGS_ON_DESC else WORD_TAGS_OFF_DESC,
                onChange = onWordTagsChange,
            )
        }
    }
}

const val SKIP_REVIEW_LABEL = "Skip the review — submit spoken answers as soon as I stop"
const val WORD_TAGS_LABEL = "Word tags on the answer"
const val WORD_TAGS_ON_DESC = "Small tags under the meaning: noun / verb, polite / colloquial, measure word, HSK level. Tap one to see what it means."
const val WORD_TAGS_OFF_DESC = "Off — the answer shows just the word, pinyin and meaning."

/** Per device (StudyPrefs.spokenSkipReview), like the web's localStorage switch. */
@Composable
fun SpokenAnswerSettings(app: LabApp) {
    val prefs = remember { StudyPrefs.get(app) }
    var on by remember { mutableStateOf(prefs.spokenSkipReview) }
    val tagsOn by prefs.wordTagsOn.collectAsState()
    SpokenAnswerSection(
        on,
        wordTagsOn = tagsOn,
        onWordTagsChange = { next ->
            prefs.setWordTagsOn(next)
            app.analytics.track("settings.change", mapOf("setting" to "word_tags", "value" to if (next) "on" else "off"))
        },
    ) { next ->
        on = next
        prefs.spokenSkipReview = next
        app.analytics.track("settings.change", mapOf("setting" to "spoken_auto_submit", "value" to if (next) "on" else "off"))
    }
}
