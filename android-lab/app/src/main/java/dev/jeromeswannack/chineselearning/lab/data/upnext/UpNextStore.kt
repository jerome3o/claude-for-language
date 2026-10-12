package dev.jeromeswannack.chineselearning.lab.data.upnext

import androidx.room.withTransaction
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.UpNext
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.UpNextEntity
import dev.jeromeswannack.chineselearning.lab.data.api.UpNextAddBody
import dev.jeromeswannack.chineselearning.lab.data.api.UpNextDto
import dev.jeromeswannack.chineselearning.lab.data.api.UpNextItemBody
import dev.jeromeswannack.chineselearning.lab.data.api.UpNextOrderBody
import dev.jeromeswannack.chineselearning.lab.data.api.enc
import dev.jeromeswannack.chineselearning.lab.data.api.upNextPosition
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.PlatformDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * "Up next" on this phone (core UpNext.kt; web services/upNext.ts) — the account's ordered list of
 * chosen notes, introduced first within the daily budget.
 *
 *  - Every change (add / reorder / remove) is written to Room (`up_next`) at once, so the queue,
 *    Home and the screen follow immediately, offline too, and queued in the Outbox in order
 *    (`POST /api/me/up-next` with client ids, `PUT …/order` with the whole order, `DELETE …/:noteId`
 *    — each idempotent), drained now when online.
 *  - The server's list (`up_next` on /api/sync/changes, or a full sync's GET) replaces the rows
 *    whenever no Up next change is still waiting in the Outbox.
 *  - Which notes are done / how many new cards are left comes from the local cards.
 */
object UpNextStore {
    const val OUTBOX_ADD = "up-next-add"
    const val OUTBOX_ORDER = "up-next-order"
    const val OUTBOX_REMOVE = "up-next-remove"
    private val KINDS = setOf(OUTBOX_ADD, OUTBOX_ORDER, OUTBOX_REMOVE)

    /** What an add did. */
    data class Result(val added: List<String>, val already: List<String>, val noNewCards: List<String>, val message: String)

    /** The list's note ids in order, for every StudyQueue.build; null when it can't be read (the queue still builds). */
    suspend fun queueList(dao: LabDao): List<String>? = try {
        dao.upNext().map { it.noteId }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Throwable) {
        android.util.Log.w("UpNextStore", "up next unavailable", e)
        null
    }

    /** note id → the queues of its cards on this phone. */
    suspend fun cardQueues(dao: LabDao, noteIds: Collection<String>): Map<String, List<Int>> =
        noteIds.distinct().chunked(500).flatMap { dao.cardsOfNotes(it) }.groupBy({ it.noteId }, { it.queue })

    private suspend fun writeOrder(dao: LabDao, order: List<String>, extra: Map<String, UpNextEntity> = emptyMap()) {
        val rows = dao.upNext().associateBy { it.noteId } + extra
        dao.clearUpNext()
        dao.upsertUpNext(order.mapIndexedNotNull { i, id -> rows[id]?.copy(position = i) })
    }

    /**
     * Put [noteIds] on the list at [position] ("top", "bottom", or a 0-based Int; null = bottom). A note
     * already on the list moves there when a position is given; a note with every card studied is
     * refused ([Result.noNewCards] — offer ⚡ Study it today).
     */
    suspend fun add(app: LabApp, noteIds: List<String>, position: Any?, source: String, nowMs: Long = System.currentTimeMillis()): Result {
        val dao = app.repo.dao
        val src = UpNext.normalizeSource(source)
        val ids = noteIds.distinct()
        val explicit = position != null && position != "bottom"
        val queues = cardQueues(dao, ids)
        val hanzi = dao.notes(ids).associate { it.id to it.hanzi }
        val current = dao.upNext().map { it.noteId }
        val onList = current.toHashSet()
        val added = ArrayList<String>()
        val already = ArrayList<String>()
        val noNew = ArrayList<String>()
        val place = ArrayList<String>()
        val fresh = HashMap<String, UpNextEntity>()
        val items = ArrayList<UpNextItemBody>()
        val now = Js.toIsoString(nowMs)
        for (id in ids) {
            if (id in onList) {
                already += id
                if (explicit) place += id
                continue
            }
            if (!UpNext.canAdd(queues[id].orEmpty())) { noNew += id; continue }
            val clientId = UUID.randomUUID().toString()
            fresh[id] = UpNextEntity(id, clientId, 0, now, src, null)
            items += UpNextItemBody(clientId, id, now)
            added += id
            place += id
        }
        if (place.isNotEmpty()) {
            val index = if (explicit) indexOf(position, current.size) else null
            withContext(Dispatchers.IO) {
                app.repo.db.withTransaction { writeOrder(dao, UpNext.insertIntoOrder(current, place, index), fresh) }
                if (items.isNotEmpty()) {
                    app.outbox.enqueueJson(OUTBOX_ADD, "POST", "/api/me/up-next", UpNextAddBody(items = items, position = upNextPosition(index ?: "bottom"), source = src), id = items.first().id)
                }
                if (explicit && already.isNotEmpty()) {
                    app.outbox.enqueueJson(OUTBOX_ORDER, "PUT", "/api/me/up-next/order", UpNextOrderBody(dao.upNext().map { it.noteId }))
                }
            }
            app.repo.notifyLocalChange()
            send(app)
        }
        if (added.isNotEmpty()) app.analytics.track("study.up_next_added", mapOf("source" to src, "count" to added.size, "already" to already.size))
        val names = { list: List<String> -> list.mapNotNull { hanzi[it]?.takeIf { h -> h.isNotEmpty() } } }
        val message = if (explicit && already.isNotEmpty() && added.isEmpty()) "Moved" else UpNext.addedMessage(names(added), already.size, noNew.size)
        return Result(added, already, noNew, message)
    }

    /** A new order (drag / ↑ top); the whole order goes up. */
    suspend fun reorder(app: LabApp, order: List<String>, how: String) {
        val dao = app.repo.dao
        withContext(Dispatchers.IO) {
            app.repo.db.withTransaction { writeOrder(dao, order) }
            app.outbox.enqueueJson(OUTBOX_ORDER, "PUT", "/api/me/up-next/order", UpNextOrderBody(order))
        }
        app.analytics.track("study.up_next_moved", mapOf("how" to how))
        app.repo.notifyLocalChange()
        send(app)
    }

    /** Take a note off the list (the note is kept). Returns its old index for Undo, null when it wasn't on it. */
    suspend fun remove(app: LabApp, noteId: String, source: String = "up_next_page"): Int? {
        val dao = app.repo.dao
        val current = dao.upNext().map { it.noteId }
        val index = current.indexOf(noteId).takeIf { it >= 0 } ?: return null
        withContext(Dispatchers.IO) {
            app.repo.db.withTransaction { writeOrder(dao, current.filter { it != noteId }) }
            app.outbox.enqueue(OUTBOX_REMOVE, "DELETE", "/api/me/up-next/${enc(noteId)}")
        }
        app.analytics.track("study.up_next_removed", mapOf("source" to UpNext.normalizeSource(source)))
        app.repo.notifyLocalChange()
        send(app)
        return index
    }

    private fun indexOf(position: Any?, size: Int): Int = when (position) {
        "top" -> 0
        is Int -> position.coerceIn(0, size)
        else -> size
    }

    private fun send(app: LabApp) {
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } } else app.scheduleBackgroundUpload()
    }

    /** The server's list replaces the rows — only when no Up next change made here is still waiting. */
    suspend fun replaceFromServer(db: LabDatabase, platform: PlatformDao, server: List<UpNextDto>) {
        if (platform.allOutbox().any { it.kind in KINDS && it.state == Outbox.PENDING }) return
        val dao = db.dao()
        db.withTransaction {
            dao.clearUpNext()
            dao.upsertUpNext(
                server.sortedBy { it.position }.distinctBy { it.note_id }.mapIndexed { i, e ->
                    UpNextEntity(e.note_id, e.id, i, e.created_at, UpNext.normalizeSource(e.source), e.added_by_name?.takeIf { it.isNotBlank() })
                },
            )
        }
    }

    /** The list's status per note (new / started / done / missing) from the local cards. */
    suspend fun statuses(dao: LabDao, noteIds: List<String>): Map<String, Pair<String, Int>> {
        val q = cardQueues(dao, noteIds)
        return noteIds.associateWith { id -> val qs = q[id].orEmpty(); UpNext.status(qs) to qs.count { it == CardQueue.NEW } }
    }
}
