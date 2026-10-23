package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorableSegments
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSegmentInput
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.explorer.rememberExplorerTap
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.MdChinese
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * The Sentence Coach's Chinese, tappable into the language explorer (the web's
 * components/coach/CoachText.tsx): every word of a coach answer — the big sentence, the
 * alternatives, the notes and Claude's replies — opens the Word view (+ Add as card / ⚡ Study it
 * today / Open card there). Words come from the device segmenter ([DeviceWords]); until its lists
 * have loaded the text is tappable character by character.
 */

/** The text's word segments from the device segmenter (null: not Chinese / lists not loaded). */
private fun deviceSegments(text: String): List<WordSegmentInput>? =
    DeviceWords.of(text)?.map { WordSegmentInput(it.text, it.pinyin, it.gloss) }

/** Text with its Chinese tappable by word (plain text when there is none). `CoachZh`. */
@Composable
fun CoachZh(
    text: String,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontWeight: FontWeight? = null,
    color: Color = Lab.colors.ink,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
) {
    if (!CoachActions.hasHan(text)) {
        androidx.compose.material3.Text(text, modifier, fontSize = fontSize, fontWeight = fontWeight, color = color, style = style)
        return
    }
    val segments = remember(text, DeviceWords.of(text) != null) { deviceSegments(text) }
    ExplorableText(text, source = "coach", modifier = modifier, segments = segments, style = style, fontSize = fontSize, fontWeight = fontWeight, color = color)
}

/** Claude's chat reply (Markdown), its Chinese tappable by word. `CoachMarkdown`. */
@Composable
fun CoachMarkdown(src: String, modifier: Modifier = Modifier, style: TextStyle = MaterialTheme.typography.bodyLarge) {
    val tap by rememberUpdatedState(rememberExplorerTap("coach"))
    val chinese = remember {
        MdChinese(
            pieces = { text ->
                if (!CoachActions.hasHan(text)) listOf(text to null)
                else ExplorableSegments.explorableSegments(text, deviceSegments(text)) { _, _ -> text }.map { it.text to it.item }
            },
            onTap = { item -> (item as? ExplorerItem)?.let { tap?.invoke(it) } },
        )
    }
    MarkdownText(src, modifier, style = style, chinese = chinese)
}
