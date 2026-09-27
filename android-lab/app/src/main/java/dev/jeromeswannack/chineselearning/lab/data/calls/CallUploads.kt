package dev.jeromeswannack.chineselearning.lab.data.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.PieceRecorder
import dev.jeromeswannack.chineselearning.lab.data.api.CallPaths
import dev.jeromeswannack.chineselearning.lab.data.api.ClosePieceBody
import dev.jeromeswannack.chineselearning.lab.data.api.RegisterPieceBody
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.serializer

/**
 * The video-call recording upload queue (port of frontend/src/services/calls/uploads.ts).
 *
 * The recorder never talks to the network: each piece's register / chunk / close becomes an
 * [Outbox] item (Room, survives process death), drained in order during the call, after every
 * sync and by the background SyncWorker — so a lesson recorded on a bad connection, or an app
 * the system killed, still arrives. Every call is idempotent on the server (piece ids are ours,
 * chunks are keyed by index), and the outbox ids are derived from them, so a retry is harmless.
 *
 * Open pieces are remembered in the [JsonCache] (web: the `callPieces` table): a piece left open
 * by a killed app gets its close queued with the chunks this phone did save ([closeOrphans]).
 */
class CallUploads(private val outbox: Outbox, private val cache: JsonCache) {
    @Serializable
    data class LocalPiece(
        val id: String,
        val call_id: String,
        val piece_index: Int,
        val started_at: Long,
        val chunk_count: Int = 0,
        /** open | closed */
        val status: String = "open",
    )

    private val mutex = Mutex()

    suspend fun register(callId: String, piece: PieceRecorder.PieceStart) = mutex.withLock {
        cache.put(pieceKey(piece.id), PIECES_KIND, LocalPiece(piece.id, callId, piece.index, piece.startedAt))
        val next = maxOf(piece.index + 1, cache.get<Int>(nextIndexKey(callId)) ?: 0)
        cache.put(nextIndexKey(callId), INDEX_KIND, next)
        outbox.enqueueJson(KIND, "POST", CallPaths.pieces(callId), RegisterPieceBody(piece.id, piece.index, piece.startedAt, piece.mimeType), id = "call-reg-${piece.id}")
    }

    suspend fun chunk(callId: String, pieceId: String, idx: Int, bytes: ByteArray) = mutex.withLock {
        val file = outbox.stageFile("call-$pieceId-$idx.ogg")
        file.writeBytes(bytes)
        outbox.enqueueRaw(KIND, "PUT", CallPaths.chunk(callId, pieceId, idx), file, PieceRecorder.MIME_TYPE.substringBefore(';'), id = "call-chunk-$pieceId-$idx")
        cache.get<LocalPiece>(pieceKey(pieceId))?.let { cache.put(pieceKey(pieceId), PIECES_KIND, it.copy(chunk_count = maxOf(it.chunk_count, idx + 1))) }
    }

    suspend fun close(callId: String, pieceId: String, chunkCount: Int, durationMs: Long) = mutex.withLock {
        outbox.enqueueJson(KIND, "POST", CallPaths.close(callId, pieceId), ClosePieceBody(chunkCount, durationMs), id = "call-close-$pieceId")
        cache.get<LocalPiece>(pieceKey(pieceId))?.let { cache.put(pieceKey(pieceId), PIECES_KIND, it.copy(status = "closed", chunk_count = chunkCount)) }
    }

    /** The next piece index for [callId] on this phone (numbering continues after a rejoin). */
    suspend fun nextIndex(callId: String): Int = cache.get<Int>(nextIndexKey(callId)) ?: 0

    /**
     * Pieces left open by an app that was killed mid-call: queue their close with the chunks
     * this phone saved. [activeCallId] is the call on screen right now (its pieces are live).
     * Also forgets closed pieces whose uploads are all done. Returns how many were closed.
     */
    suspend fun closeOrphans(activeCallId: String?): Int {
        var closed = 0
        for (p in pieces()) {
            if (p.status != "open" || p.call_id == activeCallId) continue
            close(p.call_id, p.id, p.chunk_count, 0)
            closed++
        }
        val queuedPaths = outbox.all().filter { it.kind == KIND && it.state == Outbox.PENDING }.map { it.path }
        for (p in pieces()) {
            if (p.status == "closed" && queuedPaths.none { it.contains("/pieces/${p.id}/") }) cache.delete(pieceKey(p.id))
        }
        return closed
    }

    suspend fun pieces(): List<LocalPiece> = cache.all(PIECES_KIND, cache.json.serializersModule.serializer<LocalPiece>())

    /** Upload items still waiting for [callId] (web: pendingCallUploads). */
    fun pending(callId: String): Flow<Int> = outbox.observe(KIND)
        .map { list -> list.count { it.state == Outbox.PENDING && it.path.startsWith(CallPaths.prefix(callId)) } }
        .distinctUntilChanged()

    suspend fun drain() = outbox.drain()

    /** The recorder's sink for [callId] (runs on the recording thread, so it blocks). */
    fun sink(callId: String): PieceRecorder.Sink = object : PieceRecorder.Sink {
        override fun register(piece: PieceRecorder.PieceStart) = runBlocking(Dispatchers.IO) { this@CallUploads.register(callId, piece); Unit }
        override fun chunk(pieceId: String, idx: Int, bytes: ByteArray) = runBlocking(Dispatchers.IO) { this@CallUploads.chunk(callId, pieceId, idx, bytes); Unit }
        override fun close(pieceId: String, chunkCount: Int, durationMs: Long) = runBlocking(Dispatchers.IO) { this@CallUploads.close(callId, pieceId, chunkCount, durationMs); Unit }
    }

    companion object {
        const val KIND = "call-upload"
        const val PIECES_KIND = "calls-pieces"
        const val INDEX_KIND = "calls-index"
        fun pieceKey(id: String) = "calls/piece/$id"
        fun nextIndexKey(callId: String) = "calls/next-index/$callId"

        /** The call on screen (its open pieces are being recorded, not orphans). Set by the live call. */
        @Volatile var activeCallId: String? = null
    }
}

/** After every sync: close orphaned pieces and push what they queued (web: closeOrphanPieces + drainCallUploads in sync). */
object CallsSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        val uploads = CallUploads(ctx.outbox, ctx.cache)
        if (uploads.closeOrphans(CallUploads.activeCallId) > 0) ctx.outbox.drain()
    }
}
