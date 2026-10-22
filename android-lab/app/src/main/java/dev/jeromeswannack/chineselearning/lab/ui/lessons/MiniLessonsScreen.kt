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
import dev.jeromeswannack.chineselearning.lab.core.LessonRevision
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
    /** Runs in progress on this phone: lesson id → "full" | "revision" ("▶ Continue"). */
    val inProgress: Map<String, String> = emptyMap(),
)

class MiniLessonsActions(
    val onBack: (() -> Unit)? = null,
    val onEdit: (id: String) -> Unit = {},
    val onAnswers: (id: String) -> Unit = {},
    val onDelete: (id: String) -> Unit = {},
    val onRetry: () -> Unit = {},
    /** "▶ Start" / "▶ Revision" / "▶ Continue" / "▶ Do it again": the player (`/lessons/:id/play`); [revision] = its revision. */
    val onPlay: (id: String, revision: Boolean) -> Unit = { _, _ -> },
    /** "Ready to unlock": unlock a locked lesson / open its podcast. */
    val onUnlock: (id: String) -> Unit = {},
    val onListen: (audioLessonId: String) -> Unit = {},
)

private val DAY = DateTimeFormatter.ofPattern("MMM d", Locale.ENGLISH)

private fun shortDate(iso: String?, zone: ZoneId = ZoneId.systemDefault()): String =
    iso?.let { runCatching { DAY.format(Instant.ofEpochMilli(Js.parseDate(it)).atZone(zone)) }.getOrNull() } ?: ""

/** `learnChip`: New · 🔁 Revision 2 · due today · 🔁 Revision 1 · in 5 days · ✓ Done. */
fun learnChip(learn: LessonRevision.State, cutoff: StudyCutoff): Pair<String, androidx.compose.ui.graphics.Color> = when (learn.status) {
    "new" -> "New" to Palette.New
    "done" -> "✓ Done" to RetiredGrey
    else -> {
        val name = LessonRevision.title(learn)
        if (LessonRevision.isDue(learn, cutoff.ts)) "🔁 $name · due today" to Palette.Hard
        else {
            val days = LessonRevision.daysAway(learn, cutoff.ts)
            "🔁 $name · ${if (days == 1) "tomorrow" else "in $days days"}" to Palette.Good
        }
    }
}

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
 * `/lessons` — the web's MiniLessonsPage: To do (a run in progress, revisions due, new lessons),
 * Revision coming (soonest first) and Done for good (everything right first time), with how big
 * each is ("18 exercises · ~12 min", a revision "5 questions · ~4 min") and every exercise of a
 * lesson; ▶ Start / ▶ Revision / ▶ Continue / ▶ Do it again (`/lessons/:id/play`, LessonReplay.kt),
 * Edit, My answers, Delete. Lessons revise until right first time (core LessonRevision) and are
 * done from here and Home's homework card — not the study session. Renders the cached lessons at
 * once and refreshes behind them.
 */
@Composable
fun MiniLessonsScreen(ui: MiniLessonsUi, actions: MiniLessonsActions) {
    var confirm by rememberSaveable { mutableStateOf<String?>(null) }
    // Locked lessons (shared/lesson/unlock.ts) wait in "Ready to unlock" and nowhere else.
    val locked = ui.lessons.orEmpty().filter { it.locked }
    val lessons = ui.lessons?.filter { !it.locked }
    val toDo = lessons.orEmpty().filter { it.id in ui.inProgress || it.isNew || it.revisionDue(ui.cutoff.ts) }
        .sortedWith(compareBy({ if (it.id in ui.inProgress) 0 else 1 }, { if (it.isRevision) 0 else 1 }))
    val toDoIds = toDo.mapTo(HashSet()) { it.id }
    val later = lessons.orEmpty().filter { it.id !in toDoIds && it.isRevision }.sortedBy { it.learn.dueMs ?: 0L }
    val done = lessons.orEmpty().filter { it.id !in toDoIds && it.retired }
    LabScreen("🎓 Mini Lessons", onBack = actions.onBack) {
        item {
            Text(
                "Lessons from your tutor and from Claude. Get everything right first time and a lesson is done for good; anything you miss comes back a week later as a short revision.",
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
            item { Text("These wait until you've done the real thing.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
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
        item { SectionHeader("To do (${toDo.size})") }
        if (toDo.isEmpty()) {
            item {
                Text(
                    "Nothing waiting. Ask Claude for one — in the Sentence Coach, or from any connected Claude chat: “make me a mini lesson on …”",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                )
            }
        }
        items(toDo, key = { it.id }) { LessonCard(it, ui, actions) { confirm = it.id } }
        if (later.isNotEmpty()) {
            item { SectionHeader("Revision coming (${later.size})") }
            items(later, key = { it.id }) { LessonCard(it, ui, actions) { confirm = it.id } }
        }
        if (done.isNotEmpty()) {
            item { SectionHeader("Done for good (${done.size})") }
            item { Text("Everything right first time. Do one again any time.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
            items(done, key = { it.id }) { LessonCard(it, ui, actions) { confirm = it.id } }
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
    val (chip, chipColor) = learnChip(entry.learn, ui.cutoff)
    val running = ui.inProgress[entry.id]
    val revision = entry.isRevision
    val due = entry.revisionDue(ui.cutoff.ts)
    val size = if (revision) entry.revisionSize() else entry.lessonSize()
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)),
    ) {
        Row(Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.99f) { expanded = !expanded }.padding(14.dp), verticalAlignment = Alignment.Top) {
            Text(l.icon ?: "🎓", fontSize = 28.sp, modifier = Modifier.width(44.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(l.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink)
                l.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
                val meta = buildString {
                    append(size.ifEmpty { "${Lessons.exerciseCount(l.spec)} exercises (${Lessons.countScoreable(l.spec)} scored)" })
                    if (entry.reps > 0) append(" · done ${entry.reps}×")
                    append(" · from ${l.source}")
                    shortDate(l.createdAt).takeIf { it.isNotEmpty() }?.let { append(" · $it") }
                }
                Text(meta, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.testTag("mini-lesson-size"))
            }
            StatusPill(chip, chipColor, Modifier.padding(start = 8.dp))
        }
        // Play it from here (the real player): a run in progress continues, a revision plays what was
        // missed (+ a few), a new lesson starts, a done one is "Do it again".
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val (label, asRevision) = when {
                running != null -> "▶ Continue" to (running == "revision")
                revision -> (if (due) "▶ Revision" else "▶ Revise now") to true
                entry.isNew -> "▶ Start" to false
                else -> "▶ Do it again" to false
            }
            dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill(label, Modifier.height(44.dp).testTag("lesson-play-${l.id}")) { actions.onPlay(l.id, asRevision) }
            if (revision && running == null) {
                androidx.compose.material3.TextButton(onClick = { actions.onPlay(l.id, false) }, modifier = Modifier.heightIn(min = 44.dp).testTag("lesson-whole-${l.id}")) {
                    Text("Whole lesson", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
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
                    if (entry.reps > 0) SecondaryPill("📝 My answers") { actions.onAnswers(l.id) }
                    SecondaryPill(if (ui.deleting == l.id) "Deleting…" else "🗑 Delete lesson", enabled = ui.deleting == null, danger = true, onClick = onDelete)
                }
            }
        }
    }
}
