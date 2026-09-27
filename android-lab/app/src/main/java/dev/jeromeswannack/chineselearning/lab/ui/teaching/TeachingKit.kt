package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import dev.jeromeswannack.chineselearning.lab.core.HomeworkPlan
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLoadDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * Shared pieces of the tutor screens (web: tutor-dashboard.css / homework-tutor.css).
 */

/** Initial-letter avatar (the web shows the Google photo when there is one; the Lab app has no image loader yet). */
@Composable
fun Avatar(name: String?, email: String?, size: Dp = 44.dp, muted: Boolean = false, text: String? = null) {
    Box(
        Modifier.size(size).clip(CircleShape).background(if (muted) Lab.colors.faint else Lab.colors.accentSoft),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text ?: TeachingFormat.initial(name, email),
            color = if (muted) Lab.colors.muted else Lab.colors.accent,
            fontWeight = FontWeight.SemiBold,
            fontSize = (size.value * 0.42f).sp,
        )
    }
}

enum class PillTone { Struggling, Ok, Flags, Recordings, Homework, Setup, Muted }

private fun PillTone.color(): Color = when (this) {
    PillTone.Struggling -> Palette.Hard
    PillTone.Ok -> Palette.Good
    PillTone.Flags -> Palette.Again
    PillTone.Recordings -> Palette.Secondary
    PillTone.Homework -> Palette.Easy
    PillTone.Setup -> Palette.Gold
    PillTone.Muted -> Color(0xFF6B7280)
}

/** A tinted pill; tappable when [onClick] is set (the dashboard pills link into the student's pages). */
@Composable
fun TeachPill(text: String, tone: PillTone, onClick: (() -> Unit)? = null) {
    val c = tone.color()
    Text(
        text,
        color = c,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .then(if (onClick != null) Modifier.heightIn(min = 36.dp).bouncyClickable(pressedScale = 0.93f, onClick = onClick) else Modifier)
            .clip(RoundedCornerShape(50))
            .background(c.copy(alpha = 0.13f))
            .padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

/** A white rounded card with padding — one student, one section. */
@Composable
fun TeachCard(modifier: Modifier = Modifier, muted: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(if (muted) Lab.colors.card.copy(alpha = 0.6f) else Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(20.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

/** Section title inside a screen ("Needs attention", "Homework"). */
@Composable
fun TeachSectionTitle(text: String, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** A small text button (the web's `.td-inline-btn`). */
@Composable
fun InlineButton(label: String, enabled: Boolean = true, danger: Boolean = false, onClick: () -> Unit) {
    val c = if (danger) Palette.Again else Lab.colors.accent
    Text(
        label,
        color = c,
        fontWeight = FontWeight.SemiBold,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier
            .heightIn(min = 40.dp)
            .alpha(if (enabled) 1f else 0.45f)
            .clip(RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .background(c.copy(alpha = 0.08f))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    )
}

/** Two-tone progress bar: started (light) under mastered (solid). Values 0–100. */
@Composable
fun ProgressBar2(started: Int, mastered: Int, modifier: Modifier = Modifier) {
    val s by animateFloatAsState(started.coerceIn(0, 100) / 100f, spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessLow), label = "started")
    val m by animateFloatAsState(mastered.coerceIn(0, 100) / 100f, spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessLow), label = "mastered")
    val track = Lab.colors.faint
    Canvas(modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(50))) {
        drawRect(track)
        drawRect(Palette.Good.copy(alpha = 0.35f), size = Size(size.width * s, size.height))
        drawRect(Palette.Good, size = Size(size.width * m, size.height))
    }
}

/** "#N" queue badge (the web's QueuePositionMenu button); first in the queue is red. */
@Composable
fun QueueBadge(position: Int, onClick: () -> Unit) {
    val first = position == 1
    Text(
        "#$position",
        color = if (first) Color(0xFFB91C1C) else Color(0xFF4B5563),
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        modifier = Modifier
            .heightIn(min = 36.dp)
            .bouncyClickable(pressedScale = 0.9f, onClick = onClick)
            .clip(RoundedCornerShape(50))
            .background(if (first) Color(0xFFFEE2E2) else Color(0xFFF3F4F6))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    )
}

/** The due chip a student (and the tutor) sees: overdue red, today orange, soon blue, later grey. */
@Composable
fun DueChip(label: HomeworkPlan.DueLabel) {
    if (label.text.isEmpty()) return
    val c = when (label.tone) {
        HomeworkPlan.DueTone.OVERDUE -> Palette.Again
        HomeworkPlan.DueTone.TODAY -> Palette.Hard
        HomeworkPlan.DueTone.SOON -> Palette.Easy
        else -> Color(0xFF6B7280)
    }
    Text(
        label.text,
        color = c,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(c.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

private fun levelColor(level: String): Color = when (level) {
    "heavy" -> Palette.Again
    "moderate" -> Palette.Hard
    else -> Palette.Good
}

private fun levelText(level: String): String = when (level) {
    "heavy" -> "Heavy"
    "moderate" -> "Moderate"
    else -> "Light"
}

/**
 * The load gauge (web: components/tutor/LoadGauge.tsx): level, the server's one-line summary,
 * the next seven days as bars, and — on the draft page — the same after this homework.
 */
@Composable
fun LoadGauge(load: HomeworkLoadDto, studentName: String, after: HomeworkLoadDto? = null, modifier: Modifier = Modifier) {
    val days = load.one_off.by_day
    val afterDays = after?.one_off?.by_day.orEmpty()
    val max = maxOf(1, days.maxOfOrNull { it.words + it.items } ?: 0, afterDays.maxOfOrNull { it.words + it.items } ?: 0)
    val lc = levelColor(load.level)
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(lc.copy(alpha = 0.07f)).border(1.dp, lc.copy(alpha = 0.25f), RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$studentName’s load", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis)
            LevelTag(load.level)
            if (after != null && after.level != load.level) {
                Text("→", color = Lab.colors.muted)
                LevelTag(after.level)
            }
        }
        Text(load.summary, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink)
        if (after != null) Text("After this: ${after.summary}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        if (days.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                days.forEachIndexed { i, d ->
                    val now = d.words + d.items
                    val next = afterDays.getOrNull(i)?.let { it.words + it.items } ?: now
                    Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
                        val nowFrac by animateFloatAsState(now.toFloat() / max, spring(stiffness = Spring.StiffnessLow), label = "day")
                        val nextFrac by animateFloatAsState(next.toFloat() / max, spring(stiffness = Spring.StiffnessLow), label = "dayAfter")
                        val barNow = lc
                        val barAdded = Palette.Easy.copy(alpha = 0.45f)
                        val track = Lab.colors.faint
                        Canvas(Modifier.weight(1f).widthIn(max = 28.dp).fillMaxWidth()) {
                            drawRoundRect(track, cornerRadius = androidx.compose.ui.geometry.CornerRadius(6f, 6f))
                            if (next > now) {
                                val h = size.height * nextFrac
                                drawRoundRect(barAdded, topLeft = Offset(0f, size.height - h), size = Size(size.width, h), cornerRadius = androidx.compose.ui.geometry.CornerRadius(6f, 6f))
                            }
                            val h = size.height * nowFrac
                            if (h > 0f) drawRoundRect(barNow, topLeft = Offset(0f, size.height - h), size = Size(size.width, h), cornerRadius = androidx.compose.ui.geometry.CornerRadius(6f, 6f))
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(if (i == 0) "Today" else HomeworkPlan.shortDay(d.date).take(3), fontSize = 11.sp, color = Lab.colors.muted, maxLines = 1)
                    }
                }
            }
        }
        if (load.one_off.overdue_items > 0) {
            Text(
                "${load.one_off.overdue_items} overdue${if (load.one_off.overdue_words > 0) " (${load.one_off.overdue_words} words)" else ""} — consider cutting back.",
                style = MaterialTheme.typography.bodySmall, color = Palette.Again, fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun LevelTag(level: String) {
    val c = levelColor(level)
    Text(
        levelText(level),
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(c).padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

/** A QR code for an invite link (zxing), drawn as dark modules on white. */
@Composable
fun QrCode(value: String, modifier: Modifier = Modifier, sizeDp: Dp = 220.dp) {
    val matrix = remember(value) {
        runCatching {
            QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2))
        }.getOrNull()
    }
    Box(modifier.size(sizeDp).clip(RoundedCornerShape(16.dp)).background(Color.White).padding(8.dp)) {
        if (matrix != null) {
            Canvas(Modifier.fillMaxWidth().fillMaxHeight()) {
                val n = matrix.width
                val cell = size.minDimension / n
                for (y in 0 until n) for (x in 0 until n) {
                    if (matrix.get(x, y)) drawRect(Color.Black, topLeft = Offset(x * cell, y * cell), size = Size(cell + 0.5f, cell + 0.5f))
                }
            }
        }
    }
}

/** A labelled stat pair for compact summaries. */
@Composable
fun MutedLine(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = modifier)
}

/** Space helper for Rows. */
@Composable
fun HSpace(w: Dp) = Spacer(Modifier.width(w))

/**
 * A compact one-line pill for pairs of actions inside a card ("💬 Message" · "📤 Send homework"),
 * where the kit's pills would wrap at half the phone width. [primary] fills with the accent.
 */
@Composable
fun TeachButton(label: String, modifier: Modifier = Modifier, primary: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val accent = Lab.colors.accent
    Box(
        modifier
            .heightIn(min = 48.dp)
            .bouncyClickable(enabled, 0.95f, onClick = onClick)
            .clip(RoundedCornerShape(18.dp))
            .then(if (primary) Modifier.background(accent) else Modifier.border(1.5.dp, accent.copy(alpha = 0.5f), RoundedCornerShape(18.dp)))
            .alpha(if (enabled) 1f else 0.5f)
            .padding(horizontal = 10.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (primary) Color.White else accent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
