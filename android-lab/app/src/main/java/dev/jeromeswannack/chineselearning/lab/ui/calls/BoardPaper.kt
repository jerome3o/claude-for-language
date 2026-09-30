package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SwitchDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * The call's boards are always a light "paper", in the light AND the dark theme (web: the same
 * decision): dark ink on white, so what the tutor writes reads the same on both screens. Everything
 * inside the text board and the drawing board takes its colours from here — never from
 * `Lab.colors`, whose ink is light in the dark theme. Other people's carets / flags keep their
 * presence colours.
 */
object BoardPaper {
    val Paper = Color.White
    /** Around the drawing canvas and under the toolbars. */
    val Surround = Color(0xFFF3F4F6)
    val Ink = Color(0xFF111827)
    val Caret = Color(0xFF111827)
    val Muted = Color(0xFF6B7280)
    /** The tab-complete offer after the caret. */
    val Ghost = Color(0xFF9CA3AF)
    val Border = Color(0xFFE5E7EB)
    /** The selection helper row (pinyin + meaning of the selected Chinese). */
    val HelperBg = Color(0xFFF9FAFB)
    val HelperText = Color(0xFF111827)
    val HelperPinyin = Color(0xFF2563EB)
    val HelperMeaning = Color(0xFF374151)
    /** The "⇥ …" tab-complete chip. */
    val ChipBg = Color(0xFFEEF2FF)
    val ChipText = Color(0xFF3730A3)
    val ChipBorder = Color(0xFFC7D2FE)
    val Accent = Color(0xFF2563EB)
    val AccentSoft = Color(0xFFDBEAFE)

    @Composable
    fun switchColors() = SwitchDefaults.colors(
        checkedThumbColor = Color.White, checkedTrackColor = Accent, checkedBorderColor = Accent,
        uncheckedThumbColor = Muted, uncheckedTrackColor = Border, uncheckedBorderColor = Muted,
    )

    @Composable
    fun fieldColors(text: Color = Ink) = OutlinedTextFieldDefaults.colors(
        focusedTextColor = text, unfocusedTextColor = text,
        focusedContainerColor = Paper, unfocusedContainerColor = Paper,
        focusedBorderColor = Accent, unfocusedBorderColor = Border,
        cursorColor = Caret, focusedPlaceholderColor = Muted, unfocusedPlaceholderColor = Muted,
    )
}
