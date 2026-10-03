package dev.jeromeswannack.chineselearning.lab.data.folders

import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.core.Folders
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.api.FolderDto
import dev.jeromeswannack.chineselearning.lab.data.api.FolderMoveBody
import dev.jeromeswannack.chineselearning.lab.data.api.FolderPaths
import dev.jeromeswannack.chineselearning.lab.data.api.FolderReorderBody
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummary
import dev.jeromeswannack.chineselearning.lab.data.api.NewFolderBody
import dev.jeromeswannack.chineselearning.lab.data.api.folderJson
import dev.jeromeswannack.chineselearning.lab.data.api.folders
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import dev.jeromeswannack.chineselearning.lab.data.platform.PlatformDao
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderStore
import dev.jeromeswannack.chineselearning.lab.ui.library.LibraryKeys
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Folders on the phone (web: frontend/src/services/folders.ts). The folder list — every kind —
 * lives in the [JsonCache] under [KEY] and is REPLACED whole by every sync (`/api/sync/changes`
 * carries `folders`; [Sync] asks `GET /api/folders` after a full sync or when the list is
 * stale), deletions included. Which folder an item is in lives with the item: Room
 * `decks.folderId` (v4), the Library list cache (`folder_id`) and the readers list cache.
 *
 * Writes ([FolderWrites]) are applied here at once and, offline, wait in the Outbox. A list
 * downloaded while some of them still wait would undo them on screen, so every replacement
 * re-applies the pending ones on top ([applyPending]) — like LongTermStore.
 */
object FolderStore {
    const val KEY = "folders/all"
    const val KIND = "folders"
    private const val MAX_AGE_MS = 10 * 60_000L
    private val listSerializer = ListSerializer(FolderDto.serializer())

    // Outbox kinds (one per endpoint).
    const val CREATE = "folder-create"
    const val EDIT = "folder-edit"
    const val DELETE = "folder-delete"
    const val REORDER = "folder-reorder"
    const val MOVE = "folder-move"
    val KINDS = setOf(CREATE, EDIT, DELETE, REORDER, MOVE)

    fun observe(cache: JsonCache): Flow<List<Folder>> = cache.observe(KEY, listSerializer).map { list -> list.orEmpty().map { it.toFolder() } }

    suspend fun all(cache: JsonCache): List<Folder> = cache.get(KEY, listSerializer).orEmpty().map { it.toFolder() }

    suspend fun put(cache: JsonCache, folders: List<Folder>) = cache.put(KEY, KIND, folders.map(FolderDto::of), listSerializer)

    /** The server's whole list, with this phone's still-unsent folder writes on top. */
    suspend fun replaceFromServer(cache: JsonCache, platform: PlatformDao, server: List<FolderDto>) {
        put(cache, applyPending(server.map { it.toFolder() }, pendingOps(platform)))
    }

    suspend fun pendingOps(platform: PlatformDao): List<OutboxEntity> =
        runCatching { platform.allOutbox() }.getOrDefault(emptyList()).filter { it.kind in KINDS && it.state == Outbox.PENDING }

    // ---------------- local mirror of each write ----------------

    /** Folder-list effect of one write (pure; also what [FolderWrites] does optimistically). */
    fun applyOp(folders: List<Folder>, kind: String, path: String, body: String?): List<Folder> {
        val obj = body?.let { runCatching { folderJson.parseToJsonElement(it) as? JsonObject }.getOrNull() }
        return when (kind) {
            CREATE -> {
                val b = body?.let { runCatching { folderJson.decodeFromString(NewFolderBody.serializer(), it) }.getOrNull() } ?: return folders
                if (folders.any { it.id == b.id }) folders else folders + created(folders, b)
            }
            EDIT -> {
                val id = FolderPaths.idOf(path) ?: return folders
                folders.map { f ->
                    if (f.id != id || obj == null) f
                    else f.copy(
                        name = if ("name" in obj) obj["name"]?.jsonPrimitive?.contentOrNull ?: f.name else f.name,
                        parentId = if ("parent_id" in obj) obj["parent_id"]?.jsonPrimitive?.contentOrNull else f.parentId,
                    )
                }
            }
            DELETE -> {
                val id = FolderPaths.idOf(path) ?: return folders
                folders.filter { it.id != id }.map { if (it.parentId == id) it.copy(parentId = null) else it }
            }
            REORDER -> {
                val b = body?.let { runCatching { folderJson.decodeFromString(FolderReorderBody.serializer(), it) }.getOrNull() } ?: return folders
                val pos = b.folder_ids.withIndex().associate { it.value to it.index }
                folders.map { f -> pos[f.id]?.takeIf { f.kind == b.kind }?.let { f.copy(position = it) } ?: f }
            }
            else -> folders
        }
    }

    /** A new folder goes last among its siblings (the server's rule). */
    fun created(folders: List<Folder>, b: NewFolderBody): Folder {
        val siblings = folders.filter { it.kind == b.kind && it.parentId == b.parent_id }
        val now = dev.jeromeswannack.chineselearning.lab.core.Js.toIsoString(System.currentTimeMillis())
        return Folder(b.id, "", b.kind, Folders.cleanFolderName(b.name), b.parent_id, (siblings.maxOfOrNull { it.position } ?: -1) + 1, now, now)
    }

    fun applyPending(folders: List<Folder>, pending: List<OutboxEntity>): List<Folder> =
        pending.fold(folders) { acc, op -> applyOp(acc, op.kind, op.path, op.bodyJson) }

    /** Where an item's folder is stored, per kind: Room for decks, the list caches for the others. */
    suspend fun setItemsFolder(dao: LabDao, cache: JsonCache, kind: String, ids: Collection<String>, folderId: String?) {
        if (ids.isEmpty()) return
        val set = ids.toHashSet()
        when (kind) {
            Folders.DECK -> dao.setDeckFolder(ids.toList(), folderId)
            Folders.LESSON -> patchList(cache, LibraryKeys.LIST, LibraryKeys.KIND, LibraryItemSummary.serializer()) { if (it.id in set) it.copy(folder_id = folderId) else it }
            Folders.READER -> patchList(cache, ReaderStore.LIST, ReaderStore.KIND, GradedReaderDto.serializer()) { if (it.id in set) it.copy(folderId = folderId) else it }
        }
    }

    /** A deleted folder's items → Unfiled, on the phone. */
    suspend fun unfileItems(dao: LabDao, cache: JsonCache, kind: String, folderId: String) {
        when (kind) {
            Folders.DECK -> dao.unfileDecks(folderId)
            Folders.LESSON -> patchList(cache, LibraryKeys.LIST, LibraryKeys.KIND, LibraryItemSummary.serializer()) { if (it.folder_id == folderId) it.copy(folder_id = null) else it }
            Folders.READER -> patchList(cache, ReaderStore.LIST, ReaderStore.KIND, GradedReaderDto.serializer()) { if (it.folderId == folderId) it.copy(folderId = null) else it }
        }
    }

    private suspend fun <T> patchList(cache: JsonCache, key: String, kind: String, item: kotlinx.serialization.KSerializer<T>, f: (T) -> T) {
        val s = ListSerializer(item)
        val list = cache.get(key, s) ?: return
        val next = list.map(f)
        if (next != list) cache.put(key, kind, next, s)
    }

    /**
     * After a sync rewrote decks / the Library and readers lists: the moves and deletes still
     * in the Outbox stay as made on this phone.
     */
    suspend fun reapplyPendingItems(dao: LabDao, cache: JsonCache, platform: PlatformDao) {
        for (op in pendingOps(platform)) {
            when (op.kind) {
                MOVE -> {
                    val b = op.bodyJson?.let { runCatching { folderJson.decodeFromString(FolderMoveBody.serializer(), it) }.getOrNull() } ?: continue
                    setItemsFolder(dao, cache, b.kind, b.ids, b.folder_id)
                }
                DELETE -> {
                    val id = FolderPaths.idOf(op.path) ?: continue
                    val kind = deletedKind(op) ?: continue
                    unfileItems(dao, cache, kind, id)
                }
            }
        }
    }

    /** A delete's Outbox id is `folder-delete:<kind>:<id>` (the path has no kind). */
    fun deleteOutboxId(kind: String, id: String) = "$DELETE:$kind:$id"
    private fun deletedKind(op: OutboxEntity): String? = op.id.split(':').getOrNull(1)?.takeIf(Folders::isFolderKind)

    // ---------------- collapsed groups (per device, per kind) ----------------

    private fun collapsedKey(kind: String) = "folders/collapsed/$kind"
    private val stringList = ListSerializer(String.serializer())

    fun observeCollapsed(cache: JsonCache, kind: String): Flow<List<String>> = cache.observe(collapsedKey(kind), stringList).map { it.orEmpty() }

    suspend fun toggleCollapsed(cache: JsonCache, kind: String, folderId: String?) {
        val now = cache.get(collapsedKey(kind), stringList).orEmpty()
        cache.put(collapsedKey(kind), "folders-ui", Folders.toggleCollapsed(now, Folders.collapseKey(folderId)), stringList)
    }

    /**
     * After every sync (registered in FeatureSyncs, after the Library and readers syncs): the
     * folder list when a full sync ran or it is stale (an incremental sync already replaced it
     * from `/api/sync/changes`), then the pending moves re-applied over freshly synced items.
     */
    object Sync : FeatureSync {
        override suspend fun sync(ctx: SyncContext) {
            val platform = ctx.db.platform()
            if (ctx.full || !ctx.cache.isFresh(KEY, MAX_AGE_MS)) replaceFromServer(ctx.cache, platform, ctx.api.folders())
            reapplyPendingItems(ctx.db.dao(), ctx.cache, platform)
        }
    }
}
