package dev.jeromeswannack.chineselearning.lab.data.platform

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.ApiResponse
import dev.jeromeswannack.chineselearning.lab.data.api.send
import dev.jeromeswannack.chineselearning.lab.data.api.sendFile
import dev.jeromeswannack.chineselearning.lab.data.api.upload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.serializer
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * Offline writes. A feature records the API call it wants to make; the outbox replays
 * the calls in order during sync (Repository.sync → LabPlatform.afterSync) and from the
 * background SyncWorker — like the web app's pendingRecordings / pendingCardFlags queues.
 *
 * Rules:
 *  - Only for IDEMPOTENT endpoints with a client-generated id (the server dedupes on
 *    it: `POST /api/card-flags { id, … }`), because a call can be replayed after a
 *    timeout that actually reached the server.
 *  - Update the local state (JsonCache / Room) optimistically when enqueuing; the
 *    outbox only moves the write to the server.
 *  - Strict order: a network or server error (5xx / 408 / 429) stops the drain and the
 *    item is retried next time; after [MAX_ATTEMPTS] it is marked failed. A 4xx
 *    rejection (other than 401/408/409/429) marks the item failed at once and the
 *    drain moves on. 409 counts as done (the server already has it).
 *  - A failed item stays in the table for the UI / debug report; [retryFailed] re-queues.
 *  - Upload files: write them into [stageFile]; staged files are deleted after the
 *    upload succeeds. Multipart ([enqueueUpload]) or the raw body ([enqueueRaw]).
 */
class Outbox(private val dao: PlatformDao, private val api: Api, val dir: File) {
    private val mutex = Mutex()
    private val _completed = MutableSharedFlow<OutboxEntity>(extraBufferCapacity = 64)

    /** Items the server accepted (e.g. to refresh a screen after an upload). */
    val completed: SharedFlow<OutboxEntity> = _completed.asSharedFlow()

    data class DrainResult(val sent: Int, val failed: Int, val remaining: Int)

    /** A fresh file in the outbox's own folder; hand it to [enqueueUpload] and it is deleted once uploaded. */
    fun stageFile(name: String): File {
        dir.mkdirs()
        return File(dir, "${UUID.randomUUID()}-${name.replace(Regex("[^A-Za-z0-9._-]"), "_")}")
    }

    /** Queues a JSON call. Returns the item id ([id] = your client-generated id, so re-enqueueing is a no-op). */
    suspend fun enqueue(kind: String, method: String, path: String, bodyJson: String? = null, id: String = UUID.randomUUID().toString()): String {
        dao.insertOutbox(OutboxEntity(id = id, kind = kind, method = method, path = path, bodyJson = bodyJson, filePath = null, fileField = null, fileName = null, fileMime = null, createdAt = System.currentTimeMillis()))
        return id
    }

    /** Queues a JSON call with a typed body. */
    suspend inline fun <reified B> enqueueJson(kind: String, method: String, path: String, body: B, id: String = UUID.randomUUID().toString()): String =
        enqueue(kind, method, path, apiJson().encodeToString(apiJson().serializersModule.serializer<B>(), body), id)

    /** Queues a multipart upload of [file] (+ text [fields]). */
    suspend fun enqueueUpload(
        kind: String,
        path: String,
        file: File,
        fileField: String = "file",
        fileName: String = file.name,
        mime: String = "application/octet-stream",
        fields: Map<String, String> = emptyMap(),
        id: String = UUID.randomUUID().toString(),
    ): String {
        val body = apiJson().encodeToString(MapSerializer(String.serializer(), String.serializer()), fields)
        dao.insertOutbox(OutboxEntity(id = id, kind = kind, method = "POST", path = path, bodyJson = body, filePath = file.absolutePath, fileField = fileField, fileName = fileName, fileMime = mime, createdAt = System.currentTimeMillis()))
        return id
    }

    /**
     * Queues [file] as the RAW request body (not multipart) — e.g. a video-call recording chunk,
     * `PUT /api/calls/:id/pieces/:pieceId/chunks/:idx`. Stored like an upload with no form field.
     */
    suspend fun enqueueRaw(kind: String, method: String, path: String, file: File, mime: String, id: String = UUID.randomUUID().toString()): String {
        dao.insertOutbox(OutboxEntity(id = id, kind = kind, method = method, path = path, bodyJson = null, filePath = file.absolutePath, fileField = null, fileName = file.name, fileMime = mime, createdAt = System.currentTimeMillis()))
        return id
    }

    @PublishedApi internal fun apiJson() = api.json

    fun observe(kind: String? = null): Flow<List<OutboxEntity>> = if (kind == null) dao.observeOutbox() else dao.observeOutboxKind(kind)

    suspend fun all(): List<OutboxEntity> = dao.allOutbox()

    suspend fun pendingCount(): Int = dao.pendingOutboxCount()

    suspend fun retryFailed(kind: String? = null) = dao.retryFailedOutbox(kind)

    suspend fun discardFailed(kind: String? = null) = dao.discardFailedOutbox(kind)

    /** Re-queues one item (a chat's "Not sent · Tap to retry"). */
    suspend fun retry(id: String) = dao.retryOutboxItem(id)

    /** Drops one item (pending or failed) and its staged file. */
    suspend fun discard(id: String) {
        val item = dao.allOutbox().firstOrNull { it.id == id } ?: return
        dao.deleteOutbox(id)
        item.filePath?.let { p -> File(p).takeIf { it.parentFile?.canonicalPath == dir.canonicalPath }?.delete() }
    }

    /**
     * Sends pending items oldest first. Throws [UnauthorizedException] (the session
     * expired); every other problem is recorded on the item.
     */
    suspend fun drain(): DrainResult = mutex.withLock {
        withContext(Dispatchers.IO) {
            var sent = 0
            var failed = 0
            val tried = HashSet<String>()
            loop@ while (true) {
                val batch = dao.pendingOutbox(50).filter { it.id !in tried }
                if (batch.isEmpty()) break
                for (item in batch) {
                    tried += item.id
                    val res: ApiResponse? = try {
                        execute(item)
                    } catch (e: UnauthorizedException) {
                        throw e
                    } catch (e: IOException) {
                        // Offline / timeout: keep the order, try again on the next sync.
                        dao.updateOutbox(item.id, item.attempts, e.message ?: e.javaClass.simpleName, PENDING)
                        break@loop
                    }
                    if (res == null) {
                        dao.updateOutbox(item.id, item.attempts + 1, "file missing: ${item.filePath}", FAILED)
                        failed++
                        continue
                    }
                    when {
                        res.ok || res.code == 409 -> {
                            dao.deleteOutbox(item.id)
                            item.filePath?.let { p -> File(p).takeIf { it.parentFile?.canonicalPath == dir.canonicalPath }?.delete() }
                            _completed.tryEmit(item)
                            sent++
                        }
                        res.code == 408 || res.code == 429 || res.code >= 500 -> {
                            val attempts = item.attempts + 1
                            val state = if (attempts >= MAX_ATTEMPTS) FAILED else PENDING
                            dao.updateOutbox(item.id, attempts, "HTTP ${res.code}: ${res.body.take(200)}", state)
                            if (state == FAILED) { failed++; continue } else break@loop
                        }
                        else -> {
                            dao.updateOutbox(item.id, item.attempts + 1, "HTTP ${res.code}: ${res.body.take(200)}", FAILED)
                            failed++
                        }
                    }
                }
            }
            DrainResult(sent, failed, dao.pendingOutboxCount())
        }
    }

    /** Null when the upload's file has gone. */
    private suspend fun execute(item: OutboxEntity): ApiResponse? {
        val path = item.filePath ?: return api.send(item.method, item.path, item.bodyJson)
        val file = File(path)
        if (!file.exists()) return null
        if (item.fileField == null) return api.sendFile(item.method, item.path, file, item.fileMime ?: "application/octet-stream")
        val fields = item.bodyJson?.let { api.json.decodeFromString(MapSerializer(String.serializer(), String.serializer()), it) }.orEmpty()
        return api.upload(item.path, file, item.fileField ?: "file", item.fileName ?: file.name, item.fileMime ?: "application/octet-stream", fields, item.method)
    }

    /** Deletes staged files (sign-out; the table itself is cleared with the database). */
    fun clearFiles() {
        dir.listFiles()?.forEach { it.delete() }
    }

    companion object {
        const val PENDING = "pending"
        const val FAILED = "failed"
        const val MAX_ATTEMPTS = 10
    }
}
