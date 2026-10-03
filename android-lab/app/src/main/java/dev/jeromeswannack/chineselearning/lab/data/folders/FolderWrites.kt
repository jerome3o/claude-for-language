package dev.jeromeswannack.chineselearning.lab.data.folders

import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.core.Folders
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.FolderMoveBody
import dev.jeromeswannack.chineselearning.lab.data.api.FolderPaths
import dev.jeromeswannack.chineselearning.lab.data.api.FolderReorderBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewFolderBody
import dev.jeromeswannack.chineselearning.lab.data.api.folderJson
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.send
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.decks.WriteOutcome
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.io.IOException
import java.util.UUID

/**
 * Every folder write (web: services/folders.ts createFolder / renameFolder / deleteFolder /
 * moveItemsToFolder / reorderFolders) — the same API calls. Each is checked first with the
 * parity-tested rules (core Folders.kt: name, parent), applied to the phone at once (folder
 * list in the JsonCache, the items' folder in Room / the list caches), then:
 *  - online and none of ours waiting in the Outbox: sent now; a 4xx comes back as
 *    [WriteOutcome.Refused] with the server's reason and the local change is undone;
 *  - offline / server trouble: queued in the Outbox (every folder endpoint is idempotent —
 *    create carries a client id), sent in order on the next sync.
 */
class FolderWrites(
    private val dao: LabDao,
    private val api: Api,
    private val cache: JsonCache,
    private val outbox: Outbox,
    private val online: () -> Boolean,
    /** Room changed (decks): screens reload. */
    private val onLocalChange: () -> Unit = {},
    /** Something was queued: schedule the background upload. */
    private val onQueued: () -> Unit = {},
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val lock = Mutex()

    /** `createFolder`: [parentId] = a top-level folder of the same kind, or null. */
    suspend fun create(kind: String, rawName: String, parentId: String?): Pair<WriteOutcome, Folder?> {
        Folders.folderNameProblems(rawName).firstOrNull()?.let { return WriteOutcome.Refused(it) to null }
        val all = FolderStore.all(cache)
        Folders.parentProblem(null, kind, parentId, all)?.let { return WriteOutcome.Refused(it) to null }
        val body = NewFolderBody(kind, Folders.cleanFolderName(rawName), parentId, newId())
        val text = folderJson.encodeToString(NewFolderBody.serializer(), body)
        val outcome = write(FolderStore.CREATE, "POST", FolderPaths.LIST, text, outboxId = "${FolderStore.CREATE}:${body.id}") { mirrorList(FolderStore.CREATE, FolderPaths.LIST, text) }
        val folder = if (outcome is WriteOutcome.Refused) null else FolderStore.all(cache).firstOrNull { it.id == body.id }
        return outcome to folder
    }

    /** `renameFolder`. */
    suspend fun rename(folder: Folder, rawName: String): WriteOutcome {
        Folders.folderNameProblems(rawName).firstOrNull()?.let { return WriteOutcome.Refused(it) }
        val name = Folders.cleanFolderName(rawName)
        if (name == folder.name) return WriteOutcome.Saved
        val text = buildJsonObject { put("name", JsonPrimitive(name)) }.toString()
        val path = FolderPaths.folder(folder.id)
        return write(FolderStore.EDIT, "PATCH", path, text) { mirrorList(FolderStore.EDIT, path, text) }
    }

    /** Put a folder inside a top-level folder (or back at the top level with null). */
    suspend fun setParent(folder: Folder, parentId: String?): WriteOutcome {
        Folders.parentProblem(folder.id, folder.kind, parentId, FolderStore.all(cache))?.let { return WriteOutcome.Refused(it) }
        val text = buildJsonObject { put("parent_id", parentId?.let(::JsonPrimitive) ?: JsonNull) }.toString()
        val path = FolderPaths.folder(folder.id)
        return write(FolderStore.EDIT, "PATCH", path, text) { mirrorList(FolderStore.EDIT, path, text) }
    }

    /** `deleteFolder`: its items → Unfiled, its subfolders → top level; nothing else is deleted. */
    suspend fun delete(folder: Folder): WriteOutcome {
        val path = FolderPaths.folder(folder.id)
        return write(FolderStore.DELETE, "DELETE", path, null, goneIsDone = true, outboxId = FolderStore.deleteOutboxId(folder.kind, folder.id)) {
            mirrorList(FolderStore.DELETE, path, null)
            FolderStore.unfileItems(dao, cache, folder.kind, folder.id)
        }
    }

    /** `reorderFolders`: sibling folders in their new order. */
    suspend fun reorder(kind: String, orderedIds: List<String>): WriteOutcome {
        val text = folderJson.encodeToString(FolderReorderBody.serializer(), FolderReorderBody(kind, orderedIds))
        return write(FolderStore.REORDER, "PUT", FolderPaths.REORDER, text) { mirrorList(FolderStore.REORDER, FolderPaths.REORDER, text) }
    }

    /** `moveItemsToFolder`: [folderId] null = Unfiled. */
    suspend fun move(kind: String, ids: List<String>, folderId: String?): WriteOutcome {
        if (ids.isEmpty()) return WriteOutcome.Saved
        val text = folderJson.encodeToString(FolderMoveBody.serializer(), FolderMoveBody(kind, ids, folderId))
        return write(FolderStore.MOVE, "POST", FolderPaths.MOVE, text) { FolderStore.setItemsFolder(dao, cache, kind, ids, folderId) }
    }

    private suspend fun mirrorList(kind: String, path: String, body: String?) {
        FolderStore.put(cache, FolderStore.applyOp(FolderStore.all(cache), kind, path, body))
    }

    /** Snapshot of what a write may change, to undo it when the server refuses. */
    private suspend fun snapshot(): suspend () -> Unit {
        val folders = FolderStore.all(cache)
        val decks = dao.decks().associate { it.id to it.folderId }
        val lessons = cache.entry(dev.jeromeswannack.chineselearning.lab.ui.library.LibraryKeys.LIST)?.json
        val readers = cache.entry(dev.jeromeswannack.chineselearning.lab.data.readers.ReaderStore.LIST)?.json
        return {
            FolderStore.put(cache, folders)
            for ((folderId, ids) in decks.entries.groupBy({ it.value }, { it.key })) dao.setDeckFolder(ids, folderId)
            restoreRaw(dev.jeromeswannack.chineselearning.lab.ui.library.LibraryKeys.LIST, dev.jeromeswannack.chineselearning.lab.ui.library.LibraryKeys.KIND, lessons)
            restoreRaw(dev.jeromeswannack.chineselearning.lab.data.readers.ReaderStore.LIST, dev.jeromeswannack.chineselearning.lab.data.readers.ReaderStore.KIND, readers)
        }
    }

    private suspend fun restoreRaw(key: String, kind: String, json: String?) {
        if (json == null) return
        val el = runCatching { folderJson.parseToJsonElement(json) }.getOrNull() ?: return
        cache.put(key, kind, el, kotlinx.serialization.json.JsonElement.serializer())
    }

    private suspend fun write(
        kind: String,
        method: String,
        path: String,
        body: String?,
        goneIsDone: Boolean = false,
        outboxId: String = "$kind:${newId()}",
        mirror: suspend () -> Unit,
    ): WriteOutcome = withContext(Dispatchers.IO) {
        lock.withLock {
            val undo = snapshot()
            mirror()
            onLocalChange()
            if (online() && !hasQueuedWrites()) {
                try {
                    val res = api.send(method, path, body)
                    if (res.ok || (goneIsDone && res.code == 404)) return@withLock WriteOutcome.Saved
                    if (res.code in 400..499 && res.code != 408 && res.code != 429) {
                        undo()
                        onLocalChange()
                        val e = HttpException(res.code, res.body.take(200), res.body)
                        return@withLock WriteOutcome.Refused(e.problems().firstOrNull() ?: e.userMessage())
                    }
                    // 5xx / 408 / 429: the Outbox retries it.
                } catch (e: UnauthorizedException) {
                    undo()
                    onLocalChange()
                    return@withLock WriteOutcome.Refused(e.userMessage())
                } catch (_: IOException) {
                    // Offline after all: queue it.
                }
            }
            outbox.enqueue(kind, method, path, body, id = outboxId)
            onQueued()
            WriteOutcome.Queued
        }
    }

    private suspend fun hasQueuedWrites(): Boolean = outbox.all().any { it.state == Outbox.PENDING && it.kind in FolderStore.KINDS }
}
