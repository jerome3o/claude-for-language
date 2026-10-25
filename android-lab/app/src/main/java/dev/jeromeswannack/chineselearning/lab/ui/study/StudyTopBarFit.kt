package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts

/** The counts' type size and the padding around each number (QueueCountsBar). */
data class CountsStyle(val fontSp: Float, val padDp: Float, val plusSp: Float, val plusPadDp: Float)

/**
 * How the study top bar fits on this width (Jerome, Pixel Fold folded, 412 dp: "132" broke onto two
 * lines once the 🎯 chip joined 📖 1 and ✈ Auto). The counts NEVER wrap: the chips give way first
 * (🎯 / ✈ become 44 dp icon buttons with the state as a dot / colour, the label in their content
 * description), then the numbers get smaller, then the "📖 1" chip steps aside. The widest level that
 * fits wins; the last one is used whatever (and the numbers are single-line text regardless).
 */
object StudyTopBarFit {
    data class Level(val compactChips: Boolean, val counts: CountsStyle, val showTodayLeft: Boolean)

    val FULL = Level(false, CountsStyle(17f, 7f, 13f, 1f), true)
    val LEVELS = listOf(
        FULL,
        Level(true, CountsStyle(17f, 5f, 13f, 1f), true),
        Level(true, CountsStyle(15f, 3f, 12f, 0.5f), true),
        Level(true, CountsStyle(14f, 2f, 11f, 0f), false),
    )

    /** The icon buttons (✕, ↺): Material's 48 dp. */
    const val ICON_BUTTON_DP = 48f
    /** A compact chip: a 44 dp touch target. */
    const val COMPACT_CHIP_DP = 44f
    /** The row's horizontal padding (8 dp each side) plus a little slack for rounding / the active count's 1.1× pop. */
    const val SLACK_DP = 16f + 6f

    /**
     * The first level whose widths fit [availableDp] (the bar's whole width). [countsDp] = the numbers' row at
     * that level, [chipsDp] = everything else on the right at that level (today chip, 🎯, ✈ and their gaps).
     */
    fun choose(availableDp: Float, countsDp: (Level) -> Float, chipsDp: (Level) -> Float): Level =
        LEVELS.firstOrNull { level -> SLACK_DP + 2 * ICON_BUTTON_DP + countsDp(level) + chipsDp(level) <= availableDp } ?: LEVELS.last()
}

/** What the top bar's right-hand chips say, for measuring (null = not shown). */
data class TopBarChips(val todayLeft: String?, val hardModeLabel: String?, val offlineLabel: String)

/** [StudyTopBarFit.choose] with the real text widths of this device (font scale included). */
@Composable
fun rememberTopBarLevel(maxWidth: Dp, counts: QueueCounts, chips: TopBarChips): StudyTopBarFit.Level {
    val measurer = rememberTextMeasurer(cacheSize = 32)
    val density = LocalDensity.current
    return remember(maxWidth, counts, chips, density) {
        fun widthDp(text: String, sp: Float, bold: Boolean = true): Float = with(density) {
            measurer.measure(text, TextStyle(fontSize = sp.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.SemiBold), softWrap = false, maxLines = 1)
                .size.width.toDp().value
        }
        val numbers = listOf(counts.new, counts.secondaryNew, counts.learning, counts.review)
        StudyTopBarFit.choose(
            maxWidth.value,
            countsDp = { level ->
                val s = level.counts
                numbers.sumOf { (widthDp("$it", s.fontSp) + 2 * s.padDp).toDouble() }.toFloat() +
                    3 * (widthDp("+", s.plusSp, bold = false) + 2 * s.plusPadDp) + 4f
            },
            chipsDp = { level ->
                val today = if (chips.todayLeft != null && level.showTodayLeft) widthDp(chips.todayLeft, 12f, bold = false) + 20f else 0f
                val hard = when {
                    chips.hardModeLabel == null -> 0f
                    level.compactChips -> StudyTopBarFit.COMPACT_CHIP_DP + 2f
                    else -> widthDp(chips.hardModeLabel, 13f, bold = false) + 20f + 6f
                }
                val offline = if (level.compactChips) StudyTopBarFit.COMPACT_CHIP_DP else widthDp("✈", 13f, bold = false) + 4f + widthDp(chips.offlineLabel, 13f, bold = false) + 20f
                today + hard + offline
            },
        )
    }
}

/** A compact chip's touch target (44 dp). */
internal val CompactChipSize: Dp = StudyTopBarFit.COMPACT_CHIP_DP.dp
