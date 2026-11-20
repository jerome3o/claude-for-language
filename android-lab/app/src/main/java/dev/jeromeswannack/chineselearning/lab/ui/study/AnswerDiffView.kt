package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AnswerDiff
import dev.jeromeswannack.chineselearning.lab.core.AnswerWhy
import dev.jeromeswannack.chineselearning.lab.core.ResultState
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Test tags of the slim answer feedback. */
object AnswerDiffTags {
    const val BOX = "answer-diff"
    const val LINE = "answer-diff-line"
    const val EXPECTED = "answer-diff-expected"
    const val SAID = "answer-diff-said"
    const val CHARS = "answer-diff-chars"
    const val PLAY = "answer-diff-play"
    const val SAID_PINYIN = "answer-diff-said-pinyin"
}

private val HAN = Regex("\\p{IsHan}")

/**
 * The pinyin line under "You said" (the web's `AnswerDiffPinyin`; core [AnswerDiff.pinyinLine]; Jerome, Nov 2026: "the
 * stuff that I said that was incorrect also has pinyin, so I can see where my pronunciation was"): HIS syllables — the
 * device's own pinyin of what he said (+ 一 / 不), never a network call — in the answer's pinyin style, his wrong /
 * tone-off / extra syllables in the same colour as those characters. Parts that don't line up → the device's plain line.
 */
@Composable
fun DiffPinyinLine(
    diff: AnswerDiff.Diff,
    said: String,
    modifier: Modifier = Modifier,
    accepted: Boolean = false,
    fontSize: TextUnit = 14.sp,
    tag: String = AnswerDiffTags.SAID_PINYIN,
    textAlign: androidx.compose.ui.text.style.TextAlign? = null,
) {
    val colors = Lab.colors
    val syllables = remember(diff) { AnswerDiff.pinyinLine(diff) }
    val plain = remember(syllables, said) { if (syllables != null || !HAN.containsMatchIn(said)) "" else tidyYouSaidPinyin(devicePinyinLine(said)) }
    if (syllables == null && plain.isBlank()) return
    val text = remember(syllables, plain, accepted, colors) {
        buildAnnotatedString {
            if (syllables == null) { append(plain); return@buildAnnotatedString }
            syllables.forEachIndexed { i, s ->
                if (i > 0) append(" ")
                val color = if (accepted) null else when (s.kind) {
                    "wrong" -> colors.markWrong
                    "tone" -> colors.markTone
                    "extra" -> colors.markExtra
                    else -> null
                }
                if (color == null) append(s.text) else withStyle(SpanStyle(color = color)) { append(s.text) }
            }
        }
    }
    Text(text, modifier.testTag(tag), color = colors.muted, fontSize = fontSize, lineHeight = fontSize * 1.35f, textAlign = textAlign)
}

/**
 * One marked cell: [kind] = the answer diff's (ok · sound · tone · wrong · extra · missing · plain) or the "You said"
 * row's "differs" (written differently — sounded right) / "muted" (the words around a contained answer).
 */
data class DiffCell(val text: String, val kind: String)

/** The answer diff's parts as cells. */
fun AnswerDiff.Diff.cells(): List<DiffCell> = parts.map { DiffCell(it.text, it.kind) }

/** The tone's ink (✓ green / ≈ amber / ✕ rose) — the result state's "right" ink, the marks' own tone / wrong colours. */
@Composable
fun answerDiffToneInk(tone: String): Color = when (tone) {
    "right" -> ResultColors.ink(ResultState.RIGHT)
    "close" -> Lab.colors.markTone
    else -> Lab.colors.markWrong
}

/** A marked cell's words for a screen reader ("测 — wrong", "院 — missing"); null = not marked. */
fun diffCellLabel(c: DiffCell): String? = when (c.kind) {
    "wrong" -> "${c.text} — wrong"
    "tone" -> "${c.text} — tone off"
    "extra" -> "${c.text} — extra"
    "missing" -> "missing ${c.text}"
    "sound", "differs" -> "${c.text} — sounded right, written differently"
    else -> null
}

/** The whole marked text for a screen reader: what was said, then each marked character by name. */
fun diffCellsLabel(cells: List<DiffCell>): String {
    val said = cells.filter { it.kind != "missing" }.joinToString("") { it.text }.ifEmpty { "…" }
    val marked = cells.mapNotNull(::diffCellLabel)
    return if (marked.isEmpty()) said else "$said. ${marked.joinToString("; ")}."
}

/**
 * His answer's characters, marked (the web's `AnswerDiffChars`; shared/cards/answer-diff.ts) — COLOUR ONLY (Jerome,
 * Nov 2026: "we don't need the outlines and the color and the underlines"): the character itself in its mark's colour
 * ([LabColors.markWrong] rose, [LabColors.markTone] amber = tone off, [LabColors.markExtra] violet, [LabColors.markMissing]
 * grey = the expected character he left out); a homophone ("sound" / "differs") counts as right and has no mark. No box,
 * tint or underline. Colour is never the only signal: the node's content description names each marked character
 * ([diffCellsLabel], or [label]; a parent's `clearAndSetSemantics` replaces it with the whole diff's sentence) and the
 * line above says it in words. [accepted] = right in other words: every difference in body ink.
 */
@Composable
fun DiffMarkedText(
    cells: List<DiffCell>,
    fontSize: TextUnit,
    modifier: Modifier = Modifier,
    tag: String = AnswerDiffTags.CHARS,
    accepted: Boolean = false,
    fontWeight: FontWeight = FontWeight.Medium,
    /** The node's content description (default: [diffCellsLabel]; "" = none — a parent row that merges says it all). */
    label: String? = null,
) {
    val colors = Lab.colors
    val text = remember(cells, accepted, colors) {
        buildAnnotatedString {
            if (cells.isEmpty()) append("…")
            for (c in cells) {
                val kind = if (accepted && c.kind in setOf("wrong", "extra", "tone")) "ok" else c.kind
                val color = when (kind) {
                    "wrong" -> colors.markWrong
                    "tone" -> colors.markTone
                    "extra" -> colors.markExtra
                    "missing" -> colors.markMissing
                    "muted" -> colors.muted
                    else -> colors.ink
                }
                withStyle(SpanStyle(color = color)) { append(c.text) }
            }
        }
    }
    val description = label ?: remember(cells) { diffCellsLabel(cells) }
    Text(
        text,
        fontSize = fontSize,
        lineHeight = fontSize * 1.45f,
        fontWeight = fontWeight,
        modifier = (if (description.isEmpty()) modifier else modifier.semantics { contentDescription = description }).testTag(tag),
    )
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
    /**
     * The check that judged it (Claude's answer / sentence check, the read-take check's reason): its headline / first
     * tip is the ONE why sentence under the diff, its tips / fix / alternative what "Explain more ›" opens (core
     * [AnswerWhy]). None: the device's own reason where it has one (a homophone); [headline] alone works too.
     */
    check: AnswerWhy.Check? = null,
    /**
     * "Explain more ›" with nothing on hand: Ask Claude about this answer. Default: the card's Claude thread when the
     * surface provides one ([LocalAnswerAsk]) — which also offers the small "💬 Ask Claude" link when the check gave no
     * reason at all (core `AnswerWhy.askOffered`).
     */
    onExplainMore: (() -> Unit)? = null,
    /** What he was asked (the English he said in Chinese), for Ask Claude's question; default [expectedEnglish]. */
    askPrompt: String? = null,
    /** Off: no Ask Claude here — while Claude is still checking, or while the answer is still hidden. */
    askable: Boolean = true,
    /** Analytics: the surface (study.answer_why_more). */
    whySurface: String = "answer_diff",
    /** A WRITTEN answer (typed / handwritten characters): judged by the characters — a homophone is wrong. */
    written: Boolean = false,
    /** Under the diff (🎤 Read it again …). */
    content: @Composable () -> Unit = {},
) {
    val diff = remember(said, expected, written) { AnswerDiff.of(said, expected, written) }
    val full = AnswerDiff.line(diff, accepted, headline)
    // Under a "✓ Also right" chip, "Right — worded differently" says "right" twice: just "Worded differently".
    val text = if (verdict?.first == "right" && full.startsWith("Right — ")) full.removePrefix("Right — ").replaceFirstChar { it.uppercase() } else full
    val tone = verdict?.first ?: AnswerDiff.tone(diff, accepted)
    val pinyin = remember(expected, expectedPinyin, showExpected) {
        expectedPinyin?.trim()?.ifEmpty { null } ?: if (showExpected) tidyYouSaidPinyin(devicePinyinLine(expected)) else ""
    }
    val whyCheck = check ?: headline?.takeIf { it.isNotBlank() }?.let { AnswerWhy.Check(headline = it) }
    val why = remember(diff, whyCheck, text) { AnswerWhy.why(diff, whyCheck, text) }
    val more = remember(whyCheck, why, said, expected, showExpected) { AnswerWhy.more(whyCheck, why, said, if (showExpected) expected else "") }
    // Ask Claude about this answer: the surface's own path, else the card's Claude thread (when it can be reached).
    val askCard = LocalAnswerAsk.current?.takeIf { !written }?.let { ask ->
        { ask(AnswerWhy.askQuestion(said, expected, askPrompt ?: expectedEnglish, spoken = saidLabel == AnswerDiff.YOU_SAID)) }
    }
    val onAsk = if (askable) onExplainMore ?: askCard else null
    // Nothing explains a not-right answer: one small "💬 Ask Claude" link (never when a why + Explain more is there).
    val askFallback = onAsk?.takeIf { AnswerWhy.askOffered(tone, why, more, canAsk = true) }
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
                Column(Modifier.weight(1f)) {
                    DiffMarkedText(diff.cells(), 22.sp, accepted = accepted)
                    // His own pinyin, his wrong syllables marked like the characters (wǔzhù under wǔrǔ).
                    DiffPinyinLine(diff, said, accepted = accepted)
                }
            }
            AnswerWhyLine(why, more, onAsk, whySurface, askFallback = askFallback)
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
