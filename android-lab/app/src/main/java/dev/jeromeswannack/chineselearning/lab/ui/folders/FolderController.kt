package dev.jeromeswannack.chineselearning.lab.ui.folders

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.core.Folders
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.decks.WriteOutcome
import dev.jeromeswannack.chineselearning.lab.data.folders.FolderStore
import dev.jeromeswannack.chineselearning.lab.data.folders.FolderWrites
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The sheet / dialog a folder list has open. */
sealed interface FolderSheet {
    /** "＋ Folder" (or "New folder inside…" with [parentId]); [moveIds] = "＋ New folder" in the move sheet: create, then move there. */
    data class NewFolder(val parentId: String? = null, val moveIds: List<String> = emptyList(), val error: String? = null, val busy: Boolean = false) : FolderSheet

    /** A folder header's ⋯: Rename… · New folder inside… (top level) · Delete…. */
    data class Menu(val folder: Folder, val itemCount: Int, val subfolderCount: Int) : FolderSheet

    data class Rename(val folder: Folder, val error: String? = null) : FolderSheet

    data class ConfirmDelete(val folder: Folder, val itemCount: Int, val subfolderCount: Int) : FolderSheet

    /** Move to folder… for [ids]; [currentFolderId] is ticked when they all share it ("" = mixed). */
    data class Move(val ids: List<String>, val currentFolderId: String?) : FolderSheet
}

/** Folder state of one list (decks / Library / readers). */
data class FolderUi(
    val kind: String,
    /** Every folder of this kind. */
    val folders: List<Folder> = emptyList(),
    /** `collapseKey`s of the collapsed groups (per device). */
    val collapsed: Set<String> = emptySet(),
    val selecting: Boolean = false,
    val selected: Set<String> = emptySet(),
    val sheet: FolderSheet? = null,
    /** The `movedMessage` toast (and other short confirmations). */
    val toast: String? = null,
    /** A refused write (the server's reason), shown in the list. */
    val error: String? = null,
) {
    val hasFolders: Boolean get() = folders.isNotEmpty()
    fun isCollapsed(folderId: String?) = Folders.collapseKey(folderId) in collapsed
}

/** Haptics + sounds for folder moments (no-op in tests). */
interface FolderFeel {
    fun tick() {}
    fun moved() {}
    fun failed() {}

    object None : FolderFeel

    companion object {
        fun of(app: LabApp): FolderFeel = object : FolderFeel {
            override fun tick() = app.haptics.tick()
            override fun moved() {
                app.haptics.correct()
                app.sounds.play(Sounds.Sfx.POP, 0.5f)
            }
            override fun failed() = app.haptics.wrong()
        }
    }
}

/**
 * The folder half of a list screen, shared by Decks, the Library and Readers (web: the
 * FolderGroups / MoveToFolderSheet / folder sheets the three pages share). Owns the folder
 * list (JsonCache, synced), the collapsed groups, select mode and every sheet; writes go
 * through [FolderWrites]. [currentFolderOf] answers "which folder is this item in" for the
 * move sheet's tick.
 */
class FolderController(
    private val scope: CoroutineScope,
    val kind: String,
    private val cache: JsonCache,
    private val writes: FolderWrites,
    private val feel: FolderFeel = FolderFeel.None,
    private val currentFolderOf: (String) -> String? = { null },
    private val toastMs: Long = 2_500,
) {
    private data class Local(
        val selecting: Boolean = false,
        val selected: Set<String> = emptySet(),
        val sheet: FolderSheet? = null,
        val toast: String? = null,
        val error: String? = null,
    )

    private val local = MutableStateFlow(Local())
    private var toastJob: Job? = null

    val ui: StateFlow<FolderUi> = combine(FolderStore.observe(cache), FolderStore.observeCollapsed(cache, kind), local) { all, collapsed, l ->
        FolderUi(kind, all.filter { it.kind == kind }, collapsed.toSet(), l.selecting, l.selected, l.sheet, l.toast, l.error)
    }.stateIn(scope, SharingStarted.Eagerly, FolderUi(kind))

    // ---- groups ----
    fun toggle(folderId: String?) {
        feel.tick()
        scope.launch { FolderStore.toggleCollapsed(cache, kind, folderId) }
    }

    // ---- select mode ----
    fun startSelecting() { feel.tick(); local.update { it.copy(selecting = true, selected = emptySet()) } }
    fun stopSelecting() = local.update { it.copy(selecting = false, selected = emptySet()) }
    fun toggleSelected(id: String) {
        feel.tick()
        local.update { it.copy(selected = if (id in it.selected) it.selected - id else it.selected + id) }
    }

    // ---- sheets ----
    fun newFolder(parentId: String? = null) { feel.tick(); local.update { it.copy(sheet = FolderSheet.NewFolder(parentId)) } }
    fun openMenu(folder: Folder, itemCount: Int, subfolderCount: Int) { feel.tick(); local.update { it.copy(sheet = FolderSheet.Menu(folder, itemCount, subfolderCount)) } }
    fun askRename(folder: Folder) = local.update { it.copy(sheet = FolderSheet.Rename(folder)) }
    fun askDelete(folder: Folder, itemCount: Int, subfolderCount: Int) = local.update { it.copy(sheet = FolderSheet.ConfirmDelete(folder, itemCount, subfolderCount)) }
    fun closeSheet() = local.update { it.copy(sheet = null) }
    fun dismissError() = local.update { it.copy(error = null) }

    /** Move to folder… for one item (its ⋯ menu) or the selection. */
    fun openMove(ids: List<String>) {
        if (ids.isEmpty()) return
        feel.tick()
        val folders = ids.map(currentFolderOf).distinct()
        val shared = if (folders.size == 1) folders[0] else MIXED
        local.update { it.copy(sheet = FolderSheet.Move(ids, shared)) }
    }

    fun openMoveSelected() = openMove(local.value.selected.toList())

    /** "＋ New folder" in the move sheet: create it, then move there. */
    fun newFolderForMove(ids: List<String>) = local.update { it.copy(sheet = FolderSheet.NewFolder(null, ids)) }

    // ---- writes ----
    fun create(name: String, parentId: String?) {
        val sheet = local.value.sheet as? FolderSheet.NewFolder ?: FolderSheet.NewFolder(parentId)
        local.update { it.copy(sheet = sheet.copy(busy = true, error = null)) }
        scope.launch {
            val (outcome, folder) = writes.create(kind, name, parentId)
            if (outcome is WriteOutcome.Refused || folder == null) {
                feel.failed()
                local.update { it.copy(sheet = sheet.copy(busy = false, error = (outcome as? WriteOutcome.Refused)?.message ?: "Couldn't create the folder.")) }
                return@launch
            }
            local.update { it.copy(sheet = null) }
            Analytics.track("folder.create", mapOf("kind" to kind, "nested" to (parentId != null)))
            if (sheet.moveIds.isNotEmpty()) doMove(sheet.moveIds, folder.id, folder.name) else feel.moved()
        }
    }

    fun rename(folder: Folder, name: String) {
        scope.launch {
            when (val o = writes.rename(folder, name)) {
                is WriteOutcome.Refused -> { feel.failed(); local.update { it.copy(sheet = FolderSheet.Rename(folder, o.message)) } }
                else -> { feel.tick(); local.update { it.copy(sheet = null) }; Analytics.track("folder.rename", mapOf("kind" to kind)) }
            }
        }
    }

    fun delete(folder: Folder) {
        val items = (local.value.sheet as? FolderSheet.ConfirmDelete)?.takeIf { it.folder.id == folder.id }?.itemCount
        local.update { it.copy(sheet = null) }
        scope.launch {
            when (val o = writes.delete(folder)) {
                is WriteOutcome.Refused -> refused(o.message)
                else -> { feel.tick(); showToast("Deleted “${folder.name}”"); Analytics.track("folder.delete", mapOf("kind" to kind, "items" to items)) }
            }
        }
    }

    /** Move [ids] to [folderId] (null = Unfiled) from the sheet. */
    fun moveTo(folderId: String?) {
        val sheet = local.value.sheet as? FolderSheet.Move ?: return
        val name = folderId?.let { id -> ui.value.folders.firstOrNull { it.id == id }?.name }
        local.update { it.copy(sheet = null) }
        doMove(sheet.ids, folderId, name)
    }

    private fun doMove(ids: List<String>, folderId: String?, name: String?) {
        local.update { it.copy(selecting = false, selected = emptySet()) }
        scope.launch {
            when (val o = writes.move(kind, ids, folderId)) {
                is WriteOutcome.Refused -> refused(o.message)
                else -> { feel.moved(); showToast(Folders.movedMessage(kind, ids.size, name)); Analytics.track("folder.move_items", mapOf("kind" to kind, "count" to ids.size, "unfiled" to (folderId == null))) }
            }
        }
    }

    /** The end of a header drag: top-level folders in their new order. */
    fun reorder(orderedIds: List<String>) {
        val current = Folders.sortFolders(ui.value.folders.filter { it.parentId == null }).map { it.id }
        if (orderedIds == current) return
        feel.moved()
        scope.launch { (writes.reorder(kind, orderedIds) as? WriteOutcome.Refused)?.let { refused(it.message) } }
    }

    private fun refused(message: String) {
        feel.failed()
        local.update { it.copy(error = message) }
    }

    private fun showToast(text: String) {
        local.update { it.copy(toast = text) }
        toastJob?.cancel()
        toastJob = scope.launch {
            delay(toastMs)
            local.update { if (it.toast == text) it.copy(toast = null) else it }
        }
    }

    companion object {
        /** [FolderSheet.Move.currentFolderId] when the items are in different folders: nothing ticked. */
        const val MIXED = "\u0000mixed"

        fun writes(app: LabApp) = FolderWrites(
            dao = app.repo.dao,
            api = app.repo.api,
            cache = app.cache,
            outbox = app.outbox,
            online = { app.online.value },
            onLocalChange = { app.repo.notifyLocalChange() },
            onQueued = { app.scheduleBackgroundUpload() },
        )
    }
}
