package dev.jeromeswannack.chineselearning.lab.data.homework

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.api.enc
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.PlatformDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * "Add to my long-term review" — the learner's per-word choice (core LongTerm.kt, Room
 * notes.longTerm, server notes.long_term). Port of the web's services/longTerm.ts:
 *
 *  - the choice is written to the Room note at once (every StudyQueue.build reads it, so the
 *    queue / Home follow immediately, offline too) and queued in the Outbox as
 *    `PUT /api/notes/:id/long-term` (idempotent: it sets a value), drained now when online;
 *  - a sync that rewrites notes re-applies the choices still in the Outbox ([reapplyPending]),
 *    so a download racing an un-uploaded choice never flips the switch back.
 */
object LongTermStore {
    const val OUTBOX_KIND = "note-long-term"

    @Serializable
    data class Body(val long_term: Int?, val note_id: String)

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = true; encodeDefaults = true }

    suspend fun set(app: LabApp, noteId: String, pref: Int?) {
        withContext(Dispatchers.IO) {
            app.repo.dao.setNoteLongTerm(noteId, pref)
            // A fresh id per choice: the Outbox ignores a duplicate id, and items drain in order,
            // so the server ends on the last one.
            app.outbox.enqueue(OUTBOX_KIND, "PUT", "/api/notes/${enc(noteId)}/long-term", json.encodeToString(Body.serializer(), Body(pref, noteId)))
        }
        app.repo.notifyLocalChange()
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } } else app.scheduleBackgroundUpload()
    }

    /** Inside the sync transaction that wrote notes: the pending choices win, the last one per note. */
    suspend fun reapplyPending(dao: LabDao, platform: PlatformDao) {
        val pending = platform.allOutbox().filter { it.kind == OUTBOX_KIND && it.state == Outbox.PENDING }
        for (item in pending) {
            val body = runCatching { json.decodeFromString(Body.serializer(), item.bodyJson ?: return@runCatching null) }.getOrNull() ?: continue
            dao.setNoteLongTerm(body.note_id, body.long_term)
        }
    }
}
