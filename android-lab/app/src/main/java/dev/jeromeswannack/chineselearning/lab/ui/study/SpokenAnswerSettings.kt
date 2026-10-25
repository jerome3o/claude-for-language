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
 * "Word tags on the answer" (on by default; StudyPrefs.wordTagsOn) and "Shimmer new characters"
 * (on by default; StudyPrefs.newCharShimmerOn).
 */
@Composable
fun SpokenAnswerSection(
    on: Boolean,
    /** Settings → Study → "Word tags on the answer" (the web's `WordTagsSetting`); null = not shown. */
    wordTagsOn: Boolean? = null,
    onWordTagsChange: (Boolean) -> Unit = {},
    /** Settings → Study → "Show pictures on cards" (the web's `CardPicturesSetting`); null = not shown. */
    picturesOn: Boolean? = null,
    onPicturesChange: (Boolean) -> Unit = {},
    /** Settings → Study → "Shimmer new characters" (the web's `NewCharShimmerSetting`); null = not shown. */
    newCharShimmerOn: Boolean? = null,
    onNewCharShimmerChange: (Boolean) -> Unit = {},
    /** Settings → Study → "Hard mode" (the web's `HardModeSetting`): "off" | "red" | "all"; null = not shown. */
    hardMode: String? = null,
    onHardModeChange: (String) -> Unit = {},
    onChange: (Boolean) -> Unit,
) {
    SettingsSection(
        "Study",
        if (on) "On the typing cards, 🎤 checks what you said as soon as you stop."
        else "On the typing cards, 🎤 shows what you said first — Retry, Edit or Submit it.",
    ) {
        ToggleRow("🎤", SKIP_REVIEW_LABEL, on, onChange = onChange)
        if (hardMode != null) HardModeChoices(hardMode, onHardModeChange)
        if (wordTagsOn != null) {
            ToggleRow(
                "🏷",
                WORD_TAGS_LABEL,
                wordTagsOn,
                desc = if (wordTagsOn) WORD_TAGS_ON_DESC else WORD_TAGS_OFF_DESC,
                onChange = onWordTagsChange,
            )
        }
        if (picturesOn != null) {
            ToggleRow(
                "🖼",
                PICTURES_LABEL,
                picturesOn,
                desc = if (picturesOn) PICTURES_ON_DESC else PICTURES_OFF_DESC,
                onChange = onPicturesChange,
            )
        }
        if (newCharShimmerOn != null) {
            ToggleRow(
                "✨",
                NEW_CHAR_SHIMMER_LABEL,
                newCharShimmerOn,
                desc = if (newCharShimmerOn) NEW_CHAR_SHIMMER_ON_DESC else NEW_CHAR_SHIMMER_OFF_DESC,
                onChange = onNewCharShimmerChange,
            )
        }
    }
}

const val SKIP_REVIEW_LABEL = "Skip the review — submit spoken answers as soon as I stop"
const val WORD_TAGS_LABEL = "Word tags on the answer"
const val WORD_TAGS_ON_DESC = "Small tags under the meaning: noun / verb, polite / colloquial, measure word, HSK level. Tap one to see what it means."
const val WORD_TAGS_OFF_DESC = "Off — the answer shows just the word, pinyin and meaning."
const val PICTURES_LABEL = "Show pictures on cards"
const val PICTURES_ON_DESC = "A card’s picture shows with the English when you write the Chinese, and on the answer side of the other cards — never where it would give the answer away."
const val PICTURES_OFF_DESC = "Off — cards show no pictures."
const val NEW_CHAR_SHIMMER_LABEL = "Shimmer new characters"
const val NEW_CHAR_SHIMMER_ON_DESC = "A character you have never studied before shimmers softly on the card, so you can see it is new."
const val NEW_CHAR_SHIMMER_OFF_DESC = "Off — new characters look like every other character."

/** Per device (StudyPrefs.spokenSkipReview), like the web's localStorage switch. */
@Composable
fun SpokenAnswerSettings(app: LabApp) {
    val prefs = remember { StudyPrefs.get(app) }
    var on by remember { mutableStateOf(prefs.spokenSkipReview) }
    val tagsOn by prefs.wordTagsOn.collectAsState()
    val picturesOn by prefs.picturesOn.collectAsState()
    val shimmerOn by prefs.newCharShimmerOn.collectAsState()
    val hardMode by prefs.hardMode.collectAsState()
    SpokenAnswerSection(
        on,
        hardMode = hardMode,
        onHardModeChange = { next ->
            prefs.setHardMode(next)
            app.analytics.track("settings.change", mapOf("setting" to "hard_mode", "value" to next))
            app.analytics.track("study.hard_mode", mapOf("action" to "set", "mode" to next, "where" to "settings"))
        },
        wordTagsOn = tagsOn,
        onWordTagsChange = { next ->
            prefs.setWordTagsOn(next)
            app.analytics.track("settings.change", mapOf("setting" to "word_tags", "value" to if (next) "on" else "off"))
        },
        picturesOn = picturesOn,
        onPicturesChange = { next ->
            prefs.setPicturesOn(next)
            app.analytics.track("settings.change", mapOf("setting" to "card_pictures", "value" to if (next) "on" else "off"))
        },
        newCharShimmerOn = shimmerOn,
        onNewCharShimmerChange = { next ->
            prefs.setNewCharShimmerOn(next)
            app.analytics.track("settings.change", mapOf("setting" to "new_char_shimmer", "value" to if (next) "on" else "off"))
        },
    ) { next ->
        on = next
        prefs.spokenSkipReview = next
        app.analytics.track("settings.change", mapOf("setting" to "spoken_auto_submit", "value" to if (next) "on" else "off"))
    }
}
