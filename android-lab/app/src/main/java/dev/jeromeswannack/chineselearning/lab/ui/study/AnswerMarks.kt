package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/**
 * How each character of an answer is marked on the back of the card — port of
 * `frontend/src/utils/answerDiff.ts`. Colour alone isn't enough to read it, so every mark
 * also has a shape: [Mark.CORRECT] green, no underline; [Mark.WRONG] red + a solid underline
 * (a wrong character, or an extra one past the end); [Mark.MISSING] a muted "?" + a dashed
 * underline (a character not typed / a multiple-choice row left blank).
 */
object AnswerMarks {
    enum class Mark { CORRECT, WRONG, MISSING }

    /** One character as typed / picked ("" for a missing one — drawn as "?"). */
    data class Cell(val char: String, val mark: Mark)

    data class Expected(val char: String, val matched: Boolean)

    data class TypedDiff(val typed: List<Cell>, val expected: List<Expected>)

    /**
     * Port of `typedAnswerDiff()`: position by position, by code point. Characters past the
     * end of the expected answer are WRONG (extra); positions the answer didn't reach are MISSING.
     */
    fun typedDiff(userAnswer: String, correctAnswer: String): TypedDiff {
        val user = codePoints(userAnswer)
        val target = codePoints(correctAnswer)
        val typed = ArrayList<Cell>()
        val expected = ArrayList<Expected>()
        for (i in 0 until maxOf(user.size, target.size)) {
            val u = user.getOrNull(i)
            val c = target.getOrNull(i)
            val matched = u != null && u == c
            typed += if (u != null) Cell(u, if (matched) Mark.CORRECT else Mark.WRONG) else Cell("", Mark.MISSING)
            if (c != null) expected += Expected(c, matched)
        }
        return TypedDiff(typed, expected)
    }

    /** A multiple-choice row's pick as a cell (the web's `McAnswerDiff`). */
    fun forSlot(slot: MultipleChoice.Slot): Cell {
        val chosen = slot.chosen ?: return Cell("", Mark.MISSING)
        return Cell(chosen, if (slot.status == MultipleChoice.SlotStatus.WRONG) Mark.WRONG else Mark.CORRECT)
    }

    /** Punctuation that must not start a line (Chinese line-breaking rules). */
    private const val NO_LINE_START = "，。、！？；：,.!?;:)）]】》」』”’…—%"

    /**
     * Indices grouped into wrap units: a closing punctuation mark stays with the character
     * before it, so a wrapped answer never starts a line with "，" or "。".
     */
    fun wrapGroups(chars: List<String>): List<List<Int>> {
        val groups = ArrayList<MutableList<Int>>()
        chars.forEachIndexed { i, ch ->
            if (groups.isNotEmpty() && ch.isNotEmpty() && NO_LINE_START.contains(ch)) groups.last() += i
            else groups += mutableListOf(i)
        }
        return groups
    }

    private fun codePoints(s: String): List<String> = s.codePoints().toArray().map { String(Character.toChars(it)) }
}

/** Underline thickness: thick enough to read at a glance on the Fold, next to CJK strokes. */
private val UnderlineThickness = 3.dp

/** Room under the glyph for the underline, so it never touches the character or the pinyin below. */
private val UnderlineRoom = 8.dp

/** A row of marked characters (wraps for long answers); every cell keeps the same underline room so glyphs line up. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MarkedAnswerRow(cells: List<AnswerMarks.Cell>, size: TextUnit, onChar: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.Center) {
        for (group in AnswerMarks.wrapGroups(cells.map { it.char })) {
            Row { for (i in group) MarkedChar(cells[i], size, onChar) }
        }
    }
}

/** Test tag on each character of the correct-answer line under the "↓". */
const val EXPECTED_CHAR_TAG = "answer-expected-char"

/**
 * The correct answer under the "↓": every character, wrapping onto as many lines as it needs
 * (closing punctuation kept with the character before it; a plain Row clipped long sentences at the card's edge — "…聊了两个小" for "…聊了两个小时。").
 * [matched] characters are green, the rest in [other]; each one is tappable (lookup).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ExpectedAnswerRow(chars: List<String>, matched: List<Boolean>, size: TextUnit, other: Color, onChar: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.Center) {
        for (group in AnswerMarks.wrapGroups(chars)) {
            Row {
                for (i in group) {
                    val ch = chars[i]
                    val source = remember { MutableInteractionSource() }
                    Text(
                        ch,
                        fontSize = size,
                        lineHeight = size * 1.15f,
                        color = if (matched.getOrElse(i) { false }) Palette.Good else other,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.testTag(EXPECTED_CHAR_TAG).clickable(interactionSource = source, indication = null) { onChar(ch) },
                    )
                }
            }
        }
    }
}

/**
 * One character with its mark: green when right; red with a solid underline when wrong;
 * a muted "?" with a dashed underline when missing. Characters are tappable (lookup).
 */
@Composable
fun MarkedChar(cell: AnswerMarks.Cell, size: TextUnit, onChar: (String) -> Unit) {
    val muted = Lab.colors.muted
    val source = remember { MutableInteractionSource() }
    // A missing "?" takes a full character's width, so its dashed underline reads as a slot.
    val minWidth = if (cell.mark == AnswerMarks.Mark.MISSING) with(LocalDensity.current) { size.toDp() } else 28.dp
    val (text, color) = when (cell.mark) {
        AnswerMarks.Mark.CORRECT -> cell.char to Palette.Good
        AnswerMarks.Mark.WRONG -> cell.char to Palette.Again
        AnswerMarks.Mark.MISSING -> "?" to muted
    }
    val description = when (cell.mark) {
        AnswerMarks.Mark.CORRECT -> cell.char
        AnswerMarks.Mark.WRONG -> "${cell.char}, wrong"
        AnswerMarks.Mark.MISSING -> "missing"
    }
    var modifier = Modifier
        .semantics { contentDescription = description }
        .widthIn(min = minWidth)
        .drawBehind {
            if (cell.mark == AnswerMarks.Mark.CORRECT) return@drawBehind
            val stroke = UnderlineThickness.toPx()
            val dashed = cell.mark == AnswerMarks.Mark.MISSING
            val inset = this.size.width * (if (dashed) 0.08f else 0.12f) + stroke / 2
            val y = this.size.height - UnderlineRoom.toPx() / 2
            drawLine(
                color = if (dashed) muted else Palette.Again,
                start = Offset(inset, y),
                end = Offset(this.size.width - inset, y),
                strokeWidth = stroke,
                cap = if (dashed) StrokeCap.Butt else StrokeCap.Round,
                pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())) else null,
            )
        }
        .padding(start = 3.dp, end = 3.dp, bottom = UnderlineRoom)
    if (cell.mark != AnswerMarks.Mark.MISSING) {
        modifier = modifier.clickable(interactionSource = source, indication = null) { onChar(cell.char) }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        Text(text, fontSize = size, lineHeight = size * 1.15f, color = color, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
    }
}
