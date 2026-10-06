package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonDiff
import dev.jeromeswannack.chineselearning.lab.core.spec.arr
import dev.jeromeswannack.chineselearning.lab.core.spec.objects
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryAssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemDto
import dev.jeromeswannack.chineselearning.lab.ui.editor.ExportFormat
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

// `/library/:id` — one library item (web: pages/editor/LibraryItemPage.tsx): header, Edit /
// Try it / Assign / Print / Export, the students with their copies, Push update, Contents.

data class LibraryItemActions(
    val onBack: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onEdit: () -> Unit = {},
    val onTry: () -> Unit = {},
    val onAssign: () -> Unit = {},
    val onPrint: () -> Unit = {},
    val onOpenExport: () -> Unit = {},
    val onCloseExport: () -> Unit = {},
    val onExport: (ExportFormat, Boolean) -> Unit = { _, _ -> },
    val onAnki: () -> Unit = {},
    val onPush: () -> Unit = {},
    val onAnswers: (LibraryAssignmentDto) -> Unit = {},
    val onOpenCopy: (LibraryAssignmentDto) -> Unit = {},
    val onDismissNotice: () -> Unit = {},
    val assign: AssignActions = AssignActions(),
)

@Composable
fun LibraryItemScreen(ui: LibraryItemUi, actions: LibraryItemActions) {
    val lesson = ui.item.data
    LabScreen(
        title = lesson?.title ?: "Lesson Library",
        onBack = actions.onBack,
        actions = { if (lesson != null) MoreButton(actions.onOpenExport) },
    ) {
        item(key = "notice") { NoticeSlot(ui.notice, actions.onDismissNotice) }
        item(key = "body") {
            LoadableContent(ui.item, onRetry = actions.onRetry) { item -> ItemBody(item, ui, actions) }
        }
    }
    if (ui.exportSheet && lesson != null) {
        LabBottomSheet(onDismiss = actions.onCloseExport, title = "Export “${lesson.title}”") {
            ExportRows(onExport = actions.onExport, onPrint = { actions.onCloseExport(); actions.onPrint() }, onAnki = actions.onAnki)
        }
    }
    ui.assign?.let { AssignSheet(it, actions.assign) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ItemBody(lesson: LibraryItemDto, ui: LibraryItemUi, actions: LibraryItemActions) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // ---- header ----
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.size(60.dp).clip(RoundedCornerShape(18.dp)).background(Lab.colors.accentSoft), contentAlignment = Alignment.Center) {
                Text(lesson.icon ?: "🎓", fontSize = 32.sp)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                lesson.description?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                    Spacer(Modifier.height(4.dp))
                }
                Text(
                    "v${lesson.version} · ${LibraryText.plural(LibraryText.exerciseCount(lesson.spec), "exercise")} · updated ${LibraryText.shortDate(lesson.updated_at)}",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                )
                if (lesson.tags.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { lesson.tags.forEach { TagPill(it) } }
                }
            }
        }

        // ---- actions ----
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            PrimaryPill("✏️ Edit", Modifier.height(48.dp), onClick = actions.onEdit)
            SecondaryPill("▶ Try it", Modifier.height(48.dp), onClick = actions.onTry)
            SecondaryPill("Assign…", Modifier.height(48.dp), onClick = actions.onAssign)
            SecondaryPill("🖨 Print", Modifier.height(48.dp), onClick = actions.onPrint)
            SecondaryPill("⬇ Export", Modifier.height(48.dp), onClick = actions.onOpenExport)
        }

        // ---- students ----
        val rows = ui.assignments.data.orEmpty()
        SectionHeader("Students (${rows.size})")
        when {
            ui.assignments.data == null && ui.assignments.loading -> LoadingState(text = "Loading assignments…")
            ui.assignments.data == null && ui.assignments.error != null ->
                InlineNotice(ui.assignments.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRetry)
            rows.isEmpty() -> Text("Not assigned to anyone yet.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 4.dp))
            else -> LabCard {
                rows.forEachIndexed { i, r ->
                    if (i > 0) RowDivider()
                    StudentCopyRow(r, actions)
                }
            }
        }

        // ---- push update ----
        val behind = rows.count { !it.up_to_date }
        if (behind > 0) PushBox(behind, ui.pushing, actions.onPush)

        // ---- contents ----
        SectionHeader("Contents")
        (lesson.spec.arr("sections")?.objects().orEmpty()).forEach { section ->
            Column {
                section.str("title")?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.padding(start = 4.dp, bottom = 6.dp, top = 4.dp))
                }
                LabCard {
                    section.arr("exercises")?.objects().orEmpty().forEachIndexed { i, ex ->
                        if (i > 0) RowDivider()
                        ExerciseLine(ex)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StudentCopyRow(r: LibraryAssignmentDto, actions: LibraryItemActions) {
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 10.dp, top = 12.dp, bottom = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(r.student.name?.takeIf { it.isNotBlank() } ?: r.student.email ?: "Student", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("assigned ${LibraryText.shortDate(r.assigned_at)}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
            if (r.up_to_date) StatusPill("current", Palette.Good) else StatusPill("behind", Palette.Hard)
        }
        Spacer(Modifier.height(6.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("Done ${r.completions}×") }
                append("  ·  ")
                if (r.last_completed_at != null) {
                    append("Last ")
                    val rating = r.last_rating?.let { LibraryText.RATING_LABELS[it] }
                    val color = when (r.last_rating) { 0 -> Palette.Again; 1 -> Palette.Hard; 2 -> Palette.Good; 3 -> Palette.Easy; else -> Lab.colors.ink }
                    if (rating != null) withStyle(SpanStyle(color = color, fontWeight = FontWeight.SemiBold)) { append(rating) }
                    r.last_score?.let { append(" ${it.correct}/${it.total}") }
                    append(" · ${LibraryText.shortDate(r.last_completed_at)}")
                    dev.jeromeswannack.chineselearning.lab.core.Revisit.tutorLabel(r.next_revisit_at, r.retired)?.let { append(" · $it") }
                } else {
                    withStyle(SpanStyle(color = Lab.colors.muted)) { append("not yet") }
                }
            },
            style = MaterialTheme.typography.bodyMedium,
            color = Lab.colors.ink,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            if (r.last_attempt_id != null && r.relationship_id != null) MiniAction("📝 Answers") { actions.onAnswers(r) }
            MiniAction("Open copy") { actions.onOpenCopy(r) }
        }
    }
}

@Composable
private fun PushBox(behind: Int, pushing: Boolean, onPush: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Palette.Hard.copy(alpha = 0.1f)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "$behind student cop${if (behind == 1) "y is" else "ies are"} behind the library version (edited by the student, or the library changed since). " +
                "Pushing overwrites their content but keeps their history and schedule.",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
        )
        PrimaryPill(
            if (pushing) "Pushing…" else "Push update to ${LibraryText.plural(behind, "student")}",
            Modifier.fillMaxWidth().height(52.dp),
            enabled = !pushing,
            onClick = onPush,
        )
    }
}

@Composable
private fun ExerciseLine(ex: kotlinx.serialization.json.JsonObject) {
    val type = ex.str("type")
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) { Text(LessonCatalogue.icon(type), fontSize = 18.sp) }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(LessonCatalogue.name(type), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            val text = LessonDiff.primaryText(ex)
            if (text.isNotBlank()) Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}
