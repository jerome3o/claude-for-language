package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AnswerDifference
import dev.jeromeswannack.chineselearning.lab.core.SpokenAnswerResult
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags of "You said" vs the model answer. */
object DifferenceTags {
    const val COMPARE = "difference-compare"
    const val SAID = "difference-said"
    const val MODEL = "difference-model"
    const val PLAY_MODEL = "difference-play-model"
    const val TITLE = "round-difference-title"
    const val HELD = "difference-held"
    const val MODEL_ENGLISH = "difference-model-english"
}

/**
 * "You said" vs the model answer (the web's components/study/DifferenceCompare.tsx; rules in core
 * [AnswerDifference]; docs/STUDY_SESSION.md "Right, but said differently"): two lines, the characters
 * each has that the other hasn't marked like the "You said" row (yellow + dotted = differs, red + solid
 * = not in the answer), the pinyin of both, ▶ on the model when it can be played.
 */
@Composable
fun DifferenceCompare(
    said: String,
    model: String,
    modelPinyin: String?,
    accepted: Boolean,
    modelLabel: String = AnswerDifference.MODEL,
    onPlayModel: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    /**
     * A sentence answer Claude checks (core SentenceAnswerCheck.view): the model answer FIRST and big — [modelLabel],
     * the hanzi marked, ▶, its pinyin and this English — then "You said" against it.
     */
    answerFirstEnglish: String? = null,
    answerFirst: Boolean = false,
) {
    val lines = remember(said, model, accepted) { AnswerDifference.lines(said, model, accepted) }
    val saidPinyin = remember(said) { tidyYouSaidPinyin(devicePinyinLine(said)) }
    val pinyin = remember(model, modelPinyin) { modelPinyin?.trim()?.ifEmpty { null } ?: tidyYouSaidPinyin(devicePinyinLine(model)) }
    Column(modifier.fillMaxWidth().padding(vertical = 2.dp).testTag(DifferenceTags.COMPARE), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (answerFirst) {
            AnswerFirstBlock(modelLabel, lines.model, pinyin, answerFirstEnglish, onPlayModel)
            CompareLine(AnswerDifference.SAID, lines.said, saidPinyin, DifferenceTags.SAID, null)
        } else {
            CompareLine(AnswerDifference.SAID, lines.said, saidPinyin, DifferenceTags.SAID, null)
            CompareLine(modelLabel, lines.model, pinyin, DifferenceTags.MODEL, onPlayModel)
        }
    }
}

/** The model answer first and big (the web's `difference-compare-answer`): label, hanzi marked + ▶, pinyin, English. */
@Composable
private fun AnswerFirstBlock(label: String, cells: List<SpokenAnswerResult.Cell>, pinyin: String, english: String?, onPlay: (() -> Unit)?) {
    Column(Modifier.fillMaxWidth().testTag(DifferenceTags.MODEL), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label.uppercase(), color = Lab.colors.muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.3.sp)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { SpokenMarkedCells(cells, 26.sp, "${DifferenceTags.MODEL}-hanzi") }
            if (onPlay != null) PlayModelButton(cells, onPlay)
        }
        if (pinyin.isNotBlank()) Text(pinyin, color = Lab.colors.muted, fontSize = 16.sp)
        if (!english.isNullOrBlank()) Text(english, Modifier.testTag(DifferenceTags.MODEL_ENGLISH), color = Lab.colors.ink, fontSize = 15.sp)
        Box(Modifier.fillMaxWidth().padding(top = 6.dp).height(1.dp).background(Lab.colors.cardBorder))
    }
}

@Composable
private fun PlayModelButton(cells: List<SpokenAnswerResult.Cell>, onPlay: () -> Unit) {
    val text = cells.joinToString("") { it.char }
    Box(
        Modifier.size(44.dp).bouncyClickable(true, 0.9f, role = Role.Button, onClick = onPlay)
            .semantics { contentDescription = "Play: $text" }.testTag(DifferenceTags.PLAY_MODEL),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
            Text("▶", color = Lab.colors.ink, fontSize = 14.sp)
        }
    }
}

@Composable
private fun CompareLine(label: String, cells: List<SpokenAnswerResult.Cell>, pinyin: String, tag: String, onPlay: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().testTag(tag), verticalAlignment = Alignment.CenterVertically) {
        Text(label.uppercase(), Modifier.width(92.dp), color = Lab.colors.muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.3.sp)
        Column(Modifier.weight(1f)) {
            SpokenMarkedCells(cells, 20.sp, "$tag-hanzi")
            if (pinyin.isNotBlank()) Text(pinyin, color = Lab.colors.muted, fontSize = 13.sp)
        }
        if (onPlay != null) PlayModelButton(cells, onPlay)
    }
}

/** The held exercise's / question's line: "✓ Right — worded differently" (icon + words). */
@Composable
fun DifferenceTitle(reason: String, modifier: Modifier = Modifier) {
    Text(
        AnswerDifference.TITLE[reason].orEmpty(),
        modifier.padding(top = 6.dp).testTag(DifferenceTags.TITLE),
        color = Palette.Good, fontSize = 15.sp, fontWeight = FontWeight.Bold,
    )
}
