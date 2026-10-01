package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.KnownCounts
import dev.jeromeswannack.chineselearning.lab.core.KnownPoint
import dev.jeromeswannack.chineselearning.lab.core.KnownProgress
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The chart's two series — the same hues as the web (KnownCounts.css), stepped for dark mode. */
object KnownColors {
    val Characters: Color @Composable get() = if (Lab.colors.background.luminance() < 0.5f) Color(0xFF3987E5) else Color(0xFF2A78D6)
    val Words: Color @Composable get() = if (Lab.colors.background.luminance() < 0.5f) Color(0xFFD95926) else Color(0xFFEB6834)
}

/**
 * "Characters & words" on the Progress tab (web: components/progress/KnownCounts.tsx):
 * known characters and words with what's still learning, a "?" with the definitions, the
 * history as two lines you can scrub, and the newest known characters. [known] null =
 * still being replayed (placeholders keep the layout steady).
 */
@Composable
fun KnownCard(
    known: KnownProgress?,
    zone: ZoneId,
    onPick: () -> Unit = {},
    initialScrub: Int? = null,
    initialExplain: Boolean = false,
    /** Whose numbers: "you" on the Progress tab, "they" on a tutor's student page. */
    subject: String = "you",
) {
    var explain by rememberSaveable { mutableStateOf(initialExplain) }
    LabCard {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Characters & words", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                Box(
                    Modifier.size(44.dp).bouncyClickable { explain = !explain }.semantics { contentDescription = "What do these numbers mean?" },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.size(24.dp).clip(CircleShape)
                            .border(BorderStroke(1.5.dp, if (explain) KnownColors.Characters else Lab.colors.cardBorder), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { Text("?", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = Lab.colors.muted) }
                }
            }
            AnimatedVisibility(explain, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                Text(
                    "Known = $subject've remembered it for 3+ weeks: at least one of its cards is in review with a memory " +
                        "stability over 21 days. Learning = $subject've started it but it isn't there yet. A word is a card of " +
                        "1–4 characters without punctuation (longer cards count as sentences). A character is known when " +
                        "it appears in any known card, word or sentence.",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink,
                    modifier = Modifier.padding(top = 4.dp, bottom = 8.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(12.dp),
                )
            }
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KnownTile("Characters known", known?.characters, KnownColors.Characters, Modifier.weight(1f))
                KnownTile("Words known", known?.words, KnownColors.Words, Modifier.weight(1f))
            }
            val s = known?.sentences
            if (s != null && s.known + s.learning > 0) {
                Text(
                    buildString {
                        append("Plus ${"%,d".format(s.known)} ${if (s.known == 1) "sentence" else "sentences"} known")
                        if (s.learning > 0) append(" · ${"%,d".format(s.learning)} learning")
                    },
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            }
            if (known != null && known.history.size >= 2) {
                Spacer(Modifier.height(16.dp))
                KnownHistory(known.history, zone, onPick, initialScrub)
            }
            if (known != null && known.recentCharacters.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                Text("Newest known characters", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                Spacer(Modifier.height(8.dp))
                RecentCharacters(known.recentCharacters.map { it.char })
            }
        }
    }
}

@Composable
private fun KnownTile(label: String, counts: KnownCounts?, color: Color, modifier: Modifier = Modifier) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).padding(horizontal = 14.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(color))
            Spacer(Modifier.width(6.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, maxLines = 1)
        }
        if (counts == null) {
            Text("–", style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.Bold), color = Lab.colors.muted)
            Text(" ", style = MaterialTheme.typography.bodySmall)
        } else {
            CountUpText(counts.known, MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.Bold), Lab.colors.ink)
            Text("+${"%,d".format(counts.learning)} learning", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RecentCharacters(chars: List<String>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        chars.forEachIndexed { i, c ->
            val pop = remember { Animatable(0f) }
            LaunchedEffect(c) {
                kotlinx.coroutines.delay(i * 35L)
                pop.animateTo(1f, androidx.compose.animation.core.spring(dampingRatio = 0.5f, stiffness = 400f))
            }
            Box(
                Modifier.size(44.dp)
                    .graphicsLayer { scaleX = pop.value; scaleY = pop.value; alpha = pop.value.coerceIn(0f, 1f) }
                    .clip(RoundedCornerShape(10.dp))
                    .background(Lab.colors.faint),
                contentAlignment = Alignment.Center,
            ) { Text(c, fontSize = 22.sp, color = Lab.colors.ink) }
        }
    }
}

private val MONTH_DAY = DateTimeFormatter.ofPattern("MMM d", Locale.US)
private val FULL_DAY = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)

/** A round axis maximum at or above [max] (web: niceMax). */
internal fun niceMax(max: Int): Int {
    if (max <= 4) return 4
    val pow = Math.pow(10.0, Math.floor(Math.log10(max.toDouble())))
    for (m in listOf(1.0, 2.0, 2.5, 5.0, 10.0)) if (m * pow >= max) return (m * pow).toInt()
    return (10 * pow).toInt()
}

/**
 * Known characters and words over time: two 2dp lines on one count axis that draw
 * themselves in; touch and drag to scrub (a light tick per point), the day's numbers above.
 */
@Composable
private fun KnownHistory(history: List<KnownPoint>, zone: ZoneId, onPick: () -> Unit, initialScrub: Int?, height: Dp = 150.dp) {
    var scrub by remember { mutableStateOf(initialScrub) }
    val draw = rememberAppear(1100)
    val chars = KnownColors.Characters
    val words = KnownColors.Words
    val grid = Lab.colors.cardBorder
    val muted = Lab.colors.muted
    val card = Lab.colors.card
    val max = niceMax(history.maxOf { maxOf(it.characters.known, it.words.known) })
    val last = history.last()
    val shown = scrub?.let { history.getOrNull(it) }
    val date = { ms: Long, f: DateTimeFormatter -> Instant.ofEpochMilli(ms).atZone(zone).format(f) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(chars))
        Text(" Characters   ", style = MaterialTheme.typography.labelSmall, color = Lab.colors.ink)
        Box(Modifier.size(8.dp).clip(CircleShape).background(words))
        Text(" Words", style = MaterialTheme.typography.labelSmall, color = Lab.colors.ink)
        Spacer(Modifier.weight(1f))
        Text(
            if (shown == null) "known, over time" else date(shown.atMs, FULL_DAY),
            style = MaterialTheme.typography.labelSmall, color = muted,
        )
    }
    Spacer(Modifier.height(8.dp))
    Row {
        Column(Modifier.height(height), verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = Alignment.End) {
            Text("%,d".format(max), style = MaterialTheme.typography.labelSmall, color = muted)
            Text("%,d".format(max / 2), style = MaterialTheme.typography.labelSmall, color = muted)
            Text("0", style = MaterialTheme.typography.labelSmall, color = muted)
        }
        Spacer(Modifier.width(8.dp))
        val pick = { x: Float, width: Int ->
            val i = Math.round(x / width * (history.size - 1)).coerceIn(0, history.size - 1)
            if (i != scrub) { scrub = i; onPick() }
        }
        Canvas(
            Modifier.weight(1f).height(height)
                .pointerInput(history.size) {
                    detectTapGestures(onPress = { pick(it.x, size.width) })
                }
                .pointerInput(history.size) {
                    detectHorizontalDragGestures { change, _ -> pick(change.position.x, size.width) }
                }
                .semantics {
                    contentDescription = "Known characters rose to ${last.characters.known} and known words to ${last.words.known}"
                },
        ) {
            val pad = 6.dp.toPx()
            val h = size.height - pad * 2
            val x = { i: Int -> size.width * i / (history.size - 1) }
            val y = { v: Int -> pad + h * (1 - v.toFloat() / max) }
            for (f in listOf(0f, 0.5f, 1f)) {
                val gy = pad + h * f
                drawLine(grid, Offset(0f, gy), Offset(size.width, gy), strokeWidth = 1.dp.toPx())
            }
            fun line(pick: (KnownPoint) -> Int): Path = Path().apply {
                history.forEachIndexed { i, p -> if (i == 0) moveTo(x(i), y(pick(p))) else lineTo(x(i), y(pick(p))) }
            }
            clipRect(right = size.width * draw.value + 4.dp.toPx()) {
                drawPath(line { it.words.known }, words, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                drawPath(line { it.characters.known }, chars, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            val i = scrub ?: (history.size - 1)
            val p = history[i]
            if (scrub != null) {
                drawLine(muted, Offset(x(i), 0f), Offset(x(i), size.height), strokeWidth = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
            }
            if (draw.value >= 0.99f || scrub != null) {
                for ((v, c) in listOf(p.words.known to words, p.characters.known to chars)) {
                    drawCircle(card, 6.dp.toPx(), Offset(x(i), y(v)))
                    drawCircle(c, 4.dp.toPx(), Offset(x(i), y(v)))
                }
            }
        }
    }
    Spacer(Modifier.height(4.dp))
    Row(Modifier.padding(start = 28.dp)) {
        Text(date(history.first().atMs, MONTH_DAY), style = MaterialTheme.typography.labelSmall, color = muted)
        Spacer(Modifier.weight(1f))
        Text("Today", style = MaterialTheme.typography.labelSmall, color = muted)
    }
    val p = shown ?: last
    Row(
        Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (shown == null) "Today" else date(shown.atMs, MONTH_DAY), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
        Spacer(Modifier.weight(1f))
        Box(Modifier.size(8.dp).clip(CircleShape).background(chars))
        Text(" ${"%,d".format(p.characters.known)} characters   ", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
        Box(Modifier.size(8.dp).clip(CircleShape).background(words))
        Text(" ${"%,d".format(p.words.known)} words", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
    }
}
