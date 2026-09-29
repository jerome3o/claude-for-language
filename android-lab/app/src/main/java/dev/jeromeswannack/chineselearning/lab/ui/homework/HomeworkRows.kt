package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.DueLabel
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkItemView
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** The colour of a due tone (web: .hw-chip-overdue / -today / -soon / -later / -done). */
fun dueColor(tone: String): Color = when (tone) {
    "overdue" -> Palette.Again
    "today" -> Palette.Hard
    "soon" -> Palette.Easy
    "done" -> Palette.Good
    else -> Color(0xFF6B7280)
}

/** "overdue" / "due today" / "due in 2 days" as a coloured pill (web: DueChip). */
@Composable
fun DueChip(due: DueLabel, done: Boolean = false) {
    if (done) StatusPill("done", dueColor("done"))
    else if (due.text.isNotEmpty()) StatusPill(due.text, dueColor(due.tone), Modifier.testTag("hw-due"))
}

/** One homework item: icon, title, progress line (+ bar), due chip. Taps into the pass (web: HomeworkRow). */
@Composable
fun HomeworkRow(item: HomeworkItemView, showTutor: Boolean = false, onOpen: (String) -> Unit) {
    val a = item.assignment
    val base = Homework.titleParts(a).base
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .bouncyClickable { onOpen(a.id) }
            .alpha(if (item.done) 0.7f else 1f)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("hw-row"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(Homework.kindIcon(a.kind), fontSize = 22.sp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(base, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(Homework.rowDetail(item, showTutor), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2)
            if (a.kind == "deck" && !item.done && item.progress.done > 0 && item.progress.total > 0) {
                Spacer(Modifier.height(6.dp))
                ProgressBar(item.progress.done.toFloat() / item.progress.total, Modifier.fillMaxWidth(0.7f))
            }
        }
        Spacer(Modifier.width(10.dp))
        DueChip(item.due, item.done)
    }
}

/** A thin springy progress bar (pass progress, homework rows). */
@Composable
fun ProgressBar(fraction: Float, modifier: Modifier = Modifier, color: Color = Palette.Good, height: androidx.compose.ui.unit.Dp = 6.dp) {
    val f by animateFloatAsState(fraction.coerceIn(0f, 1f), spring(dampingRatio = 0.8f, stiffness = 300f), label = "progress")
    Box(modifier.height(height).clip(RoundedCornerShape(height / 2)).background(Lab.colors.faint)) {
        Box(Modifier.fillMaxWidth(f).height(height).clip(RoundedCornerShape(height / 2)).background(color))
    }
}

/** A card of homework rows with dividers. */
@Composable
fun HomeworkList(items: List<HomeworkItemView>, showTutor: Boolean, onOpen: (String) -> Unit) {
    LabCard {
        items.forEachIndexed { i, item ->
            if (i > 0) RowDivider()
            HomeworkRow(item, showTutor, onOpen)
        }
    }
}
