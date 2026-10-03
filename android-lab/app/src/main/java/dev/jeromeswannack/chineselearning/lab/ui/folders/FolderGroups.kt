package dev.jeromeswannack.chineselearning.lab.ui.folders

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.core.FolderGroup
import dev.jeromeswannack.chineselearning.lab.core.FolderTree
import dev.jeromeswannack.chineselearning.lab.core.Folders
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

// The grouped list the Decks, Library and Readers screens share (web: components/folders/).
// A screen groups its items with core Folders.groupIntoFolders, flattens the tree with
// [folderRows] and renders each row in its own LazyColumn — headers with [FolderHeaderRow],
// items with its own card (indented by [FolderRow.Item.depth]).

/** One row of the grouped list. Keys: `folder:<id>` / `folder:unfiled` for headers, the item key for items. */
sealed interface FolderRow<out T> {
    val key: String

    data class Header(
        /** null = Unfiled. */
        val folder: Folder?,
        val depth: Int,
        /** Items in the folder and its subfolders. */
        val total: Int,
        /** Items directly in this folder (a delete moves only these to Unfiled; subfolders keep theirs). */
        val own: Int,
        val subfolders: Int,
        val collapsed: Boolean,
    ) : FolderRow<Nothing> {
        override val key: String get() = headerKey(folder?.id)
    }

    /** [groupKey] = `collapseKey` of the group it sits in (the in-folder drag stays inside it). */
    data class Item<T>(val item: T, override val key: String, val depth: Int, val groupKey: String) : FolderRow<T>

    companion object {
        fun headerKey(folderId: String?) = "folder:${Folders.collapseKey(folderId)}"
        fun isHeaderKey(key: String) = key.startsWith("folder:")
        fun folderIdOfKey(key: String): String? = key.removePrefix("folder:").takeIf { it != "unfiled" }
    }
}

/**
 * The tree as rows: each top-level folder (header, its items, then its subfolders, each a
 * header + items, indented), then Unfiled last. A collapsed group shows only its header.
 */
fun <T> folderRows(tree: FolderTree<T>, collapsed: Set<String>, keyOf: (T) -> String): List<FolderRow<T>> {
    val out = ArrayList<FolderRow<T>>()
    fun group(g: FolderGroup<T>, depth: Int) {
        val ck = Folders.collapseKey(g.folder?.id)
        val isCollapsed = ck in collapsed
        out += FolderRow.Header(g.folder, depth, g.total, g.items.size, g.children.size, isCollapsed)
        if (isCollapsed) return
        g.items.forEach { out += FolderRow.Item(it, keyOf(it), depth, ck) }
        g.children.forEach { group(it, depth + 1) }
    }
    tree.groups.forEach { group(it, 0) }
    group(tree.unfiled, 0)
    return out
}

/**
 * A folder's header row: ▸/▾ chevron (springs round), 📁 name, the count label and ⋯
 * (not on Unfiled). Tap toggles; a lifted header (being dragged) floats with a shadow.
 */
@Composable
fun FolderHeaderRow(
    row: FolderRow.Header,
    kind: String,
    onToggle: () -> Unit,
    onMenu: (() -> Unit)?,
    modifier: Modifier = Modifier,
    lifted: Boolean = false,
) {
    val angle by animateFloatAsState(if (row.collapsed) 0f else 90f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow), label = "chevron")
    val scale by animateFloatAsState(if (lifted) 1.03f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "lift")
    val elevation by animateDpAsState(if (lifted) 12.dp else 0.dp, label = "lift-shadow")
    val name = row.folder?.name ?: Folders.UNFILED_LABEL
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = (row.depth * 16).dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .shadow(elevation, RoundedCornerShape(14.dp))
            .clip(RoundedCornerShape(14.dp))
            .background(if (lifted) Lab.colors.card else if (row.depth == 0 && row.folder != null) Lab.colors.accentSoft.copy(alpha = 0.55f) else Color.Transparent)
            .border(if (lifted) 2.dp else 0.dp, if (lifted) Lab.colors.accent else Color.Transparent, RoundedCornerShape(14.dp))
            .heightIn(min = 48.dp)
            .bouncyClickable(pressedScale = 0.985f, onClick = onToggle)
            .padding(start = 10.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("▸", color = Lab.colors.muted, fontSize = 18.sp, modifier = Modifier.width(16.dp).rotate(angle))
        Spacer(Modifier.width(6.dp))
        Text(if (row.folder == null) "🗂" else "📁", fontSize = 17.sp)
        Spacer(Modifier.width(8.dp))
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Text(
                name,
                style = if (row.depth == 0) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (row.folder == null) Lab.colors.muted else Lab.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(8.dp))
            Text(Folders.folderCountLabel(kind, row.total), style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, maxLines = 1)
        }
        if (onMenu != null) {
            Box(
                Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onMenu),
                contentAlignment = Alignment.Center,
            ) { Text("⋯", fontSize = 20.sp, color = Lab.colors.ink, fontWeight = FontWeight.Bold) }
        } else {
            Spacer(Modifier.width(8.dp))
        }
    }
}

/** "＋ Folder" and "Select" (→ "Done" while selecting) above a list. */
@Composable
fun FolderToolbar(ui: FolderUi, onNewFolder: () -> Unit, onSelect: () -> Unit, onDone: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        ToolbarChip("＋ Folder", onClick = onNewFolder)
        if (ui.selecting) ToolbarChip("Done", filled = true, onClick = onDone)
        else ToolbarChip("Select", onClick = onSelect)
        if (ui.selecting) {
            Text(
                if (ui.selected.isEmpty()) "Tap to choose" else "${ui.selected.size} selected",
                style = MaterialTheme.typography.labelLarge,
                color = Lab.colors.muted,
            )
        }
    }
}

@Composable
private fun ToolbarChip(label: String, filled: Boolean = false, onClick: () -> Unit) {
    Text(
        label,
        color = if (filled) Color.White else Lab.colors.accent,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = Modifier
            .heightIn(min = 44.dp)
            .bouncyClickable(pressedScale = 0.93f, onClick = onClick)
            .clip(RoundedCornerShape(14.dp))
            .background(if (filled) Lab.colors.accent else Lab.colors.accentSoft)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    )
}

/** The tick a selectable item shows in select mode. */
@Composable
fun SelectTick(selected: Boolean, modifier: Modifier = Modifier) {
    val scale by animateFloatAsState(if (selected) 1f else 0.85f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "tick")
    Box(
        modifier
            .size(28.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(CircleShape)
            .background(if (selected) Lab.colors.accent else Color.Transparent)
            .border(2.dp, if (selected) Lab.colors.accent else Lab.colors.muted, CircleShape),
        contentAlignment = Alignment.Center,
    ) { if (selected) Text("✓", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
}

/** The bottom bar while selecting: "Move N to folder…". */
@Composable
fun SelectionBar(count: Int, onMove: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .shadow(10.dp, RoundedCornerShape(20.dp))
            .clip(RoundedCornerShape(20.dp))
            .background(Lab.colors.card)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (count == 0) "Choose what to move" else "$count selected",
            style = MaterialTheme.typography.bodyMedium,
            color = Lab.colors.muted,
            modifier = Modifier.weight(1f).padding(start = 12.dp),
        )
        dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill("Move $count to folder…", enabled = count > 0, onClick = onMove)
    }
}

/**
 * Everything a grouped list draws over itself, inside the screen's Box: the selection bar and
 * the `movedMessage` toast at the bottom, the error line, and the open folder sheet.
 */
@Composable
fun androidx.compose.foundation.layout.BoxScope.FolderOverlays(ui: FolderUi, actions: FolderActions) {
    androidx.compose.foundation.layout.Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        ui.error?.let {
            dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice(
                it,
                kind = dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind.Error,
                actionLabel = "OK",
                onAction = actions.onDismissError,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabToast(ui.toast)
        androidx.compose.animation.AnimatedVisibility(
            ui.selecting,
            enter = androidx.compose.animation.slideInVertically(spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow)) { it } + androidx.compose.animation.fadeIn(),
            exit = androidx.compose.animation.slideOutVertically { it } + androidx.compose.animation.fadeOut(),
        ) { SelectionBar(ui.selected.size, actions.onMoveSelected) }
    }
    FolderSheets(ui, actions)
}

/**
 * Press-and-hold a top-level folder header to drag it among the other folders (the Library and
 * Readers lists; the Decks list also drags decks, see DecksScreen). Commits the new order of
 * the top-level folders through [FolderActions.onReorder].
 */
@Composable
fun rememberFolderHeaderDrag(
    listState: androidx.compose.foundation.lazy.LazyListState,
    rows: List<FolderRow<*>>,
    ui: FolderUi?,
    actions: FolderActions,
    onLift: () -> Unit,
    onSlot: () -> Unit,
): dev.jeromeswannack.chineselearning.lab.ui.decks.DragReorderState {
    val ids = if (ui == null || ui.selecting) emptyList() else rows.filter { it is FolderRow.Header && it.depth == 0 && it.folder != null }.map { it.key }
    return dev.jeromeswannack.chineselearning.lab.ui.decks.rememberDragReorderState(
        listState, ids, onLift = onLift, onSlot = onSlot,
        onCommit = { final -> actions.onReorder(final.mapNotNull { FolderRow.folderIdOfKey(it) }) },
    )
}

/** The folders as they should be drawn: while a header is lifted, in the drag's preview order. */
fun foldersInDragOrder(folders: List<dev.jeromeswannack.chineselearning.lab.core.Folder>, drag: dev.jeromeswannack.chineselearning.lab.ui.decks.DragReorderState): List<dev.jeromeswannack.chineselearning.lab.core.Folder> {
    if (drag.dragId == null) return folders
    val rank = drag.order().filter { FolderRow.isHeaderKey(it) }.withIndex().associate { FolderRow.folderIdOfKey(it.value) to it.index }
    return folders.map { f -> rank[f.id]?.let { f.copy(position = it) } ?: f }
}
