package dev.jeromeswannack.chineselearning.lab.ui.progress

import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.KnownChartMode
import dev.jeromeswannack.chineselearning.lab.core.KnownRate
import dev.jeromeswannack.chineselearning.lab.core.KnownRates
import dev.jeromeswannack.chineselearning.lab.core.SeriesPace
import dev.jeromeswannack.chineselearning.lab.core.WeekGain
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant
import java.time.ZoneId

/** The chart's Total | Per week choice, remembered on this device (web: localStorage known-chart-mode-v1). */
object KnownChartModePref {
    private const val PREFS = "lab-progress"
    private const val KEY = "known-chart-mode"

    fun load(context: Context): KnownChartMode =
        KnownChartMode.parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null))

    fun save(context: Context, mode: KnownChartMode) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, mode.id).apply()
    }
}

/** "Total | Per week" as one outlined pill (web: .known-mode). */
@Composable
internal fun KnownModeToggle(mode: KnownChartMode, onChange: (KnownChartMode) -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(50)).border(1.dp, Lab.colors.outline, RoundedCornerShape(50)).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        for ((m, label) in listOf(KnownChartMode.Total to "Total", KnownChartMode.Rate to "Per week")) {
            val on = m == mode
            Box(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (on) Lab.colors.ink else Color.Transparent)
                    .bouncyClickable { onChange(m) }
                    .semantics { role = Role.Tab; selected = on }
                    .height(40.dp)
                    .width(104.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label, style = MaterialTheme.typography.labelLarge,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (on) Lab.colors.card else Lab.colors.ink,
                )
            }
        }
    }
}

private fun tzOffsetMinutes(zone: ZoneId, ms: Long): Int = zone.rules.getOffset(Instant.ofEpochMilli(ms)).totalSeconds / 60

/**
 * Per week (web: KnownRateView): the pace of the last 4 weeks vs the 4 before, then newly
 * known characters and words per week as two small bar charts on ONE scale — a zero line for
 * the weeks that went down, the current week fainter; touch and drag to inspect a week.
 */
@Composable
internal fun KnownRateHistory(rate: KnownRate, zone: ZoneId, onPick: () -> Unit, initialScrub: Int?, panelHeight: Dp = 72.dp) {
    val weeks = rate.weeks
    var scrub by remember(weeks.size) { mutableStateOf(initialScrub) }
    val grow = rememberAppear(900)
    val chars = KnownColors.Characters
    val words = KnownColors.Words
    val grid = Lab.colors.cardBorder
    val muted = Lab.colors.muted
    val ink = Lab.colors.ink
    val tz = tzOffsetMinutes(zone, weeks.last().endMs)
    val values = weeks.flatMap { listOf(it.characters, it.words) }
    val top = niceMax(maxOf(0, values.max()))
    val lowest = minOf(0, values.min())
    // A week that went down gets room below zero: at least a quarter of the top (web: the same).
    val bottom = if (lowest < 0) -niceMax(maxOf(-lowest, (top + 3) / 4)) else 0
    val span = (top - bottom).toFloat()
    val ticks = if (bottom < 0) listOf(top, 0, bottom) else listOf(top, 0)

    val pace = rate.pace
    if (pace == null) {
        Text("Your pace shows after 4 weeks of reviews.", style = MaterialTheme.typography.bodySmall, color = muted)
    } else {
        Text("Lately (last 4 weeks)", style = MaterialTheme.typography.labelSmall, color = muted)
        PaceRow(pace.words, "words", words)
        PaceRow(pace.characters, "characters", chars)
    }
    Spacer(Modifier.height(12.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(chars))
        Text(" Characters   ", style = MaterialTheme.typography.labelSmall, color = ink)
        Box(Modifier.size(8.dp).clip(CircleShape).background(words))
        Text(" Words", style = MaterialTheme.typography.labelSmall, color = ink)
        Spacer(Modifier.weight(1f))
        Text("newly known, per week", style = MaterialTheme.typography.labelSmall, color = muted)
    }
    val pick = { x: Float, width: Int ->
        val i = Math.floor((x / width * weeks.size).toDouble()).toInt().coerceIn(0, weeks.size - 1)
        if (i != scrub) { scrub = i; onPick() }
    }
    val panels = listOf<Triple<String, Color, (WeekGain) -> Int>>(
        Triple("Characters", chars) { it.characters },
        Triple("Words", words) { it.words },
    )
    for ((label, color, value) in panels) {
        Spacer(Modifier.height(10.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = muted, modifier = Modifier.padding(start = 40.dp))
        Spacer(Modifier.height(4.dp))
        Row {
            Box(Modifier.width(32.dp).height(panelHeight)) {
                for (t in ticks) {
                    val frac = (top - t) / span
                    Text(
                        if (t < 0) "−${"%,d".format(-t)}" else "%,d".format(t),
                        style = MaterialTheme.typography.labelSmall, color = muted,
                        modifier = Modifier.align(Alignment.TopEnd).offset(y = panelHeight * frac - 8.dp),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Canvas(
                Modifier.weight(1f).height(panelHeight)
                    .pointerInput(weeks.size) { detectTapGestures(onPress = { pick(it.x, size.width) }) }
                    .pointerInput(weeks.size) { detectHorizontalDragGestures { change, _ -> pick(change.position.x, size.width) } }
                    .semantics { contentDescription = "$label newly known per week" },
            ) {
                val slot = size.width / weeks.size
                val barW = minOf(16.dp.toPx(), slot - 2.dp.toPx()).coerceAtLeast(1f)
                val y = { v: Float -> size.height * (top - v) / span }
                scrub?.let { i -> drawRect(ink.copy(alpha = 0.07f), Offset(slot * i, 0f), Size(slot, size.height)) }
                for (t in ticks) {
                    val gy = y(t.toFloat())
                    drawLine(if (t == 0) muted else grid, Offset(0f, gy), Offset(size.width, gy), strokeWidth = 1.dp.toPx())
                }
                val r = minOf(2.dp.toPx(), barW / 2)
                weeks.forEachIndexed { i, w ->
                    val raw = value(w)
                    if (raw == 0) return@forEachIndexed
                    val y0 = y(0f)
                    val y1 = y(raw * grow.value)
                    drawRoundRect(
                        color.copy(alpha = if (w.partial) 0.45f else 1f),
                        Offset(slot * (i + 0.5f) - barW / 2, minOf(y0, y1)),
                        Size(barW, Math.abs(y1 - y0).coerceAtLeast(1.5.dp.toPx())),
                        CornerRadius(r, r),
                    )
                }
            }
        }
    }
    Spacer(Modifier.height(4.dp))
    Row(Modifier.padding(start = 40.dp)) {
        Text(KnownRates.weekDayLabel(weeks.first().startMs, tz), style = MaterialTheme.typography.labelSmall, color = muted)
        Spacer(Modifier.weight(1f))
        Text("This week", style = MaterialTheme.typography.labelSmall, color = muted)
    }
    val w = scrub?.let { weeks.getOrNull(it) } ?: weeks.last()
    Column(
        Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(KnownRates.weekLabel(w.startMs, w.partial, tz), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = ink)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(chars))
            Text(" ${KnownRates.signedCount(w.characters)} characters   ", style = MaterialTheme.typography.bodyMedium, color = ink)
            Box(Modifier.size(8.dp).clip(CircleShape).background(words))
            Text(" ${KnownRates.signedCount(w.words)} words", style = MaterialTheme.typography.bodyMedium, color = ink)
        }
    }
}

@Composable
private fun PaceRow(pace: SeriesPace, noun: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(8.dp))
        Text(KnownRates.paceLabel(pace.perWeek, noun), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        KnownRates.paceTrendLabel(pace)?.let {
            Spacer(Modifier.width(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}
