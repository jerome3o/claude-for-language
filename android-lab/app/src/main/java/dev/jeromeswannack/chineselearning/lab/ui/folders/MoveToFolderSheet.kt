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
            if (s.folder.parentId == null) {
                RowDivider()
                NavRow("📁", "New folder inside…", desc = "One level deep", onClick = { actions.onNewFolder(s.folder.id) })
            }
            RowDivider()
            NavRow("🗑", "Delete…", desc = "What's inside moves out — nothing is deleted", danger = true, onClick = { actions.onDelete(s.folder, s.itemCount, s.subfolderCount) })
        }
        is FolderSheet.Rename -> RenameSheet(s, actions)
        is FolderSheet.ConfirmDelete -> ConfirmDialog(
            title = "Delete folder “${s.folder.name}”?",
            text = Folders.deleteFolderMessage(ui.kind, s.folder.name, s.itemCount, s.subfolderCount),
            confirmLabel = "Delete folder",
            danger = true,
            onConfirm = { actions.onConfirmDelete(s.folder) },
            onDismiss = actions.onCloseSheet,
        )
        is FolderSheet.Move -> MoveToFolderSheet(ui, s, actions)
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
        FolderChoice("🗂", Folders.UNFILED_LABEL, 0, sheet.currentFolderId == null) { actions.onMoveTo(null) }
        for (o in Folders.folderOptions(ui.folders, ui.kind)) {
            FolderChoice("📁", o.folder.name, o.depth, sheet.currentFolderId == o.folder.id) { actions.onMoveTo(o.folder.id) }
        }
        RowDivider()
        NavRow("＋", "New folder", desc = "Make one and move ${if (n == 1) "it" else "them"} there", onClick = { actions.onNewFolderForMove(sheet.ids) })
    }
}

@Composable
private fun FolderChoice(icon: String, label: String, depth: Int, current: Boolean, onClick: () -> Unit) {
    NavRow(
        icon,
        label,
        modifier = Modifier.padding(start = (depth * 20).dp),
        trailing = { if (current) Text("✓", color = Lab.colors.accent, style = MaterialTheme.typography.titleMedium) },
        onClick = onClick,
    )
}

@Composable
private fun NewFolderSheet(ui: FolderUi, sheet: FolderSheet.NewFolder, actions: FolderActions) {
    var name by remember { mutableStateOf("") }
    var parent by remember { mutableStateOf(sheet.parentId) }
    val tops = Folders.sortFolders(ui.folders.filter { it.parentId == null })
    LabBottomSheet(onDismiss = actions.onCloseSheet, title = "New folder") {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            sheet.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
            Field("Folder name", name, hint = if (ui.kind == Folders.DECK) "e.g. HSK 2" else "e.g. Week 1") { name = it }
            // A folder that is going to receive items can only be made at the top level here.
            if (tops.isNotEmpty() && sheet.moveIds.isEmpty()) {
                Text("Inside", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    InsideChip("Top level", parent == null) { parent = null }
                }
                tops.chunked(2).forEach { pair ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        pair.forEach { f -> InsideChip("📁 ${f.name}", parent == f.id, Modifier.weight(1f)) { parent = f.id } }
                        if (pair.size == 1) androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill("Cancel", Modifier.weight(1f)) { actions.onCloseSheet() }
                PrimaryPill(
                    if (sheet.busy) "Creating…" else if (sheet.moveIds.isNotEmpty()) "Create & move" else "Create folder",
                    Modifier.weight(1f).height(52.dp),
                    enabled = !sheet.busy && Folders.folderNameProblems(name).isEmpty(),
                ) { actions.onCreate(name, if (sheet.moveIds.isEmpty()) parent else null) }
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
