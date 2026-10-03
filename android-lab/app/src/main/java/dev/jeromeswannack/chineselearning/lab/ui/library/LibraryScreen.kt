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
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummary
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
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.zIndex
import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.core.Folders
import dev.jeromeswannack.chineselearning.lab.ui.decks.dragReorderList
import dev.jeromeswannack.chineselearning.lab.ui.folders.FolderActions
import dev.jeromeswannack.chineselearning.lab.ui.folders.FolderHeaderRow
import dev.jeromeswannack.chineselearning.lab.ui.folders.FolderOverlays
import dev.jeromeswannack.chineselearning.lab.ui.folders.FolderRow
import dev.jeromeswannack.chineselearning.lab.ui.folders.FolderToolbar
import dev.jeromeswannack.chineselearning.lab.ui.folders.FolderUi
import dev.jeromeswannack.chineselearning.lab.ui.folders.SelectTick
import dev.jeromeswannack.chineselearning.lab.ui.folders.folderRows
import dev.jeromeswannack.chineselearning.lab.ui.folders.foldersInDragOrder
import dev.jeromeswannack.chineselearning.lab.ui.folders.rememberFolderHeaderDrag
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle

// `/library` — the tutor's Lesson Library (web: pages/editor/LessonLibraryPage.tsx).

data class LibraryActions(
    val onRetry: () -> Unit = {},
    val onNew: () -> Unit = {},
    val onPageMenu: () -> Unit = {},
    val onClosePageMenu: () -> Unit = {},
    val onImport: () -> Unit = {},
    val onMyLessons: () -> Unit = {},
    val onCatalogue: () -> Unit = {},
    val onOpen: (LibraryItemSummary) -> Unit = {},
    val onEdit: (LibraryItemSummary) -> Unit = {},
    val onAssign: (LibraryItemSummary) -> Unit = {},
    val onMenu: (LibraryItemSummary) -> Unit = {},
    val onCloseMenu: () -> Unit = {},
    val onDuplicate: (LibraryItemSummary) -> Unit = {},
    val onExport: (LibraryItemSummary, ExportFormat, Boolean) -> Unit = { _, _, _ -> },
    val onPrint: (LibraryItemSummary) -> Unit = {},
    val onAnki: (LibraryItemSummary) -> Unit = {},
    val onArchive: (LibraryItemSummary) -> Unit = {},
    val onConfirmArchive: (LibraryItemSummary) -> Unit = {},
    val onCancelArchive: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
    /** ⋯ → 📁 Move to folder…. */
    val onMoveToFolder: (LibraryItemSummary) -> Unit = {},
    val onLift: () -> Unit = {},
    val onSlot: () -> Unit = {},
    val newLesson: NewLessonActions = NewLessonActions(),
    val assign: AssignActions = AssignActions(),
)

@Composable
fun LibraryScreen(
    ui: LibraryUi,
    actions: LibraryActions,
    folders: FolderUi? = null,
    folderActions: FolderActions = FolderActions(),
    listState: LazyListState = rememberLazyListState(),
) {
    val data = ui.list.data
    val grouped = folders != null && folders.hasFolders && !data.isNullOrEmpty()
    val baseRows = if (grouped) libraryRows(data!!, folders!!.folders, folders.collapsed) else emptyList()
    val drag = rememberFolderHeaderDrag(listState, baseRows, folders, folderActions, actions.onLift, actions.onSlot)
    val rows = if (grouped) libraryRows(data!!, foldersInDragOrder(folders!!.folders, drag), folders.collapsed) else emptyList()
    LabScreenFrame {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                ScreenTitle("📚 Lesson Library", actions = { MoreButton(actions.onPageMenu) })
                LazyColumn(
                    Modifier.fillMaxSize().dragReorderList(drag),
                    state = listState,
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = if (folders?.selecting == true) 110.dp else 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
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
                    if (data.isNullOrEmpty()) {
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
                            ) {}
                        }
                    } else {
                        if (ui.list.offline) item(key = "offline") { OfflineNotice(updatedAt = ui.list.updatedAt) }
                        else ui.list.error?.let { e -> item(key = "error") { InlineNotice(e, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRetry) } }
                        if (folders != null) {
                            item(key = "folder-toolbar") {
                                FolderToolbar(folders, onNewFolder = { folderActions.onNewFolder(null) }, onSelect = folderActions.onSelect, onDone = folderActions.onDoneSelecting)
                            }
                        }
                        val shown: List<FolderRow<LibraryItemSummary>> = if (grouped) rows else data.map { FolderRow.Item(it, it.id, 0, "unfiled") }
                        items(shown, key = { it.key }) { row ->
                            val lifted = drag.dragId == row.key
                            val mod = Modifier
                                .zIndex(if (lifted) 1f else 0f)
                                .graphicsLayer { translationY = if (lifted) drag.dragOffsetY else 0f }
                                .then(if (lifted) Modifier else Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow)))
                            when (row) {
                                is FolderRow.Header -> FolderHeaderRow(
                                    row,
                                    Folders.LESSON,
                                    onToggle = { folderActions.onToggle(row.folder?.id) },
                                    onMenu = row.folder?.let { f -> { folderActions.onMenu(f, row.own, row.subfolders) } },
                                    modifier = mod,
                                    lifted = lifted,
                                )
                                is FolderRow.Item -> LibraryCard(
                                    row.item,
                                    busy = ui.busyItemId == row.item.id,
                                    actions,
                                    modifier = mod.padding(start = (row.depth * 16).dp),
                                    selection = if (folders?.selecting == true) row.item.id in folders.selected else null,
                                    onSelect = { folderActions.onToggleSelected(row.item.id) },
                                )
                            }
                        }
                    }
                }
            }
            if (folders != null) FolderOverlays(folders, folderActions)
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
private fun LibraryCard(
    item: LibraryItemSummary,
    busy: Boolean,
    actions: LibraryActions,
    modifier: Modifier = Modifier,
    /** Select mode: null = off, else whether it is ticked (a tap toggles). */
    selection: Boolean? = null,
    onSelect: () -> Unit = {},
) {
    LabCard(modifier.alpha(if (busy) 0.6f else 1f).then(if (selection == true) Modifier.border(2.dp, Lab.colors.accent, RoundedCornerShape(18.dp)) else Modifier)) {
        Row(
            Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.98f) { if (selection != null) onSelect() else actions.onOpen(item) }.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 10.dp),
            verticalAlignment = Alignment.Top,
        ) {
            if (selection != null) {
                SelectTick(selection, Modifier.padding(top = 10.dp))
                Spacer(Modifier.width(12.dp))
            }
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
private fun ItemMenuSheet(item: LibraryItemSummary, actions: LibraryActions) {
    LabBottomSheet(onDismiss = actions.onCloseMenu, title = item.title) {
        NavRow("⧉", "Duplicate", desc = "The copy opens in the editor", onClick = { actions.onDuplicate(item) })
        RowDivider()
        NavRow("📁", "Move to folder…", desc = "Organise your library — students see no difference", onClick = { actions.onMoveToFolder(item) })
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
 * shares the file; "Save" writes it where the tutor picks. Anki opens the export sheet (built on the phone).
 */
@Composable
fun ExportRows(onExport: (ExportFormat, Boolean) -> Unit, onPrint: () -> Unit, onAnki: () -> Unit) {
    ExportRow(ExportFormat.MD, onExport)
    NavRow("🖨", "Print view", desc = "Print it or save it as a PDF", onClick = onPrint)
    ExportRow(ExportFormat.JSON, onExport)
    ExportRow(ExportFormat.CSV, onExport)
    NavRow("⬇", "Export Anki (.apkg)", desc = "Words and sentences as Anki cards, with audio", onClick = onAnki)
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

/** Library items grouped into their folders, as rows (items keep the list's order). */
internal fun libraryRows(items: List<LibraryItemSummary>, folders: List<Folder>, collapsed: Set<String>): List<FolderRow<LibraryItemSummary>> =
    folderRows(Folders.groupIntoFolders(items, { it.folder_id }, folders, Folders.LESSON), collapsed) { it.id }
