package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ResultState
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * ONE look for every judged result (core [ResultState], the web's index.css `--result-*` + `.result-surface`;
 * docs/STUDY_SESSION.md "One look for every result"). Jerome, Nov 2026: the yellow box but not the green one was "a
 * discrepancy in the UX". Every surface that shows a verdict — "You said", Hard mode's check, the Sentence round's
 * exercises, a sentence row's take, a typed answer on the back, the right moment — draws its state with these: one
 * colour (the outline + tint) and one ink (chip, icon, words) per state, the same surface for all of them.
 */
object ResultColors {
    @Composable
    private fun dark(): Boolean = Lab.colors.card.luminance() < 0.5f

    /** The state's colour: the outline and the tint (muted, never fluorescent). Close is YELLOW, never orange. */
    @Composable
    fun tone(state: String): Color = if (dark()) when (state) {
        ResultState.RIGHT -> Color(0xFF22C55E)
        ResultState.CLOSE -> Color(0xFFFACC15)
        ResultState.WRONG -> Color(0xFFEF4444)
        else -> Color(0xFF60A5FA)
    } else when (state) {
        ResultState.RIGHT -> Color(0xFF16A34A)
        ResultState.CLOSE -> Color(0xFFEAB308)
        ResultState.WRONG -> Color(0xFFDC2626)
        else -> Color(0xFF3B82F6)
    }

    /** The state's ink: chips, icons, titles — readable on the card in both themes. */
    @Composable
    fun ink(state: String): Color = if (dark()) when (state) {
        ResultState.RIGHT -> Color(0xFF4ADE80)
        ResultState.CLOSE -> Color(0xFFFDE047)
        ResultState.WRONG -> Color(0xFFF87171)
        else -> Color(0xFF93C5FD)
    } else when (state) {
        ResultState.RIGHT -> Color(0xFF15803D)
        ResultState.CLOSE -> Color(0xFF854D0E)
        ResultState.WRONG -> Color(0xFFB91C1C)
        else -> Color(0xFF1D4ED8)
    }

    /** The state's chip fill (its colour, lightly). */
    @Composable
    fun chip(state: String): Color = tone(state).copy(alpha = 0.16f)
}

/** The surface's shape ([ResultState.SURFACE_RADIUS]). */
val ResultShape = RoundedCornerShape(ResultState.SURFACE_RADIUS.dp)

/** The one result surface: a light 1dp outline in the state's colour and a faint tint of it. */
fun Modifier.resultSurface(state: String): Modifier = composed {
    val c = ResultColors.tone(state)
    this
        .clip(ResultShape)
        .background(c.copy(alpha = ResultState.SURFACE_TINT))
        .border(ResultState.SURFACE_BORDER_WIDTH.dp, c.copy(alpha = ResultState.SURFACE_BORDER), ResultShape)
}
