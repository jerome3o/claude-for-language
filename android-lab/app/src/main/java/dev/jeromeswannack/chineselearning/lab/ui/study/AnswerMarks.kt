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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ResultState
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * How each character of an answer is marked on the back of the card — port of
 * `frontend/src/utils/answerDiff.ts`. COLOUR ONLY, like the slim answer diff (Jerome, Nov 2026: no outlines, no
 * underlines, subtler colours): [Mark.CORRECT] the "right" ink; [Mark.WRONG] the wrong mark's rose (a wrong character,
 * or an extra one past the end); [Mark.MISSING] a "?" in the missing grey (a character not typed / a multiple-choice
 * row left blank). The one-line summary above says it in words; every cell has a content description.
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

/** A row of marked characters (wraps for long answers). */
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
 * [matched] characters in the "right" ink, the rest in [other]; each one is tappable (lookup).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ExpectedAnswerRow(chars: List<String>, matched: List<Boolean>, size: TextUnit, other: Color, onChar: (String) -> Unit, newChars: Set<String> = emptySet()) {
    val right = ResultColors.ink(ResultState.RIGHT)
    FlowRow(horizontalArrangement = Arrangement.Center) {
        for (group in AnswerMarks.wrapGroups(chars)) {
            Row {
                for (i in group) {
                    val ch = chars[i]
                    val source = remember { MutableInteractionSource() }
                    // A never-seen character shimmers (NewCharShimmer.kt).
                    NewCharGlyph(
                        ch,
                        isNew = ch in newChars,
                        fontSize = size,
                        lineHeight = size * 1.15f,
                        color = if (matched.getOrElse(i) { false }) right else other,
                        fontWeight = FontWeight.Medium,
                        index = i,
                        modifier = Modifier.testTag(EXPECTED_CHAR_TAG).clickable(interactionSource = source, indication = null) { onChar(ch) },
                    )
                }
            }
        }
    }
}

/**
 * One character with its mark, colour only: the "right" ink when right; rose when wrong; a "?" in the missing grey when
 * missing. Characters are tappable (lookup).
 */
@Composable
fun MarkedChar(cell: AnswerMarks.Cell, size: TextUnit, onChar: (String) -> Unit) {
    val colors = Lab.colors
    val source = remember { MutableInteractionSource() }
    // A missing "?" takes a full character's width, so it reads as a slot.
    val minWidth = if (cell.mark == AnswerMarks.Mark.MISSING) with(LocalDensity.current) { size.toDp() } else 28.dp
    val (text, color) = when (cell.mark) {
        AnswerMarks.Mark.CORRECT -> cell.char to ResultColors.ink(ResultState.RIGHT)
        AnswerMarks.Mark.WRONG -> cell.char to colors.markWrong
        AnswerMarks.Mark.MISSING -> "?" to colors.markMissing
    }
    val description = when (cell.mark) {
        AnswerMarks.Mark.CORRECT -> cell.char
        AnswerMarks.Mark.WRONG -> "${cell.char}, wrong"
        AnswerMarks.Mark.MISSING -> "missing"
    }
    var modifier = Modifier
        .semantics { contentDescription = description }
        .widthIn(min = minWidth)
        .padding(horizontal = 3.dp)
    if (cell.mark != AnswerMarks.Mark.MISSING) {
        modifier = modifier.clickable(interactionSource = source, indication = null) { onChar(cell.char) }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        Text(text, fontSize = size, lineHeight = size * 1.15f, color = color, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
    }
}
