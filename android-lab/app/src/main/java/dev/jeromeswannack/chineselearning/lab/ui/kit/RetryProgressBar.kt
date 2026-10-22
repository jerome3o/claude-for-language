package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.RetryBar
import dev.jeromeswannack.chineselearning.lab.core.RetryBarUnit
import dev.jeromeswannack.chineselearning.lab.core.RetryBars
import dev.jeromeswannack.chineselearning.lab.ui.study.animationsDisabled
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Test tag of the retry progress bar (its semantics carry [RetryBars.label]). */
const val RETRY_BAR_TAG = "retry-progress-bar"

/** The bar's colours: blue done, orange owed with a hatch, the "↺ N" ink. */
private data class RetryBarColors(val done: Color, val retry: Color, val hatch: Color, val badge: Color)

private val LightBar = RetryBarColors(Color(0xFF3B82F6), Color(0xFFF97316), Color(0xFFFDBA74), Color(0xFFC2410C))
private val DarkBar = RetryBarColors(Color(0xFF60A5FA), Color(0xFFFB923C), Color(0xFF9A3412), Color(0xFFFDBA74))

/**
 * The retry progress bar (docs/HOMEWORK.md §3c; web components/homework/RetryProgressBar.tsx):
 * blue = steps done from the left, orange (hatched) = "Not yet" items still owed at the RIGHT end,
 * the track between = items not shown yet. When the blue reaches the orange the learner is on cards
 * already seen. The numbers come from core [RetryBars] (`passRetryBar` for a pass, `retryBar` from
 * counts), so any pass with retries can use it — homework word passes; mini-lesson homework next.
 *
 * Colour-blind safe: blue vs orange, the orange is hatched, and "↺ 3" sits at its right end. The
 * badge's slot is always kept (when [showBadge]) so the track never shrinks — the blue would look
 * as if it went backwards. Animates with a soft spring; none with the system's "remove animations".
 */
@Composable
fun RetryProgressBar(
    bar: RetryBar,
    modifier: Modifier = Modifier,
    unit: RetryBarUnit = RetryBars.WORD_UNIT,
    showBadge: Boolean = true,
    height: Dp = 8.dp,
) {
    val colors = if (Lab.colors.background.luminance() < 0.5f) DarkBar else LightBar
    val track = Lab.colors.faint
    val context = LocalContext.current
    val still = remember { animationsDisabled(context) }
    val spec: AnimationSpec<Float> = if (still) snap() else spring(dampingRatio = 0.9f, stiffness = 160f)
    val done by animateFloatAsState(bar.doneFraction.toFloat(), spec, label = "retry-bar-done")
    val retry by animateFloatAsState(bar.retryFraction.toFloat(), spec, label = "retry-bar-retry")
    val label = RetryBars.label(bar, unit)
    val owed = bar.retries > 0
    Row(
        modifier
            .semantics(mergeDescendants = true) {
                contentDescription = label
                progressBarRangeInfo = ProgressBarRangeInfo(bar.answered.toFloat(), 0f..maxOf(bar.slots, 1).toFloat())
            }
            .testTag(RETRY_BAR_TAG),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Canvas(Modifier.weight(1f).height(height)) {
            val radius = CornerRadius(size.height / 2, size.height / 2)
            drawRoundRect(track, cornerRadius = radius)
            val outline = Path().apply { addRoundRect(RoundRect(Rect(Offset.Zero, size), radius)) }
            clipPath(outline) {
                // The owed retries, from the right end leftwards; one retry in a long pass still shows.
                val rw = maxOf(retry * size.width, if (owed) 8.dp.toPx() else 0f).coerceAtMost(size.width)
                if (rw > 0.5f) {
                    val left = size.width - rw
                    drawRect(colors.retry, topLeft = Offset(left, 0f), size = Size(rw, size.height))
                    clipRect(left, 0f, size.width, size.height) {
                        val step = 6.dp.toPx()
                        val stroke = 2.dp.toPx()
                        var x = left - size.height
                        while (x < size.width) {
                            drawLine(colors.hatch, Offset(x, size.height), Offset(x + size.height, 0f), strokeWidth = stroke)
                            x += step
                        }
                    }
                }
                val dw = done.coerceIn(0f, 1f) * size.width
                if (dw > 0.5f) drawRoundRect(colors.done, size = Size(dw, size.height), cornerRadius = radius)
            }
        }
        if (showBadge) {
            Text(
                RetryBars.badge(bar) ?: "",
                modifier = Modifier.widthIn(min = 34.dp),
                textAlign = TextAlign.End,
                color = colors.badge,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
    }
}
