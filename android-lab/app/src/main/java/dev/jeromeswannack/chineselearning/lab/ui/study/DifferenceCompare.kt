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
 * "You said" vs the model answer (the web's components/study/DifferenceCompare.tsx; docs/STUDY_SESSION.md "Right, but
 * said differently"): now the slim answer diff ([AnswerDiffView], core AnswerDiff) — ONE line that says what differs,
 * the model once (▶), his answer lined up with it. A thin wrapper so the callers and test tags stay.
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
    /** The model's English under it. */
    answerFirstEnglish: String? = null,
    @Suppress("UNUSED_PARAMETER") answerFirst: Boolean = false,
    /** Claude's / Hard mode's verdict as the line's chip (core AnswerDiff.verdict). */
    verdict: Pair<String, String>? = null,
    headline: String? = null,
    /** The check that judged it: the one why sentence + "Explain more ›" (core AnswerWhy). */
    check: dev.jeromeswannack.chineselearning.lab.core.AnswerWhy.Check? = null,
    hideLine: Boolean = false,
    /** What he was asked (the English he said in Chinese), for Ask Claude's question. */
    askPrompt: String? = null,
    /** Off while Claude is still checking. */
    askable: Boolean = true,
    content: @Composable () -> Unit = {},
) {
    AnswerDiffView(
        said, model, modifier.padding(vertical = 2.dp),
        expectedPinyin = modelPinyin, expectedEnglish = answerFirstEnglish, expectedLabel = modelLabel,
        onPlayExpected = onPlayModel, accepted = accepted, headline = headline, verdict = verdict, hideLine = hideLine,
        check = check, whySurface = "sentence_round", askPrompt = askPrompt, askable = askable,
        tag = DifferenceTags.COMPARE, expectedTag = DifferenceTags.MODEL, saidTag = DifferenceTags.SAID, playTag = DifferenceTags.PLAY_MODEL,
        content = content,
    )
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
