package dev.jeromeswannack.chineselearning.lab.ui.folders

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.core.Folders
import dev.jeromeswannack.chineselearning.lab.ui.cards.Field
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** What the folder sheets call (a [FolderController]'s methods; no-ops for screenshots). */
data class FolderActions(
    val onToggle: (String?) -> Unit = {},
    val onNewFolder: (parentId: String?) -> Unit = {},
    val onMenu: (Folder, Int, Int) -> Unit = { _, _, _ -> },
    val onRename: (Folder) -> Unit = {},
    val onDelete: (Folder, Int, Int) -> Unit = { _, _, _ -> },
    val onCreate: (name: String, parentId: String?) -> Unit = { _, _ -> },
    val onSaveRename: (Folder, String) -> Unit = { _, _ -> },
    val onConfirmDelete: (Folder) -> Unit = {},
    val onMoveTo: (String?) -> Unit = {},
    val onNewFolderForMove: (List<String>) -> Unit = {},
    val onOpenMove: (List<String>) -> Unit = {},
    val onMoveSelected: () -> Unit = {},
    val onSelect: () -> Unit = {},
    val onDoneSelecting: () -> Unit = {},
    val onToggleSelected: (String) -> Unit = {},
    val onReorder: (List<String>) -> Unit = {},
    /** ⋯ → Move folder… */
    val onMoveFolder: (Folder) -> Unit = {},
    /** The pick in the Move folder sheet: [Folder] into the parent id (null = top level). */
    val onMoveFolderTo: (Folder, String?) -> Unit = { _, _ -> },
    val onCloseSheet: () -> Unit = {},
    val onDismissError: () -> Unit = {},
) {
    companion object {
        fun of(c: FolderController) = FolderActions(
            onToggle = c::toggle,
            onNewFolder = c::newFolder,
            onMenu = c::openMenu,
            onRename = c::askRename,
            onDelete = c::askDelete,
            onCreate = c::create,
            onSaveRename = c::rename,
            onConfirmDelete = c::delete,
            onMoveTo = c::moveTo,
            onNewFolderForMove = c::newFolderForMove,
            onOpenMove = c::openMove,
            onMoveSelected = c::openMoveSelected,
            onSelect = c::startSelecting,
            onDoneSelecting = c::stopSelecting,
            onToggleSelected = c::toggleSelected,
            onReorder = c::reorder,
            onMoveFolder = c::openMoveFolder,
            onMoveFolderTo = c::moveFolder,
            onCloseSheet = c::closeSheet,
            onDismissError = c::dismissError,
        )
    }
}

/** Whichever folder sheet / dialog [ui] has open. Put it once at the end of a screen. */
@Composable
fun FolderSheets(ui: FolderUi, actions: FolderActions) {
    when (val s = ui.sheet) {
        null -> Unit
        is FolderSheet.NewFolder -> NewFolderSheet(ui, s, actions)
        is FolderSheet.Menu -> LabBottomSheet(onDismiss = actions.onCloseSheet, title = "📁 ${s.folder.name}") {
            NavRow("✏️", "Rename…", onClick = { actions.onRename(s.folder) })
            // Folders nest up to MAX_FOLDER_DEPTH levels: the deepest level can't hold another.
            val level = Folders.folderLevel(s.folder, ui.folders)
            if (level < Folders.MAX_FOLDER_DEPTH) {
                RowDivider()
                NavRow("📁", "New folder inside…", desc = "Folders go ${Folders.MAX_FOLDER_DEPTH} levels deep", onClick = { actions.onNewFolder(s.folder.id) })
            }
            RowDivider()
            NavRow("↪", "Move folder…", desc = "Into another folder, or to the top level", onClick = { actions.onMoveFolder(s.folder) })
            RowDivider()
            NavRow("🗑", "Delete…", desc = "What's inside moves out — nothing is deleted", danger = true, onClick = { actions.onDelete(s.folder, s.itemCount, s.subfolderCount) })
        }
        is FolderSheet.Rename -> RenameSheet(s, actions)
        is FolderSheet.ConfirmDelete -> ConfirmDialog(
            title = "Delete folder “${s.folder.name}”?",
            text = Folders.deleteFolderMessage(
                ui.kind, s.folder.name, s.itemCount, s.subfolderCount,
                s.folder.parentId?.let { p -> ui.folders.firstOrNull { it.id == p }?.name },
            ),
            confirmLabel = "Delete folder",
            danger = true,
            onConfirm = { actions.onConfirmDelete(s.folder) },
            onDismiss = actions.onCloseSheet,
        )
        is FolderSheet.Move -> MoveToFolderSheet(ui, s, actions)
        is FolderSheet.MoveFolder -> MoveFolderSheet(ui, s, actions)
    }
}

/** "Now in HSK 2 › Week 1" — where the thing being moved is now. */
@Composable
private fun Breadcrumb(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = Lab.colors.muted,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp).testTag("folder-breadcrumb"),
    )
}

/**
 * Move folder…: the top level, then every folder in tree order (indented) except the folder
 * itself and its own subfolders; places too deep for it are shown greyed ("Too deep").
 */
@Composable
fun MoveFolderSheet(ui: FolderUi, sheet: FolderSheet.MoveFolder, actions: FolderActions) {
    val f = sheet.folder
    val inside = (Folders.folderDescendantIds(f.id, ui.folders) + f.id).toSet()
    val parent = f.parentId?.let { p -> ui.folders.firstOrNull { it.id == p } }
    LabBottomSheet(onDismiss = actions.onCloseSheet, title = "Move folder “${f.name}”") {
        Breadcrumb("Now in ${parent?.let { Folders.folderPath(it, ui.folders) } ?: "the top level"}")
        sheet.error?.let { InlineNotice(it, kind = NoticeKind.Error, modifier = Modifier.padding(horizontal = 20.dp)) }
        FolderChoice("🏠", "Top level", 0, parent == null) { actions.onMoveFolderTo(f, null) }
        for (o in Folders.folderOptions(ui.folders, ui.kind)) {
            if (o.folder.id in inside) continue
            val problem = Folders.parentProblem(f.id, ui.kind, o.folder.id, ui.folders)
            FolderChoice(
                if (o.depth == 0) "📁" else "↳", o.folder.name, o.depth + 1, parent?.id == o.folder.id,
                enabled = problem == null, desc = if (problem != null) "Too deep" else null,
                tag = "move-folder-to-${o.folder.id}",
            ) { actions.onMoveFolderTo(f, o.folder.id) }
        }
    }
}

/**
 * Move to folder…: Unfiled, then every folder in picker order (`folderOptions`, subfolders
 * indented), the current one ticked, and "＋ New folder" (create, then move there).
 */
@Composable
fun MoveToFolderSheet(ui: FolderUi, sheet: FolderSheet.Move, actions: FolderActions) {
    val n = sheet.ids.size
    LabBottomSheet(onDismiss = actions.onCloseSheet, title = if (n == 1) "Move to folder" else "Move $n ${Folders.folderItemNoun(ui.kind, n)} to folder") {
        if (sheet.currentFolderId != FolderController.MIXED) {
            val current = sheet.currentFolderId?.let { id -> ui.folders.firstOrNull { it.id == id } }
            Breadcrumb("Now in ${current?.let { Folders.folderPath(it, ui.folders) } ?: Folders.UNFILED_LABEL}")
        }
        FolderChoice("🗂", Folders.UNFILED_LABEL, 0, sheet.currentFolderId == null) { actions.onMoveTo(null) }
        for (o in Folders.folderOptions(ui.folders, ui.kind)) {
            FolderChoice(if (o.depth == 0) "📁" else "↳", o.folder.name, o.depth, sheet.currentFolderId == o.folder.id, tag = "move-to-${o.folder.id}") { actions.onMoveTo(o.folder.id) }
        }
        RowDivider()
        NavRow("＋", "New folder", desc = "Make one and move ${if (n == 1) "it" else "them"} there", onClick = { actions.onNewFolderForMove(sheet.ids) })
    }
}

@Composable
private fun FolderChoice(
    icon: String, label: String, depth: Int, current: Boolean,
    enabled: Boolean = true, desc: String? = null, tag: String? = null, onClick: () -> Unit,
) {
    NavRow(
        icon,
        label,
        modifier = Modifier.padding(start = (depth * 18).dp).then(if (tag != null) Modifier.testTag(tag) else Modifier),
        desc = desc,
        enabled = enabled,
        trailing = { if (current) Text("✓", color = Lab.colors.accent, style = MaterialTheme.typography.titleMedium) },
        onClick = onClick,
    )
}

@Composable
private fun NewFolderSheet(ui: FolderUi, sheet: FolderSheet.NewFolder, actions: FolderActions) {
    var name by remember { mutableStateOf("") }
    var parent by remember { mutableStateOf(sheet.parentId) }
    // Any folder that can still hold another (MAX_FOLDER_DEPTH levels), in tree order.
    val parents = Folders.folderOptions(ui.folders, ui.kind).filter { it.depth + 1 < Folders.MAX_FOLDER_DEPTH }
    LabBottomSheet(onDismiss = actions.onCloseSheet, title = "New folder") {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            sheet.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
            Field("Folder name", name, hint = if (ui.kind == Folders.DECK) "e.g. HSK 2" else "e.g. Week 1") { name = it }
            if (parents.isNotEmpty()) {
                Text("Inside", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                InsideChip("Top level", parent == null, Modifier.fillMaxWidth()) { parent = null }
                // The tree, indented — the chosen one says its whole path.
                parents.forEach { o ->
                    InsideChip(
                        if (parent == o.folder.id) "📁 ${Folders.folderPath(o.folder, ui.folders)}" else "${if (o.depth == 0) "📁" else "↳"} ${o.folder.name}",
                        parent == o.folder.id,
                        Modifier.padding(start = (o.depth * 18).dp).fillMaxWidth().testTag("inside-${o.folder.id}"),
                    ) { parent = o.folder.id }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill("Cancel", Modifier.weight(1f)) { actions.onCloseSheet() }
                PrimaryPill(
                    if (sheet.busy) "Creating…" else if (sheet.moveIds.isNotEmpty()) "Create & move" else "Create folder",
                    Modifier.weight(1f).height(52.dp),
                    enabled = !sheet.busy && Folders.folderNameProblems(name).isEmpty(),
                ) { actions.onCreate(name, parent) }
            }
        }
    }
}

@Composable
private fun InsideChip(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        label,
        color = if (selected) androidx.compose.ui.graphics.Color.White else Lab.colors.ink,
        style = MaterialTheme.typography.labelLarge,
        maxLines = 1,
        modifier = modifier
            .bouncyClickable(pressedScale = 0.95f, onClick = onClick)
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) Lab.colors.accent else Lab.colors.faint)
            .padding(horizontal = 14.dp, vertical = 13.dp),
    )
}

@Composable
private fun RenameSheet(sheet: FolderSheet.Rename, actions: FolderActions) {
    var name by remember(sheet.folder.id) { mutableStateOf(sheet.folder.name) }
    LabBottomSheet(onDismiss = actions.onCloseSheet, title = "Rename folder") {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            sheet.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
            Field("Folder name", name) { name = it }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill("Cancel", Modifier.weight(1f)) { actions.onCloseSheet() }
                PrimaryPill("Save", Modifier.weight(1f).height(52.dp), enabled = Folders.folderNameProblems(name).isEmpty()) { actions.onSaveRename(sheet.folder, name) }
            }
        }
    }
}
