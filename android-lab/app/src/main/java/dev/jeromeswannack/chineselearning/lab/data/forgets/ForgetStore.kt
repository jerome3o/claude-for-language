package dev.jeromeswannack.chineselearning.lab.data.forgets

import androidx.room.withTransaction
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Leech
import dev.jeromeswannack.chineselearning.lab.data.CardForgetEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.api.CardForgetDto
import dev.jeromeswannack.chineselearning.lab.data.api.ForgetBody
import dev.jeromeswannack.chineselearning.lab.data.api.ForgetItemBody
import dev.jeromeswannack.chineselearning.lab.data.api.ForgetUndoBody
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.PlatformDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * "Forget this card" on this phone (core Forgets / Leech; web services/cardForgets.ts;
 * docs/STUDY_SESSION.md "Forget").
 *
 *  - A forget is written to Room at once (`card_forgets`, pending "add") and the card is replayed from
 *    its events + forgets — NEW from now on, offline too — then queued in the Outbox as
 *    `POST /api/me/card-forgets` with its client id (idempotent).
 *  - Undo (the toast's button, right after) marks the rows pending "undo" (out of the replay at once),
 *    queues `POST /api/me/card-forgets/undo` and replays the cards again — back as they were.
 *  - Every sync replaces the synced rows with the server's FULL live list ([replaceFromServer]); a row
 *    whose Outbox item is still pending stays as made here. The cards whose forgets changed are
 *    returned so the sync replays them.
 * The review history is never touched.
 */
object ForgetStore {
    const val OUTBOX_ADD = "card-forget"
    const val OUTBOX_UNDO = "card-forget-undo"
    const val PENDING_ADD = "add"
    const val PENDING_UNDO = "undo"

    data class Outcome(val ids: List<String>, val cardIds: List<String>, val message: String)

    /** Forget [cardIds] now. [scope] = "card" | "note", [source] = "study" | "card_hub" | "leech" (analytics). */
    suspend fun forget(app: LabApp, cardIds: List<String>, scope: String, source: String, nowMs: Long = System.currentTimeMillis()): Outcome {
        val ids = cardIds.distinct()
        if (ids.isEmpty()) return Outcome(emptyList(), emptyList(), "")
        val at = Js.toIsoString(nowMs)
        val items = ids.map { ForgetItemBody(UUID.randomUUID().toString(), it, at, "app") }
        val dao = app.repo.dao
        withContext(Dispatchers.IO) {
            val outboxId = items.first().id
            app.outbox.enqueueJson(OUTBOX_ADD, "POST", "/api/me/card-forgets", ForgetBody(items), id = outboxId)
            dao.upsertCardForgets(items.map { CardForgetEntity(it.id, it.card_id, at, PENDING_ADD, outboxId) })
        }
        app.repo.replayCards(ids)
        app.analytics.track("card.forget", mapOf("scope" to scope, "count" to ids.size, "source" to source, "undone" to false))
        send(app)
        return Outcome(items.map { it.id }, ids, Leech.forgetMessage(ids.size))
    }

    /** Undo: these forgets stop counting at once; the cards are back as they were. Returns the toast line. */
    suspend fun undo(app: LabApp, forgetIds: List<String>, source: String): String {
        if (forgetIds.isEmpty()) return ""
        val dao = app.repo.dao
        val rows = withContext(Dispatchers.IO) { dao.cardForgets().filter { it.id in forgetIds.toSet() } }
        if (rows.isEmpty()) return ""
        withContext(Dispatchers.IO) {
            val outboxId = app.outbox.enqueueJson(OUTBOX_UNDO, "POST", "/api/me/card-forgets/undo", ForgetUndoBody(rows.map { it.id }))
            dao.upsertCardForgets(rows.map { it.copy(pending = PENDING_UNDO, outboxId = outboxId) })
        }
        val cards = rows.map { it.cardId }.distinct()
        app.repo.replayCards(cards)
        app.analytics.track("card.forget", mapOf("count" to cards.size, "source" to source, "undone" to true))
        send(app)
        return Leech.undoForgetMessage(cards.size)
    }

    private fun send(app: LabApp) {
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } } else app.scheduleBackgroundUpload()
    }

    /**
     * The server's FULL live list replaces the synced rows; a row whose Outbox item is still pending keeps
     * the local change. Returns the cards whose live forgets changed (the sync replays them).
     */
    suspend fun replaceFromServer(db: LabDatabase, platform: PlatformDao, server: List<CardForgetDto>): Set<String> {
        val dao = db.dao()
        val pendingOutbox = platform.allOutbox().filter { it.state == Outbox.PENDING }.mapTo(HashSet()) { it.id }
        val changed = HashSet<String>()
        db.withTransaction {
            val local = dao.cardForgets()
            fun live(rows: List<CardForgetEntity>) = rows.filter { it.pending != PENDING_UNDO }.map { "${it.cardId}@${it.forgottenAt}" }.toSet()
            val keep = local.filter { it.pending != null && it.outboxId != null && it.outboxId in pendingOutbox }
            val keptIds = keep.mapTo(HashSet()) { it.id }
            val before = local.groupBy { it.cardId }
            val drop = local.map { it.id }.filter { it !in keptIds }
            drop.chunked(500).forEach { dao.deleteCardForgets(it) }
            dao.upsertCardForgets(server.filter { it.id !in keptIds }.map { CardForgetEntity(it.id, it.card_id, it.forgotten_at) })
            val after = dao.cardForgets().groupBy { it.cardId }
            for (card in before.keys + after.keys) {
                if (live(before[card].orEmpty()) != live(after[card].orEmpty())) changed += card
            }
        }
        return changed
    }
}
