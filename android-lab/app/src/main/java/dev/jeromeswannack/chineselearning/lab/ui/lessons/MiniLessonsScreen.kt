package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Revisit
import dev.jeromeswannack.chineselearning.lab.core.RevisitState
import dev.jeromeswannack.chineselearning.lab.core.ExerciseTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonSchedule
import dev.jeromeswannack.chineselearning.lab.core.Lessons
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class MiniLessonsUi(
    val lessons: List<LessonEntry>? = null,
    val cutoff: StudyCutoff = StudyCutoff(0),
    val offline: Boolean = false,
    val updatedAt: Long? = null,
    val error: String? = null,
    val refreshing: Boolean = false,
    val deleting: String? = null,
    /** Audio lessons by id (title + heard to the end) for the locked rows. */
    val audio: Map<String, Pair<String?, Boolean>> = emptyMap(),
)

class MiniLessonsActions(
    val onBack: (() -> Unit)? = null,
    val onEdit: (id: String) -> Unit = {},
    val onAnswers: (id: String) -> Unit = {},
    val onDelete: (id: String) -> Unit = {},
    val onRetry: () -> Unit = {},
    /** "✓ Done for good" on a finished lesson (never offered again). */
    val onDoneForGood: (id: String) -> Unit = {},
    /** "↩ Bring back" on a lesson done for good (due again at once). */
    val onBringBack: (id: String) -> Unit = {},
    /** "▶ Start" / "▶ Do it again": the real player outside the session (`/lessons/:id/play`). */
    val onPlay: (id: String) -> Unit = {},
    /** "Ready to unlock": unlock a locked lesson / open its podcast. */
    val onUnlock: (id: String) -> Unit = {},
    val onListen: (audioLessonId: String) -> Unit = {},
)

private val DAY = DateTimeFormatter.ofPattern("MMM d", Locale.ENGLISH)

private fun shortDate(iso: String?, zone: ZoneId = ZoneId.systemDefault()): String =
    iso?.let { runCatching { DAY.format(Instant.ofEpochMilli(Js.parseDate(it)).atZone(zone)) }.getOrNull() } ?: ""

/** `revisitChip`: New / Due today / Next revisit 20 Oct / Done for good. */
fun scheduleChip(entry: LessonEntry, cutoff: StudyCutoff): Pair<String, androidx.compose.ui.graphics.Color> = revisitChip(entry.state, cutoff)

/** "Done for good" — the web's grey `retired` chip. */
val RetiredGrey = androidx.compose.ui.graphics.Color(0xFF6B7280)

/** The chip and its colour for a "revisit later" state (Mini Lessons and Readers lists). */
fun revisitChip(s: RevisitState, cutoff: StudyCutoff): Pair<String, androidx.compose.ui.graphics.Color> {
    val label = Revisit.chip(s, cutoff.ts)
    return label to when {
        s.isRetired -> RetiredGrey
        s.isNew -> Palette.New
        LessonSchedule.isUpNext(s, cutoff) -> Palette.Hard
        else -> Palette.Good
    }
}

/**
 * `/lessons` — the web's MiniLessonsPage: Up next (new / due today), Coming back later (the
 * "revisit later" schedule, soonest first) and Done for good (↩ Bring back), every exercise of
 * a lesson, Edit, ✓ Done for good, My answers and Delete — and on every card ▶ Start (new) /
 * ▶ Do it again (`/lessons/:id/play`, LessonReplay.kt). Renders the cached lessons at once and
 * refreshes behind them.
 */
@Composable
fun MiniLessonsScreen(ui: MiniLessonsUi, actions: MiniLessonsActions) {
    var confirm by rememberSaveable { mutableStateOf<String?>(null) }
    // Locked lessons (shared/lesson/unlock.ts) wait in "Ready to unlock" and nowhere else.
    val locked = ui.lessons.orEmpty().filter { it.locked }
    val lessons = ui.lessons?.filter { !it.locked }
    val upNext = lessons.orEmpty().filter { LessonSchedule.isUpNext(it.state, ui.cutoff) }
    val scheduled = lessons.orEmpty().filter { it.state.isScheduled && !LessonSchedule.isUpNext(it.state, ui.cutoff) }.sortedBy { it.state.dueMs ?: 0L }
    val retired = lessons.orEmpty().filter { it.retired }
    LabScreen("🎓 Mini Lessons", onBack = actions.onBack) {
        item {
            Text(
                "Custom lessons authored by Claude (from chat or MCP). They mix into your study sessions; once finished, your rating decides when one comes back (Good: in two weeks, then longer each time — Settings → Lessons & readers).",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
        }
        if (ui.offline) item { OfflineNotice(updatedAt = ui.updatedAt) }
        else ui.error?.let { e -> item { InlineNotice(e, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRetry) } }
        if (lessons == null) {
            item { LoadingState() }
            return@LabScreen
        }
        if (locked.isNotEmpty()) {
            item { SectionHeader("🔒 Ready to unlock (${locked.size})") }
            item { Text("These wait until you've done the real thing — then they come today.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
            item(key = "locked") {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp))) {
                    locked.forEachIndexed { i, e ->
                        val unlock = e.unlock ?: return@forEachIndexed
                        val (audioTitle, heard) = if (unlock.isAudio) ui.audio[unlock.audioLessonId.orEmpty()] ?: (null to false) else (null to false)
                        if (i > 0) androidx.compose.material3.HorizontalDivider(Modifier.padding(start = 64.dp, end = 16.dp), color = Lab.colors.faint)
                        dev.jeromeswannack.chineselearning.lab.ui.today.LockedLessonRow(
                            dev.jeromeswannack.chineselearning.lab.ui.today.TodayLockedRow(e.id, e.lesson.title.ifBlank { e.lesson.spec.title }, unlock, audioTitle, heard),
                            onUnlock = { actions.onUnlock(e.id) },
                            onListen = unlock.audioLessonId?.takeIf { unlock.isAudio }?.let { id -> { actions.onListen(id) } },
                        )
                    }
                }
            }
        }
        item { SectionHeader("Up next (${upNext.size})") }
        if (upNext.isEmpty()) {
            item {
                Text(
                    "Nothing waiting. Ask Claude for one — during study, in the Sentence Coach, or from any connected Claude chat: “make me a mini lesson on …”",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                )
            }
        }
        items(upNext, key = { it.id }) { LessonCard(it, ui, actions) { confirm = it.id } }
        if (scheduled.isNotEmpty()) {
            item { SectionHeader("Coming back later (${scheduled.size})") }
            items(scheduled, key = { it.id }) { LessonCard(it, ui, actions) { confirm = it.id } }
        }
        if (retired.isNotEmpty()) {
            item { SectionHeader("Done for good (${retired.size})") }
            item { Text("Never offered again. Bring one back to put it in rotation.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
            items(retired, key = { it.id }) { LessonCard(it, ui, actions) { confirm = it.id } }
        }
    }
    confirm?.let { id ->
        val title = lessons?.firstOrNull { it.id == id }?.lesson?.title ?: "this lesson"
        ConfirmDialog("Delete lesson?", "Delete \"$title\"? This can't be undone.", "Delete", onConfirm = { actions.onDelete(id) }, onDismiss = { confirm = null }, danger = true)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LessonCard(entry: LessonEntry, ui: MiniLessonsUi, actions: MiniLessonsActions, onDelete: () -> Unit) {
    var expanded by rememberSaveable(entry.id) { mutableStateOf(false) }
    val l = entry.lesson
    val (chip, chipColor) = scheduleChip(entry, ui.cutoff)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)),
    ) {
        Row(Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.99f) { expanded = !expanded }.padding(14.dp), verticalAlignment = Alignment.Top) {
            Text(l.icon ?: "🎓", fontSize = 28.sp, modifier = Modifier.width(44.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(l.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink)
                l.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
                val meta = buildString {
                    append("${Lessons.exerciseCount(l.spec)} exercises (${Lessons.countScoreable(l.spec)} scored)")
                    if (entry.reps > 0) append(" · studied ${entry.reps}×")
                    append(" · from ${l.source}")
                    shortDate(l.createdAt).takeIf { it.isNotEmpty() }?.let { append(" · $it") }
                }
                Text(meta, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
            }
            StatusPill(chip, chipColor, Modifier.padding(start = 8.dp))
        }
        // Play it from here (the real player): a new lesson starts, a finished one is "Do it again".
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill(
                if (entry.state.isNew) "▶ Start" else "▶ Do it again",
                Modifier.height(44.dp).testTag("lesson-play-${l.id}"),
            ) { actions.onPlay(l.id) }
            androidx.compose.material3.TextButton(onClick = { expanded = !expanded }, modifier = Modifier.heightIn(min = 44.dp)) {
                Text(if (expanded) "Hide the parts" else "See the parts", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }
        AnimatedVisibility(expanded, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                l.spec.sections.forEach { section ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        section.title?.takeIf { it.isNotBlank() }?.let { Text(it, fontWeight = FontWeight.Bold, color = Lab.colors.ink) }
                        section.exercises.forEach { ex ->
                            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 8.dp)) {
                                Text(ExerciseTypes.label(ex.type), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = Violet, modifier = Modifier.width(128.dp))
                                Text(Lessons.summary(ex), fontSize = 14.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecondaryPill("✏️ Edit") { actions.onEdit(l.id) }
                    if (entry.retired) SecondaryPill("↩ Bring back") { actions.onBringBack(l.id) }
                    else if (entry.reps > 0) SecondaryPill("✓ Done for good") { actions.onDoneForGood(l.id) }
                    if (entry.reps > 0) SecondaryPill("📝 My answers") { actions.onAnswers(l.id) }
                    SecondaryPill(if (ui.deleting == l.id) "Deleting…" else "🗑 Delete lesson", enabled = ui.deleting == null, danger = true, onClick = onDelete)
                }
            }
        }
    }
}
