package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AnswerDiff
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags of the slim answer feedback. */
object AnswerDiffTags {
    const val BOX = "answer-diff"
    const val LINE = "answer-diff-line"
    const val EXPECTED = "answer-diff-expected"
    const val SAID = "answer-diff-said"
    const val CHARS = "answer-diff-chars"
    const val PLAY = "answer-diff-play"
}

/**
 * One marked cell: [kind] = the answer diff's (ok · sound · tone · wrong · extra · missing · plain) or the "You said"
 * row's "differs" (written differently: the yellow highlight + dotted underline).
 */
data class DiffCell(val text: String, val kind: String)

/** The answer diff's parts as cells. */
fun AnswerDiff.Diff.cells(): List<DiffCell> = parts.map { DiffCell(it.text, it.kind) }

/** The tone's ink (✓ green / ≈ lemon / ✕ rose), from the marks' own palette so it reads in dark mode. */
@Composable
fun answerDiffToneInk(tone: String): Color = when (tone) {
    "right" -> if (Lab.colors.card.luminance() < 0.5f) Color(0xFF4ADE80) else Color(0xFF15803D)
    "close" -> Lab.colors.markTone
    else -> Lab.colors.markWrong
}

/**
 * His answer's characters, marked (the web's `AnswerDiffChars`; shared/cards/answer-diff.ts) — a SHAPE per kind as
 * well as a colour (Jerome is red / green colour-blind): wrong = rose + tint + thick solid underline, tone off = lemon
 * wavy underline over a tint (body ink), extra = yellow highlight in a solid amber box, missing = the expected character,
 * muted, in a dashed box, a homophone = a faint dotted underline, "differs" = the yellow highlight + dotted underline.
 * [accepted] = right in other words: every difference only a quiet dotted underline.
 */
@Composable
fun DiffMarkedText(
    cells: List<DiffCell>,
    fontSize: TextUnit,
    modifier: Modifier = Modifier,
    tag: String = AnswerDiffTags.CHARS,
    accepted: Boolean = false,
    fontWeight: FontWeight = FontWeight.Medium,
) {
    val colors = Lab.colors
    val dark = colors.card.luminance() < 0.5f
    val extraBg = if (dark) Palette.PartialStrong.copy(alpha = 0.28f) else Color(0xFFFDE68A)
    val extraInk = if (dark) Palette.PartialStrong else Palette.PartialInk
    val differsBg = if (dark) Palette.PartialStrong.copy(alpha = 0.22f) else Palette.PartialStrong
    val differsInk = if (dark) Palette.PartialStrong else Palette.PartialInk
    val ranges = remember(cells, accepted) { mutableListOf<Pair<IntRange, String>>() }
    val text = remember(cells, accepted, dark) {
        ranges.clear()
        buildAnnotatedString {
            if (cells.isEmpty()) append("…")
            for (c in cells) {
                val start = length
                val kind = if (accepted && c.kind in setOf("wrong", "extra", "tone", "differs")) "quiet" else c.kind
                val style = when (kind) {
                    "wrong" -> SpanStyle(color = colors.markWrong)
                    "extra" -> SpanStyle(color = extraInk, background = extraBg)
                    "missing" -> SpanStyle(color = colors.muted)
                    "plain" -> SpanStyle(color = colors.ink)
                    "muted" -> SpanStyle(color = colors.muted)
                    "differs" -> SpanStyle(color = differsInk, background = differsBg)
                    else -> SpanStyle(color = colors.ink)
                }
                withStyle(style) { append(c.text) }
                if (length > start && kind != "ok" && kind != "plain" && kind != "muted") ranges += (start until length) to kind
            }
        }
    }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val density = LocalDensity.current
    Text(
        text,
        fontSize = fontSize,
        lineHeight = fontSize * 1.45f,
        fontWeight = fontWeight,
        onTextLayout = { layout = it },
        modifier = modifier.testTag(tag).drawBehind {
            val l = layout ?: return@drawBehind
            if (l.layoutInput.text != text) return@drawBehind
            val em = fontSize.toPx()
            for ((range, kind) in ranges) {
                for (offset in range) {
                    if (offset >= text.length || text[offset].isLowSurrogate()) continue
                    val box = l.getBoundingBox(offset)
                    val base = l.getLineBaseline(l.getLineForOffset(offset))
                    drawDiffMark(kind, box.left, box.right, base - em * 0.92f, base + em * 0.24f, base + em * 0.18f, colors.markWrong, colors.markWrongTint, colors.markTone, colors.markToneTint, colors.muted, differsInk, density.density)
                }
            }
        },
    )
}

private fun DrawScope.drawDiffMark(
    kind: String, left: Float, right: Float, top: Float, bottom: Float, lineY: Float,
    wrong: Color, wrongTint: Color, tone: Color, toneTint: Color, muted: Color, differs: Color, dp: Float,
) {
    when (kind) {
        "wrong" -> {
            drawRoundRect(wrongTint, Offset(left, top), Size(right - left, bottom - top), CornerRadius(3 * dp))
            drawLine(wrong, Offset(left, lineY), Offset(right, lineY), strokeWidth = 3 * dp)
        }
        "tone" -> {
            drawRoundRect(toneTint, Offset(left, top), Size(right - left, bottom - top), CornerRadius(3 * dp))
            val amp = 1.7f * dp
            val half = 3f * dp
            val path = Path().apply {
                moveTo(left, lineY)
                var x = left
                var up = true
                while (x < right) {
                    val nx = minOf(x + half, right)
                    quadraticTo((x + nx) / 2, lineY + if (up) -amp * 2 else amp * 2, nx, lineY)
                    x = nx
                    up = !up
                }
            }
            drawPath(path, tone, style = Stroke(width = 1.6f * dp, cap = StrokeCap.Round))
        }
        "missing" -> drawRoundRect(
            muted, Offset(left + dp, top + dp), Size(right - left - 2 * dp, bottom - top - 2 * dp), CornerRadius(3 * dp),
            style = Stroke(width = 1.5f * dp, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.5f * dp, 2.5f * dp))),
        )
        // An extra is a solid amber box (never a strike: a line through 了 reads as 子).
        "extra" -> drawRoundRect(
            differs, Offset(left + dp * 0.5f, top + dp * 0.5f), Size(right - left - dp, bottom - top - dp), CornerRadius(3 * dp),
            style = Stroke(width = 1.5f * dp),
        )
        "sound", "quiet", "differs" -> drawLine(
            if (kind == "differs") differs else muted, Offset(left, lineY), Offset(right, lineY), strokeWidth = 1.6f * dp, cap = StrokeCap.Round,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(0.1f, 3.6f * dp)),
        )
    }
}

/**
 * The slim answer feedback (the web's components/study/AnswerDiff.tsx; core [AnswerDiff]; docs/STUDY_SESSION.md
 * "Answer feedback: one line and a diff"): ONE short line that says what differs (icon + words, never colour alone;
 * [verdict] = Claude's / Hard mode's chip in front of it), the expected answer once (▶ when it can be played), and his
 * answer lined up with it character by character. No explanations, tips or reasons.
 */
@Composable
fun AnswerDiffView(
    said: String,
    expected: String,
    modifier: Modifier = Modifier,
    expectedPinyin: String? = null,
    expectedEnglish: String? = null,
    expectedLabel: String = "Answer",
    showExpected: Boolean = true,
    onPlayExpected: (() -> Unit)? = null,
    accepted: Boolean = false,
    headline: String? = null,
    /** (tone, label) — core AnswerDiff.verdict(…). */
    verdict: Pair<String, String>? = null,
    hideLine: Boolean = false,
    saidLabel: String = AnswerDiff.YOU_SAID,
    tag: String = AnswerDiffTags.BOX,
    expectedTag: String = AnswerDiffTags.EXPECTED,
    saidTag: String = AnswerDiffTags.SAID,
    playTag: String = AnswerDiffTags.PLAY,
    /** Under the diff (🎤 Read it again …). */
    content: @Composable () -> Unit = {},
) {
    val diff = remember(said, expected) { AnswerDiff.of(said, expected) }
    val full = AnswerDiff.line(diff, accepted, headline)
    // Under a "✓ Also right" chip, "Right — worded differently" says "right" twice: just "Worded differently".
    val text = if (verdict?.first == "right" && full.startsWith("Right — ")) full.removePrefix("Right — ").replaceFirstChar { it.uppercase() } else full
    val tone = verdict?.first ?: AnswerDiff.tone(diff, accepted)
    val pinyin = remember(expected, expectedPinyin, showExpected) {
        expectedPinyin?.trim()?.ifEmpty { null } ?: if (showExpected) tidyYouSaidPinyin(devicePinyinLine(expected)) else ""
    }
    Column(modifier.fillMaxWidth().testTag(tag), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!hideLine) {
            val ink = answerDiffToneInk(tone)
            Row(
                Modifier.fillMaxWidth().testTag(AnswerDiffTags.LINE).semantics { contentDescription = listOfNotNull(verdict?.second, text).joinToString(" · ") },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(AnswerDiff.icon(tone), color = ink, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Spacer6()
                if (verdict != null) {
                    Text(verdict.second, color = ink, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    Text(" · ", color = Lab.colors.muted, fontSize = 15.sp)
                }
                Text(text, color = Lab.colors.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
        }
        if (showExpected) {
            Row(Modifier.fillMaxWidth().testTag(expectedTag), verticalAlignment = Alignment.Top) {
                DiffLabel(expectedLabel)
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(expected, Modifier.weight(1f, fill = false), color = Lab.colors.ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                        if (onPlayExpected != null) {
                            Box(
                                Modifier.size(44.dp).bouncyClickable(true, 0.9f, role = Role.Button, onClick = onPlayExpected)
                                    .semantics { contentDescription = "Play: $expected" }.testTag(playTag),
                                contentAlignment = Alignment.Center,
                            ) {
                                Box(Modifier.size(38.dp).clip(CircleShape).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
                                    Text("▶", color = Lab.colors.ink, fontSize = 13.sp)
                                }
                            }
                        }
                    }
                    if (pinyin.isNotBlank()) Text(pinyin, color = Lab.colors.muted, fontSize = 14.sp)
                    if (!expectedEnglish.isNullOrBlank()) Text(expectedEnglish, Modifier.testTag("$expectedTag-english"), color = Lab.colors.ink, fontSize = 14.sp)
                }
            }
        }
        if (!diff.empty) {
            val label = AnswerDiff.label(diff, text, saidLabel)
            Row(Modifier.fillMaxWidth().testTag(saidTag).clearAndSetSemantics { contentDescription = label }, verticalAlignment = Alignment.Top) {
                DiffLabel(saidLabel)
                DiffMarkedText(diff.cells(), 22.sp, Modifier.weight(1f), accepted = accepted)
            }
        }
        content()
    }
}

@Composable
private fun Spacer6() = Box(Modifier.width(6.dp))

@Composable
private fun DiffLabel(label: String) {
    Text(
        label.uppercase(), Modifier.width(84.dp).padding(top = 6.dp),
        color = Lab.colors.muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.3.sp,
    )
}
