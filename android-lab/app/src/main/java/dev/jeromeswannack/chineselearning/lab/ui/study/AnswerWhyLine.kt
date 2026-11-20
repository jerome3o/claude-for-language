package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AnswerWhy
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Test tags of the why line. */
object AnswerWhyTags {
    const val BOX = "answer-why"
    const val TEXT = "answer-why-text"
    const val MORE = "answer-why-more"
    const val DETAIL = "answer-why-detail"
    const val ASK = "answer-ask-claude"
}

/**
 * The ONE "why" sentence under an answer's verdict + diff, with a small "Explain more ›" (the web's
 * components/study/AnswerWhy.tsx; core [AnswerWhy]; docs/STUDY_SESSION.md "Answer feedback: one line and a diff").
 * Muted text, no box — the result-state colour stays on the verdict. "Explain more ›" opens what the check already
 * returned IN PLACE (its tips, the corrected line, an alternative), no new call; with nothing on hand it asks Claude
 * about this answer ([onAsk]) where the surface has that path. Collapsed by default, open for this showing only.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AnswerWhyLine(
    why: String?,
    more: AnswerWhy.More?,
    onAsk: (() -> Unit)? = null,
    surface: String = "answer_diff",
    /**
     * No why and nothing more, the answer not right (core `AnswerWhy.askOffered`): the one small "💬 Ask Claude" link —
     * it opens the card's Claude thread with the question, his answer and the expected one.
     */
    askFallback: (() -> Unit)? = null,
) {
    val app = LocalContext.current.applicationContext as? LabApp
    val colors = Lab.colors
    if (why.isNullOrEmpty() && more == null) {
        if (askFallback == null) return
        Box(
            Modifier.heightIn(min = 44.dp)
                .bouncyClickable(pressedScale = 0.95f, role = Role.Button) {
                    app?.analytics?.track("study.answer_why_more", mapOf("surface" to surface, "action" to "ask_fallback"))
                    askFallback()
                }
                .testTag(AnswerWhyTags.ASK),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(AnswerWhy.ASK_CLAUDE, color = colors.muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
        return
    }
    var open by remember(why, more) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().testTag(AnswerWhyTags.BOX)) {
        FlowRow(verticalArrangement = Arrangement.Center) {
            if (!why.isNullOrEmpty()) {
                Text(why, Modifier.align(Alignment.CenterVertically).padding(end = 6.dp).testTag(AnswerWhyTags.TEXT), color = colors.muted, fontSize = 14.sp, lineHeight = 20.sp)
            }
            if (more != null || onAsk != null) {
                Box(
                    Modifier.heightIn(min = 44.dp)
                        .bouncyClickable(pressedScale = 0.95f, role = Role.Button) {
                            if (more == null) {
                                app?.analytics?.track("study.answer_why_more", mapOf("surface" to surface, "action" to "ask"))
                                onAsk?.invoke()
                            } else {
                                app?.analytics?.track("study.answer_why_more", mapOf("surface" to surface, "action" to if (open) "close" else "open"))
                                open = !open
                            }
                        }
                        .semantics { contentDescription = if (open) AnswerWhy.LESS else "Explain more" }
                        .testTag(AnswerWhyTags.MORE),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(if (open) AnswerWhy.LESS else AnswerWhy.MORE, color = colors.muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        if (open && more != null) {
            Column(Modifier.fillMaxWidth().testTag(AnswerWhyTags.DETAIL), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (t in more.tips) Text(t, color = colors.muted, fontSize = 14.sp, lineHeight = 20.sp)
                for ((label, zh) in listOfNotNull(more.corrected?.let { AnswerWhy.CORRECTED to it }, more.alternative?.let { AnswerWhy.ALTERNATIVE to it })) {
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = colors.muted)) { append(label) }
                            append(" ")
                            withStyle(SpanStyle(color = colors.ink)) { append(zh) }
                        },
                        fontSize = 14.sp, lineHeight = 20.sp,
                    )
                }
            }
        }
    }
}
