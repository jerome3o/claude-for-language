package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummaryDto
import dev.jeromeswannack.chineselearning.lab.ui.editor.ExportFormat
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

// `/library` — the tutor's Lesson Library (web: pages/editor/LessonLibraryPage.tsx).

data class LibraryActions(
    val onRetry: () -> Unit = {},
    val onNew: () -> Unit = {},
    val onPageMenu: () -> Unit = {},
    val onClosePageMenu: () -> Unit = {},
    val onImport: () -> Unit = {},
    val onMyLessons: () -> Unit = {},
    val onCatalogue: () -> Unit = {},
    val onOpen: (LibraryItemSummaryDto) -> Unit = {},
    val onEdit: (LibraryItemSummaryDto) -> Unit = {},
    val onAssign: (LibraryItemSummaryDto) -> Unit = {},
    val onMenu: (LibraryItemSummaryDto) -> Unit = {},
    val onCloseMenu: () -> Unit = {},
    val onDuplicate: (LibraryItemSummaryDto) -> Unit = {},
    val onExport: (LibraryItemSummaryDto, ExportFormat, Boolean) -> Unit = { _, _, _ -> },
    val onPrint: (LibraryItemSummaryDto) -> Unit = {},
    val onAnki: (LibraryItemSummaryDto) -> Unit = {},
    val onArchive: (LibraryItemSummaryDto) -> Unit = {},
    val onConfirmArchive: (LibraryItemSummaryDto) -> Unit = {},
    val onCancelArchive: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
    val newLesson: NewLessonActions = NewLessonActions(),
    val assign: AssignActions = AssignActions(),
)

@Composable
fun LibraryScreen(ui: LibraryUi, actions: LibraryActions) {
    LabScreen(
        title = "📚 Lesson Library",
        actions = { MoreButton(actions.onPageMenu) },
    ) {
        item(key = "notice") { NoticeSlot(ui.notice, actions.onDismissNotice) }
        item(key = "intro") {
            Text(
                "Master copies of your mini lessons. Assign one to a student and they get their own copy in their study sessions; edit here and push the update to keep everyone in step.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
        item(key = "new") { PrimaryPill("+ New lesson", Modifier.fillMaxWidth().height(54.dp), onClick = actions.onNew) }
        item(key = "catalogue") {
            LabCard {
                NavRow(
                    "🧭",
                    "Exercise catalogue",
                    desc = "Every exercise type — sentence making, writing, dictation, speaking, conversations — with a sample lesson you can take.",
                    onClick = actions.onCatalogue,
                )
            }
        }
        item(key = "list") {
            LoadableContent(
                ui.list,
                onRetry = actions.onRetry,
                isEmpty = { it.isEmpty() },
                empty = {
                    EmptyState(
                        "📚",
                        "No lessons yet",
                        body = "Describe one and let Claude draft it, or import a JSON export.",
                        actionLabel = "+ New lesson",
                        onAction = actions.onNew,
                    )
                },
            ) { items ->
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items.forEach { item -> LibraryCard(item, busy = ui.busyItemId == item.id, actions) }
                }
            }
        }
    }

    if (ui.pageMenu) {
        LabBottomSheet(onDismiss = actions.onClosePageMenu, title = "Lesson Library") {
            NavRow("⬆", "Import JSON…", desc = "A lesson exported from the app or written by Claude", onClick = actions.onImport)
            RowDivider()
            NavRow("🎓", "My mini lessons", desc = "The lessons in your own study sessions", onClick = actions.onMyLessons)
        }
    }
    ui.menuFor?.let { item -> ItemMenuSheet(item, actions) }
    ui.confirmArchive?.let { item ->
        ConfirmDialog(
            title = "Archive “${item.title}”?",
            text = "Students keep their copies.",
            confirmLabel = "Archive",
            danger = true,
            onConfirm = { actions.onConfirmArchive(item) },
            onDismiss = actions.onCancelArchive,
        )
    }
    ui.newLesson?.let { NewLessonSheet(it, actions.newLesson) }
    ui.assign?.let { AssignSheet(it, actions.assign) }
}

/** The web's toast, in the flow: success lines fade out by themselves. */
@Composable
internal fun NoticeSlot(notice: Notice?, onDismiss: () -> Unit) {
    AnimatedVisibility(
        notice != null,
        enter = fadeIn(tween(200)) + expandVertically(),
        exit = fadeOut(tween(250)) + shrinkVertically(),
    ) {
        val n = notice ?: return@AnimatedVisibility
        InlineNotice(n.text, kind = n.kind, actionLabel = "✕", onAction = onDismiss)
    }
}

@Composable
internal fun MoreButton(onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(48.dp)) {
        Text("⋯", fontSize = 24.sp, color = Lab.colors.ink, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun LibraryCard(item: LibraryItemSummaryDto, busy: Boolean, actions: LibraryActions) {
    LabCard(Modifier.alpha(if (busy) 0.6f else 1f)) {
        Row(
            Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.98f) { actions.onOpen(item) }.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 10.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.accentSoft), contentAlignment = Alignment.Center) {
                Text(item.icon ?: "🎓", fontSize = 26.sp)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                item.description?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink.copy(alpha = 0.8f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(4.dp))
                Text(LibraryText.meta(item), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                if (item.tags.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    ChipRow { item.tags.forEach { TagPill(it) } }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SecondaryPill("✏️ Edit", Modifier.height(44.dp), enabled = !busy) { actions.onEdit(item) }
            PrimaryPill("Assign…", Modifier.height(44.dp), enabled = !busy) { actions.onAssign(item) }
            Spacer(Modifier.weight(1f))
            MoreButton { if (!busy) actions.onMenu(item) }
        }
    }
}

@Composable
internal fun TagPill(tag: String) {
    Text(
        tag,
        style = MaterialTheme.typography.labelMedium,
        color = Lab.colors.accent,
        modifier = Modifier.clip(CircleShape).background(Lab.colors.accentSoft).padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

@Composable
private fun ItemMenuSheet(item: LibraryItemSummaryDto, actions: LibraryActions) {
    LabBottomSheet(onDismiss = actions.onCloseMenu, title = item.title) {
        NavRow("⧉", "Duplicate", desc = "The copy opens in the editor", onClick = { actions.onDuplicate(item) })
        RowDivider()
        ExportRows(
            onExport = { format, save -> actions.onExport(item, format, save) },
            onPrint = { actions.onPrint(item) },
            onAnki = { actions.onAnki(item) },
        )
        RowDivider()
        NavRow("🗄", "Archive", desc = "Students keep their copies", danger = true, onClick = { actions.onArchive(item) })
    }
}

private val EXPORT_DESC = mapOf(
    ExportFormat.MD to "With the answer key",
    ExportFormat.JSON to "Re-importable",
    ExportFormat.CSV to "Vocabulary for Quizlet",
)

/**
 * Markdown / Print view / JSON / CSV (Quizlet) / Anki, in the web menu's order. A row tap
 * shares the file; "Save" writes it where the tutor picks. Anki is built by the main app.
 */
@Composable
fun ExportRows(onExport: (ExportFormat, Boolean) -> Unit, onPrint: () -> Unit, onAnki: () -> Unit) {
    ExportRow(ExportFormat.MD, onExport)
    NavRow("🖨", "Print view", desc = "Print it or save it as a PDF", onClick = onPrint)
    ExportRow(ExportFormat.JSON, onExport)
    ExportRow(ExportFormat.CSV, onExport)
    NavRow("⬇", "Export Anki (.apkg)", desc = "Built by the main app", external = true, onClick = onAnki)
}

@Composable
private fun ExportRow(format: ExportFormat, onExport: (ExportFormat, Boolean) -> Unit) {
    NavRow(
        "⬇",
        "Export ${format.label}",
        desc = EXPORT_DESC[format],
        onClick = { onExport(format, false) },
        trailing = {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                MiniAction("Share") { onExport(format, false) }
                MiniAction("Save") { onExport(format, true) }
            }
        },
    )
}

@Composable
internal fun MiniAction(label: String, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
    }
}
